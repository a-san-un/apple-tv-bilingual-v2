/**
 * subtitle-block-candidates.test.ts
 * 対応候補の境界、結合制限、元の入力位置、入力不変性を確認する。
 */
import { describe, expect, it } from 'vitest';
import { generateSubtitleCandidates, type IndexedCue } from './subtitle-block-candidates';

/** 候補生成へ渡す検証済み内部データを作る。 */
const cue = (startTime: number, endTime: number, inputIndex = 0): IndexedCue => ({
  startTime, endTime, inputIndex, text: '本文',
});

describe('対応候補の生成', () => {
  it('片側が空なら呼び出しごとに新しい空配列を返す', () => {
    const first = generateSubtitleCandidates([], []);
    expect(first).toEqual([]);
    expect(generateSubtitleCandidates([], [])).not.toBe(first);
    expect(generateSubtitleCandidates([cue(0, 10)], [])).toEqual([]);
    expect(generateSubtitleCandidates([], [cue(0, 10)])).toEqual([]);
  });

  it.each([[5.999, false], [6, true], [6.001, true]] as const)(
    '重なり率の境界を判定する: 終了 %s', (end, expected) => {
      const result = generateSubtitleCandidates([cue(0, 10)], [cue(0, end)]);
      expect(result).toHaveLength(expected ? 1 : 0);
      if (expected) {
        expect(result[0]?.overlapRatio).toBeCloseTo(end / 10);
        expect(result[0]?.score).toBeCloseTo((end / 10 - 0.60) * 2);
      }
    });

  it('接触だけ・非重複は対応候補にしない', () => {
    expect(generateSubtitleCandidates([cue(0, 10)], [cue(10, 20)])).toEqual([]);
    expect(generateSubtitleCandidates([cue(0, 10)], [cue(11, 20)])).toEqual([]);
  });

  it.each([[0, true], [0.999, true], [1, true], [1.001, false]] as const)(
    '空白率の境界を両方向で判定する: gap %s', (gap, expected) => {
      const single = [cue(0, 10)];
      const pair = [cue(0, 4), cue(4 + gap, 10, 1)];
      const forward = generateSubtitleCandidates(single, pair).filter((c) => c.secondaryCount === 2);
      const reverse = generateSubtitleCandidates(pair, single).filter((c) => c.primaryCount === 2);
      expect(forward).toHaveLength(expected ? 1 : 0);
      expect(reverse).toHaveLength(expected ? 1 : 0);
      if (expected) expect(forward[0]?.score).toBeCloseTo(1.2);
    });

  it('重なる2件では先のcueが遅く終わっても最大終了を使う', () => {
    const result = generateSubtitleCandidates([cue(0, 10)], [cue(0, 10), cue(2, 3, 1)]);
    expect(result.find((c) => c.secondaryCount === 2)?.overlapRatio).toBe(1);
  });

  it('2対2・3件結合・非隣接の結合を生成しない', () => {
    const inputs = [cue(0, 4), cue(4, 6, 1), cue(6, 10, 2)];
    const result = generateSubtitleCandidates(inputs, inputs);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.primaryCount + c.secondaryCount <= 3)).toBe(true);
    const againstSingle = generateSubtitleCandidates([cue(0, 10)], inputs);
    expect(againstSingle.some((c) => c.secondaryCount === 2)).toBe(true);
    expect(againstSingle.filter((c) => c.secondaryCount === 2).map((c) => c.secondaryOffset)).toEqual([0, 1]);
    expect(againstSingle.every((c) => c.secondaryCount <= 2)).toBe(true);
  });

  it('元の入力位置を保持し、複数候補が同じcueを含んでも採用を即決しない', () => {
    const result = generateSubtitleCandidates([cue(0, 4, 0), cue(4, 8, 3)], [cue(4, 8, 8)]);
    expect(result.find((c) => c.primaryOffset === 1 && c.primaryCount === 1)).toMatchObject({
      primaryInputIndex: 3, secondaryInputIndex: 8,
    });
    const ambiguous = generateSubtitleCandidates([cue(0, 10)], [cue(0, 10), cue(0, 10, 1)]);
    expect(ambiguous.filter((c) => c.secondaryCount === 1)).toHaveLength(2);
    expect(ambiguous.some((c) => c.secondaryCount === 2)).toBe(true);
  });

  it('凍結した入力を変更せず余分なプロパティを読まず新しい結果を返す', () => {
    const input = Object.freeze({
      ...cue(0, 10, 5),
      get track(): never { throw new Error('track must not be read'); },
    });
    const inputs = Object.freeze([input]);
    const first = generateSubtitleCandidates(inputs, inputs);
    const second = generateSubtitleCandidates(inputs, inputs);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(Object.values(first[0] ?? {}).every((value) => typeof value === 'number')).toBe(true);
    const candidate = first[0];
    if (candidate === undefined) throw new Error('Expected a candidate');
    candidate.score = -1;
    expect(second[0]?.score).toBeCloseTo(0.8);
    expect(input.inputIndex).toBe(5);
  });
});
