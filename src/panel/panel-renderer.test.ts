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
import type { SubtitleBlock } from '../shared/types';
import { createPanelRenderer, type PanelRenderInput } from './panel-renderer';

/**
 * 本文と時刻を持つテスト用 block を作る。
 * @param text 学習言語本文。
 * @returns 母国語本文も持つ block。
 */
const block = (text: string): SubtitleBlock => ({
  startTime: 0, endTime: 1, primaryText: text, secondaryText: `訳:${text}`,
});

/**
 * 空 history を表示する入力を作る。
 * @returns テスト内で変更できる独立した入力。
 */
const input = (): PanelRenderInput => ({
  history: { past: [], current: null, future: [] },
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
  it('history 順に全行を表示し、指定された current だけを強調する', /** history 順に全行を表示し、指定された current だけを強調することを検証する。 */ () => {
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const data = input();
    data.history = { past: [block('past')], current: block('current'), future: [block('future')] };
    const before = JSON.stringify(data);
    renderer.render(data);
    const rows = Array.from(host.querySelectorAll<HTMLElement>('[data-subtitle-block]'));
    expect(rows.map(/** 行の上段本文を読む。@param row 描画済みの行。@returns 上段本文。 */ row => row.firstChild?.textContent)).toEqual(['past', 'current', 'future']);
    expect(host.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    expect(rows[1]?.getAttribute('aria-current')).toBe('true');
    expect(rows[1]?.style.fontWeight).toBe('700');
    expect(JSON.stringify(data)).toBe(before);
    renderer.dispose();
  });

  it('両側の欠損でも言語領域を移動せず、改行と空行の高さを指定する', /** 両側の欠損でも言語領域を移動せず、改行と空行の高さを指定することを検証する。 */ () => {
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const data = input();
    data.history.future = [
      { ...block('primary\nline'), secondaryText: null },
      { ...block('unused'), primaryText: null, secondaryText: '母国語\n本文' },
    ];
    renderer.render(data);
    const rows = Array.from(host.querySelectorAll('[data-subtitle-block]'));
    expect(Array.from(rows[0]!.children).map(/** 言語領域の本文を読む。@param el 描画済みの言語領域。@returns 領域の本文。 */ el => el.textContent)).toEqual(['primary\nline', '']);
    expect(Array.from(rows[1]!.children).map(/** 言語領域の本文を読む。@param el 描画済みの言語領域。@returns 領域の本文。 */ el => el.textContent)).toEqual(['', '母国語\n本文']);
    for (const row of rows) {
      for (const region of Array.from(row.children)) {
        expect((region as HTMLElement).style.whiteSpace).toBe('pre-wrap');
        expect((region as HTMLElement).style.minHeight).toBe('1lh');
      }
    }
    expect(host.querySelector('[aria-current]')).toBeNull();
    renderer.dispose();
  });

  it('本文を HTML として解釈しない', /** 本文を HTML として解釈しないことを検証する。 */ () => {
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const data = input();
    data.history.current = block('<img src=x onerror=alert(1)> & <ruby>字</ruby>');
    renderer.render(data);
    expect(host.querySelector('img, ruby')).toBeNull();
    expect(host.querySelector('[data-subtitle-block]')?.firstChild?.textContent).toBe(data.history.current.primaryText);
    renderer.dispose();
  });

  it('空状態と字幕行を相互に置き換え、二重描画しない', /** 空状態と字幕行を相互に置き換え、二重描画しないことを検証する。 */ () => {
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const data = input();
    renderer.render(data);
    expect(host.textContent).toBe('表示できる字幕はありません');
    data.history.current = block('new');
    renderer.render(data);
    renderer.render(data);
    expect(host.querySelectorAll('[data-subtitle-panel]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-subtitle-block]')).toHaveLength(1);
    expect(host.querySelector('p')).toBeNull();
    renderer.render(input());
    expect(host.querySelector('[data-subtitle-block]')).toBeNull();
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
    data.history.current = block('must not render');
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
    data.history.current = { startTime: 0, endTime: 1, primaryText: sample.language === 'en' ? sample.raw : null, secondaryText: sample.language === 'ja' ? sample.raw : null };
    const before = JSON.stringify(data);
    try {
      renderer.render(data);
      const row = host.querySelector('[data-subtitle-block]')!;
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
    data.history.future = [{ ...block('<bad>'), secondaryText: '日本語' }, block('next')];
    const before = JSON.stringify(data);
    try {
      renderer.render(data);
      expect(host.querySelector('[data-subtitle-block]')?.textContent).toBe('<bad>plain:日本語');
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
    data.history.current = { ...block('<b></b>'), secondaryText: null };
    try {
      renderer.render(data);
      const row = host.querySelector('[data-subtitle-block]')!;
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
    const data = input(); data.history.current = { ...block('encoded'), secondaryText: null };
    try {
      renderer.render(data);
      expect(host.querySelector('img, ruby')).toBeNull();
      expect(host.querySelector('[data-subtitle-block]')?.textContent).toBe(literal);
    } finally { renderer.dispose(); }
  });

  it('実 helper の API 不在でも raw を安全表示する', /** 実失敗経路と renderer の fallback を接続して確認する。 */ () => {
    vi.mocked(subtitleText.toSubtitlePlainText).mockRestore();
    vi.stubGlobal('VTTCue', undefined);
    const host = document.createElement('div');
    const renderer = createPanelRenderer(host);
    const data = input(); data.history.current = block('<i>raw</i>');
    try {
      renderer.render(data);
      expect(host.querySelector('[data-subtitle-block]')?.firstChild?.textContent).toBe('<i>raw</i>');
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
    const data = input(); data.history.current = block('late');
    renderer.render(data);
    expect(subtitleText.toSubtitlePlainText).not.toHaveBeenCalled();
    expect(host.children).toHaveLength(0);
  });
});
