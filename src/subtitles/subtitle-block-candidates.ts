/**
 * subtitle-block-candidates.ts
 * 検証・完全重複除去済みの cue から対応候補を作る builder 内部の純関数。
 * 候補の採用、cue の消費、本文結合、block 出力、source・DOM 操作は行わない。
 */
import type { SubtitleCueSnapshot } from '../shared/types';

/** 元の入力位置を保持する内部表現。cue・track の参照を含めない。 */
export type IndexedCue = Pick<SubtitleCueSnapshot, 'startTime' | 'endTime' | 'text'> & {
  inputIndex: number;
};

/** offset は重複除去後の位置、inputIndex は元の入力位置。 */
export type SubtitleMatchCandidate = {
  primaryOffset: number;
  secondaryOffset: number;
  primaryCount: 1 | 2;
  secondaryCount: 1 | 2;
  primaryInputIndex: number;
  secondaryInputIndex: number;
  overlapRatio: number;
  score: number;
};

type CandidateRange = {
  startTime: number;
  endTime: number;
  inputIndex: number;
};

/**
 * 隣接1件または2件の候補範囲を求める。
 * @param cues 開始時刻順で検証・重複除去済みの配列。
 * @param offset 重複除去後の先頭位置。
 * @param count 候補に使う件数。
 * @returns 範囲。件数不足または空白率が条件を超える場合は null。
 */
const getRange = (
  cues: readonly IndexedCue[],
  offset: number,
  count: 1 | 2,
): CandidateRange | null => {
  const first = cues[offset];
  if (first === undefined) return null;
  if (count === 1) {
    return { startTime: first.startTime, endTime: first.endTime, inputIndex: first.inputIndex };
  }
  const second = cues[offset + 1];
  if (second === undefined) return null;
  const endTime = Math.max(first.endTime, second.endTime);
  const gap = Math.max(0, second.startTime - first.endTime);
  const span = endTime - first.startTime;
  if (gap / span > 0.10) return null;
  return { startTime: first.startTime, endTime, inputIndex: first.inputIndex };
};

/**
 * 1対1・1対2・2対1の全対応候補を列挙する。
 * @param primary 検証・重複除去済みの学習言語 cue。元の入力位置を保持する。
 * @param secondary 検証・重複除去済みの母国語 cue。元の入力位置を保持する。
 * @returns 重なり率60%以上の候補と点数。入力参照を含まない新しい配列。
 */
export const generateSubtitleCandidates = (
  primary: readonly IndexedCue[],
  secondary: readonly IndexedCue[],
): SubtitleMatchCandidate[] => {
  const candidates: SubtitleMatchCandidate[] = [];
  const shapes = [[1, 1], [1, 2], [2, 1]] as const;
  for (let p = 0; p < primary.length; p += 1) {
    for (let s = 0; s < secondary.length; s += 1) {
      for (const [primaryCount, secondaryCount] of shapes) {
        const primaryRange = getRange(primary, p, primaryCount);
        const secondaryRange = getRange(secondary, s, secondaryCount);
        if (primaryRange === null || secondaryRange === null) continue;
        const overlap = Math.max(0,
          Math.min(primaryRange.endTime, secondaryRange.endTime) -
          Math.max(primaryRange.startTime, secondaryRange.startTime));
        const span = Math.max(primaryRange.endTime, secondaryRange.endTime) -
          Math.min(primaryRange.startTime, secondaryRange.startTime);
        const overlapRatio = overlap / span;
        if (overlapRatio < 0.60) continue;
        candidates.push({
          primaryOffset: p,
          secondaryOffset: s,
          primaryCount,
          secondaryCount,
          primaryInputIndex: primaryRange.inputIndex,
          secondaryInputIndex: secondaryRange.inputIndex,
          overlapRatio,
          score: (overlapRatio - 0.60) * (primaryCount + secondaryCount),
        });
      }
    }
  }
  return candidates;
};
