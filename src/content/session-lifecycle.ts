/**
 * session-lifecycle.ts
 *
 * playback session の start / stop / dispose を所有する session owner。
 * subtitle readiness 待機、retry、video 差し替え検知、cleanup 集約をここに閉じ込める。
 * subtitle source / track resolver / panel renderer の起動はまだ行わない。
 */
import { createDisposeBag, type DisposeBag } from '../shared/dispose';
import {
  comparePlaybackTargetSnapshots,
  resolvePlaybackTarget,
} from './playback-root';
import type {
  DisposeFn,
  PlaybackTarget,
  RestartReason,
  SessionState,
  WaitingState,
} from '../shared/types';

const DEFAULT_READINESS_RETRY_DELAY_MS = 250;

/**
 * lifecycle の状態変化を受け取る callback。
 * content coordinator はこの通知だけを購読して session の外側へ状態を伝える。
 */
export type SessionStateListener = (state: SessionState) => void;

/**
 * `session-lifecycle.ts` が公開する最小 controller。
 */
export type SessionLifecycleController = {
  getState(): SessionState;
  start(target: PlaybackTarget | null, reason?: RestartReason): void;
  stop(): void;
  dispose(): void;
  subscribe(listener: SessionStateListener): DisposeFn;
};

/**
 * lifecycle の外から差し替え可能にする依存群。
 * test では clock / retry scheduler / document を差し替えて再試行を決定的に観測する。
 */
export type SessionLifecycleOptions = {
  doc?: Document;
  now?: () => number;
  retryDelayMs?: number;
  scheduleRetry?: (callback: () => void, delayMs: number) => DisposeFn;
};

/**
 * 停止中または開始前の state を作る。
 *
 * @param status `idle` または `stopped`。
 * @param target 現在ひも付いている target。未解決なら null。
 * @returns waiting を持たない停止系 state。
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

  return {
    status: 'stopped',
    target,
    waiting: null,
    reason: null,
  };
}

/**
 * 待機中 state を作る。
 *
 * @param target 現在監視する playback target。
 * @param waiting readiness 待機の詳細。
 * @param reason この待機に入った理由。
 * @returns waiting state。
 */
const createWaitingState = (
  target: PlaybackTarget,
  waiting: WaitingState,
  reason: RestartReason,
): SessionState => ({
  status: 'waiting',
  target,
  waiting,
  reason,
});

/**
 * ready 到達後の running state を作る。
 *
 * @param target ready になった playback target。
 * @param reason この session を開始した理由。
 * @returns running state。
 */
const createRunningState = (
  target: PlaybackTarget,
  reason: RestartReason,
): SessionState => ({
  status: 'running',
  target,
  waiting: null,
  reason,
});

/**
 * 現在値の破壊的変更を避けるために state snapshot を複製する。
 *
 * @param state 複製元 state。
 * @returns 外部へ返してよい state snapshot。
 */
const cloneState = (state: SessionState): SessionState => {
  if (state.status !== 'waiting' || state.waiting === null) {
    return { ...state };
  }

  return {
    ...state,
    waiting: {
      ...state.waiting,
    },
  };
};

/**
 * `setTimeout` ベースの retry 登録を disposer 付きに正規化する。
 *
 * @param callback retry 時に実行する callback。
 * @param delayMs retry までの待機時間。
 * @returns timeout を解除する disposer。
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
 * readiness 待機だけにぶら下がる監視資源を張り替える holder を作る。
 *
 * @returns 次回差し替え時に旧待機だけを止められる disposer holder。
 */
const createWaitingBagHolder = (): {
  replace(nextBag: DisposeBag | null): void;
  dispose(): void;
} => {
  let current: DisposeBag | null = null;

  return {
    replace(nextBag) {
      current?.dispose();
      current = nextBag;
    },
    dispose() {
      current?.dispose();
      current = null;
    },
  };
};

/**
 * session lifecycle controller を作る。
 *
 * @param options clock / retry / document を差し替えるための任意依存。
 * @returns playback session の開始停止と状態購読を提供する controller。
 */
export const createSessionLifecycle = (
  options: SessionLifecycleOptions = {},
): SessionLifecycleController => {
  const doc = options.doc ?? document;
  const now = options.now ?? (() => Date.now());
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_READINESS_RETRY_DELAY_MS;
  const scheduleRetry = options.scheduleRetry ?? scheduleTimeoutRetry;
  const listeners = new Set<SessionStateListener>();
  const lifecycleBag = createDisposeBag();
  const waitingBagHolder = createWaitingBagHolder();

  let state: SessionState = createInactiveState('idle', null);
  let disposed = false;

  /**
   * 登録済み listener へ最新 state を通知する。
   */
  const notify = (): void => {
    const snapshot = cloneState(state);
    listeners.forEach((listener) => {
      listener(snapshot);
    });
  };

  /**
   * state を更新して listener へ通知する。
   *
   * @param next 更新後 state。
   */
  const setState = (next: SessionState): void => {
    state = next;
    notify();
  };

  /**
   * waiting 中の target を再解決し、旧 target との差分を返す。
   *
   * @param current 現在の session target。
   * @returns 再解決 target。比較できない場合は null。
   */
  const resolveNextTarget = (current: PlaybackTarget): PlaybackTarget | null => {
    const next = resolvePlaybackTarget(doc);
    if (!next) {
      return null;
    }

    const comparison = comparePlaybackTargetSnapshots(current.snapshot, next.snapshot);
    if (comparison.isSameTarget) {
      return current;
    }

    return next;
  };

  /**
   * playback target が subtitle ready かを判定する。
   *
   * @param target 判定対象の playback target。
   * @returns `textTracks.length > 0` のとき true。
   */
  const isSubtitleReady = (target: PlaybackTarget): boolean =>
    target.videoEl.textTracks.length > 0;

  /**
   * waiting bag を current target 用に張り替える。
   *
   * @param target 現在監視する playback target。
   * @param reason waiting に入った理由。
   * @param retryCount 今回までの retry 回数。
   * @param startedAt waiting 開始時刻。
   */
  const enterWaiting = (
    target: PlaybackTarget,
    reason: RestartReason,
    retryCount: number,
    startedAt: number,
  ): void => {
    const waitingBag = createDisposeBag();
    // 旧 waiting にぶら下がる retry を先に止め、現在の target だけを監視対象に保つ。
    waitingBagHolder.replace(waitingBag);

    const waitingState: WaitingState = {
      startedAt,
      retryCount,
      targetVideo: target.videoEl,
    };

    setState(createWaitingState(target, waitingState, reason));

    const retryDispose = scheduleRetry(() => {
      if (disposed) {
        return;
      }

      const latestTarget = resolveNextTarget(target);
      if (!latestTarget) {
        enterWaiting(target, reason, retryCount + 1, startedAt);
        return;
      }

      if (latestTarget.videoEl !== target.videoEl) {
        // readiness 待機中に video identity が変わったら、旧 waiting を引き継がず session を張り直す。
        start(latestTarget, 'video-replaced');
        return;
      }

      if (isSubtitleReady(latestTarget)) {
        // ready 到達後は waiting 専用 cleanup を即座に解放して running へ移る。
        waitingBagHolder.dispose();
        setState(createRunningState(latestTarget, reason));
        return;
      }

      enterWaiting(latestTarget, reason, retryCount + 1, startedAt);
    }, retryDelayMs);

    waitingBag.add(retryDispose);
  };

  /**
   * target を元に session を開始または再開始する。
   *
   * @param target 開始対象の playback target。未解決なら何もせず戻る。
   * @param reason 開始理由。省略時は `initial-start`。
   */
  const start = (
    target: PlaybackTarget | null,
    reason: RestartReason = 'initial-start',
  ): void => {
    if (disposed) {
      return;
    }

    // start を呼び直すたびに旧 waiting retry をいったん捨て、二重監視を避ける。
    waitingBagHolder.dispose();

    if (!target) {
      setState({
        status: 'waiting',
        target: null,
        waiting: null,
        reason,
      });
      return;
    }

    if (isSubtitleReady(target)) {
      // 初回解決時点で ready なら waiting を経由せず、そのまま running に入る。
      setState(createRunningState(target, reason));
      return;
    }

    const previousWaiting = state.status === 'waiting' ? state.waiting : null;
    const startedAt = previousWaiting?.startedAt ?? now();
    const retryCount = previousWaiting?.retryCount ?? 0;

    enterWaiting(target, reason, retryCount, startedAt);
  };

  /**
   * 現在の waiting / running session を停止する。
   * stop は複数回呼ばれても cleanup を 1 回だけにする。
   */
  const stop = (): void => {
    if (disposed || state.status === 'stopped') {
      return;
    }

    waitingBagHolder.dispose();
    const target = state.target;
    setState(createInactiveState('stopped', target));
  };

  // lifecycle 全体の dispose 時に、waiting cleanup と listener 購読を最後にまとめて解放する。
  lifecycleBag.add(() => {
    waitingBagHolder.dispose();
    listeners.clear();
  });

  return {
    /**
     * 現在の session state を取得する。
     *
     * @returns 呼び出し側が安全に読める state snapshot。
     */
    getState(): SessionState {
      return cloneState(state);
    },

    /**
     * playback target を受け取って session を開始または再開始する。
     *
     * @param target 開始対象の playback target。
     * @param reason 開始理由。
     */
    start,

    /**
     * 現在の session を停止する。
     */
    stop,

    /**
     * lifecycle 全体を破棄する。
     * dispose は複数回呼ばれても 1 回だけ cleanup する。
     */
    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      waitingBagHolder.dispose();
      lifecycleBag.dispose();
      setState(createInactiveState('stopped', state.target));
    },

    /**
     * session state 更新を購読する。
     *
     * @param listener state 更新ごとに呼ばれる callback。
     * @returns 購読解除 disposer。dispose 済みなら no-op を返す。
     */
    subscribe(listener: SessionStateListener): DisposeFn {
      if (disposed) {
        return () => {};
      }

      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
};
