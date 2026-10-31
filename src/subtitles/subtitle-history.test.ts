/**
 * subtitle-history.test.ts
 * 再生位置の境界、同時刻、seek、表示順、不正時刻、純関数の責務を確認する。
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { deriveSubtitleHistory, deriveSubtitleDisplayHistory } from './subtitle-history';
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

  it('実機の同時刻英語3断片と日本語1件を1枠にし、断片の装飾・順序を保って現在へ分類する', /** 旧builderの実機回帰を表示枠経路へ移す。 */ () => {
    const start = 558.9016666666666;
    const end = 561.8427;
    const texts = ['<c.white.bg_black>No. And besides,</c>', 'I thought you were', 'on top of the DNA?'];
    const timeline = {
      primary: texts.map(/** @param text 観測した原文。@returns 同時刻の元字幕。 */ (text) => ({ startTime: start, endTime: end, text })),
      secondary: [{ startTime: 559.0591666666667, endTime: 561.8111666666666, text: 'それに 採取は\nお前の担当だろ？' }],
    };
    const blocks = buildSubtitleDisplayBlocks(timeline, prepareSubtitleDisplayItems(timeline, displayIdentity));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'dialogue', startTime: start, endTime: end });
    expect(blocks[0]?.primary.map(/** @param item 学習言語要素。@returns 本文。 */ (item) => item.text)).toEqual(texts);
    expect(blocks[0]?.secondary.map(/** @param item 母国語要素。@returns 本文。 */ (item) => item.text)).toEqual(['それに 採取は\nお前の担当だろ？']);
    expect(deriveSubtitleDisplayHistory(blocks, 561.034888)).toEqual({ past: [], current: blocks, future: [] });
  });
});
