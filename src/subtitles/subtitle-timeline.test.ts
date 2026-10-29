/**
 * subtitle-timeline.test.ts
 *
 * 言語別truthの構築関数を直接検証する。時刻分類・再生経路・実機描画は対象外。
 * 入力の保持と検証に絞り、対訳候補や旧ブロックの期待値を持ち込まない。
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SubtitleCueSnapshot, SubtitleTimeline } from '../shared/types';
import { buildSubtitleTimeline } from './subtitle-timeline';

/**
 * 検証用のcue snapshotを作る。
 * @param startTime 開始時刻。秒単位。
 * @param endTime 終了時刻。秒単位。
 * @param text 本文。省略時はtextとする。
 * @returns 呼出しごとに独立したcue snapshot。
 */
const cue = (startTime: number, endTime: number, text = 'text'): SubtitleCueSnapshot => ({
  startTime, endTime, text, track: null,
});

/** 構築契約・入力違反・参照分離のテストを登録する。 */
describe('フェーズ6: 言語別subtitle timeline構築', () => {
  it('共通timeline型を返し、空入力の配列を共有しない', /** 型と空入力の境界を確認する。 */ () => {
    expectTypeOf<ReturnType<typeof buildSubtitleTimeline>>().toEqualTypeOf<SubtitleTimeline>();
    const first = buildSubtitleTimeline([], []);
    const second = buildSubtitleTimeline([], []);
    expect(first).toEqual({ primary: [], secondary: [] });
    expect(first).not.toBe(second);
    expect(first.primary).not.toBe(second.primary);
    expect(first.primary).not.toBe(first.secondary);
  });

  it('片言語を空配列で表し、同時刻の両言語もペア化しない', /** 言語別の保持を確認する。 */ () => {
    const p = cue(0, 2, 'English');
    const s = cue(0, 2, '日本語');
    expect(buildSubtitleTimeline([p], [])).toEqual({ primary: [{ startTime: 0, endTime: 2, text: 'English' }], secondary: [] });
    expect(buildSubtitleTimeline([], [s]).secondary).toEqual([{ startTime: 0, endTime: 2, text: '日本語' }]);
    const result = buildSubtitleTimeline([p], [s]);
    expect(result.primary).toHaveLength(1);
    expect(result.secondary).toHaveLength(1);
    expect(Object.keys(result.primary[0] ?? {}).sort()).toEqual(['endTime', 'startTime', 'text']);
  });

  it('重複・同時刻・時間の重なりを結合せず入力順に保持する', /** 同じ値の別入力も残すことを確認する。 */ () => {
    const a = cue(1, 8, 'a');
    const b = cue(1, 8, 'b');
    const duplicate = cue(1, 8, 'a');
    const inside = cue(2, 3, 'inside');
    const result = buildSubtitleTimeline([a, b, duplicate, inside], []);
    expect(result.primary).toEqual([
      { startTime: 1, endTime: 8, text: 'a' },
      { startTime: 1, endTime: 8, text: 'b' },
      { startTime: 1, endTime: 8, text: 'a' },
      { startTime: 2, endTime: 3, text: 'inside' },
    ]);
  });

  it('本文のタグ・改行・空白・縦書き文字と時刻精度を保持する', /** 表示用変換と区別する。 */ () => {
    const raw = '  <ruby>字<rt>じ</rt></ruby>\n〝コ︱チ〟　';
    const result = buildSubtitleTimeline([], [cue(96.01221111111111, 102.6862111111111, raw)]);
    expect(result.secondary).toEqual([{ startTime: 96.01221111111111, endTime: 102.6862111111111, text: raw }]);
  });

  it('凍結入力を変更せず、track属性を読まずに値だけをコピーする', /** 不要な参照の読取・保持を防ぐ。 */ () => {
    const input = Object.freeze({
      startTime: 0, endTime: 1, text: 'raw',
      /** trackへアクセスした不正な実装を検出する。@throws Error 参照違反。 */
      get track(): null { throw new Error('track must not be read'); },
    });
    const inputs = Object.freeze([input]);
    const first = buildSubtitleTimeline(inputs, []);
    const second = buildSubtitleTimeline(inputs, []);
    expect(first.primary).toEqual([{ startTime: 0, endTime: 1, text: 'raw' }]);
    // テスト側の比較がgetterへ触れないよう、参照同一性だけを真偽値で渡す。
    expect(Object.is(first.primary[0], input)).toBe(false);
    expect(first.primary[0]).not.toBe(second.primary[0]);
    expect(inputs).toHaveLength(1);
  });

  it('構築後の入力変更を戻り値へ伝えない', /** 元cueを保持しないことを確認する。 */ () => {
    const input = cue(0, 1, 'original');
    const result = buildSubtitleTimeline([input], []);
    input.text = 'changed';
    input.startTime = 0.5;
    expect(result.primary).toEqual([{ startTime: 0, endTime: 1, text: 'original' }]);
  });

  it.each([
    cue(NaN, 1), cue(0, Infinity), cue(-1, 1), cue(1, 1), cue(2, 1),
    cue(0, 1, ''), cue(0, 1, ' \n　'),
  ])('不正なcueを両言語で拒否する: %j', /**
   * 不正cueを除外や補正で隠さないことを確認する。
   * @param invalid 時刻または本文が構築条件に違反するcue。
   */ (invalid) => {
    expect(/** 不正primaryを構築する。@returns timeline。@throws RangeError 入力違反。 */ () => buildSubtitleTimeline([invalid], [])).toThrow(RangeError);
    expect(/** 不正secondaryを構築する。@returns timeline。@throws RangeError 入力違反。 */ () => buildSubtitleTimeline([], [invalid])).toThrow(RangeError);
  });

  it('開始時刻の逆順を拒否し、入力を並べ替えない', /** 順序の補正をしないことを確認する。 */ () => {
    const inputs = [cue(2, 3), cue(1, 4)];
    expect(/** 逆順入力を構築する。@returns timeline。@throws RangeError 順序違反。 */ () => buildSubtitleTimeline(inputs, [])).toThrow(RangeError);
    expect(inputs[0]?.startTime).toBe(2);
    expect(/** 逆順secondaryを構築する。@returns timeline。@throws RangeError 順序違反。 */ () => buildSubtitleTimeline([], inputs)).toThrow(RangeError);
  });
});
