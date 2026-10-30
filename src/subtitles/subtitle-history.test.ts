/**
 * subtitle-history.test.ts
 * 再生位置の境界、同時刻、seek、表示順、不正時刻、純関数の責務を確認する。
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SubtitleBlock, LegacySubtitleHistorySnapshot } from '../shared/types';
import { buildSubtitleBlocks } from './subtitle-block-builder';
import { deriveLegacySubtitleHistory, deriveSubtitleHistory, deriveSubtitleDisplayHistory } from './subtitle-history';
import type { SubtitleDisplayBlock, SubtitleDisplayHistory } from '../shared/types';
import { buildSubtitleDisplayBlocks } from './subtitle-display-blocks';
import { prepareSubtitleDisplayItems } from './subtitle-text-parts';

/** @param startTime 開始秒。@param endTime 終了秒。@param kind 枠種別。@returns 検証用の独立した片言語枠。 */
const displayBlock = (startTime: number, endTime: number, kind: SubtitleDisplayBlock['kind'] = 'dialogue'): SubtitleDisplayBlock => ({
  kind, startTime, endTime, primary: [{ sourceIndex: 0, text: ' A\n ' }], secondary: [],
});
/** @param text 元本文。@returns パーサーを使わない表示本文。 */
const displayIdentity = (text: string): string => text;

describe('表示枠単位のhistory', /** 元字幕分類とは別の契約を検証する。 */ () => {
  it('共通型と独立した空の3配列を返す', /** 空配列も呼出し間で共有しない。 */ () => {
    expectTypeOf<ReturnType<typeof deriveSubtitleDisplayHistory>>().toEqualTypeOf<SubtitleDisplayHistory>();
    const first = deriveSubtitleDisplayHistory([], 0);
    const again = deriveSubtitleDisplayHistory([], 0);
    expect(first).toEqual({ past: [], current: [], future: [] });
    expect(new Set([first.past, first.current, first.future, again.past, again.current, again.future]).size).toBe(6);
  });

  it.each([0, 9.999, 10, 11.999, 12, 100])('セリフと補助の開始以上・終了未満を判定する: %s', /** @param time 再生秒。 */ (time) => {
    const inputs = [displayBlock(10, 12), displayBlock(10, 12, 'auxiliary')];
    const result = deriveSubtitleDisplayHistory(inputs, time);
    expect(result).toEqual({ past: time >= 12 ? inputs : [], current: time >= 10 && time < 12 ? inputs : [], future: time < 10 ? inputs : [] });
  });

  it('重なる現在枠を全件保持し、短い枠の終了後も長い枠を現在に残す', /** 代表1件を選ばない。 */ () => {
    const long = displayBlock(0, 20);
    const short = displayBlock(10, 12);
    const auxiliary = displayBlock(10, 15, 'auxiliary');
    const inputs = [long, short, auxiliary];
    expect(deriveSubtitleDisplayHistory(inputs, 10).current).toEqual(inputs);
    expect(deriveSubtitleDisplayHistory(inputs, 12)).toEqual({ past: [short], current: [long, auxiliary], future: [] });
    expect(deriveSubtitleDisplayHistory(inputs, 20)).toEqual({ past: inputs, current: [], future: [] });
  });

  it('各区分の固定順・参照を保持し、空白区間で直前枠を現在にしない', /** 再ソートや枠コピーを行わない。 */ () => {
    const a = displayBlock(1, 2);
    const b = displayBlock(4, 5);
    const c = displayBlock(4, 5, 'auxiliary');
    const inputs = Object.freeze([Object.freeze(a), Object.freeze(b), Object.freeze(c)]);
    const before = JSON.stringify(inputs);
    const result = deriveSubtitleDisplayHistory(inputs, 3);
    expect(result).toEqual({ past: [a], current: [], future: [b, c] });
    expect(result.past[0]).toBe(a);
    expect(result.future[0]).toBe(b);
    expect(result.future).not.toBe(inputs);
    expect(JSON.stringify(inputs)).toBe(before);
  });

  it('前後seek相当でも同じ分類になり、全入力をちょうど1区分へ保持する', /** 過去の呼出しを蓄積しない。 */ () => {
    const inputs = [displayBlock(1, 4), displayBlock(2, 5), displayBlock(6, 8, 'auxiliary')];
    const expected = deriveSubtitleDisplayHistory(inputs, 3);
    for (const time of [0, 9, 2, 8, 3]) {
      const result = deriveSubtitleDisplayHistory(inputs, time);
      const all = [...result.past, ...result.current, ...result.future];
      expect(all).toHaveLength(inputs.length);
      for (const value of inputs) expect(all.filter(/** @param item 分類済み枠。@returns 同じ入力枠か。 */ (item) => item === value)).toHaveLength(1);
      expect(deriveSubtitleDisplayHistory(inputs, 3)).toEqual(expected);
    }
  });

  it.each([NaN, Infinity, -Infinity, -1])('不正時刻%sは空・非空とも拒否する', /** @param time 非有限または負の再生秒。 */ (time) => {
    expect(/** @returns 分類結果。@throws RangeError 不正時刻。 */ () => deriveSubtitleDisplayHistory([], time)).toThrow(RangeError);
    expect(/** @returns 分類結果。@throws RangeError 不正時刻。 */ () => deriveSubtitleDisplayHistory([displayBlock(0, 1)], time)).toThrow(RangeError);
  });

  it('構築済み枠の内部空白でも現在を維持し、元字幕の分類を変えない', /** 構築・分類の純関数を接続する。 */ () => {
    const timeline = { primary: [{ startTime: 0, endTime: 2, text: 'A' }, { startTime: 4, endTime: 6, text: 'B' }], secondary: [{ startTime: 0, endTime: 6, text: 'S' }] };
    const blocks = buildSubtitleDisplayBlocks(timeline, prepareSubtitleDisplayItems(timeline, displayIdentity));
    expect(deriveSubtitleHistory(timeline, 3).current.primary).toEqual([]);
    expect(deriveSubtitleDisplayHistory(blocks, 3).current).toEqual(blocks);
    expect(deriveSubtitleDisplayHistory(blocks, 6).past).toEqual(blocks);
  });

  it('英語2件・日本語3件の枠を正確な開始終了で分類し、母国語の切替に依存しない', /** 内部空白と英語終了後も同じ枠参照を保持する。 */ () => {
    const start = 48.09800833333331;
    const end = 52.01037777777778;
    const timeline = { primary: [{ startTime: start, endTime: 51.934, text: 'A' }, { startTime: start, endTime: 51.934, text: 'B' }], secondary: [{ startTime: 48.131, endTime: 49.131, text: 'S1' }, { startTime: 49.341, endTime: 50.717, text: 'S2' }, { startTime: 50.842, endTime: end, text: 'S3' }] };
    const blocks = buildSubtitleDisplayBlocks(timeline, prepareSubtitleDisplayItems(timeline, displayIdentity));
    expect(deriveSubtitleDisplayHistory(blocks, start - 0.001).future).toEqual(blocks);
    for (const time of [start, 49.2, 50.8, 52, end - 0.001]) expect(deriveSubtitleDisplayHistory(blocks, time).current[0]).toBe(blocks[0]);
    expect(deriveSubtitleDisplayHistory(blocks, end)).toEqual({ past: blocks, current: [], future: [] });
  });

  it('競合で範囲が重なる2枠を両方現在にし、元字幕はCと②だけを現在にする', /** 表示枠と元字幕の意味を分ける。 */ () => {
    const timeline = { primary: [{ startTime: 10, endTime: 12, text: 'A' }, { startTime: 12, endTime: 14, text: 'B' }, { startTime: 14, endTime: 16, text: 'C' }], secondary: [{ startTime: 10, endTime: 14, text: '①' }, { startTime: 12, endTime: 16, text: '②' }] };
    const blocks = buildSubtitleDisplayBlocks(timeline, prepareSubtitleDisplayItems(timeline, displayIdentity));
    expect(blocks).toHaveLength(2);
    expect(deriveSubtitleDisplayHistory(blocks, 14).current).toEqual(blocks);
    expect(deriveSubtitleHistory(timeline, 14).current).toEqual({ primary: [timeline.primary[2]], secondary: [timeline.secondary[1]] });
    expect(deriveSubtitleDisplayHistory(blocks, 16)).toEqual({ past: blocks, current: [], future: [] });
  });
});


/** テスト用の独立した block を作る。 */
const block = (startTime: number, text: string, endTime = startTime + 0.5): SubtitleBlock => ({
  startTime, endTime, primaryText: text, secondaryText: null,
});

describe('移行中の旧ブロック経路のhistory回帰', () => {
  it('旧経路専用のsnapshot型を使う', () => {
    expectTypeOf<ReturnType<typeof deriveLegacySubtitleHistory>>().toEqualTypeOf<LegacySubtitleHistorySnapshot>();
  });

  it('空配列では current:null と新しい空配列を返す', () => {
    const first = deriveLegacySubtitleHistory([], 0);
    const second = deriveLegacySubtitleHistory([], 0);
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
    const result = deriveLegacySubtitleHistory(inputs, time);
    expect(result.current).toBe(expectedIndex < 0 ? null : inputs[expectedIndex]);
    expect(result.past).toEqual(expectedIndex < 0 ? [] : inputs.slice(0, expectedIndex));
    expect(result.future).toEqual(expectedIndex < 0 ? inputs : inputs.slice(expectedIndex + 1));
    expect([...result.past, ...(result.current === null ? [] : [result.current]), ...result.future]).toEqual(inputs);
  });

  it('同じ開始時刻なら表示順で最初を選び後続をfutureに残す', () => {
    const inputs = [block(10, 'A'), block(10, 'B'), block(18, 'C')];
    expect(deriveLegacySubtitleHistory(inputs, 10)).toEqual({ current: inputs[0], past: [], future: inputs.slice(1) });
    expect(deriveLegacySubtitleHistory(inputs, 17)).toEqual({ current: inputs[0], past: [], future: inputs.slice(1) });
    expect(deriveLegacySubtitleHistory(inputs, 18)).toEqual({ current: inputs[2], past: inputs.slice(0, 2), future: [] });
  });

  it('終了による切替や以前のblockへの復帰を行わない', () => {
    const inputs = [block(0, 'long', 100), block(10, 'short', 11), block(30, 'next')];
    expect(deriveLegacySubtitleHistory(inputs, 11).current).toBe(inputs[1]);
    expect(deriveLegacySubtitleHistory(inputs, 29).current).toBe(inputs[1]);
    expect(deriveLegacySubtitleHistory(inputs, 200).current).toBe(inputs[2]);
  });

  it('前進・後退・直接seekに依存せず同じ結果を返す', () => {
    const inputs = [block(10, 'A'), block(20, 'B'), block(30, 'C')];
    const expected = deriveLegacySubtitleHistory(inputs, 25);
    for (const time of [0, 35, 10, 100, 20]) {
      deriveLegacySubtitleHistory(inputs, time);
      expect(deriveLegacySubtitleHistory(inputs, 25)).toEqual(expected);
    }
  });

  it.each([NaN, Infinity, -Infinity, -1])('不正な再生時刻 %s は空入力でも拒否する', (time) => {
    expect(() => deriveLegacySubtitleHistory([], time)).toThrow(RangeError);
    expect(() => deriveLegacySubtitleHistory([block(0, 'A')], time)).toThrow(RangeError);
  });

  it('母国語のみのblockも同じ開始時刻規則で選ぶ', () => {
    const input: SubtitleBlock = { startTime: 0, endTime: 1, primaryText: null, secondaryText: '母国語' };
    expect(deriveLegacySubtitleHistory([input], 0)).toEqual({ current: input, past: [], future: [] });
  });

  it('表示順を並べ替えず開始済みの最大開始時刻を選ぶ', () => {
    const inputs = [block(20, 'B'), block(10, 'A'), block(30, 'C')];
    expect(deriveLegacySubtitleHistory(inputs, 25)).toEqual({ current: inputs[0], past: [], future: inputs.slice(1) });
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
    const first = deriveLegacySubtitleHistory(inputs, 0);
    const second = deriveLegacySubtitleHistory(inputs, 0);
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
    expect(deriveLegacySubtitleHistory(blocks, 4)).toEqual({ current: blocks[1], past: [blocks[0]], future: [] });
  });
});
