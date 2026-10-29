/* @vitest-environment jsdom */
/**
 * panel-renderer.test.ts
 *
 * Vitest と jsdom で panel の表示契約・DOM 所有・反復 cleanup を検証する。
 * mock は afterEach で復元し、document に追加したテスト DOM を除去する。
 * ブラウザの可視性・実寸法・再生経路の購読解除は、このテストでは証明しない。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as subtitleText from './subtitle-text';
import { subtitleTextRegressionCases } from './subtitle-text-regression-cases';
import type { SubtitleHistoryView, SubtitleTimeline, TimedSubtitleText } from '../shared/types';
import { createPanelRenderer, type PanelRenderInput } from './panel-renderer';

/** @param text 固定する本文。@returns 1言語の時刻付き字幕単位。 */
const entry = (text: string): TimedSubtitleText => ({ startTime: 0, endTime: 1, text });

/** @param text 学習言語本文。@returns 両言語が独立した配列を持つ区分入力。 */
const period = (text: string): SubtitleTimeline => ({ primary: [entry(text)], secondary: [entry(`訳:${text}`)] });

/** 入力を組み立てるテストだけが区分を差し替える。描画APIのreadonly契約は維持する。 */
type MutableRenderInput = Omit<PanelRenderInput, 'history'> & {
  history: { -readonly [K in keyof SubtitleHistoryView]: SubtitleHistoryView[K] };
};

/**
 * 空 history を表示する入力を作る。
 * @returns テスト内で変更できる独立した入力。
 */
const input = (): MutableRenderInput => ({
  history: { past: { primary: [], secondary: [] }, current: { primary: [], secondary: [] }, future: { primary: [], secondary: [] } },
  extensionEnabled: true, panelOpen: true,
});

beforeEach(/** 既存の描画契約は変換を恒等関数へ差し替えて確認する。 */ () => {
  vi.spyOn(subtitleText, 'toSubtitlePlainText').mockImplementation(/**
   * 本文を変更しないテスト用境界。
   * @param text 入力本文。
   * @returns 同じ本文。
   */ (text) => text);
  vi.spyOn(console, 'warn').mockImplementation(/** テスト中の警告出力を抑え、呼出しは検証する。 */ () => {});
});

afterEach(/** mock とテスト DOM を次のケースへ持ち越さない。 */ () => {
  vi.unstubAllGlobals();
  // 意図的に失敗させた DOM method も復元してから、テスト DOM を除去する。
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('panel-renderer', /** この module の契約を検証するケースを登録する。 */ () => {
  it('過去・現在・未来の順で言語別に描画し、現在の全字幕を強調する', /** 区分と全件保持を確認する。 */ () => {
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const data = input();
    data.history = { past: period('past'), current: { primary: [entry('current1'), entry('current2')], secondary: [entry('現在')] }, future: period('future') };
    const before = JSON.stringify(data);
    renderer.render(data);
    const sections = Array.from(host.querySelectorAll<HTMLElement>('[data-subtitle-period]'));
    expect(sections.map(/** @param el 区分要素。@returns 区分名。 */ el => el.dataset.subtitlePeriod)).toEqual(['past', 'current', 'future']);
    const rows = Array.from(host.querySelectorAll<HTMLElement>('[data-subtitle-entry]'));
    expect(rows.map(/** @param el 字幕要素。@returns 表示本文。 */ el => el.textContent)).toEqual(['past', '訳:past', 'current1', 'current2', '現在', 'future', '訳:future']);
    const current = host.querySelectorAll<HTMLElement>('[aria-current="true"]');
    expect(current).toHaveLength(3);
    for (const row of Array.from(current)) expect(row.style.fontWeight).toBe('700');
    expect(JSON.stringify(data)).toBe(before);
    renderer.dispose();
  });

  it('片言語でも領域を移動せず、改行と空行の高さを保持する', /** ペアの欠損ではなく言語別空配列を扱う。 */ () => {
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const data = input();
    data.history.future = { primary: [entry('primary\nline')], secondary: [] };
    renderer.render(data);
    let future = host.querySelector('[data-subtitle-period="future"]')!;
    expect(future.children[0]?.textContent).toBe('primary\nline');
    expect(future.children[1]?.textContent).toBe('');
    for (const el of Array.from(future.querySelectorAll<HTMLElement>('[data-subtitle-role] > div'))) {
      expect(el.style.whiteSpace).toBe('pre-wrap');
      expect(el.style.minHeight).toBe('1lh');
    }
    data.history.future = { primary: [], secondary: [entry('母国語\n本文')] };
    renderer.render(data);
    future = host.querySelector('[data-subtitle-period="future"]')!;
    expect(future.children[0]?.textContent).toBe('');
    expect(future.children[1]?.textContent).toBe('母国語\n本文');
    expect(host.querySelector('[aria-current]')).toBeNull();
    renderer.dispose();
  });

  it('本文を HTML として解釈しない', /** 本文を HTML として解釈しないことを検証する。 */ () => {
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const data = input();
    data.history.current = period('<img src=x onerror=alert(1)> & <ruby>字</ruby>');
    renderer.render(data);
    expect(host.querySelector('img, ruby')).toBeNull();
    expect(host.querySelector('[data-subtitle-entry]')?.firstChild?.textContent).toBe(data.history.current.primary[0]?.text);
    renderer.dispose();
  });

  it('空状態と字幕行を相互に置き換え、二重描画しない', /** 空状態と字幕行を相互に置き換え、二重描画しないことを検証する。 */ () => {
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const data = input();
    renderer.render(data);
    expect(host.textContent).toBe('表示できる字幕はありません');
    data.history.current = period('new');
    renderer.render(data);
    renderer.render(data);
    expect(host.querySelectorAll('[data-subtitle-panel]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-subtitle-entry]')).toHaveLength(2);
    expect(host.querySelector('p')).toBeNull();
    renderer.render(input());
    expect(host.querySelector('[data-subtitle-entry]')).toBeNull();
    expect(host.textContent).toBe('表示できる字幕はありません');
    renderer.dispose();
  });

  it('初回は非表示で、ON と open が両方 true のときだけ表示する', /** 初回は非表示で、ON と open が両方 true のときだけ表示することを検証する。 */ () => {
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const root = host.firstElementChild as HTMLElement;
    expect(root.hidden).toBe(true);
    for (const enabled of [false, true]) {
      for (const open of [false, true]) {
        renderer.render({ ...input(), extensionEnabled: enabled, panelOpen: open });
        expect(root.hidden).toBe(!(enabled && open));
      }
    }
    renderer.dispose();
  });

  it('自身の領域だけを除去し、dispose 後に再描画しない', /** 自身の領域だけを除去し、dispose 後に再描画しないことを検証する。 */ () => {
    const host = document.createElement('div');
    const existing = document.createElement('button');
    host.append(existing);
    document.body.append(host);
    const renderer = createPanelRenderer(host);
    renderer.render(input());
    const root = host.querySelector('[data-subtitle-panel]')!;
    const remove = vi.spyOn(root, 'remove');
    renderer.dispose();
    renderer.dispose();
    renderer.render(input());
    expect(remove).toHaveBeenCalledTimes(1);
    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild).toBe(existing);
    expect(host.isConnected).toBe(true);
  });

  it('旧 renderer の cleanup が新 renderer の領域を外さない', /** 旧 renderer の cleanup が新 renderer の領域を外さないことを検証する。 */ () => {
    const host = document.createElement('div');
    const old = createPanelRenderer(host);
    old.dispose();
    const next = createPanelRenderer(host);
    next.render(input());
    const root = host.firstElementChild;
    old.dispose();
    old.render(input());
    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild).toBe(root);
    next.dispose();
  });

  it('除去失敗後も旧 DOM を更新せず、除去成功とは扱わない', /** 除去失敗後も旧 DOM を更新せず、除去成功とは扱わないことを検証する。 */ () => {
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    renderer.render(input());
    const root = host.firstElementChild!;
    const before = root.innerHTML;
    const error = new Error('remove failed');
    const remove = vi.spyOn(root, 'remove').mockImplementation(/** DOM 操作の失敗を再現する。@throws テストで用意した例外。 */ () => { throw error; });
    expect(/** assertion 対象の呼出しを遅延する。@returns 呼出し結果。@throws 対象処理が投げた例外。 */ () => renderer.dispose()).toThrow(error);
    const data = input();
    data.history.current = period('must not render');
    renderer.render(data);
    expect(/** assertion 対象の呼出しを遅延する。@returns 呼出し結果。@throws 対象処理が投げた例外。 */ () => renderer.dispose()).not.toThrow();
    expect(root.parentElement).toBe(host);
    expect(root.innerHTML).toBe(before);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});


/** 変換の正しさではなく、helper と描画の接続・失敗分離を確認する。 */
describe('panel-renderer の表示用本文変換', /** 接続ケースを登録する。 */ () => {
  it.each(subtitleTextRegressionCases)('$name の変換結果を対応言語だけに表示する', /**
   * 観測済み結果を返す helper 境界で、受渡しを検証する。標準パーサーの検証ではない。
   * @param sample 実 cue の入力・期待値。
   */ (sample) => {
    const convert = vi.mocked(subtitleText.toSubtitlePlainText).mockReturnValue(sample.expectedPlain);
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const data = input();
    data.history.current = { primary: sample.language === 'en' ? [entry(sample.raw)] : [], secondary: sample.language === 'ja' ? [entry(sample.raw)] : [] };
    const before = JSON.stringify(data);
    try {
      renderer.render(data);
      const row = host.querySelector('[data-subtitle-period="current"]')!;
      expect(row.children[0]?.textContent).toBe(sample.language === 'en' ? sample.expectedPlain : '');
      expect(row.children[1]?.textContent).toBe(sample.language === 'ja' ? sample.expectedPlain : '');
      expect(convert).toHaveBeenCalledTimes(1);
      expect(convert).toHaveBeenCalledWith(sample.raw);
      expect(JSON.stringify(data)).toBe(before);
      expect(row.querySelector('ruby, rt, i')).toBeNull();
      expect(console.warn).not.toHaveBeenCalled();
    } finally { renderer.dispose(); }
  });

  it('両言語を独立に変換し、失敗した本文だけ raw へ戻して後続更新も試す', /** 失敗分離と警告抑制を検証する。 */ () => {
    const error = new Error('conversion failed');
    const convert = vi.mocked(subtitleText.toSubtitlePlainText).mockImplementation(/**
     * 片側の失敗を再現する。
     * @param text 入力本文。
     * @returns 正常側の表示文字列。
     * @throws bad 本文の変換失敗。
     */ (text) => { if (text === '<bad>') throw error; return `plain:${text}`; });
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const data = input();
    data.history.future = { primary: [entry('<bad>'), entry('next')], secondary: [entry('日本語'), entry('訳:next')] };
    const before = JSON.stringify(data);
    try {
      renderer.render(data);
      expect(host.querySelector('[data-subtitle-period="future"]')?.textContent).toBe('<bad>plain:nextplain:日本語plain:訳:next');
      expect(host.textContent).toContain('plain:next');
      renderer.render(data);
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith('[atv-bilingual:panel] subtitle text conversion failed; using original text', error);
      expect(host.querySelector('bad')).toBeNull();
      expect(JSON.stringify(data)).toBe(before);
      convert.mockReturnValue('recovered');
      renderer.render(data);
      expect(host.textContent).not.toContain('<bad>');
      expect(host.textContent).toContain('recovered');
    } finally { renderer.dispose(); }
  });

  it('空の変換結果でも block と欠損側の空行を削除しない', /** null と変換後の空を区別する。 */ () => {
    const convert = vi.mocked(subtitleText.toSubtitlePlainText).mockReturnValue('');
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const data = input();
    data.history.current = { primary: [entry('<b></b>')], secondary: [] };
    try {
      renderer.render(data);
      const row = host.querySelector('[data-subtitle-period="current"]')!;
      expect(row.children).toHaveLength(2);
      expect(row.textContent).toBe('');
      expect(host.querySelector('p')).toBeNull();
      expect(convert).toHaveBeenCalledTimes(1);
    } finally { renderer.dispose(); }
  });

  it('変換された文字列も HTML として挿入しない', /** helper の出力を安全に表示する。 */ () => {
    const literal = '<img src=x onerror=alert(1)> & <ruby>字</ruby>';
    vi.mocked(subtitleText.toSubtitlePlainText).mockReturnValue(literal);
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const data = input(); data.history.current = { primary: [entry('encoded')], secondary: [] };
    try {
      renderer.render(data);
      expect(host.querySelector('img, ruby')).toBeNull();
      expect(host.querySelector('[data-subtitle-entry]')?.textContent).toBe(literal);
    } finally { renderer.dispose(); }
  });

  it('実 helper の API 不在でも raw を安全表示する', /** 実失敗経路と renderer の fallback を接続して確認する。 */ () => {
    vi.mocked(subtitleText.toSubtitlePlainText).mockRestore();
    vi.stubGlobal('VTTCue', undefined);
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const data = input(); data.history.current = period('<i>raw</i>');
    try {
      renderer.render(data);
      expect(host.querySelector('[data-subtitle-entry]')?.firstChild?.textContent).toBe('<i>raw</i>');
      expect(host.querySelector('i')).toBeNull();
      expect(console.warn).toHaveBeenCalledTimes(1);
    } finally { renderer.dispose(); }
  });

  it('空 history では helper を呼ばない', /** 字幕なしを変換失敗と混同しない。 */ () => {
    const host = document.createElement('div'); const renderer = createPanelRenderer(host);
    try { renderer.render(input()); expect(subtitleText.toSubtitlePlainText).not.toHaveBeenCalled(); } finally { renderer.dispose(); }
  });

  it('dispose 後は変換も再描画もしない', /** 終了後の境界呼出しを防ぐ。 */ () => {
    const host = document.createElement('div'); const renderer = createPanelRenderer(host);
    renderer.dispose();
    const data = input(); data.history.current = period('late');
    renderer.render(data);
    expect(subtitleText.toSubtitlePlainText).not.toHaveBeenCalled();
    expect(host.children).toHaveLength(0);
  });
});
