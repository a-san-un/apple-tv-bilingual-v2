/**
 * index.ts
 *
 * 保存設定の読込、playback target の再評価、lifecycle への入力と開始停止を担当する。
 * ui-state の有効状態を読み、ready な設定と browser language fallback を渡す。
 * track 解決、source、readiness retry、truth、panel の処理は各 module に委譲する。
 * 既存の debug badge と target 発見用 observer を維持し、pagehide または起動失敗時に
 * top-level の購読・timer・observer・badge・lifecycle を一度だけ cleanup する。
 */
import {
  comparePlaybackTargetSnapshots,
  resolvePlaybackTarget,
} from './playback-root';
import { createSessionLifecycle } from './session-lifecycle';
import { loadSettings } from '../settings/settings-store';
import { createDisposeBag } from '../shared/dispose';
import type {
  Disposable,
  RestartReason,
  SessionState,
} from '../shared/types';
import { createUiStateStore } from '../ui/ui-state';

/**
 * Phase 4 の実機確認時だけ、自動起動を許可する開発用フラグ。
 * 正式な ON/OFF UI ではなく、通常は false として OFF 開始を維持する。
 */
const DEBUG_PHASE4_SUBTITLES = true;

/** session 状態だけを観測する既存の debug badge を表示する。 */
const DEBUG_SESSION_BADGE = true;

/** DOM 変化による target 再評価をまとめる待機時間。ミリ秒単位。 */
const SPA_OBSERVER_DEBOUNCE_MS = 120;

/** session 状態の表示と、その DOM の破棄を提供する debug view。 */
type SessionDebugBadge = Disposable & {
  update(state: SessionState): void;
};

/**
 * playback dialog 配下へ配置する、最小の session 状態表示を作る。
 * subtitle の採用成功や cue 取得成功を表す UI ではない。
 *
 * @returns coordinator が更新し、top-level cleanup で破棄する debug view。
 */
const createSessionDebugBadge = (): SessionDebugBadge => {
  if (!DEBUG_SESSION_BADGE) {
    return {
      /**
       * 表示無効時は状態を描画しない。
       *
       * @param state 受信した session 状態。
       */
      update(state): void {
        void state;
      },

      /** 表示無効時は解放する DOM を持たない。 */
      dispose(): void { },
    };
  }

  const badge = document.createElement('div');
  let mountedRoot: HTMLElement | null = null;
  let disposed = false;

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
   * target の変更に合わせて badge の配置先を同期する。
   *
   * @param rootEl 現在の playback root。null は配置先なし。
   */
  const syncMountTarget = (rootEl: HTMLElement | null): void => {
    if (mountedRoot === rootEl) {
      return;
    }

    // 旧 dialog に拡張 DOM を残さないよう、配置先を変える前に取り外す。
    badge.remove();
    mountedRoot = rootEl;
    mountedRoot?.appendChild(badge);
  };

  return {
    /**
     * session 状態を表示する。同じ文字列は再設定しない。
     *
     * @param state lifecycle が公開する session 状態。
     */
    update(state): void {
      if (disposed) {
        return;
      }

      // target を保持する stopped 状態でも、停止後の badge は残さない。
      const rootEl =
        state.status === 'waiting' || state.status === 'running'
          ? state.target?.rootEl ?? null
          : null;
      syncMountTarget(rootEl);

      const trackCount = state.target?.videoEl.textTracks.length ?? 0;
      const text = [
        `session: ${state.status}`,
        `reason: ${state.reason ?? 'none'}`,
        `tracks: ${trackCount}`,
      ].join(' | ');

      // badge 自身の childList 更新による、不要な observer 再評価を減らす。
      if (badge.textContent !== text) {
        badge.textContent = text;
      }

      const colors: Record<SessionState['status'], string> = {
        idle: 'rgba(55, 65, 81, 0.88)',
        waiting: 'rgba(180, 83, 9, 0.88)',
        running: 'rgba(22, 101, 52, 0.88)',
        stopped: 'rgba(55, 65, 81, 0.88)',
      };
      badge.style.background = colors[state.status];
    },

    /** badge を取り外し、保持参照を破棄する。2 回目以降は何もしない。 */
    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      badge.remove();
      mountedRoot = null;
    },
  };
};

/**
 * 設定と runtime state を lifecycle へ接続する。
 * 設定の再読込・native menu 同期・正式な ON/OFF UI は今回追加しない。
 *
 * @returns 初期配線の完了。設定読込や初期化の例外は cleanup 後に reject する。
 */
const bootContentScript = async (): Promise<void> => {
  const settingsResult = await loadSettings();
  const uiStateStore = createUiStateStore();
  const sessionLifecycle = createSessionLifecycle(
    settingsResult.status === 'ready'
      ? {
        subtitle: {
          settings: settingsResult.settings,
          fallbackSecondaryLang:
            settingsResult.settings.secondaryLang === null
              ? navigator.language
              : null,
        },
      }
      : {},
  );
  const debugBadge = createSessionDebugBadge();
  const bag = createDisposeBag();

  let observerTimerId: number | null = null;
  let disposed = false;
  let hasEverResolvedTarget = false;

  /**
   * target 再評価用の予約を解除する。
   * timer は coordinator が 1 つだけ所有する。
   */
  const clearObserverTimer = (): void => {
    if (observerTimerId === null) {
      return;
    }

    window.clearTimeout(observerTimerId);
    observerTimerId = null;
  };

  /**
   * top-level 資源を逆順で一度だけ解放する。
   * cleanup 失敗は記録し、残りの解除試行を中断しない。
   */
  const dispose = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;
    try {
      bag.dispose();
    } catch (error) {
      console.error('[atv-bilingual:cleanup] content cleanup failed', error);
    }
  };

  /**
   * 保存設定と有効状態を確認し、現在の target を lifecycle へ渡す。
   *
   * @param reason 再評価理由。DOM observer 由来では同一 target の再開始を省く。
   */
  const applyCurrentTarget = (
    reason: RestartReason = 'initial-start',
  ): void => {
    if (disposed) {
      return;
    }

    if (
      settingsResult.status !== 'ready' ||
      !uiStateStore.getState().extensionEnabled
    ) {
      sessionLifecycle.stop();
      return;
    }

    const target = resolvePlaybackTarget(document);
    const current = sessionLifecycle.getState();

    if (reason === 'spa-navigation') {
      // 未解決の waiting を繰り返し通知しても、新しい情報は増えない。
      if (
        target === null &&
        current.status === 'waiting' &&
        current.target === null
      ) {
        return;
      }

      if (
        target !== null &&
        current.target !== null &&
        (current.status === 'waiting' || current.status === 'running')
      ) {
        const comparison = comparePlaybackTargetSnapshots(
          current.target.snapshot,
          target.snapshot,
        );

        // readiness の進行は lifecycle の retry に任せ、同一 target を再開始しない。
        if (comparison.isSameTarget) {
          return;
        }
        if (comparison.hasVideoChanged) {
          sessionLifecycle.start(target, 'video-replaced');
          return;
        }
      }
    }

    const nextReason =
      target !== null &&
        !hasEverResolvedTarget &&
        reason === 'spa-navigation'
        ? 'playback-target-appeared'
        : reason;

    sessionLifecycle.start(target, nextReason);
  };

  /** DOM 変化をまとめて処理し、現在の target を再評価する。 */
  const refreshTarget = (): void => {
    observerTimerId = null;
    applyCurrentTarget('spa-navigation');
  };

  /** 有効時だけ target 再評価を予約し、古い予約は置き換える。 */
  const scheduleTargetRefresh = (): void => {
    if (disposed || !uiStateStore.getState().extensionEnabled) {
      return;
    }

    clearObserverTimer();
    observerTimerId = window.setTimeout(
      refreshTarget,
      SPA_OBSERVER_DEBOUNCE_MS,
    );
  };

  try {
    // 逆順 cleanup で、購読と監視を先に止めてから lifecycle を破棄する。
    bag.add(sessionLifecycle);
    bag.add(debugBadge);
    bag.add(clearObserverTimer);

    bag.add(
      sessionLifecycle.subscribe((state) => {
        debugBadge.update(state);
        if (state.target !== null) {
          hasEverResolvedTarget = true;
        }
      }),
    );

    // ready は設定の有効性だけを表す。通常起動で自動的に ON にはしない。
    if (DEBUG_PHASE4_SUBTITLES && settingsResult.status === 'ready') {
      uiStateStore.setExtensionEnabled(true);
    }

    let previousEnabled = uiStateStore.getState().extensionEnabled;
    bag.add(
      uiStateStore.subscribe((state) => {
        // panel 開閉だけの通知では、字幕処理を再開始しない。
        if (state.extensionEnabled === previousEnabled) {
          return;
        }

        previousEnabled = state.extensionEnabled;
        clearObserverTimer();
        applyCurrentTarget('manual-restart');
      }),
    );

    const playbackObserver = new MutationObserver(scheduleTargetRefresh);
    bag.add(() => {
      playbackObserver.disconnect();
    });
    playbackObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    window.addEventListener('pagehide', dispose, { once: true });
    bag.add(() => {
      window.removeEventListener('pagehide', dispose);
    });

    debugBadge.update(sessionLifecycle.getState());
    applyCurrentTarget('initial-start');
  } catch (error) {
    // 起動途中で失敗した場合も、登録済みの資源を取り残さない。
    dispose();
    throw error;
  }
};

void bootContentScript().catch((error: unknown) => {
  console.error('[atv-bilingual:content] failed to boot content script', error);
});
