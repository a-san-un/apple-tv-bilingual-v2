/**
 * session-lifecycle.ts
 *
 * playback session の開始停止、readiness 待機、retry、video 差し替え検知を所有する。
 * 待機資源は bag 単位で解除し、解除失敗は記録して停止・再開始を継続する。
 * 解除に失敗して旧 retry が残っても、現在の待機以外からは状態を更新しない。
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

/** readiness 未通過時に再確認する間隔。 */
const DEFAULT_READINESS_RETRY_DELAY_MS = 250;

/**
 * lifecycle の状態変化を受け取る callback。
 * content coordinator はこの通知だけを購読して session の外側へ状態を伝える。
 */
export type SessionStateListener = (state: SessionState) => void;

/** session lifecycle が公開する最小 controller。 */
export type SessionLifecycleController = {
  getState(): SessionState;
  start(target: PlaybackTarget | null, reason?: RestartReason): void;
  stop(): void;
  dispose(): void;
  subscribe(listener: SessionStateListener): DisposeFn;
};

/**
 * lifecycle の外から差し替え可能にする依存群。
 * test では clock / retry scheduler / document を差し替えて再試行を決定的に観測する。
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
 * @param status idle または stopped。
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
 * state の外側と waiting 情報を複製する。
 * target と DOM 要素の参照は維持する。
 *
 * @param state 複製元 state。
 * @returns state の外側と waiting 情報を変更しても内部へ伝わらない snapshot。
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
 * setTimeout ベースの retry 登録を disposer 付きに正規化する。
 *
 * @param callback retry 時に実行する callback。
 * @param delayMs retry までの待機時間。ミリ秒単位。
 * @returns 呼び出し側の waiting bag が保持して実行する timeout 解除関数。
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
 * 解除前に参照を切り離し、残った旧 callback が現在の待機として動くことを防ぐ。
 * 解除失敗は記録し、session の停止や次の待機を妨げない。
 *
 * @returns 待機 bag の保持、同一性確認、cleanup を行う holder。
 */
const createWaitingBagHolder = (): {
  replace(nextBag: DisposeBag | null): void;
  isCurrent(bag: DisposeBag): boolean;
  dispose(): void;
} => {
  let current: DisposeBag | null = null;

  /**
   * 現在の待機 bag を先に切り離してから、cleanup を試す。
   * 同じ bag の再解除と、解除失敗による session 後処理の中断を防ぐ。
   */
  const releaseCurrent = (): void => {
    const bag = current;
    // 実際の解除に失敗しても、旧 callback の同一性確認はここから false になる。
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
     * 旧待機を無効化して解除を試し、新しい待機 bag を保持する。
     *
     * @param nextBag 次に保持する bag。null なら待機なしにする。
     */
    replace(nextBag): void {
      releaseCurrent();
      current = nextBag;
    },

    /**
     * 指定した bag が、現在の待機を所有しているかを確認する。
     *
     * @param bag retry callback の登録元となる待機 bag。
     * @returns 現在保持している bag と同じ参照なら true。
     */
    isCurrent(bag: DisposeBag): boolean {
      return current === bag;
    },

    /** 現在の待機を無効化して bag を切り離し、cleanup を試す。 */
    dispose(): void {
      releaseCurrent();
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

  /** 登録済み listener へ最新 state を通知する。 */
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
   * @returns 再解決 target。対象が見つからない場合は null。
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
   * @returns textTracks.length > 0 のとき true。
   */
  const isSubtitleReady = (target: PlaybackTarget): boolean =>
    target.videoEl.textTracks.length > 0;

  /**
   * waiting bag を current target 用に張り替える。
   * retry は登録元の bag が現在の待機である間だけ実行する。
   *
   * @param target 現在監視する playback target。
   * @param reason waiting に入った理由。
   * @param retryCount 今回までの retry 回数。
   * @param startedAt waiting 開始時刻。now() と同じ時間単位。
   */
  const enterWaiting = (
    target: PlaybackTarget,
    reason: RestartReason,
    retryCount: number,
    startedAt: number,
  ): void => {
    const waitingBag = createDisposeBag();
    // 旧 waiting を先に無効化して解除を試し、次の retry は新しい bag だけで所有する。
    waitingBagHolder.replace(waitingBag);

    const waitingState: WaitingState = {
      startedAt,
      retryCount,
      targetVideo: target.videoEl,
    };

    setState(createWaitingState(target, waitingState, reason));

    // 状態通知中に stop / start / dispose された場合は、旧待機へ retry を登録しない。
    if (disposed || !waitingBagHolder.isCurrent(waitingBag)) {
      return;
    }

    const retryDispose = scheduleRetry(() => {
      // 解除失敗で残った旧 callback が、停止状態や新しい待機を変更することを防ぐ。
      if (disposed || !waitingBagHolder.isCurrent(waitingBag)) {
        return;
      }

      const latestTarget = resolveNextTarget(target);
      if (!latestTarget) {
        enterWaiting(target, reason, retryCount + 1, startedAt);
        return;
      }

      if (latestTarget.videoEl !== target.videoEl) {
        // video identity が変わったら、旧 waiting を引き継がず session を張り直す。
        start(latestTarget, 'video-replaced');
        return;
      }

      if (isSubtitleReady(latestTarget)) {
        // ready 到達後は旧 callback を無効化し、待機資源の解除を試して running へ移る。
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
   * @param target 開始対象。null なら target 未解決の waiting state にする。
   * @param reason 開始理由。省略時は initial-start。
   */
  const start = (
    target: PlaybackTarget | null,
    reason: RestartReason = 'initial-start',
  ): void => {
    if (disposed) {
      return;
    }

    // 旧 callback を無効化して解除を試し、次の開始処理へ進む。
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
      // 初回解決時点で ready なら waiting を経由せず、そのまま running に入る。
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
   * 待機 callback は先に無効化し、cleanup の失敗は記録して stopped への更新を継続する。
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

  // 待機解除の失敗は holder が受け止めるため、購読者の破棄まで進められる。
  lifecycleBag.add(() => {
    waitingBagHolder.dispose();
    listeners.clear();
  });

  return {
    /**
     * 現在の session state を取得する。
     *
     * @returns state の外側と waiting 情報を複製した snapshot。target と DOM 参照は共有する。
     */
    getState(): SessionState {
      return cloneState(state);
    },

    /**
     * playback target を受け取って session を開始または再開始する。
     *
     * @param target 開始対象。null なら target 未解決として待機する。
     * @param reason 開始理由。省略時は initial-start。
     */
    start,

    /** 現在の session を停止する。 */
    stop,

    /**
     * lifecycle 全体を破棄する。
     * 待機 cleanup の失敗は記録し、購読解除と停止状態への更新を継続する。
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
     * @returns 呼び出し側が保持して実行する購読解除関数。dispose 済みなら no-op。
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
