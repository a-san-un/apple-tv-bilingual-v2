/* @vitest-environment jsdom */
/** display描画とDOM寿命を検証する。実ブラウザの寸法・追従は別検証。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelRenderer, type PanelRenderInput } from './panel-renderer';
import type { SubtitleDisplayBlock } from '../shared/types';
import * as text from './subtitle-text';

/** @param value 表示済み本文。@param kind 枠種別。@returns 固定の表示枠。 */
const block = (value: string, kind: 'dialogue' | 'auxiliary' = 'dialogue'): SubtitleDisplayBlock => ({
  kind, startTime: 1, endTime: 2, primary: [{ sourceIndex: 0, text: value }], secondary: [],
});
/** @param blocks 固定順の表示枠。@returns 全枠が現在の入力。 */
const input = (blocks: readonly SubtitleDisplayBlock[] = []): PanelRenderInput => ({
  generation: 1, display: { status: 'ready', blocks, history: { past: [], current: blocks, future: [] } },
  panelOpen: true, extensionEnabled: true,
});
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('panel-rendererのdisplay描画', () => {
  it('画面順とblocks位置の対応を分け、現在枠全体を強調する', () => {
    const host = document.createElement('div'); const renderer = createPanelRenderer(host);
    const a = block('future'); const b = block('past'); const c = block('〝現在〟', 'auxiliary');
    const data: PanelRenderInput = { ...input(), display: { status: 'ready', blocks: [a,b,c], history: { past: [b], current: [c], future: [a] } } };
    const before = JSON.stringify(data);
    try {
      const result = renderer.render(data)!;
      expect(result.scrollEl.textContent).toBe('past〝現在〟future');
      expect(result.blockElements.map(row => row.textContent)).toEqual(['future','past','〝現在〟']);
      expect(host.querySelectorAll('[aria-current]')).toHaveLength(1);
      expect(result.blockElements[2]?.getAttribute('aria-current')).toBe('true');
      expect(result.blockElements[2]?.style.fontWeight).toBe('700');
      expect(JSON.stringify(data)).toBe(before);
    } finally { renderer.dispose(); }
  });

  it('別snapshotの同世代・区分移動でも枠DOMと本文DOMを再利用する', () => {
    const host = document.createElement('div'); const renderer = createPanelRenderer(host);
    try {
      const first = renderer.render(input([block('same')]))!;
      const entry = first.blockElements[0]?.querySelector('[data-subtitle-entry]');
      const b = block('same');
      const next = renderer.render({ ...input(), display: { status: 'ready', blocks: [b], history: { past: [b], current: [], future: [] } } })!;
      expect(next.blockElements[0]).toBe(first.blockElements[0]);
      expect(next.blockElements[0]?.querySelector('[data-subtitle-entry]')).toBe(entry);
      expect(next.blockElements[0]?.hasAttribute('aria-current')).toBe(false);
      const changed = renderer.render({ ...input([b]), generation: 2 })!;
      expect(changed.blockElements[0]).not.toBe(first.blockElements[0]);
    } finally { renderer.dispose(); }
  });

  it('準備済み本文と原文fallbackをHTML解釈・再変換しない', () => {
    const convert = vi.spyOn(text, 'toSubtitlePlainText');
    const host = document.createElement('div'); const renderer = createPanelRenderer(host);
    try {
      const result = renderer.render(input([block('<img src=x>\n<ruby>字</ruby>')]))!;
      expect(result.scrollEl.textContent).toBe('<img src=x>\n<ruby>字</ruby>');
      expect(host.querySelector('img,ruby')).toBeNull();
      expect(convert).not.toHaveBeenCalled();
      const regions = result.blockElements[0]!.querySelectorAll<HTMLElement>('[data-subtitle-role]');
      expect(regions).toHaveLength(2);
      expect(regions[1]?.textContent).toBe('');
      for (const region of Array.from(regions)) { expect(region.style.minHeight).toBe('1lh'); expect(region.style.whiteSpace).toBe('pre-wrap'); }
    } finally { renderer.dispose(); }
  });

  it.each(['null','empty','timeline-failed','display-failed'] as const)('%sでは旧字幕を消し案内文を追加しない', status => {
    const host = document.createElement('div'); const renderer = createPanelRenderer(host);
    try {
      renderer.render(input([block('old')]));
      const data: PanelRenderInput = status === 'null' ? { ...input(), generation: null, display: null }
        : status === 'empty' ? input() : { ...input(), display: { status: 'unavailable', reason: status } };
      const result = renderer.render(data)!;
      expect(result.scrollEl.textContent).toBe(''); expect(result.blockElements).toEqual([]);
      expect(host.querySelector('p')).toBeNull();
      expect(renderer.render(input([block('recovered')]))!.scrollEl.textContent).toBe('recovered');
    } finally { renderer.dispose(); }
  });

  it('不正時刻では固定順で表示し現在強調を外す', () => {
    const host = document.createElement('div'); const renderer = createPanelRenderer(host);
    const blocks = [block('a'), block('b','auxiliary')];
    try {
      const first = renderer.render(input(blocks))!;
      const result = renderer.render({ ...input(), display: { status: 'invalid-time', blocks } })!;
      expect(result.scrollEl.textContent).toBe('ab');
      expect(result.blockElements[0]).toBe(first.blockElements[0]);
      expect(host.querySelector('[aria-current]')).toBeNull();
    } finally { renderer.dispose(); }
  });

  it('空の表示本文も枠・両言語領域として保持する', () => {
    const host = document.createElement('div'); const renderer = createPanelRenderer(host);
    try { expect(renderer.render(input([block('')]))!.blockElements).toHaveLength(1); expect(host.querySelectorAll('[data-subtitle-role]')).toHaveLength(2); }
    finally { renderer.dispose(); }
  });

  it('初回は非表示で、enabledとopenの両方がtrueの場合だけ表示する', () => {
    const host = document.createElement('div'); const renderer = createPanelRenderer(host);
    const root = host.firstElementChild as HTMLElement; expect(root.hidden).toBe(true);
    try { for (const enabled of [false,true]) for (const open of [false,true]) {
      expect(renderer.render({ ...input(), panelOpen: open, extensionEnabled: enabled })).not.toBeNull();
      expect(root.hidden).toBe(!(open && enabled));
    } } finally { renderer.dispose(); }
  });

  it('所有領域だけを一度除去し、終了後はnullを返す', () => {
    const host = document.createElement('div'); const existing = document.createElement('span'); host.append(existing);
    const renderer = createPanelRenderer(host); renderer.render(input());
    const root = host.querySelector('[data-subtitle-panel]')!; const remove = vi.spyOn(root,'remove');
    renderer.dispose(); renderer.dispose(); expect(renderer.render(input())).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1); expect(host.firstChild).toBe(existing); expect(host.children).toHaveLength(1);
    const next = createPanelRenderer(host); renderer.dispose(); expect(next.render(input())).not.toBeNull(); next.dispose();
  });

  it('除去失敗でも終了を維持し再試行しない', () => {
    const host = document.createElement('div'); const renderer = createPanelRenderer(host); renderer.render(input());
    const root = host.firstElementChild!; const error = new Error('remove failed');
    const remove = vi.spyOn(root,'remove').mockImplementation(() => { throw error; });
    expect(() => renderer.dispose()).toThrow(error); expect(() => renderer.dispose()).not.toThrow();
    expect(renderer.render(input([block('late')]))).toBeNull(); expect(remove).toHaveBeenCalledTimes(1);
  });
});


it('同世代・同じ並びの更新では一覧を再挿入しない', () => {
  const host=document.createElement('div'); const renderer=createPanelRenderer(host);
  try {
    const first=renderer.render(input([block('same')]))!;
    const replace=vi.spyOn(first.scrollEl,'replaceChildren');
    const next=renderer.render(input([block('same')]))!;
    expect(replace).not.toHaveBeenCalled(); expect(next.blockElements[0]).toBe(first.blockElements[0]);
  } finally { renderer.dispose(); }
});
