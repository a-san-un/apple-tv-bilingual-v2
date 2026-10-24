/* @vitest-environment jsdom */

/**
 * session lifecycle の unit test。
 * readiness 待機、video 差し替え、cleanup の一度化と解除失敗時の後処理を確認する。
 * 解除に失敗して残った旧 retry が、停止状態や新しい待機を変更しないことも確認する。
 * subtitle source / panel の起動は扱わない。
 */

import { describe, expect, it, vi } from 'vitest';

import { createSessionLifecycle } from './session-lifecycle';
import { resolvePlaybackTarget } from './playback-root';
import type { DisposeFn } from '../shared/types';

/**
 * retry 登録、手動発火、cleanup 回数の観測をまとめて扱う test double を作る。
 * 実時間の setTimeout を使わず、waiting retry の張り替えを決定的に検証する。
 *
 * @returns 登録済み retry の発火と disposer 観測を行う test helper 群。
 */
const createRetryScheduler = () => {
  const disposers: DisposeFn[] = [];
  const callbacks: Array<() => void> = [];

  return {
    /**
     * retry callback を保持し、その登録を解除する関数を作る。
     *
     * @param callback runNext() で手動実行する callback。
     * @returns 二重実行を防ぐ cleanup 関数。
     */
    schedule(callback: () => void): DisposeFn {
      callbacks.push(callback);

      let disposed = false;
      const dispose = vi.fn(() => {
        disposed = true;
      });

      disposers.push(dispose);

      return () => {
        if (disposed) {
          return;
        }

        dispose();
      };
    },

    /** 保持している先頭の callback を手動実行する。 */
    runNext(): void {
      const callback = callbacks.shift();
      callback?.();
    },

    /**
     * 登録した cleanup の spy を取得する。
     *
     * @param index 登録順の 0 始まりの位置。
     * @returns 対象の cleanup。存在しなければ undefined。
     */
    getDisposer(index: number) {
      return disposers[index];
    },
  };
};

/**
 * cleanup が必ず失敗し、残った retry callback を手動発火できる scheduler を作る。
 * 実際に解除できたとは扱わず、callback 側の無効化を独立して検証する。
 *
 * @returns 登録 spy、旧 callback の手動発火、cleanup spy の取得を行う helper 群。
 */
const createFailingRetryScheduler = () => {
  const callbacks: Array<() => void> = [];
  const disposers: Array<ReturnType<typeof vi.fn>> = [];

  /**
   * callback を保持し、必ず例外を投げる cleanup を返す。
   *
   * @param callback 解除に失敗して残る retry callback。
   * @returns cleanup 試行を観測できる spy。実行すると例外を投げる。
   */
  const schedule = vi.fn((callback: () => void): DisposeFn => {
    callbacks.push(callback);

    const dispose = vi.fn(() => {
      throw new Error('retry cleanup failed');
    });

    disposers.push(dispose);
    return dispose;
  });

  return {
    schedule,

    /**
     * 指定した登録の callback を、解除試行後も手動実行する。
     *
     * @param index 登録順の 0 始まりの位置。
     * @throws 指定位置に callback が登録されていない場合。
     */
    fire(index: number): void {
      const callback = callbacks[index];

      if (callback === undefined) {
        throw new Error(`retry callback ${index} must exist`);
      }

      callback();
    },

    /**
     * 登録した cleanup の spy を取得する。
     *
     * @param index 登録順の 0 始まりの位置。
     * @returns 対象の cleanup spy。
     * @throws 指定位置に cleanup が登録されていない場合。
     */
    getDisposer(index: number) {
      const dispose = disposers[index];

      if (dispose === undefined) {
        throw new Error(`retry disposer ${index} must exist`);
      }

      return dispose;
    },
  };
};

/**
 * playback root 解決に必要な最小 DOM を毎回作り直す。
 *
 * @param videoHtml 差し替えたい video 要素断片。省略時は単一 video を使う。
 */
const setPlaybackDom = (videoHtml = '<video></video>'): void => {
  document.body.innerHTML = `
    <dialog class="playback-view">
      <div data-testid="video-container"></div>
      <div data-testid="video-player-content"></div>
      ${videoHtml}
    </dialog>
  `;
};

/**
 * jsdom 上の video へ最小の textTracks length を注入する。
 *
 * @param video length を差し込む対象の video。
 * @param length readiness 判定で参照する track 数。
 */
const mockTextTrackLength = (video: HTMLVideoElement, length: number): void => {
  Object.defineProperty(video, 'textTracks', {
    configurable: true,
    value: { length },
  });
};

describe('session-lifecycle', () => {
  it('treats textTracks.length === 0 as waiting state, not terminal failure', () => {
    setPlaybackDom();

    const target = resolvePlaybackTarget(document);
    expect(target).not.toBeNull();
    mockTextTrackLength(target!.videoEl, 0);

    const scheduler = createRetryScheduler();
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: (callback) => scheduler.schedule(callback),
    });

    lifecycle.start(target, 'initial-start');

    expect(lifecycle.getState().status).toBe('waiting');
    expect(lifecycle.getState().target).toBe(target);
  });

  it('moves to running when the target video is already ready', () => {
    setPlaybackDom();

    const target = resolvePlaybackTarget(document);
    expect(target).not.toBeNull();
    mockTextTrackLength(target!.videoEl, 1);

    const lifecycle = createSessionLifecycle({ doc: document });
    lifecycle.start(target, 'initial-start');

    expect(lifecycle.getState().status).toBe('running');
    expect(lifecycle.getState().target).toBe(target);
  });

  it('disposes previous waiting retry when video identity changes during waiting', () => {
    setPlaybackDom('<video id="first"></video>');

    const firstTarget = resolvePlaybackTarget(document);
    expect(firstTarget).not.toBeNull();
    mockTextTrackLength(firstTarget!.videoEl, 0);

    const scheduler = createRetryScheduler();
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: (callback) => scheduler.schedule(callback),
    });

    lifecycle.start(firstTarget, 'initial-start');

    // waiting 中に video だけ差し替わると、旧 retry を破棄して新 target へ結び直す必要がある。
    const replacementVideo = document.createElement('video');
    replacementVideo.id = 'second';
    mockTextTrackLength(replacementVideo, 1);
    firstTarget!.rootEl.querySelector('video')?.replaceWith(replacementVideo);

    scheduler.runNext();

    expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);
    expect(lifecycle.getState().status).toBe('running');
    expect(lifecycle.getState().target?.videoEl).toBe(replacementVideo);
    expect(lifecycle.getState().reason).toBe('video-replaced');
  });

  it('runs cleanup only once even when stop and dispose are called repeatedly', () => {
    setPlaybackDom();

    const target = resolvePlaybackTarget(document);
    expect(target).not.toBeNull();
    mockTextTrackLength(target!.videoEl, 0);

    const scheduler = createRetryScheduler();
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: (callback) => scheduler.schedule(callback),
    });

    lifecycle.start(target, 'initial-start');
    lifecycle.stop();
    lifecycle.stop();
    lifecycle.dispose();
    lifecycle.dispose();

    expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);
    expect(lifecycle.getState().status).toBe('stopped');
  });

  it('keeps unresolved target observable as waiting state', () => {
    const lifecycle = createSessionLifecycle({ doc: document });

    expect(() => {
      lifecycle.start(null, 'spa-navigation');
    }).not.toThrow();
    expect(lifecycle.getState().status).toBe('waiting');
    expect(lifecycle.getState().target).toBeNull();
    expect(lifecycle.getState().reason).toBe('spa-navigation');
  });

  it('待機解除が失敗しても停止状態へ進み、dispose で購読を解除する', () => {
    setPlaybackDom();

    const target = resolvePlaybackTarget(document);
    if (target === null) {
      throw new Error('playback target must exist');
    }
    mockTextTrackLength(target.videoEl, 0);

    const retryDispose = vi.fn(() => {
      throw new Error('retry cleanup failed');
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => { });
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: () => retryDispose,
    });

    try {
      const listener = vi.fn();
      lifecycle.subscribe(listener);
      lifecycle.start(target);
      listener.mockClear();

      expect(() => lifecycle.stop()).not.toThrow();
      expect(lifecycle.getState().status).toBe('stopped');
      expect(retryDispose).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'stopped' }),
      );
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        '[atv-bilingual:cleanup] readiness waiting cleanup failed',
        expect.any(AggregateError),
      );

      listener.mockClear();

      expect(() => lifecycle.dispose()).not.toThrow();
      expect(listener).not.toHaveBeenCalled();
      expect(lifecycle.getState().status).toBe('stopped');
      expect(retryDispose).toHaveBeenCalledTimes(1);

      lifecycle.dispose();
      expect(retryDispose).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledTimes(1);
    } finally {
      try {
        lifecycle.dispose();
      } finally {
        errorLog.mockRestore();
      }
    }
  });

  it('旧待機の解除が失敗しても再開始でき、直接 dispose 時の解除失敗も記録する', () => {
    setPlaybackDom();

    const target = resolvePlaybackTarget(document);
    if (target === null) {
      throw new Error('playback target must exist');
    }
    mockTextTrackLength(target.videoEl, 0);

    const oldDispose = vi.fn(() => {
      throw new Error('old retry cleanup failed');
    });
    const nextDispose = vi.fn(() => {
      throw new Error('next retry cleanup failed');
    });
    const scheduleRetry = vi
      .fn<() => DisposeFn>()
      .mockReturnValueOnce(oldDispose)
      .mockReturnValueOnce(nextDispose);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => { });
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry,
    });

    try {
      lifecycle.start(target);

      // 旧 bag の解除失敗が、新しい waiting の作成を妨げないことを確認する。
      expect(() => lifecycle.start(target, 'manual-restart')).not.toThrow();
      expect(lifecycle.getState().status).toBe('waiting');
      expect(lifecycle.getState().reason).toBe('manual-restart');
      expect(scheduleRetry).toHaveBeenCalledTimes(2);
      expect(oldDispose).toHaveBeenCalledTimes(1);
      expect(nextDispose).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(1);

      const listener = vi.fn();
      lifecycle.subscribe(listener);

      // stop を経由しない直接 dispose でも、購読解除と状態更新まで進む。
      expect(() => lifecycle.dispose()).not.toThrow();
      expect(lifecycle.getState().status).toBe('stopped');
      expect(nextDispose).toHaveBeenCalledTimes(1);
      expect(listener).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(2);
      expect(errorLog).toHaveBeenNthCalledWith(
        2,
        '[atv-bilingual:cleanup] readiness waiting cleanup failed',
        expect.any(AggregateError),
      );

      // 破棄後の購読・開始・停止も、状態更新や cleanup の再実行を起こさない。
      const lateListener = vi.fn();
      const unsubscribe = lifecycle.subscribe(lateListener);
      unsubscribe();
      lifecycle.start(target);
      lifecycle.stop();
      lifecycle.dispose();

      expect(lifecycle.getState().status).toBe('stopped');
      expect(lateListener).not.toHaveBeenCalled();
      expect(oldDispose).toHaveBeenCalledTimes(1);
      expect(nextDispose).toHaveBeenCalledTimes(1);
      expect(scheduleRetry).toHaveBeenCalledTimes(2);
      expect(errorLog).toHaveBeenCalledTimes(2);
    } finally {
      try {
        lifecycle.dispose();
      } finally {
        errorLog.mockRestore();
      }
    }
  });

  // 解除失敗で残った callback が、停止後に session を再開しないことを確認する。
  it('停止後に解除できなかった旧 retry が発火しても停止状態を維持する', () => {
    setPlaybackDom();

    const target = resolvePlaybackTarget(document);
    if (target === null) {
      throw new Error('playback target must exist');
    }
    mockTextTrackLength(target.videoEl, 0);

    const scheduler = createFailingRetryScheduler();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => { });
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: scheduler.schedule,
    });

    try {
      const listener = vi.fn();
      lifecycle.subscribe(listener);
      lifecycle.start(target, 'initial-start');

      expect(scheduler.schedule).toHaveBeenCalledTimes(1);
      expect(() => lifecycle.stop()).not.toThrow();
      expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledTimes(1);

      const stoppedState = lifecycle.getState();
      expect(stoppedState.status).toBe('stopped');
      listener.mockClear();

      // ready になっても、停止済みの旧 callback に再開を許可しない。
      mockTextTrackLength(target.videoEl, 1);

      expect(() => scheduler.fire(0)).not.toThrow();

      expect(lifecycle.getState()).toEqual(stoppedState);
      expect(listener).not.toHaveBeenCalled();
      expect(scheduler.schedule).toHaveBeenCalledTimes(1);
      expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);

      // 未 ready に戻っても、旧 callback が新しい待機を登録してはならない。
      mockTextTrackLength(target.videoEl, 0);

      expect(() => scheduler.fire(0)).not.toThrow();

      expect(lifecycle.getState()).toEqual(stoppedState);
      expect(listener).not.toHaveBeenCalled();
      expect(scheduler.schedule).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledTimes(1);
    } finally {
      try {
        lifecycle.dispose();
      } finally {
        errorLog.mockRestore();
      }
    }
  });

  // 再開始して running になった新 session の状態と reason を守る。
  it('再開始後に旧 retry が発火しても新しい running 状態と reason を変更しない', () => {
    setPlaybackDom();

    const target = resolvePlaybackTarget(document);
    if (target === null) {
      throw new Error('playback target must exist');
    }
    mockTextTrackLength(target.videoEl, 0);

    const scheduler = createFailingRetryScheduler();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => { });
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: scheduler.schedule,
    });

    try {
      const listener = vi.fn();
      lifecycle.subscribe(listener);
      lifecycle.start(target, 'initial-start');

      mockTextTrackLength(target.videoEl, 1);

      expect(() => lifecycle.start(target, 'manual-restart')).not.toThrow();
      expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledTimes(1);

      const runningState = lifecycle.getState();
      expect(runningState.status).toBe('running');
      expect(runningState.reason).toBe('manual-restart');
      expect(runningState.target).toBe(target);
      listener.mockClear();

      expect(() => scheduler.fire(0)).not.toThrow();

      expect(lifecycle.getState()).toEqual(runningState);
      expect(listener).not.toHaveBeenCalled();
      expect(scheduler.schedule).toHaveBeenCalledTimes(1);
      expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledTimes(1);
    } finally {
      try {
        lifecycle.dispose();
      } finally {
        errorLog.mockRestore();
      }
    }
  });

  // 旧 callback が、新しい待機の bag を解除・置換しないことを確認する。
  it('旧 retry が発火しても新しい待機と retry を解除・置換しない', () => {
    setPlaybackDom();

    const target = resolvePlaybackTarget(document);
    if (target === null) {
      throw new Error('playback target must exist');
    }
    mockTextTrackLength(target.videoEl, 0);

    const scheduler = createFailingRetryScheduler();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => { });
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: scheduler.schedule,
    });

    try {
      const listener = vi.fn();
      lifecycle.subscribe(listener);
      lifecycle.start(target, 'initial-start');

      expect(() => lifecycle.start(target, 'manual-restart')).not.toThrow();

      expect(scheduler.schedule).toHaveBeenCalledTimes(2);
      expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);
      expect(scheduler.getDisposer(1)).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(1);

      const waitingState = lifecycle.getState();
      expect(waitingState.status).toBe('waiting');
      expect(waitingState.reason).toBe('manual-restart');
      listener.mockClear();

      // 新しい待機中に、解除できなかった旧 callback だけを発火する。
      expect(() => scheduler.fire(0)).not.toThrow();

      expect(lifecycle.getState()).toEqual(waitingState);
      expect(listener).not.toHaveBeenCalled();
      expect(scheduler.schedule).toHaveBeenCalledTimes(2);
      expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);
      expect(scheduler.getDisposer(1)).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(1);

      // 旧 callback を遮断しても、現在の retry は readiness を処理できる。
      mockTextTrackLength(target.videoEl, 1);

      expect(() => scheduler.fire(1)).not.toThrow();

      expect(lifecycle.getState().status).toBe('running');
      expect(lifecycle.getState().reason).toBe('manual-restart');
      expect(lifecycle.getState().target).toBe(target);
      expect(scheduler.schedule).toHaveBeenCalledTimes(2);
      expect(scheduler.getDisposer(1)).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'running',
          reason: 'manual-restart',
        }),
      );
      expect(errorLog).toHaveBeenCalledTimes(2);
    } finally {
      try {
        lifecycle.dispose();
      } finally {
        errorLog.mockRestore();
      }
    }
  });
});
