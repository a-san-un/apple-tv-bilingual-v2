/**
 * subtitle-history.test.ts
 * 再生位置の境界、同時刻、seek、表示順、不正時刻、純関数の責務を確認する。
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SubtitleBlock, SubtitleHistorySnapshot, SubtitleHistoryView } from '../shared/types';
import { buildSubtitleBlocks } from './subtitle-block-builder';
import { deriveSubtitleHistory } from './subtitle-history';

/** テスト用の独立した block を作る。 */
const block = (startTime: number, text: string, endTime = startTime + 0.5): SubtitleBlock => ({
  startTime, endTime, primaryText: text, secondaryText: null,
});

describe('再生位置からの subtitle history 導出', () => {
  it('既存の snapshot 型と view 別名を使う', () => {
    expectTypeOf<ReturnType<typeof deriveSubtitleHistory>>().toEqualTypeOf<SubtitleHistorySnapshot>();
    expectTypeOf<SubtitleHistoryView>().toEqualTypeOf<SubtitleHistorySnapshot>();
  });

  it('空配列では current:null と新しい空配列を返す', () => {
    const first = deriveSubtitleHistory([], 0);
    const second = deriveSubtitleHistory([], 0);
    expect(first).toEqual({ current: null, past: [], future: [] });
    expect(first).not.toBe(second);
    expect(first.past).not.toBe(second.past);
    expect(first.future).not.toBe(second.future);
  });

  it.each([
    [0, -1], [9.999, -1], [10, 0], [10.999, 0],
    [11, 1], [11.999, 1], [12, 2], [100, 2],
  ])('開始時刻の境界を判定する: %s', (time, expectedIndex) => {
    const inputs = [block(10, 'A'), block(11, 'B'), block(12, 'C')];
    const result = deriveSubtitleHistory(inputs, time);
    expect(result.current).toBe(expectedIndex < 0 ? null : inputs[expectedIndex]);
    expect(result.past).toEqual(expectedIndex < 0 ? [] : inputs.slice(0, expectedIndex));
    expect(result.future).toEqual(expectedIndex < 0 ? inputs : inputs.slice(expectedIndex + 1));
    expect([...result.past, ...(result.current === null ? [] : [result.current]), ...result.future]).toEqual(inputs);
  });

  it('同じ開始時刻なら表示順で最初を選び後続をfutureに残す', () => {
    const inputs = [block(10, 'A'), block(10, 'B'), block(18, 'C')];
    expect(deriveSubtitleHistory(inputs, 10)).toEqual({ current: inputs[0], past: [], future: inputs.slice(1) });
    expect(deriveSubtitleHistory(inputs, 17)).toEqual({ current: inputs[0], past: [], future: inputs.slice(1) });
    expect(deriveSubtitleHistory(inputs, 18)).toEqual({ current: inputs[2], past: inputs.slice(0, 2), future: [] });
  });

  it('終了による切替や以前のblockへの復帰を行わない', () => {
    const inputs = [block(0, 'long', 100), block(10, 'short', 11), block(30, 'next')];
    expect(deriveSubtitleHistory(inputs, 11).current).toBe(inputs[1]);
    expect(deriveSubtitleHistory(inputs, 29).current).toBe(inputs[1]);
    expect(deriveSubtitleHistory(inputs, 200).current).toBe(inputs[2]);
  });

  it('前進・後退・直接seekに依存せず同じ結果を返す', () => {
    const inputs = [block(10, 'A'), block(20, 'B'), block(30, 'C')];
    const expected = deriveSubtitleHistory(inputs, 25);
    for (const time of [0, 35, 10, 100, 20]) {
      deriveSubtitleHistory(inputs, time);
      expect(deriveSubtitleHistory(inputs, 25)).toEqual(expected);
    }
  });

  it.each([NaN, Infinity, -Infinity, -1])('不正な再生時刻 %s は空入力でも拒否する', (time) => {
    expect(() => deriveSubtitleHistory([], time)).toThrow(RangeError);
    expect(() => deriveSubtitleHistory([block(0, 'A')], time)).toThrow(RangeError);
  });

  it('母国語のみのblockも同じ開始時刻規則で選ぶ', () => {
    const input: SubtitleBlock = { startTime: 0, endTime: 1, primaryText: null, secondaryText: '母国語' };
    expect(deriveSubtitleHistory([input], 0)).toEqual({ current: input, past: [], future: [] });
  });

  it('表示順を並べ替えず開始済みの最大開始時刻を選ぶ', () => {
    const inputs = [block(20, 'B'), block(10, 'A'), block(30, 'C')];
    expect(deriveSubtitleHistory(inputs, 25)).toEqual({ current: inputs[0], past: [], future: inputs.slice(1) });
    expect(inputs.map((item) => item.primaryText)).toEqual(['B', 'A', 'C']);
  });

  it('凍結入力を変更せず新しい配列を返し、終了時刻を読まない', () => {
    const input: SubtitleBlock = Object.freeze({
      startTime: 0,
      get endTime(): number { throw new Error('endTime must not be read'); },
      primaryText: 'A', secondaryText: null,
    });
    const next = Object.freeze(block(10, 'B'));
    const inputs = Object.freeze([input, next]);
    const first = deriveSubtitleHistory(inputs, 0);
    const second = deriveSubtitleHistory(inputs, 0);
    expect(first.current).toBe(input);
    expect(first.future).not.toBe(inputs);
    expect(first.future).not.toBe(second.future);
    first.future.pop();
    expect(second.future).toEqual([next]);
    expect(inputs).toHaveLength(2);
  });

  it('builder の出力から history を導出する', () => {
    const cue = (startTime: number, endTime: number, text: string) => ({ startTime, endTime, text, track: null });
    const blocks = buildSubtitleBlocks([cue(0, 4, 'p1'), cue(4, 8, 'p2')], [cue(0, 4, 's1'), cue(4, 8, 's2')]);
    expect(deriveSubtitleHistory(blocks, 4)).toEqual({ current: blocks[1], past: [blocks[0]], future: [] });
  });
});
