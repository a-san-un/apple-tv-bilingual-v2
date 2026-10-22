/**
 * content/index.ts
 *
 * content script の top-level coordinator。
 * settings 読込、playback target 解決、session lifecycle 起動、top-level error handling だけを担う。
 * subtitle source や panel 描画の詳細、readiness retry の中身は各 module へ委譲する。
 */
import { resolvePlaybackTarget } from './playback-root';
import { createSessionLifecycle } from './session-lifecycle';
import { loadSettings } from '../settings/settings-store';
import { createUiStateStore } from '../ui/ui-state';
import type { RestartReason, SessionState } from '../shared/types';

/**
 * DevTools なしで session 状態を確認するための最小 debug 表示。
 * 正式な debug UI や health snapshot ではなく、Phase 3-B の確認に必要な情報だけを出す。
 */
const DEBUG_SESSION_BADGE = true;

/** SPA 遷移由来の DOM 変化を束ねる短い debounce 時間。 */
const SPA_OBSERVER_DEBOUNCE_MS = 120;

/**
 * session 状態だけを 1 行で表示する最小 debug badge を作る。
 * session owner の中身には触れず、購読した state を薄く表示するだけに留める。
 *
 * @returns state 更新と DOM cleanup をまとめた最小 debug view。
 */
const createSessionDebugBadge = (): {
  update(state: SessionState): void;
  dispose(): void;
} => {
  if (!DEBUG_SESSION_BADGE) {
    return {
      update() {},
      dispose() {},
    };
  }

  const badge = document.createElement('div');
  let mountedRoot: HTMLElement | null = null;

  badge.setAttribute('data-atv-bilingual-debug', 'session');
  Object.assign(badge.style, {
    position: 'absolute',
    top: '48px',
    right: '16px',
    zIndex: '2147483647',
    padding: '6px 8px',
    borderRadius: '6px',
    fontSize: '12px',
    lineHeight: '1.4',
    fontFamily: 'monospace',
    color: '#ffffff',
    background: 'rgba(55, 65, 81, 0.88)',
    pointerEvents: 'none',
    whiteSpace: 'pre-wrap',
  });

  /**
   * session status に応じて badge 色だけを切り替える。
   *
   * @param status 表示中の session status。
   */
  const applyColor = (status: SessionState['status']): void => {
    if (status === 'running') {
      badge.style.background = 'rgba(22, 101, 52, 0.88)';
      return;
    }

    if (status === 'waiting') {
      badge.style.background = 'rgba(180, 83, 9, 0.88)';
      return;
    }

    badge.style.background = 'rgba(55, 65, 81, 0.88)';
  };

  /**
   * 再生 dialog の差し替えに合わせて badge の mount 先を同期する。
   *
   * @param rootEl 現在の playback root。未解決時は null または undefined。
   */
  const syncMountTarget = (rootEl: HTMLElement | null | undefined): void => {
    const nextRoot = rootEl ?? null;

    if (mountedRoot === nextRoot) {
      return;
    }

    badge.remove();
    mountedRoot = nextRoot;

    if (!mountedRoot) {
      return;
    }

    mountedRoot.appendChild(badge);
  };

  return {
    update(state) {
      syncMountTarget(state.target?.rootEl);

      const trackCount = state.target?.videoEl.textTracks?.length ?? 0;
      badge.textContent = [
        `session: ${state.status}`,
        `reason: ${state.reason ?? 'none'}`,
        `tracks: ${trackCount}`,
      ].join(' | ');
      applyColor(state.status);
    },
    dispose() {
      badge.remove();
      mountedRoot = null;
    },
  };
};

/**
 * content script 全体を起動する。
 * settings、UI state、session lifecycle を接続し、pagehide まで top-level cleanup を保持する。
 */
const bootContentScript = async (): Promise<void> => {
  const settings = await loadSettings();
  const uiStateStore = createUiStateStore();
  const sessionLifecycle = createSessionLifecycle();
  const debugBadge = createSessionDebugBadge();

  let observerTimerId: number | null = null;
  let disposed = false;
  let hasEverResolvedTarget = false;

  /**
   * observer debounce に使っている timer を止める。
   *
   * pagehide や再スケジュール時に古い timer を残さないため、top-level で 1 つだけ所有する。
   */
  const clearObserverTimer = (): void => {
    if (observerTimerId === null) {
      return;
    }

    window.clearTimeout(observerTimerId);
    observerTimerId = null;
  };

  sessionLifecycle.subscribe((state) => {
    debugBadge.update(state);

    if (state.target) {
      hasEverResolvedTarget = true;
    }
  });
  debugBadge.update(sessionLifecycle.getState());

  /**
   * 現在の DOM から playback target を引き直し、session lifecycle へ渡す。
   *
   * @param reason 今回の再評価理由。初回起動、SPA 遷移、設定変更のいずれかを渡す。
   */
  const applyCurrentTarget = (
    reason: RestartReason = 'initial-start',
  ): void => {
    const state = uiStateStore.getState();
    if (!state.extensionEnabled) {
      sessionLifecycle.stop();
      return;
    }

    const target = resolvePlaybackTarget(document);
    const nextReason =
      target !== null && !hasEverResolvedTarget && reason === 'spa-navigation'
        ? 'playback-target-appeared'
        : reason;

    sessionLifecycle.start(target, nextReason);
  };

  /**
   * SPA 由来の細かい DOM 変化を 1 回の target 再評価へ束ねる。
   *
   * observer callback ごとに即時再起動すると session の start/stop が過剰になるため、短い debounce を入れる。
   */
  const scheduleTargetRefreshFromObserver = (): void => {
    if (disposed) {
      return;
    }

    clearObserverTimer();
    observerTimerId = window.setTimeout(() => {
      observerTimerId = null;
      applyCurrentTarget('spa-navigation');
    }, SPA_OBSERVER_DEBOUNCE_MS);
  };

  const playbackObserver = new MutationObserver(() => {
    scheduleTargetRefreshFromObserver();
  });

  playbackObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  uiStateStore.subscribe(() => {
    applyCurrentTarget('settings-changed');
  });

  if (settings.status === 'ready') {
    uiStateStore.setExtensionEnabled(true);
  }

  applyCurrentTarget('initial-start');

  /**
   * content script の top-level 資源を 1 回だけ解放する。
   *
   * observer、session lifecycle、debug badge をまとめて止め、pagehide 以降の再実行を防ぐ。
   */
  const dispose = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;
    clearObserverTimer();
    playbackObserver.disconnect();
    sessionLifecycle.dispose();
    debugBadge.dispose();
  };

  window.addEventListener('pagehide', dispose, { once: true });
};

void bootContentScript().catch((error: unknown) => {
  console.error('[atv-bilingual:content] failed to boot content script', error);
});
