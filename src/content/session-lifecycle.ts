/**
 * playback session の開始停止、readiness 待機、video 差し替え検知を所有する。
 * 字幕接続の詳細は subtitle-session.ts に委譲し、データ取得と更新通知だけを中継する。
 * 中継購読の解除と字幕接続の dispose を、接続単位の bag に保持する。
 * 待機・字幕・任意の panel 接続は、旧参照を切り離してから cleanup を試す。
 * panel DOM の操作・購読の解除本体は panel-session.ts に委譲する。
 * track 選定、cue 読取、字幕ログ、panel 描画、native menu 同期は担当しない。
 */
import { createDisposeBag, type DisposeBag } from '../shared/dispose';
import { createPanelSession } from './panel-session';
import type { ReadySettings } from '../settings/settings-store';
import {
  createSubtitleSession,
  type SubtitleSession,
  type SubtitleSessionSnapshot,
  type SubtitleSessionObservation,
} from '../subtitles/subtitle-session';
import {
  comparePlaybackTargetSnapshots,
  resolvePlaybackTarget,
} from './playback-root';
import type {
  Disposable,
  DisposeFn,
  UiStateStore,
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
  getSubtitleSnapshot(): SubtitleSessionSnapshot | null;
  subscribeSubtitle(listener: () => void): DisposeFn;
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

  /** 既存の操作側 UI store。省略時は panel を生成しない。 */
  panel?: { uiState: Pick<UiStateStore, 'getState' | 'subscribe'> };

  /** 字幕観測情報。null は旧接続の情報をクリアする通知。 */
  onSubtitleObservation?: (
    observation: SubtitleSessionObservation | null,
  ) => void;
};

/**
 * DOM 参照を持たない開始前・停止後の state を作る。
 *
 * @param status 開始前は idle、終了後は stopped。
 * @returns target・waiting・reason を保持しない非稼働 state。
 */
const createInactiveState = (status: 'idle' | 'stopped'): SessionState => ({
  status,
  target: null,
  waiting: null,
  reason: null,
});

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
  const subtitleListeners = new Set<{ listener: () => void }>();
  let subtitleNotificationRevision = 0;
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

  let state: SessionState = createInactiveState('idle');
  let subtitleSession: SubtitleSession | null = null;
  let subtitleSessionBag: DisposeBag | null = null;
  let subtitleGeneration = 0;
  // 字幕接続の世代とは別に、panel 初期化・cleanup をまたぐ開始停止要求を識別する。
  let lifecycleRevision = 0;
  let startingRevision: number | null = null;
  let panelSession: Disposable | null = null;
  let disposed = false;

  /**
   * 現在の字幕接続から snapshot を取得する。
   * @returns 接続中の写し。接続なし・最終破棄後は null。
   * @throws 字幕接続の取得失敗。
   */
  const getSubtitleSnapshot = (): SubtitleSessionSnapshot | null =>
    disposed || subtitleSession === null ? null : subtitleSession.getSnapshot();

  /**
   * controller の字幕更新を登録単位で購読する。即時通知は行わない。
   * @param listener 引数なしで更新を受け取る callback。
   * @returns 登録元が保持・実行する冪等な解除関数。最終破棄後の登録は無効。
   */
  const subscribeSubtitle = (listener: () => void): DisposeFn => {
    if (disposed) {
      /** 最終終了後は購読を登録しない。 */
      return () => {};
    }
    const entry = { listener };
    subtitleListeners.add(entry);
    /** 登録元の寿命が終了した購読だけを解除する。 */
    return () => { subtitleListeners.delete(entry); };
  };

  /** panel 接続を先に保持先から外し、解除失敗後も他資源の cleanup を可能にする。 */
  const releasePanelSession = (): void => {
    const current = panelSession;
    panelSession = null;
    try {
      current?.dispose();
    } catch (error) {
      console.error('[atv-bilingual:cleanup] panel session cleanup failed', error);
    }
  };

  /**
   * 字幕観測情報を渡し、観測先の例外を lifecycle へ伝播させない。
   *
   * @param observation 観測情報。null は表示情報のクリア。
   */
  const notifySubtitleObservation = (
    observation: SubtitleSessionObservation | null,
  ): void => {
    try {
      options.onSubtitleObservation?.(observation);
    } catch (error) {
      console.error(
        '[atv-bilingual:debug] subtitle observation failed',
        error,
      );
    }
  };

  /** 登録済み listener へ、最新 state の写しを通知する。 */
  const notify = (): void => {
    const snapshot = cloneState(state);
    const revision = lifecycleRevision;
    for (const listener of [...listeners]) {
      // 先行購読者による停止・再開始後に、古い状態通知を続けない。
      if (disposed || revision !== lifecycleRevision) return;
      if (listeners.has(listener)) listener(snapshot);
    }
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

  /** データは取得せず更新だけを通知し、再入後に古い通知を続けない。 */
  const notifySubtitle = (): void => {
    const generation = subtitleGeneration;
    const revision = ++subtitleNotificationRevision;
    for (const entry of [...subtitleListeners]) {
      if (disposed || generation !== subtitleGeneration || revision !== subtitleNotificationRevision) return;
      if (!subtitleListeners.has(entry)) continue;
      try {
        entry.listener();
      } catch (error) {
        console.error('[atv-bilingual:subtitle] subtitle subscriber failed', error);
      }
    }
  };

  /** 旧通知を無効化し、字幕接続の破棄と観測情報のクリアを試す。 */
  const releaseSubtitleSession = (): void => {
    const session = subtitleSession;
    const bag = subtitleSessionBag;

    subtitleSession = null;
    subtitleSessionBag = null;
    const generation = ++subtitleGeneration;

    try {
      bag?.dispose();
    } catch (error) {
      console.error(
        '[atv-bilingual:cleanup] subtitle session cleanup failed',
        error,
      );
    } finally {
      if (generation === subtitleGeneration) {
        notifySubtitleObservation(null);
        if (session !== null && generation === subtitleGeneration) notifySubtitle();
      }
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
    const generation = subtitleGeneration;
    waitingBagHolder.dispose();
    if (disposed || generation !== subtitleGeneration) return;

    /**
     * 現在の接続からの観測情報だけを中継する。
     *
     * @param observation 字幕接続が作成した観測情報。
     */
    const observeSubtitle = (
      observation: SubtitleSessionObservation,
    ): void => {
      if (
        disposed ||
        generation !== subtitleGeneration ||
        observation.videoEl !== target.videoEl
      ) {
        return;
      }

      notifySubtitleObservation(observation);
    };

    if (subtitleInput !== null) {
      const sessionBag = createDisposeBag();
      try {
        const createdSession = createSubtitleSession({
          videoEl: target.videoEl,
          settings: subtitleInput.settings,
          fallbackSecondaryLang: subtitleInput.fallbackSecondaryLang,
          ...(options.onSubtitleObservation === undefined
            ? {}
            : { onObservation: observeSubtitle }),
        });

        sessionBag.add(createdSession);
        // 初期化中に停止・再開始された場合、古い接続を保持しない。
        if (disposed || generation !== subtitleGeneration) {
          sessionBag.dispose();
          return;
        }

        subtitleSession = createdSession;
        subtitleSessionBag = sessionBag;
        /** 現在の接続の更新だけを、snapshot を取得せず中継する。 */
        const relaySubtitle = (): void => {
          if (!disposed && generation === subtitleGeneration && subtitleSession === createdSession) {
            notifySubtitle();
          }
        };
        // 逆順 cleanup により、中継購読の解除を session 破棄より先に試す。
        sessionBag.add(createdSession.subscribe(relaySubtitle));
      } catch (error) {
        if (subtitleSessionBag === sessionBag) {
          subtitleSession = null;
          subtitleSessionBag = null;
        }
        try {
          sessionBag.dispose();
        } catch (cleanupError) {
          console.error('[atv-bilingual:cleanup] subtitle session cleanup failed', cleanupError);
        }
        if (!disposed && generation === subtitleGeneration) {
          notifySubtitleObservation(null);
        }

        console.error(
          '[atv-bilingual:subtitle] subtitle session start failed',
          error,
        );
      }
    }

    if (disposed || generation !== subtitleGeneration) {
      return;
    }

    setState({ status: 'running', target, waiting: null, reason });
    if (!disposed && generation === subtitleGeneration && subtitleInput !== null) notifySubtitle();
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
        // 消失した target の panel と待機を外し、再発見は外部の再評価に委ねる。
        start(null, reason);
        return;
      }
      const comparison = comparePlaybackTargetSnapshots(target.snapshot, latestTarget.snapshot);
      if (!comparison.isSameTarget) {
        // 同じ video でも mount 先が変われば、旧 panel を次の対象へ持ち越さない。
        start(latestTarget, comparison.hasVideoChanged ? 'video-replaced' : reason);
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

    const revision = ++lifecycleRevision;
    startingRevision = revision;
    try {
      // panel を先に外し、旧字幕のクリア通知で終了済み DOM を更新しない。
      releasePanelSession();
      if (disposed || revision !== lifecycleRevision) return;
      const generation = subtitleGeneration + 1;
      releaseSubtitleSession();
      if (disposed || revision !== lifecycleRevision || generation !== subtitleGeneration) return;
      waitingBagHolder.dispose();
      if (disposed || revision !== lifecycleRevision) return;
      if (target === null) {
        setState({ status: 'waiting', target: null, waiting: null, reason });
        return;
      }

      if (options.panel !== undefined) {
        try {
          const created = createPanelSession({
            mountEl: target.panelMountEl,
            uiState: options.panel.uiState,
            getSubtitleSnapshot,
            subscribeSubtitle,
          });
          // 初期描画中に停止・再開始された接続を、現在の保持先へ戻さない。
          if (disposed || revision !== lifecycleRevision) {
            created.dispose();
            return;
          }
          panelSession = created;
        } catch (error) {
          console.error('[atv-bilingual:panel] panel session start failed', error);
        }
      }
      if (disposed || revision !== lifecycleRevision) return;
      if (isSubtitleReady(target)) {
        enterRunning(target, reason);
        return;
      }
      const previousWaiting = state.status === 'waiting' ? state.waiting : null;
      enterWaiting(target, reason, previousWaiting?.retryCount ?? 0, previousWaiting?.startedAt ?? now());
    } finally {
      if (startingRevision === revision) startingRevision = null;
    }
  };

  /** panel・字幕接続・待機を解放し、公開購読を維持した停止状態へ更新する。 */
  const stop = (): void => {
    if (disposed || (state.status === 'stopped' && startingRevision === null)) return;
    const revision = ++lifecycleRevision;
    releasePanelSession();
    if (disposed || revision !== lifecycleRevision) return;
    const generation = subtitleGeneration + 1;
    releaseSubtitleSession();
    if (disposed || revision !== lifecycleRevision || generation !== subtitleGeneration) return;
    waitingBagHolder.dispose();
    if (disposed || revision !== lifecycleRevision) return;
    // 次回開始では新たな入力 target を使い、旧 DOM を再開用に保持しない。
    setState(createInactiveState('stopped'));
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

    /** @returns 現在の接続の写し。接続なし・破棄後は null。取得以外ではコピーしない。 */
    getSubtitleSnapshot,

    /**
     * 字幕データの更新だけを購読する。状態購読・診断通知とは独立する。
     * @param listener 更新後に引数なしで呼ぶ callback。即時通知はしない。
     * @returns 登録単位の冪等な解除関数。破棄後の登録は無効。
     */
    subscribeSubtitle,

    start,
    stop,

    /** 資源の解除を試し、購読者を破棄する。2 回目以降は何もしない。 */
    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      ++lifecycleRevision;
      startingRevision = null;
      releasePanelSession();
      subtitleListeners.clear();
      releaseSubtitleSession();
      waitingBagHolder.dispose();
      listeners.clear();
      // 最終終了後は状態取得からも旧 target の DOM 参照を返さない。
      state = createInactiveState('stopped');
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
