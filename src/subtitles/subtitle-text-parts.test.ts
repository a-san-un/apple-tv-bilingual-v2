/* @vitest-environment jsdom */
/** 本文準備の分類・fallback・不変性を検証する。API代替は実WebVTT解析の証明ではない。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubtitleTimeline, TimedSubtitleText } from '../shared/types';
import { prepareSubtitleDisplayItems } from './subtitle-text-parts';

/** @param text 元本文。@returns 凍結した元字幕。 */
const cue = (text: string): TimedSubtitleText => Object.freeze({ startTime: 1, endTime: 2, text });
/** @param text 元本文。@returns 変換しない本文。 */
const identity = (text: string): string => text;
afterEach(/** globalとspyを次のケースへ残さない。 */ () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('表示用本文準備', /** 準備結果の契約を検証する。 */ () => {
  it.each([
    ['〝コ︱チ〟', 'auxiliary'],
    ['〝人物紹介〟 〝地名〟', 'auxiliary'],
    [' \n〝人物\n紹介〟\t〝地名〟　\n', 'auxiliary'],
    ['〝A〟〝B〟', 'auxiliary'],
    ['〝Coach〟', 'auxiliary'],
    ['こんにちは 〝コ︱チ〟', 'dialogue'],
    ['〝コ︱チ〟こんにちは', 'dialogue'],
    ['〝A〟 x 〝B〟', 'dialogue'],
    ['〝コ︱チ', 'dialogue'],
    ['コ︱チ〟', 'dialogue'],
    ['〝外側〝内側〟〟', 'dialogue'],
    ['〝A〟〟', 'dialogue'],
    ['〝A〟〝B', 'dialogue'],
    ['普通の字幕', 'dialogue'],
    ['', 'dialogue'],
    [' \n　', 'dialogue'],
  ])('両言語で本文全体を分類する: %j', /**
   * 分類しても本文と元入力位置を維持する。
   * @param text 変換後本文。
   * @param kind 期待する分類。
   */ (text, kind) => {
    const result = prepareSubtitleDisplayItems({ primary: [cue(text)], secondary: [cue(text)] }, identity);
    for (const role of ['primary', 'secondary'] as const) {
      expect(result[role]).toEqual([{ kind, sourceIndex: 0, text }]);
    }
    expect(result.conversionFailed).toBe(false);
  });

  it('空・片言語を扱い、空入力では変換しない', /** 空の言語を補完しない。 */ () => {
    const convert = vi.fn(identity);
    expect(prepareSubtitleDisplayItems({ primary: [], secondary: [] }, convert)).toEqual({ primary: [], secondary: [], conversionFailed: false });
    expect(convert).not.toHaveBeenCalled();
    expect(prepareSubtitleDisplayItems({ primary: [], secondary: [cue('日本語')] }, convert).primary).toEqual([]);
    expect(prepareSubtitleDisplayItems({ primary: [cue('English')], secondary: [] }, convert).secondary).toEqual([]);
  });

  it('元字幕・順序・件数を変えず、同値の別入力も保持する', /** 凍結入力と独立した準備結果を確認する。 */ () => {
    const values = Object.freeze([cue('A'), cue('〝B〟'), cue('A')]);
    const timeline: SubtitleTimeline = Object.freeze({ primary: values, secondary: values });
    const before = JSON.stringify(timeline);
    const convert = vi.fn(identity);
    const first = prepareSubtitleDisplayItems(timeline, convert);
    expect(convert).toHaveBeenCalledTimes(6);
    expect(first.primary).toEqual([
      { kind: 'dialogue', sourceIndex: 0, text: 'A' },
      { kind: 'auxiliary', sourceIndex: 1, text: '〝B〟' },
      { kind: 'dialogue', sourceIndex: 2, text: 'A' },
    ]);
    const again = prepareSubtitleDisplayItems(timeline, identity);
    expect(again).toEqual(first);
    expect(first.primary).not.toBe(first.secondary);
    expect(first.primary[0]).not.toBe(first.secondary[0]);
    expect(first.primary[0]).not.toBe(again.primary[0]);
    expect(JSON.stringify(timeline)).toBe(before);
  });

  it('原文ではなく変換結果を判定し、空変換結果も保持する', /** 変換成功を空文字で失敗扱いにしない。 */ () => {
    const convert = vi.fn().mockReturnValueOnce('〝Coach〟').mockReturnValueOnce('');
    const result = prepareSubtitleDisplayItems({ primary: [cue('<i>〝Coach〟</i>'), cue('<i></i>')], secondary: [] }, convert);
    expect(result.primary).toEqual([{ kind: 'auxiliary', sourceIndex: 0, text: '〝Coach〟' }, { kind: 'dialogue', sourceIndex: 1, text: '' }]);
    expect(result.conversionFailed).toBe(false);
  });

  it('変換失敗は原文全体をセリフへ残し、両言語・後続更新を継続する', /** 失敗を蓄積せず毎回変換を試し、警告は出さない。 */ () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(/** 警告の有無だけを記録する。 */ () => {});
    const convert = vi.fn().mockImplementationOnce(/** 変換失敗を再現する。@throws Error 解析失敗。 */ () => { throw new Error('parse'); }).mockReturnValueOnce('next').mockImplementationOnce(/** 非Errorの変換失敗も再現する。@throws string 解析失敗。 */ () => { throw 'parse'; });
    const timeline = { primary: [cue('〝raw〟'), cue('next')], secondary: [cue('<b>〝raw〟</b>')] };
    const result = prepareSubtitleDisplayItems(timeline, convert);
    expect(result).toEqual({ primary: [{ kind: 'dialogue', sourceIndex: 0, text: '〝raw〟' }, { kind: 'dialogue', sourceIndex: 1, text: 'next' }], secondary: [{ kind: 'dialogue', sourceIndex: 0, text: '<b>〝raw〟</b>' }], conversionFailed: true });
    expect(convert).toHaveBeenCalledTimes(3);
    expect(warn).not.toHaveBeenCalled();
    expect(prepareSubtitleDisplayItems(timeline, identity).conversionFailed).toBe(false);
    convert.mockReset().mockReturnValue('〝recovered〟');
    expect(prepareSubtitleDisplayItems(timeline, convert).primary[0]?.kind).toBe('auxiliary');
    expect(convert).toHaveBeenCalledTimes(3);
  });

  it('省略時は既存変換でruby注釈を除いてから分類する', /** 標準APIへの委譲とDOM処理を代替fragmentで確認する。 */ () => {
    const construct = vi.fn();
    vi.stubGlobal('VTTCue', class {
      /** @param start 一時cue開始。@param end 一時cue終了。@param text 原文。 */
      constructor(start: number, end: number, text: string) { construct(start, end, text); }
      /** @returns 呼出しごとに独立した未接続fragment。 */
      getCueAsHTML(): DocumentFragment {
        const fragment = document.createDocumentFragment();
        const ruby = document.createElement('ruby');
        const rt = document.createElement('rt');
        rt.textContent = 'よみ';
        ruby.append('人物', rt);
        fragment.append('〝', ruby, '〟');
        return fragment;
      }
    });
    const raw = '<ruby>人物<rt>よみ</rt></ruby>';
    const result = prepareSubtitleDisplayItems({ primary: [cue(raw)], secondary: [] });
    expect(construct).toHaveBeenCalledTimes(1);
    expect(construct).toHaveBeenCalledWith(0, 1, raw);
    expect(result.primary).toEqual([{ kind: 'auxiliary', sourceIndex: 0, text: '〝人物〟' }]);
    expect(result.conversionFailed).toBe(false);
  });

  it('標準API不在も原文fallbackし、空の成功へ読み替えない', /** API不在による変換失敗を結果に残す。 */ () => {
    vi.stubGlobal('VTTCue', undefined);
    expect(prepareSubtitleDisplayItems({ primary: [cue('〝raw〟')], secondary: [] })).toEqual({ primary: [{ kind: 'dialogue', sourceIndex: 0, text: '〝raw〟' }], secondary: [], conversionFailed: true });
  });
});
