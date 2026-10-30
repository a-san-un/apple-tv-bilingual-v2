/** 表示枠の構成・配置・不変性を検証する。時刻分類・DOM・実機は対象外。 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SubtitleDisplayBlock, SubtitleTimeline, TimedSubtitleText } from '../shared/types';
import { prepareSubtitleDisplayItems, type PreparedSubtitleItems } from './subtitle-text-parts';
import { buildSubtitleDisplayBlocks } from './subtitle-display-blocks';

/** @param startTime 開始秒。@param endTime 終了秒。@param text 原文。@returns 独立した元字幕。 */
const cue = (startTime: number, endTime: number, text = 'text'): TimedSubtitleText => ({ startTime, endTime, text });
/** @param text 元本文。@returns 解析しない表示本文。 */
const identity = (text: string): string => text;
/** @param primary 学習言語。@param secondary 母国語。@returns 実準備関数と構築関数の接続結果。 */
const build = (primary: readonly TimedSubtitleText[], secondary: readonly TimedSubtitleText[] = []): readonly SubtitleDisplayBlock[] => {
  const timeline = { primary, secondary };
  return buildSubtitleDisplayBlocks(timeline, prepareSubtitleDisplayItems(timeline, identity));
};
/** @param blocks 全枠。@returns 種別・範囲・言語別元入力位置による構成要約。 */
const shape = (blocks: readonly SubtitleDisplayBlock[]) => blocks.map(/** @param block 表示枠。@returns 構成の比較値。 */ (block) => [
  block.kind, block.startTime, block.endTime,
  block.primary.map(/** @param item 学習言語要素。@returns 元入力位置。 */ (item) => item.sourceIndex),
  block.secondary.map(/** @param item 母国語要素。@returns 元入力位置。 */ (item) => item.sourceIndex),
]);

describe('表示枠構築', /** 固定構成と入力契約を検証する。 */ () => {
  it('共通型と空・片言語を扱い、空枠を作らない', /** 空配列は取得ごとに独立させる。 */ () => {
    expectTypeOf<ReturnType<typeof buildSubtitleDisplayBlocks>>().toEqualTypeOf<readonly SubtitleDisplayBlock[]>();
    const first = build([]);
    expect(first).toEqual([]);
    expect(build([])).not.toBe(first);
    expect(shape(build([cue(1, 2)]))).toEqual([['dialogue', 1, 2, [0], []]]);
    expect(shape(build([], [cue(1, 2), cue(1, 2)]))).toEqual([['dialogue', 1, 2, [], [0]], ['dialogue', 1, 2, [], [1]]]);
  });

  it.each([1, 2, 3, 1000])('同時刻%s件を結合・重複除去せず1枠へ保持する', /** @param count 元字幕件数。 */ (count) => {
    const primary = Array.from({ length: count }, /** @returns 同じ値の別入力。 */ () => cue(1, 2, ' A\n '));
    const blocks = build(primary);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.primary).toHaveLength(count);
    expect(blocks[0]?.primary[0]?.text).toBe(' A\n ');
    expect(blocks[0]?.primary[count - 1]?.sourceIndex).toBe(count - 1);
  });

  it('同一開始で終了が異なる枠を挟んでも完全一致分を集約する', /** 本文順は元入力順で保持する。 */ () => {
    expect(shape(build([cue(1, 4, 'A'), cue(1, 3, 'B'), cue(1, 4, 'C')]))).toEqual([
      ['dialogue', 1, 3, [1], []], ['dialogue', 1, 4, [0, 2], []],
    ]);
  });

  it('英語2件・日本語3件の範囲を両言語から求める', /** 正本の実数境界を丸めない。 */ () => {
    const primary = [cue(48.09800833333331, 51.934, 'A'), cue(48.09800833333331, 51.934, 'B')];
    const secondary = [cue(48.131, 49.131, '子供たち！'), cue(49.341, 50.717, 'あれは…'), cue(50.842, 52.01037777777778, '子犬さん！')];
    expect(shape(build(primary, secondary))).toEqual([['dialogue', 48.09800833333331, 52.01037777777778, [0, 1], [0, 1, 2]]]);
  });

  it('早い母国語候補を採用し、競合候補で再結合しない', /** 正本のA・B・①・②とCを検証する。 */ () => {
    expect(shape(build([cue(10, 12), cue(12, 14), cue(14, 16)], [cue(10, 14), cue(12, 16)]))).toEqual([
      ['dialogue', 10, 16, [0, 1], [0, 1]], ['dialogue', 14, 16, [2], []],
    ]);
  });

  it('同一開始の候補は母国語の元入力順で採用する', /** 長い後続候補で確定枠を拡張しない。 */ () => {
    expect(shape(build([cue(0, 2), cue(2, 4), cue(4, 6)], [cue(0, 4), cue(0, 6)]))).toEqual([
      ['dialogue', 0, 6, [0, 1], [0, 1]], ['dialogue', 4, 6, [2], []],
    ]);
  });

  it('長さや枠数で候補を抑制しない', /** 多数枠を1候補として保持する。 */ () => {
    const primary = Array.from({ length: 100 }, /** @param _ 未使用の配列値。@param index 元入力位置。@returns 連続区間。 */ (_, index) => cue(index * 10, index * 10 + 10));
    expect(build(primary, [cue(0, 1000)])[0]?.primary).toHaveLength(100);
  });

  it('接触だけを重なりとせず、母国語の先行開始を枠範囲へ反映する', /** 元時刻は補正しない。 */ () => {
    expect(shape(build([cue(10, 14)], [cue(3, 10), cue(10, 13)]))).toEqual([
      ['dialogue', 3, 10, [], [0]], ['dialogue', 10, 14, [0], [1]],
    ]);
    expect(shape(build([cue(10, 14)], [cue(3, 13)]))).toEqual([['dialogue', 3, 14, [0], [0]]]);
  });

  it('比較区間の内部空白にしかない母国語は独立枠へ残す', /** 結合根拠の範囲を比較に使わない。 */ () => {
    expect(shape(build([cue(0, 2), cue(4, 6)], [cue(0, 6), cue(2, 4)]))).toEqual([
      ['dialogue', 0, 6, [0, 1], [0]], ['dialogue', 2, 4, [], [1]],
    ]);
  });

  it('競合後は最大重なりへ配置し、根拠の範囲延長を比較へ混ぜない', /** Cとの3秒がABとの1秒より大きい。 */ () => {
    expect(shape(build([cue(0, 2), cue(4, 6), cue(6, 10)], [cue(0, 6), cue(5, 9)]))).toEqual([
      ['dialogue', 0, 6, [0, 1], [0]], ['dialogue', 5, 10, [2], [1]],
    ]);
  });

  it('学習言語の重複時間を二重計上せず、同点は早い枠へ置く', /** 和集合による2秒対2秒を比較する。 */ () => {
    expect(shape(build([cue(0, 4), cue(1, 4), cue(4, 8)], [cue(0, 4), cue(2, 6)]))).toEqual([
      ['dialogue', 0, 6, [0, 1], [0, 1]], ['dialogue', 4, 8, [2], []],
    ]);
  });

  it('配置済み母国語の延長で後続字幕を吸い寄せない', /** 比較は学習言語区間だけで固定する。 */ () => {
    expect(shape(build([cue(2, 4)], [cue(0, 3), cue(1, 2)]))).toEqual([
      ['dialogue', 0, 4, [0], [0]], ['dialogue', 1, 2, [], [1]],
    ]);
  });

  it('非連続の重なりは結合せず、同点は最初の元入力へ置く', /** 特別な候補選択機構を増やさない。 */ () => {
    expect(shape(build([cue(0, 10), cue(1, 10), cue(2, 3), cue(3, 10), cue(4, 10)], [cue(5, 6)]))).toEqual([
      ['dialogue', 0, 10, [0], [0]], ['dialogue', 1, 10, [1], []], ['dialogue', 2, 3, [2], []], ['dialogue', 3, 10, [3], []], ['dialogue', 4, 10, [4], []],
    ]);
    expect(shape(build([cue(0, 10), cue(0, 1), cue(0, 9)], [cue(5, 6)]))).toEqual([
      ['dialogue', 0, 1, [1], []], ['dialogue', 0, 9, [2], []], ['dialogue', 0, 10, [0], [0]],
    ]);
  });

  it('補助を独立1要素とし、時刻・種別・言語役割・入力位置の固定順を守る', /** 同時刻でも補助同士をペア化しない。 */ () => {
    const blocks = build([cue(0, 5, '〝A〟 〝B〟'), cue(0, 5, 'dialogue'), cue(0, 5, '〝C〟')], [cue(0, 5, '〝D〟')]);
    expect(shape(blocks)).toEqual([
      ['dialogue', 0, 5, [1], []], ['auxiliary', 0, 5, [0], []], ['auxiliary', 0, 5, [2], []], ['auxiliary', 0, 5, [], [0]],
    ]);
    expect(blocks[1]?.primary[0]?.text).toBe('〝A〟 〝B〟');
    expect(shape(build([cue(0, 100, '〝A〟'), cue(10, 12)], [cue(10, 12)]))[1]).toEqual(['dialogue', 10, 12, [1], [0]]);
  });

  it('全入力をちょうど1回配置し、凍結入力を変えず結果を共有しない', /** 元本文と準備結果の保持・参照分離を確認する。 */ () => {
    const timeline: SubtitleTimeline = { primary: [cue(0, 2, '<i>A</i>'), cue(2, 4, 'B'), cue(3, 5, '〝C〟')], secondary: [cue(0, 4, 'S'), cue(4, 6, 'T')] };
    const prepared = prepareSubtitleDisplayItems(timeline, identity);
    for (const role of ['primary', 'secondary'] as const) {
      for (const entry of timeline[role]) Object.freeze(entry);
      for (const entry of prepared[role]) Object.freeze(entry);
      Object.freeze(timeline[role]); Object.freeze(prepared[role]);
    }
    Object.freeze(timeline); Object.freeze(prepared);
    const before = JSON.stringify({ timeline, prepared });
    const first = buildSubtitleDisplayBlocks(timeline, prepared);
    const again = buildSubtitleDisplayBlocks(timeline, prepared);
    expect(again).toEqual(first);
    expect(first[0]).not.toBe(again[0]);
    expect(first[0]?.primary[0]).not.toBe(again[0]?.primary[0]);
    for (const role of ['primary', 'secondary'] as const) {
      const indices: number[] = [];
      for (const block of first) for (const item of block[role]) indices.push(item.sourceIndex);
      indices.sort(/** @param a 左添字。@param b 右添字。@returns 数値順。 */ (a, b) => a - b);
      expect(indices).toEqual(Array.from({ length: timeline[role].length }, /** @param _ 未使用値。@param index 元入力位置。@returns 添字。 */ (_, index) => index));
    }
    expect(JSON.stringify({ timeline, prepared })).toBe(before);
  });

  it.each([-1, 0.5, 1, NaN, Infinity])('不正な元入力位置%sを両言語で拒否する', /** @param sourceIndex 不正添字。 */ (sourceIndex) => {
    for (const role of ['primary', 'secondary'] as const) {
      const timeline = { primary: [cue(0, 1)], secondary: [cue(0, 1)] };
      const prepared = prepareSubtitleDisplayItems(timeline, identity);
      const invalid = { ...prepared, [role]: [{ kind: 'dialogue', sourceIndex, text: '' }] } as PreparedSubtitleItems;
      expect(/** @returns 構築結果。@throws RangeError 添字違反。 */ () => buildSubtitleDisplayBlocks(timeline, invalid)).toThrow(RangeError);
    }
  });

  it('準備結果の件数不一致を両言語で拒否する', /** 空・不足・余剰を検出する。 */ () => {
    for (const role of ['primary', 'secondary'] as const) {
      const timeline = { primary: [cue(0, 1)], secondary: [cue(0, 1)] };
      const prepared = prepareSubtitleDisplayItems(timeline, identity);
      for (const items of [[], [...prepared[role], ...prepared[role]]]) {
        expect(/** @returns 構築結果。@throws RangeError 件数違反。 */ () => buildSubtitleDisplayBlocks(timeline, { ...prepared, [role]: items })).toThrow(RangeError);
      }
    }
  });

  it('不正時刻・逆順・不正分類を拒否し、空表示本文は保持する', /** 準備結果の空文字と元時刻違反を混同しない。 */ () => {
    for (const value of [cue(NaN, 2), cue(-1, 2), cue(0, Infinity), cue(1, 1)]) {
      const timeline = { primary: [value], secondary: [] };
      expect(/** @returns 構築結果。@throws RangeError 時刻違反。 */ () => buildSubtitleDisplayBlocks(timeline, prepareSubtitleDisplayItems(timeline, identity))).toThrow(RangeError);
    }
    const timeline = { primary: [cue(0, 1)], secondary: [] };
    const prepared = prepareSubtitleDisplayItems(timeline, identity);
    const invalid = { ...prepared, primary: [{ kind: 'invalid', sourceIndex: 0, text: '' }] } as unknown as PreparedSubtitleItems;
    expect(/** @returns 構築結果。@throws RangeError 分類違反。 */ () => buildSubtitleDisplayBlocks(timeline, invalid)).toThrow(RangeError);
    expect(buildSubtitleDisplayBlocks(timeline, { ...prepared, primary: [{ kind: 'dialogue', sourceIndex: 0, text: '' }] })[0]?.primary[0]?.text).toBe('');
    expect(/** @returns 構築結果。@throws RangeError 順序違反。 */ () => build([cue(2, 3), cue(1, 2)])).toThrow(RangeError);
  });
});
