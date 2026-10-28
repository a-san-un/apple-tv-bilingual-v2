/**
 * subtitle-block-builder.ts
 *
 * 両言語の cue snapshot から字幕 truth を構築する純関数。
 * 入力検証・完全重複除去・同時刻正規化・候補生成・全体選択・block 出力を行う。
 * track、DOM、source の取得・購読、history は扱わず、資源や入力参照を保持しない。
 */
import type { SubtitleBlock, SubtitleCueSnapshot } from '../shared/types';
import { generateSubtitleCandidates, type NormalizedSubtitleUnit, type SubtitleMatchCandidate } from './subtitle-block-candidates';

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
 * 完全重複除去後、連続する同一開始・終了時刻の cue を1単位にする。
 * @param cues 全件の検証を済ませた、開始時刻順の同一役割の cue。track は読まない。
 * @returns 本文順・元の先頭入力位置を保持した新しい単位配列。入力参照は保持しない。
 */
const normalizeSubtitleCues = (
  cues: readonly SubtitleCueSnapshot[],
): NormalizedSubtitleUnit[] => {
  const seen = new Set<string>();
  const unique = cues.flatMap((cue, inputIndex) => {
    const { startTime, endTime, text } = cue;
    const key = JSON.stringify([startTime, endTime, text]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ startTime, endTime, text, inputIndex }];
  });

  const units: NormalizedSubtitleUnit[] = [];
  for (let offset = 0; offset < unique.length;) {
    const first = unique[offset];
    if (first === undefined) throw new Error('Missing subtitle cue');
    const texts = [first.text];
    let nextOffset = offset + 1;
    while (nextOffset < unique.length) {
      const next = unique[nextOffset];
      if (next === undefined) throw new Error('Missing subtitle cue');
      if (next.startTime !== first.startTime || next.endTime !== first.endTime) break;
      texts.push(next.text);
      nextOffset += 1;
    }
    units.push({ ...first, text: texts.join('\n') });
    offset = nextOffset;
  }
  return units;
};

/**
 * 採用した正規化単位から本文と時刻を確定する。
 * @param primaryUnits 学習言語の採用単位。未対応なら空配列。
 * @param secondaryUnits 母国語の採用単位。未対応なら空配列。
 * @returns unit 参照や内部位置を持たない新しい block。
 */
const createBlock = (
  primaryUnits: readonly NormalizedSubtitleUnit[],
  secondaryUnits: readonly NormalizedSubtitleUnit[],
): SubtitleBlock => {
  const timedUnits = primaryUnits.length > 0 ? primaryUnits : secondaryUnits;
  const first = timedUnits[0];
  if (first === undefined) throw new Error('Cannot create an empty subtitle block');
  return {
    startTime: first.startTime,
    endTime: timedUnits.reduce((end, unit) => Math.max(end, unit.endTime), first.endTime),
    primaryText: primaryUnits.length === 0 ? null : primaryUnits.map((unit) => unit.text).join('\n'),
    secondaryText: secondaryUnits.length === 0 ? null : secondaryUnits.map((unit) => unit.text).join('\n'),
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

  const primaryUnits = normalizeSubtitleCues(primaryCues);
  const secondaryUnits = normalizeSubtitleCues(secondaryCues);
  const selected = selectSubtitleCandidates(generateSubtitleCandidates(primaryUnits, secondaryUnits));
  const matches = new Map(selected.map((match) => [match.primaryOffset, match]));
  const consumedSecondaryOffsets = new Set<number>();
  const primaryBlocks: SubtitleBlock[] = [];
  for (let offset = 0; offset < primaryUnits.length;) {
    const match = matches.get(offset);
    const primaryCount = match?.primaryCount ?? 1;
    const matchedPrimaryUnits = primaryUnits.slice(offset, offset + primaryCount);
    const matchedSecondaryUnits = match === undefined ? [] : secondaryUnits.slice(
      match.secondaryOffset, match.secondaryOffset + match.secondaryCount);
    if (match !== undefined) {
      for (let i = 0; i < match.secondaryCount; i += 1) {
        consumedSecondaryOffsets.add(match.secondaryOffset + i);
      }
    }
    primaryBlocks.push(createBlock(matchedPrimaryUnits, matchedSecondaryUnits));
    offset += primaryCount;
  }
  const secondaryBlocks = secondaryUnits.flatMap((unit, offset) =>
    consumedSecondaryOffsets.has(offset) ? [] : [createBlock([], [unit])]);
  const blocks: SubtitleBlock[] = [];
  let secondaryBlockOffset = 0;
  for (const primaryBlock of primaryBlocks) {
    while (secondaryBlockOffset < secondaryBlocks.length) {
      const secondaryBlock = secondaryBlocks[secondaryBlockOffset];
      if (secondaryBlock === undefined) throw new Error('Missing secondary block');
      if (secondaryBlock.startTime >= primaryBlock.startTime) break;
      blocks.push(secondaryBlock);
      secondaryBlockOffset += 1;
    }
    blocks.push(primaryBlock);
  }
  blocks.push(...secondaryBlocks.slice(secondaryBlockOffset));
  return blocks;
};

/** 単位ベースの採用列。後続を共有し、比較中の配列コピーを避ける。 */
type SelectionPlan = {
  score: number;
  mergeCount: number;
  matchedUnitCount: number;
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
  if (left.matchedUnitCount !== right.matchedUnitCount) {
    return left.matchedUnitCount > right.matchedUnitCount;
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
    score: 0, mergeCount: 0, matchedUnitCount: 0, candidate: null, next: null,
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
      matchedUnitCount: candidate.primaryCount + candidate.secondaryCount + suffix.matchedUnitCount,
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
