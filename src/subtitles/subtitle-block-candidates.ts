/**
 * subtitle-block-candidates.ts
 * 検証・完全重複除去・同時刻正規化済みの単位から対応候補を作る内部の純関数。
 * 候補の採用、単位の消費、本文結合、正規化、block 出力、source・DOM 操作は行わない。
 */
import type { SubtitleCueSnapshot } from '../shared/types';

/** 正規化済みの本文・時刻と先頭cueの元入力位置。生cueの件数や参照は持たない。 */
export type NormalizedSubtitleUnit = Pick<SubtitleCueSnapshot, 'startTime' | 'endTime' | 'text'> & {
  inputIndex: number;
};

/** offsetは正規化後の配列位置、Countは単位数、inputIndexは先頭cueの元入力位置。 */
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
 * 隣接1単位または2単位の候補範囲を求める。
 * @param units 開始時刻順で検証・重複除去・同時刻正規化済みの単位配列。
 * @param offset 正規化後の配列の先頭位置。
 * @param count 候補に使う単位数。
 * @returns 範囲。単位数不足または空白率が条件を超える場合は null。
 */
const getRange = (
  units: readonly NormalizedSubtitleUnit[],
  offset: number,
  count: 1 | 2,
): CandidateRange | null => {
  const first = units[offset];
  if (first === undefined) return null;
  if (count === 1) {
    return { startTime: first.startTime, endTime: first.endTime, inputIndex: first.inputIndex };
  }
  const second = units[offset + 1];
  if (second === undefined) return null;
  const endTime = Math.max(first.endTime, second.endTime);
  const gap = Math.max(0, second.startTime - first.endTime);
  const span = endTime - first.startTime;
  if (gap / span > 0.10) return null;
  return { startTime: first.startTime, endTime, inputIndex: first.inputIndex };
};

/**
 * 1対1・1対2・2対1の全対応候補を列挙する。
 * @param primaryUnits 検証・重複除去・同時刻正規化済みの学習言語単位。先頭cueの元入力位置を保持する。
 * @param secondaryUnits 検証・重複除去・同時刻正規化済みの母国語単位。先頭cueの元入力位置を保持する。
 * @returns 重なり率60%以上の候補と点数。入力参照を含まない新しい配列。
 */
export const generateSubtitleCandidates = (
  primaryUnits: readonly NormalizedSubtitleUnit[],
  secondaryUnits: readonly NormalizedSubtitleUnit[],
): SubtitleMatchCandidate[] => {
  const candidates: SubtitleMatchCandidate[] = [];
  const shapes = [[1, 1], [1, 2], [2, 1]] as const;
  for (let primaryOffset = 0; primaryOffset < primaryUnits.length; primaryOffset += 1) {
    for (let secondaryOffset = 0; secondaryOffset < secondaryUnits.length; secondaryOffset += 1) {
      for (const [primaryCount, secondaryCount] of shapes) {
        const primaryRange = getRange(primaryUnits, primaryOffset, primaryCount);
        const secondaryRange = getRange(secondaryUnits, secondaryOffset, secondaryCount);
        if (primaryRange === null || secondaryRange === null) continue;
        const overlap = Math.max(0,
          Math.min(primaryRange.endTime, secondaryRange.endTime) -
          Math.max(primaryRange.startTime, secondaryRange.startTime));
        const span = Math.max(primaryRange.endTime, secondaryRange.endTime) -
          Math.min(primaryRange.startTime, secondaryRange.startTime);
        const overlapRatio = overlap / span;
        if (overlapRatio < 0.60) continue;
        const matchedUnitCount = primaryCount + secondaryCount;
        candidates.push({
          primaryOffset,
          secondaryOffset,
          primaryCount,
          secondaryCount,
          primaryInputIndex: primaryRange.inputIndex,
          secondaryInputIndex: secondaryRange.inputIndex,
          overlapRatio,
          score: (overlapRatio - 0.60) * matchedUnitCount,
        });
      }
    }
  }
  return candidates;
};
