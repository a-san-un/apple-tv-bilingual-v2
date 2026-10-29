/**
 * independent-subtitle-view.test.ts
 *
 * 実ログから固定した5 cueで、timelineの3区分分類を直接検証する。
 * 試作内の選択処理は持たず、過去・現在・未来で同じ字幕単位を使う。
 * 再生経路・表示用本文変換・Chrome描画の成功とは区別する。
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SubtitleCueSnapshot, SubtitleHistorySnapshot, SubtitleHistoryView, SubtitleTimeline, TimedSubtitleText } from '../shared/types';
import { deriveSubtitleHistory } from './subtitle-history';
import { buildSubtitleTimeline } from './subtitle-timeline';

/**
 * 元ログの値を固定し、試験による入力変更を防ぐ。
 * @param startTime 観測した開始時刻。秒単位。
 * @param endTime 観測した終了時刻。開始より後の秒数。
 * @param text 観測したraw本文。装飾・改行・文字を保持する。
 * @returns 凍結した検証用字幕。
 */
const cue = (startTime: number, endTime: number, text: string): TimedSubtitleText =>
  Object.freeze({ startTime, endTime, text });

const opportunity = cue(96.00300833333331, 98.50954166666665, '<c.white.bg_black><i>This is your opportunity</i></c>');
const ashes = cue(98.64300833333331, 101.34534166666666, '<c.white.bg_black><i>to rise from these ashes</i></c>');
const glory = cue(101.47880833333332, 102.68294166666664, '<c.white.bg_black><i>and grab glory.</i></c>');
const translation = cue(96.01221111111111, 102.6862111111111, '今こそ逆境に打ち勝って\n栄光をつかめ');
const coach = cue(98.43121111111111, 99.76621111111112, '〝コ︱チ〟');
const primary = Object.freeze([opportunity, ashes, glory]);
const secondary = Object.freeze([translation, coach]);

const timeline: SubtitleTimeline = Object.freeze({ primary, secondary });
const empty = { primary: [], secondary: [] };

/**
 * 固定した値をtimeline構築関数の入力へ渡す。実trackは作らない。
 * @param value 元時刻・本文を持つ固定値。
 * @returns trackがnullの新しい入力snapshot。
 */
const toSnapshot = (value: TimedSubtitleText): SubtitleCueSnapshot => ({ ...value, track: null });

/** 実関数の3場面・分類境界・順序・参照・不変性を検証する。 */
describe('フェーズ6: 言語別timelineの過去・現在・未来分類', () => {
  it('新しいsnapshot型とview別名を使う', /** 共通型との一致を確認する。 */ () => {
    expectTypeOf<ReturnType<typeof deriveSubtitleHistory>>().toEqualTypeOf<SubtitleHistorySnapshot>();
    expectTypeOf<SubtitleHistoryView>().toEqualTypeOf<SubtitleHistorySnapshot>();
  });

  it('1分39秒: opportunityは過去、ashesと日本語2件は現在、gloryは未来', /** 第1場面の全区分を確認する。 */ () => {
    expect(deriveSubtitleHistory(timeline, 99)).toEqual({
      past: { primary: [opportunity], secondary: [] },
      current: { primary: [ashes], secondary: [translation, coach] },
      future: { primary: [glory], secondary: [] },
    });
  });

  it('1分41.6秒: gloryと長い日本語訳が現在に残る', /** 第2場面の全区分を確認する。 */ () => {
    expect(deriveSubtitleHistory(timeline, 101.6)).toEqual({
      past: { primary: [opportunity, ashes], secondary: [coach] },
      current: { primary: [glory], secondary: [translation] },
      future: empty,
    });
  });

  it('日本語訳の終了ちょうどに対象5件が全て過去へ入り、現在を補完しない', /** 第3場面の終了境界を確認する。 */ () => {
    expect(deriveSubtitleHistory(timeline, translation.endTime - 0.001).current).toEqual({ primary: [], secondary: [translation] });
    expect(deriveSubtitleHistory(timeline, translation.endTime)).toEqual({ past: timeline, current: empty, future: empty });
    expect(deriveSubtitleHistory(timeline, translation.endTime + 0.001)).toEqual({ past: timeline, current: empty, future: empty });
  });

  it('開始ちょうどを含み、各言語で終了ちょうどを除く', /** 言語間で時刻を合わせないことを確認する。 */ () => {
    expect(deriveSubtitleHistory(timeline, opportunity.startTime).current).toEqual({ primary: [opportunity], secondary: [] });
    expect(deriveSubtitleHistory(timeline, translation.startTime).current).toEqual({ primary: [opportunity], secondary: [translation] });
    expect(deriveSubtitleHistory(timeline, glory.endTime).current).toEqual({ primary: [], secondary: [translation] });
  });

  it('前進・後退しても同じ結果になり、凍結入力と元の本文を変更しない', /** seek相当と入力不変性を確認する。 */ () => {
    const before = JSON.stringify(timeline);
    const first = deriveSubtitleHistory(timeline, 99);
    deriveSubtitleHistory(timeline, 200);
    deriveSubtitleHistory(timeline, 0);
    const again = deriveSubtitleHistory(timeline, 99);
    expect(again).toEqual(first);
    expect(again.current.primary).not.toBe(first.current.primary);
    expect(again.current.secondary).not.toBe(first.current.secondary);
    expect(again.current.primary[0]).toBe(ashes);
    expect(JSON.stringify(timeline)).toBe(before);
  });

  it('空入力・片言語を扱い、先頭より前は全件未来、末尾後は全件過去', /** 空区分をnullや直前字幕で埋めないことを確認する。 */ () => {
    expect(deriveSubtitleHistory(empty, 99)).toEqual({ past: empty, current: empty, future: empty });
    expect(deriveSubtitleHistory({ primary: [], secondary }, 99).current).toEqual({ primary: [], secondary: [translation, coach] });
    expect(deriveSubtitleHistory({ primary, secondary: [] }, 99).current).toEqual({ primary: [ashes], secondary: [] });
    expect(deriveSubtitleHistory(timeline, 0)).toEqual({ past: empty, current: empty, future: timeline });
    expect(deriveSubtitleHistory(timeline, 200)).toEqual({ past: timeline, current: empty, future: empty });
  });

  it('短い字幕が終了しても、重なる長い字幕は現在に残る', /** 各字幕自身の終了で分類することを確認する。 */ () => {
    const long = cue(10, 20, 'long');
    const short = cue(12, 13, 'short');
    const input: SubtitleTimeline = { primary: [long, short], secondary: [] };
    expect(deriveSubtitleHistory(input, 12).current.primary).toEqual([long, short]);
    expect(deriveSubtitleHistory(input, 13)).toEqual({ past: { primary: [short], secondary: [] }, current: { primary: [long], secondary: [] }, future: empty });
    expect(deriveSubtitleHistory(input, 20)).toEqual({ past: input, current: empty, future: empty });
  });

  it('同時刻の全件と同じ値の別入力を結合・削除しない', /** 多重度と入力順を確認する。 */ () => {
    const a = cue(1, 2, 'a');
    const b = cue(1, 2, 'b');
    const duplicate = cue(1, 2, 'a');
    const input: SubtitleTimeline = { primary: [a, b, duplicate], secondary: [a] };
    expect(deriveSubtitleHistory(input, 1).current).toEqual(input);
    expect(deriveSubtitleHistory(input, 2).past).toEqual(input);
  });

  it('空白区間の現在は空になり、過去と未来を保持する', /** 代表字幕を維持する旧規則と区別する。 */ () => {
    const a = cue(1, 2, 'a');
    const b = cue(4, 5, 'b');
    expect(deriveSubtitleHistory({ primary: [a, b], secondary: [] }, 3)).toEqual({ past: { primary: [a], secondary: [] }, current: empty, future: { primary: [b], secondary: [] } });
  });

  it('全入力要素が各時刻でちょうど1区分に入り、6配列を共有しない', /** 欠落・二重分類・区分配列の共有を検出する。 */ () => {
    for (const time of [0, 99, 101.6, translation.endTime, 200]) {
      const view = deriveSubtitleHistory(timeline, time);
      const arrays = [view.past.primary, view.past.secondary, view.current.primary, view.current.secondary, view.future.primary, view.future.secondary];
      expect(new Set(arrays).size).toBe(6);
      for (const role of ['primary', 'secondary'] as const) {
        const expected = new Map<TimedSubtitleText, number>();
        const actual = new Map<TimedSubtitleText, number>();
        for (const value of timeline[role]) expected.set(value, (expected.get(value) ?? 0) + 1);
        for (const period of ['past', 'current', 'future'] as const) {
          for (const value of view[period][role]) actual.set(value, (actual.get(value) ?? 0) + 1);
        }
        expect(actual).toEqual(expected);
      }
    }
  });

  it('構築関数の戻り値をそのまま分類できる', /** 新しい構築・分類の接続を確認する。 */ () => {
    const built = buildSubtitleTimeline(primary.map(toSnapshot), secondary.map(toSnapshot));
    expect(deriveSubtitleHistory(built, 99)).toEqual(deriveSubtitleHistory(timeline, 99));
  });

  it.each([NaN, Infinity, -Infinity, -1])('空timelineでも不正時刻%sを拒否する', /**
   * 不正時刻で空結果を返して隠さないことを確認する。
   * @param time 非有限または負の再生時刻。
   */ (time) => {
    expect(/** 不正時刻で分類する。@returns history。@throws RangeError 入力違反。 */ () => deriveSubtitleHistory(empty, time)).toThrow(RangeError);
    expect(/** 非空入力も同じ境界で拒否する。@returns history。@throws RangeError 入力違反。 */ () => deriveSubtitleHistory(timeline, time)).toThrow(RangeError);
  });
});
