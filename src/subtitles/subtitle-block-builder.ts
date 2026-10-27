/**
 * subtitle-block-builder.ts
 *
 * 両言語の cue snapshot から字幕 truth を構築する純関数。
 * 入力検証・完全重複除去・候補生成・全体選択・block 出力を行う。
 * track、DOM、source の取得・購読、history は扱わず、資源や入力参照を保持しない。
 */
import type { SubtitleBlock, SubtitleCueSnapshot } from '../shared/types';
import { generateSubtitleCandidates, type IndexedCue, type SubtitleMatchCandidate } from './subtitle-block-candidates';

/**
 * cue の時刻範囲と本文が入力条件を満たすかを確認する。
 * @param cue 検証する cue snapshot。track は参照しない。
 * @returns 有限の非負時刻、正の長さ、空白だけでない本文なら true。
 */
const isSupportedCue = (cue: SubtitleCueSnapshot): boolean =>
  Number.isFinite(cue.startTime) &&
  Number.isFinite(cue.endTime) &&
  cue.startTime >= 0 &&
  cue.startTime < cue.endTime &&
  cue.text.trim().length > 0;

/**
 * 同言語の完全重複だけを除去する。
 * @param cues 入力検証済みの cue 配列。
 * @returns 最初の入力位置と本文・時刻を保持した、新しい内部表現の配列。
 */
const deduplicateCues = (cues: readonly SubtitleCueSnapshot[]): IndexedCue[] => {
  const seen = new Set<string>();
  const result: IndexedCue[] = [];
  cues.forEach((cue, inputIndex) => {
    const { startTime, endTime, text } = cue;
    const key = JSON.stringify([startTime, endTime, text]);
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ startTime, endTime, text, inputIndex });
  });
  return result;
};

/**
 * 採用した cue 群から本文と時刻を確定する。
 * @param primary 学習言語の採用 cue。未対応なら空配列。
 * @param secondary 母国語の採用 cue。未対応なら空配列。
 * @returns cue 参照や内部位置を持たない新しい block。
 */
const createBlock = (
  primary: readonly IndexedCue[],
  secondary: readonly IndexedCue[],
): SubtitleBlock => {
  const timedCues = primary.length > 0 ? primary : secondary;
  const first = timedCues[0];
  if (first === undefined) throw new Error('Cannot create an empty subtitle block');
  return {
    startTime: first.startTime,
    endTime: timedCues.reduce((end, cue) => Math.max(end, cue.endTime), first.endTime),
    primaryText: primary.length === 0 ? null : primary.map((cue) => cue.text).join('\n'),
    secondaryText: secondary.length === 0 ? null : secondary.map((cue) => cue.text).join('\n'),
  };
};

/**
 * cue 配列を検証し、対応づけと片言語の保持により字幕 truth を構築する。
 * @param primaryCues 開始時刻の非減少順に並んだ学習言語 cue。
 * @param secondaryCues 開始時刻の非減少順に並んだ母国語 cue。
 * @returns primary の順を軸に母国語のみの block を挿入した、新しい block 配列。
 * @throws RangeError 時刻・本文・入力順が入力条件を満たさない場合。
 */
export const buildSubtitleBlocks = (
  primaryCues: readonly SubtitleCueSnapshot[],
  secondaryCues: readonly SubtitleCueSnapshot[],
): SubtitleBlock[] => {
  for (const cues of [primaryCues, secondaryCues]) {
    let previousStartTime = 0;
    for (const cue of cues) {
      if (!isSupportedCue(cue) || cue.startTime < previousStartTime) {
        throw new RangeError('Subtitle cue time, text, or input order is invalid');
      }
      previousStartTime = cue.startTime;
    }
  }

  const primaryInputs = deduplicateCues(primaryCues);
  const secondaryInputs = deduplicateCues(secondaryCues);
  const selected = selectSubtitleCandidates(generateSubtitleCandidates(primaryInputs, secondaryInputs));
  const matches = new Map(selected.map((match) => [match.primaryOffset, match]));
  const consumedSecondary = new Set<number>();
  const primaryBlocks: SubtitleBlock[] = [];
  for (let offset = 0; offset < primaryInputs.length;) {
    const match = matches.get(offset);
    const primaryCount = match?.primaryCount ?? 1;
    const primary = primaryInputs.slice(offset, offset + primaryCount);
    const secondary = match === undefined ? [] : secondaryInputs.slice(
      match.secondaryOffset, match.secondaryOffset + match.secondaryCount);
    if (match !== undefined) {
      for (let i = 0; i < match.secondaryCount; i += 1) {
        consumedSecondary.add(match.secondaryOffset + i);
      }
    }
    primaryBlocks.push(createBlock(primary, secondary));
    offset += primaryCount;
  }
  const secondaryBlocks = secondaryInputs.flatMap((cue, offset) =>
    consumedSecondary.has(offset) ? [] : [createBlock([], [cue])]);
  const blocks: SubtitleBlock[] = [];
  let secondaryOffset = 0;
  for (const primaryBlock of primaryBlocks) {
    while (secondaryOffset < secondaryBlocks.length) {
      const secondaryBlock = secondaryBlocks[secondaryOffset];
      if (secondaryBlock === undefined) throw new Error('Missing secondary block');
      if (secondaryBlock.startTime >= primaryBlock.startTime) break;
      blocks.push(secondaryBlock);
      secondaryOffset += 1;
    }
    blocks.push(primaryBlock);
  }
  blocks.push(...secondaryBlocks.slice(secondaryOffset));
  return blocks;
};

/** 採用列の内部表現。後続を共有し、比較中の配列コピーを避ける。 */
type SelectionPlan = {
  score: number;
  mergeCount: number;
  matchedCueCount: number;
  candidate: SubtitleMatchCandidate | null;
  next: SelectionPlan | null;
};

/**
 * 系列全体の優先順位を比較する。
 * @param left 比較する採用列。
 * @param right 比較する採用列。
 * @returns left を優先する場合は true。同一なら false。
 */
const isBetterSelection = (left: SelectionPlan, right: SelectionPlan): boolean => {
  if (left.score !== right.score) return left.score > right.score;
  if (left.mergeCount !== right.mergeCount) return left.mergeCount < right.mergeCount;
  if (left.matchedCueCount !== right.matchedCueCount) {
    return left.matchedCueCount > right.matchedCueCount;
  }
  let a: SelectionPlan | null = left;
  let b: SelectionPlan | null = right;
  while (a?.candidate != null && b?.candidate != null) {
    const keys = ['primaryInputIndex', 'secondaryInputIndex', 'primaryCount', 'secondaryCount'] as const;
    for (const key of keys) {
      if (a.candidate[key] !== b.candidate[key]) return a.candidate[key] < b.candidate[key];
    }
    a = a.next;
    b = b.next;
  }
  return a?.candidate == null && b?.candidate != null;
};

/**
 * 再利用なし・順序維持を満たす最良の採用列を選ぶ builder 内部の純関数。
 * @param candidates 候補生成済みの有効な候補。列挙順には依存しない。
 * @returns 入力順の採用候補。新しい配列と候補オブジェクトを返し、block は生成しない。
 */
export const selectSubtitleCandidates = (
  candidates: readonly SubtitleMatchCandidate[],
): SubtitleMatchCandidate[] => {
  const ordered = [...candidates].sort((a, b) =>
    a.primaryOffset - b.primaryOffset || a.secondaryOffset - b.secondaryOffset);
  const empty: SelectionPlan = {
    score: 0, mergeCount: 0, matchedCueCount: 0, candidate: null, next: null,
  };
  const plans: SelectionPlan[] = [];
  let best = empty;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const candidate = ordered[i];
    if (candidate === undefined) throw new Error('Missing candidate');
    let suffix = empty;
    for (let j = i + 1; j < ordered.length; j += 1) {
      const following = ordered[j];
      const plan = plans[j];
      if (following === undefined || plan === undefined) throw new Error('Missing selection plan');
      if (
        following.primaryOffset >= candidate.primaryOffset + candidate.primaryCount &&
        following.secondaryOffset >= candidate.secondaryOffset + candidate.secondaryCount &&
        isBetterSelection(plan, suffix)
      ) suffix = plan;
    }
    const plan: SelectionPlan = {
      score: candidate.score + suffix.score,
      mergeCount: (candidate.primaryCount + candidate.secondaryCount === 3 ? 1 : 0) + suffix.mergeCount,
      matchedCueCount: candidate.primaryCount + candidate.secondaryCount + suffix.matchedCueCount,
      candidate,
      next: suffix,
    };
    plans[i] = plan;
    if (isBetterSelection(plan, best)) best = plan;
  }
  const result: SubtitleMatchCandidate[] = [];
  let current: SelectionPlan | null = best;
  while (current?.candidate != null) {
    result.push({ ...current.candidate });
    current = current.next;
  }
  return result;
};
