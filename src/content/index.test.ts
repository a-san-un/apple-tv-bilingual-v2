/* @vitest-environment jsdom */
/**
 * content entry の再評価予約と lifecycle への委譲を確認する。
 * observer 通知は手動発火し、timer は fake timer で制御する。
 * target 解決と UI store は実装を使い、字幕処理・storage・badge は差し替える。
 * 実ブラウザの MutationObserver 配信や字幕取得そのものは対象外とする。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolvePlaybackTarget } from './playback-root';
import { createSessionLifecycle, type SessionStateListener } from './session-lifecycle';
import { createSessionDebugBadge } from './debug-badge';
import { attachSubtitleSnapshotLog } from './debug-subtitle-log';
import { loadSettings } from '../settings/settings-store';
import type { PlaybackTarget, RestartReason, SessionState, UiStateStore } from '../shared/types';
import { createUiStateStore } from '../ui/ui-state';

vi.mock('./session-lifecycle', () => ({ createSessionLifecycle: vi.fn() }));
vi.mock('./debug-badge', () => ({ createSessionDebugBadge: vi.fn() }));
vi.mock('./debug-subtitle-log', () => ({ attachSubtitleSnapshotLog: vi.fn() }));
vi.mock('../settings/settings-store', () => ({ loadSettings: vi.fn() }));
vi.mock('./playback-root', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./playback-root')>();
  return { ...actual, resolvePlaybackTarget: vi.fn(actual.resolvePlaybackTarget) };
});
vi.mock('../ui/ui-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/ui-state')>();
  return { ...actual, createUiStateStore: vi.fn(actual.createUiStateStore) };
});

let emitMutation: () => void;
let store: UiStateStore;
let state: SessionState;
let stateListener: SessionStateListener | null;
const observe = vi.fn();
const disconnect = vi.fn();
const dispose = vi.fn();
const badgeDispose = vi.fn();
const subtitleLogDispose = vi.fn();
const start = vi.fn((target: PlaybackTarget | null, reason: RestartReason = 'initial-start') => {
  state = target === null
    ? { status: 'waiting', target: null, waiting: null, reason }
    : { status: 'running', target, waiting: null, reason };
  stateListener?.(state);
});
const stop = vi.fn(() => {
  state = { status: 'stopped', target: null, waiting: null, reason: null };
  stateListener?.(state);
});

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  state = { status: 'idle', target: null, waiting: null, reason: null };
  stateListener = null;
  document.body.innerHTML = `
    <dialog class="playback-view">
      <div data-testid="video-container"></div>
      <div data-testid="video-player-content"></div>
      <video></video>
    </dialog>
  `;

  vi.mocked(loadSettings).mockResolvedValue({
    status: 'ready', settings: { primaryLang: 'en', secondaryLang: 'ja' },
  });
  vi.mocked(createSessionDebugBadge).mockReturnValue({
    update: vi.fn(), updateSubtitle: vi.fn(), dispose: badgeDispose,
  });
  vi.mocked(attachSubtitleSnapshotLog).mockReturnValue({ dispose: subtitleLogDispose });
  vi.mocked(createSessionLifecycle).mockReturnValue({
    getState: () => state,
    getSubtitleSnapshot: () => null,
    subscribeSubtitle: () => () => {},
    start,
    stop,
    dispose,
    subscribe: (listener) => {
      stateListener = listener;
      return () => { stateListener = null; };
    },
  });
  vi.stubGlobal('MutationObserver', vi.fn(function (callback: () => void) {
    emitMutation = callback;
    return { observe, disconnect, takeRecords: () => [] };
  }));

  await import('./index');
  await Promise.resolve();
  expect(start).toHaveBeenCalledTimes(1);
  expect(observe).toHaveBeenCalledWith(document.documentElement, {
    childList: true, subtree: true,
  });
  const result = vi.mocked(createUiStateStore).mock.results[0];
  if (result?.type !== 'return') {
    throw new Error('entry must create its UI store');
  }
  store = result.value;
  vi.mocked(resolvePlaybackTarget).mockClear();
  start.mockClear();
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('content entry の target 再評価', () => {
  it('DOM 通知が続いても最初の予約から120ms後に再評価し、次の予約も受け付ける', () => {
    emitMutation();
    for (let index = 0; index < 3; index += 1) {
      vi.advanceTimersByTime(30);
      emitMutation();
    }
    vi.advanceTimersByTime(29);
    expect(resolvePlaybackTarget).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(resolvePlaybackTarget).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    emitMutation();
    vi.advanceTimersByTime(120);
    expect(resolvePlaybackTarget).toHaveBeenCalledTimes(2);
  });

  it('同一 target の再評価では lifecycle を再開始しない', () => {
    emitMutation();
    emitMutation();
    vi.advanceTimersByTime(120);
    expect(resolvePlaybackTarget).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('video 差し替え後は最新 target を video-replaced で開始する', () => {
    emitMutation();
    vi.advanceTimersByTime(60);
    const replacement = document.createElement('video');
    document.querySelector('video')?.replaceWith(replacement);
    emitMutation();
    vi.advanceTimersByTime(60);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ videoEl: replacement }), 'video-replaced',
    );
  });

  it('pagehide で予約と observer を解除し、旧通知でも再評価しない', () => {
    emitMutation();
    expect(vi.getTimerCount()).toBe(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(vi.getTimerCount()).toBe(0);
    emitMutation();
    vi.advanceTimersByTime(240);
    expect(resolvePlaybackTarget).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(badgeDispose).toHaveBeenCalledTimes(1);
  });

  it('OFF で予約を解除し、後続通知では予約・再評価しない', () => {
    emitMutation();
    expect(vi.getTimerCount()).toBe(1);
    store.setExtensionEnabled(false);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    emitMutation();
    vi.advanceTimersByTime(240);
    expect(resolvePlaybackTarget).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});


describe('字幕snapshotログの配線', () => {
  it('開発用フラグで接続し、lifecycleより先に破棄する', () => {
    expect(attachSubtitleSnapshotLog).toHaveBeenCalledTimes(1);
    expect(attachSubtitleSnapshotLog).toHaveBeenCalledWith(expect.objectContaining({ getSubtitleSnapshot: expect.any(Function), subscribeSubtitle: expect.any(Function) }), true);
    window.dispatchEvent(new Event('pagehide'));
    expect(subtitleLogDispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    const logOrder = subtitleLogDispose.mock.invocationCallOrder[0];
    const lifecycleOrder = dispose.mock.invocationCallOrder[0];
    if (logOrder === undefined || lifecycleOrder === undefined) {
      throw new Error('both cleanup calls must exist');
    }
    expect(logOrder).toBeLessThan(lifecycleOrder);
  });
});

/** coordinator の配線と実 lifecycle への解除到達を分けて検証する。 */
describe('content entry の panel 配線', () => {
  it('既存 store を渡し、開発用起動で初回だけ開く', () => {
    expect(createUiStateStore).toHaveBeenCalledTimes(1);
    expect(createSessionLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      panel: { uiState: store },
    }));
    expect(store.getState()).toEqual({ extensionEnabled: true, panelOpen: true });
  });

  it('開閉だけでは再開始せず、target 再評価でも手動 close を上書きしない', () => {
    store.setPanelOpen(false);
    store.setPanelOpen(true);
    store.setPanelOpen(false);
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    emitMutation();
    vi.advanceTimersByTime(120);
    expect(store.getState().panelOpen).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('実 lifecycle と panel を経由して OFF・再開・pagehide の解除が到達する', async () => {
    // beforeEach の mock entry を終了してから、同じ fixture で実接続を起動する。
    window.dispatchEvent(new Event('pagehide'));
    vi.resetModules();
    const actual = await vi.importActual<typeof import('./session-lifecycle')>('./session-lifecycle');
    vi.mocked(createSessionLifecycle).mockImplementationOnce(actual.createSessionLifecycle);
    await import('./index');
    await Promise.resolve();
    const result = vi.mocked(createUiStateStore).mock.results.at(-1);
    if (result?.type !== 'return') throw new Error('entry must create its UI store');
    const connectedStore: UiStateStore = result.value;
    const host = document.querySelector('#atv-panel-host');
    expect(host).not.toBeNull();
    expect(document.querySelector<HTMLElement>('[data-subtitle-panel]')?.hidden).toBe(false);
    connectedStore.setPanelOpen(false);
    expect(document.querySelector('#atv-panel-host')).toBe(host);
    expect(document.querySelector<HTMLElement>('[data-subtitle-panel]')?.hidden).toBe(true);
    connectedStore.setExtensionEnabled(false);
    expect(document.querySelector('#atv-panel-host')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    connectedStore.setExtensionEnabled(true);
    const restartedHost = document.querySelector('#atv-panel-host');
    expect(restartedHost).not.toBeNull();
    expect(restartedHost).not.toBe(host);
    expect(connectedStore.getState().panelOpen).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-subtitle-panel]')?.hidden).toBe(true);
    window.dispatchEvent(new Event('pagehide'));
    expect(document.querySelector('#atv-panel-host')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    connectedStore.setPanelOpen(true);
    connectedStore.setExtensionEnabled(false);
    connectedStore.setExtensionEnabled(true);
    emitMutation();
    vi.advanceTimersByTime(500);
    expect(document.querySelector('#atv-panel-host')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
