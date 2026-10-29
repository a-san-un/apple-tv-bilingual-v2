/* @vitest-environment jsdom */
/**
 * helper の DOM 処理・境界・失敗を検証する。
 * 単体テストの手作り fragment は WebVTT パーサーの代用品ではない。
 * 標準 API の実例12件は API 不在時に skip し、成功と混同しない。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toSubtitlePlainText } from './subtitle-text';
import { subtitleTextRegressionCases } from './subtitle-text-regression-cases';

/** global の差替えを次のケースへ残さない。 */
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/**
 * テスト専用の ruby を作る。WebVTT の解析はしない。
 * @param base 親文字。
 * @param reading 除外対象の注釈。
 * @returns 未接続の ruby 要素。
 */
const ruby = (base: string, reading: string): HTMLElement => {
  const element = document.createElement('ruby');
  const rt = document.createElement('rt');
  rt.textContent = reading;
  element.append(base, rt);
  return element;
};

describe('subtitle-text の処理境界', /** 単体検証を登録する。 */ () => {
  it('読み仮名と傍点だけを除き、親文字・改行を残す', /** fragment 走査を検証する。 */ () => {
    const fragment = document.createDocumentFragment();
    const wrapper = document.createElement('span');
    wrapper.append(ruby('噂', 'うわさ'), '\n', ruby('本', '・'), ruby('当', '・'), ruby('に', '・'));
    fragment.append(wrapper);
    const parse = vi.fn(/** 作業用 fragment を返す。@returns 未接続 fragment。 */ () => fragment);
    expect(toSubtitlePlainText('raw input', parse)).toBe('噂\n本当に');
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledWith('raw input');
    expect(fragment.querySelectorAll('rt')).toHaveLength(0);
    expect(wrapper.isConnected).toBe(false);
  });

  it('装飾要素の中の文字と空白・記号を保持する', /** 表示用文字の保持を検証する。 */ () => {
    const fragment = document.createDocumentFragment();
    const italic = document.createElement('i');
    italic.textContent = "♪ They don't pay our kind... ♪";
    fragment.append('  ', italic, '\n聞こえ…　出るから待ってて  ');
    expect(toSubtitlePlainText('raw', /** 解析済み境界を差し替える。@returns 作業用 fragment。 */ () => fragment)).toBe("  ♪ They don't pay our kind... ♪\n聞こえ…　出るから待ってて  ");
  });

  it('解析済みの文字を HTML や WebVTT として再解釈しない', /** 二重変換を防ぐ。 */ () => {
    const fragment = document.createDocumentFragment();
    fragment.append('<ruby>字<rt>じ</rt></ruby> & <img src=x>');
    expect(toSubtitlePlainText('encoded raw', /** 文字ノードを返す。@returns 作業用 fragment。 */ () => fragment)).toBe('<ruby>字<rt>じ</rt></ruby> & <img src=x>');
    expect(fragment.querySelector('img, ruby')).toBeNull();
  });

  it('空の解析結果を補完しない', /** 空表示を許可する。 */ () => {
    expect(toSubtitlePlainText('', /** 空 fragment を返す。@returns 作業用 fragment。 */ () => document.createDocumentFragment())).toBe('');
  });

  it('パーサー失敗を空文字や raw に置き換えず返す', /** エラー境界を検証する。 */ () => {
    const error = new Error('parse failed');
    expect(/** 対象を遅延実行する。@returns 変換結果。@throws パーサー失敗。 */ () => toSubtitlePlainText('raw', /** 解析失敗を再現する。@throws テスト用エラー。 */ () => { throw error; })).toThrow(error);
  });

  it('fragment 操作失敗を返す', /** DOM エラー境界を検証する。 */ () => {
    const fragment = document.createDocumentFragment();
    const error = new Error('query failed');
    vi.spyOn(fragment, 'querySelectorAll').mockImplementation(/** DOM 失敗を再現する。@throws テスト用エラー。 */ () => { throw error; });
    expect(/** 対象を遅延実行する。@returns 変換結果。@throws DOM 失敗。 */ () => toSubtitlePlainText('raw', /** 作業用 fragment を返す。@returns fragment。 */ () => fragment)).toThrow(error);
  });

  it('標準 API がなければ明示的に失敗する', /** API 不在を隠さない。 */ () => {
    vi.stubGlobal('VTTCue', undefined);
    expect(/** 標準経路を呼ぶ。@returns 変換結果。@throws API 不在。 */ () => toSubtitlePlainText('raw')).toThrow('VTTCue is unavailable');
  });

  it('標準経路は一時 cue に元の文字列を一度だけ渡す', /** API への委譲だけを検証し、実解析成功とは扱わない。 */ () => {
    const fragment = document.createDocumentFragment();
    fragment.append('parsed');
    const getCueAsHTML = vi.fn(/** API の戻り値を差し替える。@returns 作業用 fragment。 */ () => fragment);
    const construct = vi.fn();
    vi.stubGlobal('VTTCue', class {
      /**
       * API 入力を記録する。
       * @param start 一時 cue の開始時刻。
       * @param end 一時 cue の終了時刻。
       * @param text 元の本文。
       */
      constructor(start: number, end: number, text: string) { construct(start, end, text); }
      getCueAsHTML = getCueAsHTML;
    });
    expect(toSubtitlePlainText('  raw &amp; text  ')).toBe('parsed');
    expect(construct).toHaveBeenCalledTimes(1);
    expect(construct).toHaveBeenCalledWith(0, 1, '  raw &amp; text  ');
    expect(getCueAsHTML).toHaveBeenCalledTimes(1);
  });
});

describe.skipIf(typeof globalThis.VTTCue !== 'function')('標準 VTTCue の実 cue 回帰（API 不在時は未実行）', /** 標準パーサーの12件を登録する。 */ () => {
  it.each(subtitleTextRegressionCases)('$name', /**
   * 元の本文を実パーサーで変換する。
   * @param sample Chrome で観測した入力・期待値。
   */ (sample) => {
    const before = JSON.stringify(sample);
    const fragment = new VTTCue(0, 1, sample.raw).getCueAsHTML();
    expect(fragment.querySelectorAll('rt')).toHaveLength(sample.expectedRtCount);
    expect(toSubtitlePlainText(sample.raw)).toBe(sample.expectedPlain);
    expect(JSON.stringify(sample)).toBe(before);
  });
});
