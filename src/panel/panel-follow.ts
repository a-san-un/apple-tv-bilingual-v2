/**
 * 描画後の対象案内・手動停止・位置維持と操作listenerを所有する。
 * rendererのDOMを借用し、除去・本文変換・時刻分類・保存は行わない。
 */
import { createDisposeBag, type DisposeBag } from '../shared/dispose';
import type { Disposable } from '../shared/types';
import type { SubtitleUpdateReason } from '../subtitles/subtitle-session';
import type { PanelRenderInput, PanelRenderResult } from './panel-renderer';

export type PanelUpdateTrigger = SubtitleUpdateReason | 'initial' | 'ui';
export type PanelFollowInput = Readonly<{ presentation: PanelRenderInput; rendered: PanelRenderResult; trigger: PanelUpdateTrigger }>;
export type PanelFollow = Disposable & { beforeRender(): void; afterRender(input: PanelFollowInput | null): void };

/** @param input 同じsnapshotの表示とDOM対応。@returns 案内対象のblocks内位置。 */
const selectTarget = (input: PanelFollowInput): number => {
  const display = input.presentation.display;
  if (display?.status !== 'ready') return -1;
  const history = display.history;
  let target = history.current.find(block => block.kind === 'dialogue') ?? history.current[0];
  if (target === undefined) {
    for (const block of history.past) {
      if (target === undefined || block.endTime > target.endTime) target = block;
    }
  }
  target ??= history.future[0];
  return target === undefined ? -1 : display.blocks.indexOf(target);
};

/** @param input 描画情報。@returns UI意思と所有領域が可視ならtrue。 */
const visible = (input: PanelFollowInput): boolean =>
  input.presentation.extensionEnabled && input.presentation.panelOpen &&
  !input.rendered.scrollEl.closest<HTMLElement>('[data-subtitle-panel]')?.hidden;

/** @returns 接続側が破棄する追従owner。予約処理や保存stateは持たない。 */
export const createPanelFollow = (): PanelFollow => {
  let disposed = false;
  let manual = false;
  let latest: PanelFollowInput | null = null;
  let binding: DisposeBag | null = null;
  let boundScroll: HTMLElement | null = null;
  let boundButton: HTMLButtonElement | null = null;
  let bindingRevision = 0;
  let lastTarget: { generation: number | null; index: number } | null = null;
  let saved: { generation: number | null; top: number; index: number; offset: number } | null = null;

  /** bindingを先に無効化する。@throws AggregateError listener解除失敗。 */
  const release = (): void => {
    const old = binding; binding = null; boundScroll = null; boundButton = null; ++bindingRevision;
    old?.dispose();
  };
  /** @param el 借用するスクロール領域。@param top 目標位置。 */
  const move = (el: HTMLElement, top: number): void => {
    el.scrollTop = Math.max(0, Math.min(Math.max(0, el.scrollHeight - el.clientHeight), top));
  };
  /** @param force 初回・seek・明示再開で先頭を上端へ寄せる。 */
  const guide = (force: boolean): void => {
    const input = latest;
    if (disposed || manual || input === null || !visible(input)) return;
    const index = selectTarget(input);
    if (index < 0) { lastTarget = null; return; }
    const generation = input.presentation.generation;
    if (!force && lastTarget?.generation === generation && lastTarget.index === index) return;
    lastTarget = { generation, index };
    const { scrollEl, blockElements } = input.rendered;
    const row = blockElements[index];
    if (row === undefined) return;
    const viewport = scrollEl.getBoundingClientRect();
    const top = row.getBoundingClientRect().top;
    if (force || top < viewport.top) move(scrollEl, scrollEl.scrollTop + top - viewport.top);
    else if (top >= viewport.bottom) move(scrollEl, scrollEl.scrollTop + top - viewport.bottom + 1);
  };
  /** @param input 最新の借用DOM。@throws listener登録・旧binding解除の失敗。 */
  const bind = (input: PanelFollowInput): void => {
    const { scrollEl, resumeButton } = input.rendered;
    if (boundScroll === scrollEl && boundButton === resumeButton) return;
    release();
    const bag = createDisposeBag(); binding = bag; boundScroll = scrollEl; boundButton = resumeButton;
    const revision = bindingRevision;
    /** @returns この登録が現在のownerに属するならtrue。 */
    const active = (): boolean => !disposed && revision === bindingRevision;
    /** ユーザーのスクロール入力だけで停止する。 */
    const stop = (): void => { if (active()) manual = true; };
    /** @param event スクロールを起こすキー。入力欄の編集は除く。 */
    const key = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) stop();
    };
    /** @param event スクロールバー上のpointer操作。本文選択では停止しない。 */
    const pointer = (event: PointerEvent): void => {
      const rect = scrollEl.getBoundingClientRect();
      if (event.target === scrollEl && event.clientX >= rect.left + scrollEl.clientLeft + scrollEl.clientWidth) stop();
    };
    /** 明示的な再開。字幕取得や再bindは行わない。 */
    const resume = (): void => { if (active()) { manual = false; lastTarget = null; guide(true); } };
    bag.add(() => scrollEl.removeEventListener('wheel', stop)); scrollEl.addEventListener('wheel', stop, { passive: true });
    bag.add(() => scrollEl.removeEventListener('touchmove', stop)); scrollEl.addEventListener('touchmove', stop, { passive: true });
    bag.add(() => scrollEl.removeEventListener('keydown', key)); scrollEl.addEventListener('keydown', key);
    bag.add(() => scrollEl.removeEventListener('pointerdown', pointer)); scrollEl.addEventListener('pointerdown', pointer);
    bag.add(() => resumeButton.removeEventListener('click', resume)); resumeButton.addEventListener('click', resume);
  };

  return {
    /** 手動閲覧時だけ、描画前の位置と見えている枠を記録する。 */
    beforeRender(): void {
      saved = null;
      if (disposed || !manual || latest === null || !visible(latest)) return;
      const { scrollEl, blockElements } = latest.rendered;
      const viewport = scrollEl.getBoundingClientRect();
      const row = Array.from(scrollEl.children).find(el => { const r = el.getBoundingClientRect(); return r.bottom > viewport.top && r.top < viewport.bottom; });
      saved = { generation: latest.presentation.generation, top: scrollEl.scrollTop, index: row === undefined ? -1 : blockElements.indexOf(row as HTMLElement), offset: row === undefined ? 0 : row.getBoundingClientRect().top - viewport.top };
    },
    /** @param input 有効な描画結果。nullは旧対応無効化。@throws listener操作失敗。 */
    afterRender(input): void {
      if (disposed) return;
      const position = saved; saved = null; latest = input;
      if (input === null) { lastTarget = null; release(); return; }
      bind(input);
      if (!visible(input)) { lastTarget = null; return; }
      if (manual) {
        if (position !== null) {
          const { scrollEl, blockElements } = input.rendered;
          const row = position.generation === input.presentation.generation ? blockElements[position.index] : undefined;
          if (row === undefined) move(scrollEl, position.top);
          else move(scrollEl, scrollEl.scrollTop + row.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top - position.offset);
        }
        return;
      }
      guide(input.trigger === 'initial' || input.trigger === 'seek');
    },
    /** 内部参照を先に解放し、解除失敗後も終了を維持する。@throws AggregateError 解除失敗。 */
    dispose(): void {
      if (disposed) return; disposed = true; latest = null; saved = null; lastTarget = null; release();
    },
  };
};
