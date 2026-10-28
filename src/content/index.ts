/**
 * index.ts
 *
 * 保存設定の読込、playback target の再評価、lifecycle への入力と開始停止を担当する。
 * ui-state の有効状態を読み、ready な設定と browser language fallback を渡す。
 * track 解決、source、readiness retry、truth、panel、debug badge の描画は
 * 各 module に委譲する。
 * target 発見用 observer を維持し、pagehide または起動失敗時に
 * top-level の購読・timer・observer・badge・lifecycle を一度だけ cleanup する。
 */
import { createSessionDebugBadge } from './debug-badge';
import { attachSubtitleSnapshotLog } from './debug-subtitle-log';
import {
  comparePlaybackTargetSnapshots,
  resolvePlaybackTarget,
} from './playback-root';
import { createSessionLifecycle } from './session-lifecycle';
import { loadSettings } from '../settings/settings-store';
import { createDisposeBag } from '../shared/dispose';
import type { RestartReason } from '../shared/types';
import { createUiStateStore } from '../ui/ui-state';

/**
 * 字幕接続の実機確認用に、保存設定が ready の場合だけ自動的に ON にする。
 * 正式な ON/OFF UI とは別の開発用フラグで、Phase にかかわらず使用する。
 * 通常は false として OFF 開始を維持する。
 */
const DEBUG_AUTO_ENABLE_SUBTITLES = true;

/** 初回表示の開発用。ready かつ有効な起動時だけ開き、再接続では意思を変えない。 */
const DEBUG_AUTO_OPEN_PANEL = true;

/** session 状態を観測する debug badge を表示する。 */
const DEBUG_SESSION_BADGE = true;

/** 字幕本文を含む実機観測ログ。通常利用・配布前はfalseにする。 */
const DEBUG_SUBTITLE_SNAPSHOT_LOG = true;

/** DOM 変化をまとめ、target 再評価まで待つ時間。ミリ秒単位。 */
const TARGET_REFRESH_DELAY_MS = 120;

/**
 * 設定と runtime state を lifecycle へ接続する。
 * 設定の再読込・native menu 同期・正式な ON/OFF UI は今回追加しない。
 *
 * @returns 初期配線の完了。設定読込や初期化の例外は cleanup 後に reject する。
 */
const bootContentScript = async (): Promise<void> => {
  const settingsResult = await loadSettings();
  const uiStateStore = createUiStateStore();
  const debugBadge = createSessionDebugBadge(DEBUG_SESSION_BADGE);
  const sessionLifecycle = createSessionLifecycle({
    panel: { uiState: uiStateStore },
    // badge 無効時は、診断専用の字幕観測 callback を接続しない。
    ...(DEBUG_SESSION_BADGE
      ? { onSubtitleObservation: debugBadge.updateSubtitle }
      : {}),
    ...(settingsResult.status === 'ready'
      ? {
        subtitle: {
          settings: settingsResult.settings,
          fallbackSecondaryLang:
            settingsResult.settings.secondaryLang === null
              ? navigator.language
              : null,
        },
      }
      : {}),
  });
  const bag = createDisposeBag();

  let observerTimerId: number | null = null;
  let disposed = false;
  let hasEverResolvedTarget = false;

  /**
   * target 再評価用の予約を解除する。
   * timer は coordinator が1つだけ所有する。
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

  /** 有効時だけ target 再評価を予約し、予約済みなら実行時刻を維持する。 */
  const scheduleTargetRefresh = (): void => {
    if (
      disposed ||
      !uiStateStore.getState().extensionEnabled ||
      observerTimerId !== null
    ) {
      return;
    }

    observerTimerId = window.setTimeout(
      refreshTarget,
      TARGET_REFRESH_DELAY_MS,
    );
  };

  try {
    // 逆順 cleanup で、購読と監視を先に止めてから lifecycle を破棄する。
    bag.add(sessionLifecycle);
    bag.add(debugBadge);
    bag.add(clearObserverTimer);
    bag.add(attachSubtitleSnapshotLog(sessionLifecycle, DEBUG_SUBTITLE_SNAPSHOT_LOG));

    bag.add(
      sessionLifecycle.subscribe((state) => {
        debugBadge.update(state);
        if (state.target !== null) {
          hasEverResolvedTarget = true;
        }
      }),
    );

    // ready は設定の有効性だけを表す。通常起動で自動的に ON にはしない。
    if (DEBUG_AUTO_ENABLE_SUBTITLES && settingsResult.status === 'ready') {
      uiStateStore.setExtensionEnabled(true);
    }
    // 正式な開閉 UI の代用ではなく、初期表示を観測するための一回限りの入力。
    if (
      DEBUG_AUTO_OPEN_PANEL &&
      settingsResult.status === 'ready' &&
      uiStateStore.getState().extensionEnabled
    ) {
      uiStateStore.setPanelOpen(true);
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
