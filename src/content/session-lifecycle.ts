/**
 * playback session の開始停止、readiness 待機、video 差し替え検知を所有する。
 * 字幕接続の詳細は subtitle-session.ts に委譲し、返された dispose を保持する。
 * 待機と字幕接続は、旧参照を切り離してから cleanup を試す。
 * track 選定、cue 読取、字幕ログ、panel 描画、native menu 同期は担当しない。
 */
import { createDisposeBag, type DisposeBag } from '../shared/dispose';
import type { ReadySettings } from '../settings/settings-store';
import { createSubtitleSession } from '../subtitles/subtitle-session';
import {
  comparePlaybackTargetSnapshots,
  resolvePlaybackTarget,
} from './playback-root';
import type {
  Disposable,
  DisposeFn,
  LanguageCode,
  PlaybackTarget,
  RestartReason,
  SessionState,
  WaitingState,
} from '../shared/types';

/** readiness を再確認する間隔。ミリ秒単位。 */
const DEFAULT_READINESS_RETRY_DELAY_MS = 250;

/** session の状態更新を受け取る callback。 */
export type SessionStateListener = (state: SessionState) => void;

/** session の状態取得・開始停止・破棄・購読を提供する controller。 */
export type SessionLifecycleController = {
  getState(): SessionState;
  start(target: PlaybackTarget | null, reason?: RestartReason): void;
  stop(): void;
  dispose(): void;
  subscribe(listener: SessionStateListener): DisposeFn;
};

/**
 * readiness 通過後の字幕接続に使う入力。
 * 保存設定とブラウザ言語は、content coordinator が取得して渡す。
 */
export type SessionSubtitleInput = {
  settings: ReadySettings;
  fallbackSecondaryLang?: LanguageCode | null;
};

/**
 * lifecycle の入力と、テストで差し替える依存。
 * subtitle を省略した場合は、字幕接続なしで readiness の状態管理だけを行う。
 */
export type SessionLifecycleOptions = {
  doc?: Document;
  now?: () => number;
  retryDelayMs?: number;
  scheduleRetry?: (callback: () => void, delayMs: number) => DisposeFn;
  subtitle?: SessionSubtitleInput;
};

/**
 * 開始前または停止中の state を作る。
 *
 * @param status idle または stopped。
 * @param target 停止対象の target。開始前は null。
 * @returns waiting を持たない state。
 */
function createInactiveState(status: 'idle', target: null): SessionState;
function createInactiveState(
  status: 'stopped',
  target: PlaybackTarget | null,
): SessionState;
function createInactiveState(
  status: 'idle' | 'stopped',
  target: PlaybackTarget | null,
): SessionState {
  if (status === 'idle') {
    return {
      status: 'idle',
      target: null,
      waiting: null,
      reason: null,
    };
  }

  return { status: 'stopped', target, waiting: null, reason: null };
}

/**
 * 待機中の state を作る。
 *
 * @param target 現在監視する target。
 * @param waiting 待機開始時刻と retry 情報。
 * @param reason 待機に入った理由。
 * @returns readiness 待機中の state。
 */
const createWaitingState = (
  target: PlaybackTarget,
  waiting: WaitingState,
  reason: RestartReason,
): SessionState => ({ status: 'waiting', target, waiting, reason });

/**
 * 外部へ渡す state を複製する。
 *
 * @param state 複製元。
 * @returns 外側と waiting の写し。target と DOM の参照は共有する。
 */
const cloneState = (state: SessionState): SessionState => {
  if (state.status !== 'waiting' || state.waiting === null) {
    return { ...state };
  }

  return { ...state, waiting: { ...state.waiting } };
};

/**
 * timeout で readiness の再確認を予約する。
 *
 * @param callback timeout 到達時に実行する処理。
 * @param delayMs 待機時間。ミリ秒単位。
 * @returns 待機 bag が保持・実行する timeout 解除関数。
 */
const scheduleTimeoutRetry = (
  callback: () => void,
  delayMs: number,
): DisposeFn => {
  const timeoutId = window.setTimeout(callback, delayMs);
  return () => {
    window.clearTimeout(timeoutId);
  };
};

/**
 * 現在の待機 bag を保持し、旧 callback の無効化と cleanup を行う。
 *
 * @returns 待機の置換・同一性確認・解除を行う holder。
 */
const createWaitingBagHolder = (): {
  replace(nextBag: DisposeBag | null): void;
  isCurrent(bag: DisposeBag): boolean;
  dispose(): void;
} => {
  let current: DisposeBag | null = null;

  /** 旧 callback を無効化してから cleanup を試し、失敗は記録する。 */
  const releaseCurrent = (): void => {
    const bag = current;
    // 解除に失敗しても、旧 callback を現在の待機として扱わない。
    current = null;
    if (bag === null) {
      return;
    }

    try {
      bag.dispose();
    } catch (error) {
      console.error(
        '[atv-bilingual:cleanup] readiness waiting cleanup failed',
        error,
      );
    }
  };

  return {
    /**
     * 旧待機の解除を試して、新しい bag を保持する。
     *
     * @param nextBag 新しい待機 bag。null は待機なし。
     */
    replace(nextBag): void {
      releaseCurrent();
      current = nextBag;
    },

    /**
     * callback の登録元が現在の待機かを確認する。
     *
     * @param bag 確認する待機 bag。
     * @returns 現在保持する bag と同じ参照なら true。
     */
    isCurrent(bag: DisposeBag): boolean {
      return current === bag;
    },

    /** 現在の待機を無効化し、cleanup を試す。 */
    dispose(): void {
      releaseCurrent();
    },
  };
};

/**
 * playback session の lifecycle を作る。
 *
 * @param options 依存の差し替えと任意の字幕入力。省略時は readiness のみ扱う。
 * @returns 呼び出し側が保持し、終了時に dispose する controller。
 */
export const createSessionLifecycle = (
  options: SessionLifecycleOptions = {},
): SessionLifecycleController => {
  const doc = options.doc ?? document;
  const now = options.now ?? (() => Date.now());
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_READINESS_RETRY_DELAY_MS;
  const scheduleRetry = options.scheduleRetry ?? scheduleTimeoutRetry;
  const listeners = new Set<SessionStateListener>();
  const waitingBagHolder = createWaitingBagHolder();

  // 呼び出し元による設定の変更を、開始済み lifecycle へ伝えない。
  const subtitleInput =
    options.subtitle === undefined
      ? null
      : {
        settings: { ...options.subtitle.settings },
        fallbackSecondaryLang:
          options.subtitle.fallbackSecondaryLang ?? null,
      };

  let state: SessionState = createInactiveState('idle', null);
  let subtitleSession: Disposable | null = null;
  let disposed = false;

  /** 登録済み listener へ、最新 state の写しを通知する。 */
  const notify = (): void => {
    const snapshot = cloneState(state);
    listeners.forEach((listener) => {
      listener(snapshot);
    });
  };

  /**
   * state を更新して購読者へ通知する。
   *
   * @param next 更新後の state。
   */
  const setState = (next: SessionState): void => {
    state = next;
    notify();
  };

  /** 字幕接続を切り離して dispose を試し、失敗後も後処理を継続する。 */
  const releaseSubtitleSession = (): void => {
    const session = subtitleSession;
    subtitleSession = null;
    if (session === null) {
      return;
    }

    try {
      session.dispose();
    } catch (error) {
      console.error(
        '[atv-bilingual:cleanup] subtitle session cleanup failed',
        error,
      );
    }
  };

  /**
   * 待機中の target を再解決する。
   *
   * @param current 現在監視する target。
   * @returns 同一 snapshot なら current、変化時は新 target、未解決なら null。
   */
  const resolveNextTarget = (current: PlaybackTarget): PlaybackTarget | null => {
    const next = resolvePlaybackTarget(doc);
    if (next === null) {
      return null;
    }

    const comparison = comparePlaybackTargetSnapshots(
      current.snapshot,
      next.snapshot,
    );
    return comparison.isSameTarget ? current : next;
  };

  /**
   * 字幕処理の最小 readiness を判定する。
   *
   * @param target 判定する target。
   * @returns textTracks.length > 0 なら true。
   */
  const isSubtitleReady = (target: PlaybackTarget): boolean =>
    target.videoEl.textTracks.length > 0;

  /**
   * ready な target の字幕接続を開始し、running を通知する。
   * running は readiness 通過を表し、字幕取得成功を保証しない。
   *
   * @param target readiness を通過した target。
   * @param reason session の開始理由。
   */
  const enterRunning = (
    target: PlaybackTarget,
    reason: RestartReason,
  ): void => {
    waitingBagHolder.dispose();
    releaseSubtitleSession();

    if (subtitleInput !== null) {
      try {
        // source の生成・購読・bind は字幕接続 module に閉じ込める。
        subtitleSession = createSubtitleSession({
          videoEl: target.videoEl,
          settings: subtitleInput.settings,
          fallbackSecondaryLang: subtitleInput.fallbackSecondaryLang,
        });
      } catch (error) {
        console.error(
          '[atv-bilingual:subtitle] subtitle session start failed',
          error,
        );
      }
    }

    setState({ status: 'running', target, waiting: null, reason });
  };

  /**
   * 現在の target 用に待機を張り替える。
   *
   * @param target 監視する target。
   * @param reason 待機に入った理由。
   * @param retryCount これまでの再確認回数。
   * @param startedAt 待機開始時刻。now() と同じ時間単位。
   */
  const enterWaiting = (
    target: PlaybackTarget,
    reason: RestartReason,
    retryCount: number,
    startedAt: number,
  ): void => {
    const waitingBag = createDisposeBag();
    // 旧待機を無効化してから、新しい retry の owner を確定する。
    waitingBagHolder.replace(waitingBag);
    setState(
      createWaitingState(
        target,
        { startedAt, retryCount, targetVideo: target.videoEl },
        reason,
      ),
    );

    // 状態通知中に停止・再開始された場合、旧待機へ retry を追加しない。
    if (disposed || !waitingBagHolder.isCurrent(waitingBag)) {
      return;
    }

    /** 現在の待機だけで target と readiness を再確認する。 */
    const retry = (): void => {
      if (disposed || !waitingBagHolder.isCurrent(waitingBag)) {
        return;
      }

      const latestTarget = resolveNextTarget(target);
      if (latestTarget === null) {
        enterWaiting(target, reason, retryCount + 1, startedAt);
        return;
      }
      if (latestTarget.videoEl !== target.videoEl) {
        // video 差し替えでは旧待機を引き継がず、新 target で開始し直す。
        start(latestTarget, 'video-replaced');
        return;
      }
      if (isSubtitleReady(latestTarget)) {
        enterRunning(latestTarget, reason);
        return;
      }

      enterWaiting(latestTarget, reason, retryCount + 1, startedAt);
    };

    waitingBag.add(scheduleRetry(retry, retryDelayMs));
  };

  /**
   * 旧資源の解除を試して、session を開始または再開始する。
   *
   * @param target 開始対象。null は target 未解決の waiting とする。
   * @param reason 開始理由。省略時は initial-start。
   */
  const start = (
    target: PlaybackTarget | null,
    reason: RestartReason = 'initial-start',
  ): void => {
    if (disposed) {
      return;
    }

    // 新しい接続を作る前に、旧字幕接続と retry を止める。
    releaseSubtitleSession();
    waitingBagHolder.dispose();
    if (target === null) {
      setState({ status: 'waiting', target: null, waiting: null, reason });
      return;
    }
    if (isSubtitleReady(target)) {
      enterRunning(target, reason);
      return;
    }

    const previousWaiting = state.status === 'waiting' ? state.waiting : null;
    enterWaiting(
      target,
      reason,
      previousWaiting?.retryCount ?? 0,
      previousWaiting?.startedAt ?? now(),
    );
  };

  /** 字幕接続と待機の解除を試し、停止状態へ更新する。 */
  const stop = (): void => {
    if (disposed || state.status === 'stopped') {
      return;
    }

    releaseSubtitleSession();
    waitingBagHolder.dispose();
    setState(createInactiveState('stopped', state.target));
  };

  return {
    /**
     * 現在の state を取得する。
     *
     * @returns 外側と waiting の写し。target と DOM の参照は共有する。
     */
    getState(): SessionState {
      return cloneState(state);
    },

    start,
    stop,

    /** 資源の解除を試し、購読者を破棄する。2 回目以降は何もしない。 */
    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      releaseSubtitleSession();
      waitingBagHolder.dispose();
      listeners.clear();
      state = createInactiveState('stopped', state.target);
    },

    /**
     * session の状態更新を購読する。
     *
     * @param listener 更新通知を受け取る callback。
     * @returns 呼び出し側が保持・実行する購読解除関数。破棄後は no-op。
     */
    subscribe(listener: SessionStateListener): DisposeFn {
      if (disposed) {
        return () => { };
      }

      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
