/* @vitest-environment jsdom */

/**
 * readiness、旧 retry の無効化、字幕接続の寿命管理を確認する。
 * subtitle-session は mock にし、開始と dispose の委譲だけを観測する。
 * track 選定、cue 読取、字幕ログは subtitle-session.test.ts で確認する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionLifecycle } from './session-lifecycle';
import { resolvePlaybackTarget } from './playback-root';
import { createSubtitleSession } from '../subtitles/subtitle-session';
import type { DisposeFn } from '../shared/types';

vi.mock('../subtitles/subtitle-session', () => ({
  createSubtitleSession: vi.fn(),
}));

const createSubtitleSessionMock = vi.mocked(createSubtitleSession);

/**
 * readiness 判定用の track 数を video に設定する。
 *
 * @param video 設定先。
 * @param length readiness 判定で参照する track 数。
 */
const setTrackCount = (video: HTMLVideoElement, length: number): void => {
  Object.defineProperty(video, 'textTracks', {
    configurable: true,
    value: { length },
  });
};

/**
 * playback target を解決できる最小 DOM を作る。
 *
 * @param trackCount 初期の track 数。省略時は未 ready。
 * @returns 解決済み target。
 * @throws 必須の DOM を解決できない場合。
 */
const createTarget = (trackCount = 0) => {
  document.body.innerHTML = `
    <dialog class="playback-view">
      <div data-testid="video-container"></div>
      <div data-testid="video-player-content"></div>
      <video></video>
    </dialog>
  `;
  const target = resolvePlaybackTarget(document);
  if (target === null) {
    throw new Error('playback target must exist');
  }
  setTrackCount(target.videoEl, trackCount);
  return target;
};

/**
 * retry と cleanup を手動で観測する scheduler を作る。
 * callback は解除後も保持し、残存 callback の無効化を検証できるようにする。
 *
 * @param failCleanup true の場合、解除処理が例外を投げる。
 * @returns 登録 spy、callback 発火、cleanup spy 取得用の helper。
 */
const createRetryScheduler = (failCleanup = false) => {
  const callbacks: Array<() => void> = [];
  const disposers: Array<ReturnType<typeof vi.fn>> = [];

  /** @param callback 手動で発火する retry。@returns 登録の解除関数。 */
  const schedule = vi.fn((callback: () => void): DisposeFn => {
    callbacks.push(callback);
    const dispose = vi.fn(() => {
      if (failCleanup) {
        throw new Error('retry cleanup failed');
      }
    });
    disposers.push(dispose);
    return dispose;
  });

  return {
    schedule,

    /**
     * 登録済み callback を手動実行する。
     *
     * @param index 登録順の位置。省略時は最初の登録。
     * @throws callback が存在しない場合。
     */
    fire(index = 0): void {
      const callback = callbacks[index];
      if (callback === undefined) {
        throw new Error(`retry callback ${index} must exist`);
      }
      callback();
    },

    /**
     * cleanup の spy を取得する。
     *
     * @param index 登録順の位置。
     * @returns 対象の spy。
     * @throws cleanup が存在しない場合。
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
 * 失敗系テストの cleanup ログを抑制する。
 *
 * @returns afterEach で復元する console.error の spy。
 */
const observeCleanupErrors = () =>
  vi.spyOn(console, 'error').mockImplementation(() => { });

beforeEach(() => {
  createSubtitleSessionMock.mockReset();
  createSubtitleSessionMock.mockImplementation(() => ({ dispose: vi.fn() }));
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('session-lifecycle の readiness', () => {
  it('textTracks が 0 件なら失敗ではなく waiting にする', () => {
    const target = createTarget();
    const scheduler = createRetryScheduler();
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: scheduler.schedule,
    });
    try {
      lifecycle.start(target);
      expect(lifecycle.getState().status).toBe('waiting');
      expect(lifecycle.getState().target).toBe(target);
      expect(scheduler.schedule).toHaveBeenCalledTimes(1);
    } finally {
      lifecycle.dispose();
    }
  });

  it('最初から ready なら running にする', () => {
    const target = createTarget(1);
    const lifecycle = createSessionLifecycle({ doc: document });
    try {
      lifecycle.start(target);
      expect(lifecycle.getState().status).toBe('running');
      expect(lifecycle.getState().target).toBe(target);
    } finally {
      lifecycle.dispose();
    }
  });

  it('待機中の video 差し替えでは旧 retry を解除して新 video を開始する', () => {
    const target = createTarget();
    const scheduler = createRetryScheduler();
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: scheduler.schedule,
    });
    try {
      lifecycle.start(target);
      const replacement = document.createElement('video');
      setTrackCount(replacement, 1);
      target.videoEl.replaceWith(replacement);
      scheduler.fire();
      expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);
      expect(lifecycle.getState().status).toBe('running');
      expect(lifecycle.getState().target?.videoEl).toBe(replacement);
      expect(lifecycle.getState().reason).toBe('video-replaced');
    } finally {
      lifecycle.dispose();
    }
  });

  it('stop と dispose を繰り返しても cleanup は一度だけ試す', () => {
    const target = createTarget();
    const scheduler = createRetryScheduler();
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: scheduler.schedule,
    });
    lifecycle.start(target);
    lifecycle.stop();
    lifecycle.stop();
    lifecycle.dispose();
    lifecycle.dispose();
    expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);
    expect(lifecycle.getState().status).toBe('stopped');
  });

  it('target 未解決を waiting として公開する', () => {
    const lifecycle = createSessionLifecycle({ doc: document });
    try {
      lifecycle.start(null, 'spa-navigation');
      expect(lifecycle.getState()).toEqual({
        status: 'waiting',
        target: null,
        waiting: null,
        reason: 'spa-navigation',
      });
    } finally {
      lifecycle.dispose();
    }
  });
});

describe('session-lifecycle の cleanup 失敗', () => {
  it('待機解除が失敗しても停止し、dispose 後は購読者を呼ばない', () => {
    const target = createTarget();
    const scheduler = createRetryScheduler(true);
    const errorLog = observeCleanupErrors();
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: scheduler.schedule,
    });
    try {
      const listener = vi.fn();
      lifecycle.subscribe(listener);
      lifecycle.start(target);
      listener.mockClear();
      expect(() => lifecycle.stop()).not.toThrow();
      expect(lifecycle.getState().status).toBe('stopped');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        '[atv-bilingual:cleanup] readiness waiting cleanup failed',
        expect.any(AggregateError),
      );
      listener.mockClear();
      lifecycle.dispose();
      lifecycle.dispose();
      expect(listener).not.toHaveBeenCalled();
      expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledTimes(1);
    } finally {
      lifecycle.dispose();
    }
  });

  it('旧待機の解除失敗後も再開始し、直接 dispose の後処理を続ける', () => {
    const target = createTarget();
    const scheduler = createRetryScheduler(true);
    const errorLog = observeCleanupErrors();
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: scheduler.schedule,
    });
    try {
      lifecycle.start(target);
      expect(() => lifecycle.start(target, 'manual-restart')).not.toThrow();
      expect(lifecycle.getState().reason).toBe('manual-restart');
      expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);
      expect(scheduler.getDisposer(1)).not.toHaveBeenCalled();
      const listener = vi.fn();
      lifecycle.subscribe(listener);
      expect(() => lifecycle.dispose()).not.toThrow();
      expect(listener).not.toHaveBeenCalled();
      expect(scheduler.getDisposer(1)).toHaveBeenCalledTimes(1);
      const lateListener = vi.fn();
      lifecycle.subscribe(lateListener)();
      lifecycle.start(target);
      lifecycle.stop();
      lifecycle.dispose();
      expect(lifecycle.getState().status).toBe('stopped');
      expect(lateListener).not.toHaveBeenCalled();
      expect(scheduler.schedule).toHaveBeenCalledTimes(2);
      expect(errorLog).toHaveBeenCalledTimes(2);
    } finally {
      lifecycle.dispose();
    }
  });

  it('停止後に残った旧 retry が発火しても状態と予約を変更しない', () => {
    const target = createTarget();
    const scheduler = createRetryScheduler(true);
    observeCleanupErrors();
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: scheduler.schedule,
    });
    try {
      lifecycle.start(target);
      lifecycle.stop();
      const stopped = lifecycle.getState();
      const listener = vi.fn();
      lifecycle.subscribe(listener);
      for (const count of [1, 0]) {
        setTrackCount(target.videoEl, count);
        scheduler.fire();
        expect(lifecycle.getState()).toEqual(stopped);
      }
      expect(listener).not.toHaveBeenCalled();
      expect(scheduler.schedule).toHaveBeenCalledTimes(1);
    } finally {
      lifecycle.dispose();
    }
  });

  it('再開始後の旧 retry が新しい running の reason を変更しない', () => {
    const target = createTarget();
    const scheduler = createRetryScheduler(true);
    observeCleanupErrors();
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: scheduler.schedule,
    });
    try {
      lifecycle.start(target);
      setTrackCount(target.videoEl, 1);
      lifecycle.start(target, 'manual-restart');
      const running = lifecycle.getState();
      const listener = vi.fn();
      lifecycle.subscribe(listener);
      scheduler.fire();
      expect(lifecycle.getState()).toEqual(running);
      expect(running.reason).toBe('manual-restart');
      expect(listener).not.toHaveBeenCalled();
      expect(scheduler.schedule).toHaveBeenCalledTimes(1);
    } finally {
      lifecycle.dispose();
    }
  });

  it('旧 retry は新しい待機を解除せず、現在の retry は ready を処理する', () => {
    const target = createTarget();
    const scheduler = createRetryScheduler(true);
    observeCleanupErrors();
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: scheduler.schedule,
    });
    try {
      lifecycle.start(target);
      lifecycle.start(target, 'manual-restart');
      const waiting = lifecycle.getState();
      scheduler.fire(0);
      expect(lifecycle.getState()).toEqual(waiting);
      expect(scheduler.schedule).toHaveBeenCalledTimes(2);
      expect(scheduler.getDisposer(1)).not.toHaveBeenCalled();
      setTrackCount(target.videoEl, 1);
      scheduler.fire(1);
      expect(lifecycle.getState().status).toBe('running');
      expect(lifecycle.getState().reason).toBe('manual-restart');
      expect(scheduler.getDisposer(1)).toHaveBeenCalledTimes(1);
    } finally {
      lifecycle.dispose();
    }
  });
});

describe('session-lifecycle の字幕接続の委譲', () => {
  const subtitle = {
    settings: { primaryLang: 'en', secondaryLang: 'ja' },
    fallbackSecondaryLang: null,
  };

  it('字幕入力なしでは、ready でも字幕接続を生成しない', () => {
    const target = createTarget(1);
    const lifecycle = createSessionLifecycle({ doc: document });
    try {
      lifecycle.start(target);
      expect(createSubtitleSessionMock).not.toHaveBeenCalled();
    } finally {
      lifecycle.dispose();
    }
  });

  it('ready 到達後にだけ、設定と video を字幕接続へ渡す', () => {
    const target = createTarget();
    const scheduler = createRetryScheduler();
    const lifecycle = createSessionLifecycle({
      doc: document,
      scheduleRetry: scheduler.schedule,
      subtitle,
    });
    try {
      lifecycle.start(target);
      expect(createSubtitleSessionMock).not.toHaveBeenCalled();
      setTrackCount(target.videoEl, 1);
      scheduler.fire();
      expect(createSubtitleSessionMock).toHaveBeenCalledTimes(1);
      expect(createSubtitleSessionMock).toHaveBeenCalledWith({
        videoEl: target.videoEl,
        settings: subtitle.settings,
        fallbackSecondaryLang: null,
      });
    } finally {
      lifecycle.dispose();
    }
  });

  it.each(['stop', 'dispose'] as const)(
    '%s は字幕接続の dispose を一度だけ実行する',
    (method) => {
      const target = createTarget(1);
      const dispose = vi.fn();
      createSubtitleSessionMock.mockReturnValue({ dispose });
      const lifecycle = createSessionLifecycle({ doc: document, subtitle });
      try {
        lifecycle.start(target);
        lifecycle[method]();
        lifecycle.stop();
        lifecycle.dispose();
        expect(dispose).toHaveBeenCalledTimes(1);
      } finally {
        lifecycle.dispose();
      }
    },
  );

  it('旧字幕接続を破棄してから新しい接続を生成する', () => {
    const target = createTarget(1);
    const operations: string[] = [];
    createSubtitleSessionMock.mockImplementation(() => {
      operations.push('start');
      return { dispose: () => { operations.push('dispose'); } };
    });
    const lifecycle = createSessionLifecycle({ doc: document, subtitle });
    try {
      lifecycle.start(target);
      lifecycle.start(target, 'manual-restart');
      expect(operations).toEqual(['start', 'dispose', 'start']);
    } finally {
      lifecycle.dispose();
    }
  });

  it('字幕接続の破棄が失敗しても停止状態へ進む', () => {
    const target = createTarget(1);
    const errorLog = observeCleanupErrors();
    const dispose = vi.fn(() => { throw new Error('cleanup failed'); });
    createSubtitleSessionMock.mockReturnValue({ dispose });
    const lifecycle = createSessionLifecycle({ doc: document, subtitle });
    try {
      lifecycle.start(target);
      expect(() => lifecycle.stop()).not.toThrow();
      expect(lifecycle.getState().status).toBe('stopped');
      expect(errorLog).toHaveBeenCalledWith(
        '[atv-bilingual:cleanup] subtitle session cleanup failed',
        expect.any(Error),
      );
      lifecycle.dispose();
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      lifecycle.dispose();
    }
  });
});
