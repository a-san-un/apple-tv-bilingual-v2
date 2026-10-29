/* @vitest-environment jsdom */

/**
 * readiness、旧 retry の無効化、字幕接続の寿命管理を確認する。
 * subtitle-session は mock にし、寿命管理と字幕データの取得・通知中継を観測する。
 * track 選定、cue 読取、字幕ログは subtitle-session.test.ts で確認する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionLifecycle } from './session-lifecycle';
import { createUiStateStore } from '../ui/ui-state';
import * as panelConnection from './panel-session';
import { resolvePlaybackTarget } from './playback-root';
import { createSubtitleSession, type SubtitleSessionSnapshot } from '../subtitles/subtitle-session';
import type { DisposeFn } from '../shared/types';

vi.mock('../subtitles/subtitle-session', () => ({
  createSubtitleSession: vi.fn(),
}));

const createSubtitleSessionMock = vi.mocked(createSubtitleSession);

/** @returns 各言語の入力がない状態を表す独立した空配列。 */
const emptyTimeline = () => ({ primary: [], secondary: [] });

/** @returns 3区分とも字幕を持たない期待値。 */
const emptyHistory = () => ({ past: emptyTimeline(), current: emptyTimeline(), future: emptyTimeline() });

/** @returns 接続中で字幕を持たない期待値。接続なしのnullとは区別する。 */
const emptySnapshot = () => ({ timeline: emptyTimeline(), history: emptyHistory() });



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
  createSubtitleSessionMock.mockImplementation(() => ({ dispose: vi.fn(), getSnapshot: () => (emptySnapshot()), subscribe: () => () => {} }));
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
      createSubtitleSessionMock.mockReturnValue({ dispose, getSnapshot: () => (emptySnapshot()), subscribe: () => () => {} });
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
      return { dispose: () => { operations.push('dispose'); }, getSnapshot: () => (emptySnapshot()), subscribe: () => () => {} };
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
    createSubtitleSessionMock.mockReturnValue({ dispose, getSnapshot: () => (emptySnapshot()), subscribe: () => () => {} });
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

describe('session-lifecycle の字幕観測の寿命', () => {
  const subtitleInput = {
    settings: { primaryLang: 'en', secondaryLang: 'ja' },
    fallbackSecondaryLang: null,
  };

  it('停止後は旧接続の観測通知を中継しない', () => {
    const target = createTarget(1);
    const observe = vi.fn();
    const lifecycle = createSessionLifecycle({
      doc: document,
      subtitle: subtitleInput,
      onSubtitleObservation: observe,
    });

    try {
      lifecycle.start(target);

      const callback =
        createSubtitleSessionMock.mock.calls[0]?.[0].onObservation;
      expect(callback).toBeTypeOf('function');

      lifecycle.stop();
      expect(observe).toHaveBeenLastCalledWith(null);
      observe.mockClear();

      callback?.({
        videoEl: target.videoEl,
        event: 'bound',
        role: null,
        primary: null,
        secondary: null,
        primaryCueChanges: 0,
        secondaryCueChanges: 0,
      });

      expect(observe).not.toHaveBeenCalled();
    } finally {
      lifecycle.dispose();
    }
  });

  it('再開始後は新しい接続の観測通知だけを中継する', () => {
    const target = createTarget(1);
    const observe = vi.fn();
    const lifecycle = createSessionLifecycle({
      doc: document,
      subtitle: subtitleInput,
      onSubtitleObservation: observe,
    });

    try {
      lifecycle.start(target);
      const oldCallback =
        createSubtitleSessionMock.mock.calls[0]?.[0].onObservation;

      lifecycle.start(target, 'manual-restart');
      const newCallback =
        createSubtitleSessionMock.mock.calls[1]?.[0].onObservation;

      expect(oldCallback).toBeTypeOf('function');
      expect(newCallback).toBeTypeOf('function');
      observe.mockClear();

      const observation = {
        videoEl: target.videoEl,
        event: 'bound' as const,
        role: null,
        primary: null,
        secondary: null,
        primaryCueChanges: 0,
        secondaryCueChanges: 0,
      };

      oldCallback?.(observation);
      expect(observe).not.toHaveBeenCalled();

      newCallback?.(observation);
      expect(observe).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledWith(observation);
    } finally {
      lifecycle.dispose();
    }
  });
});


/**
 * 解除後も旧 callback を発火できる字幕接続 mock。
 * @param text snapshot を識別する本文。
 * @returns 接続 API と、残存 callback 発火・cleanup 観測用の helper。
 */
const createSubtitleDataMock = (text = 'subtitle') => {
  let callback: (() => void) | undefined;
  const operations: string[] = [];
  const unsubscribe = vi.fn(() => { operations.push('unsubscribe'); });
  const dispose = vi.fn(() => { operations.push('dispose'); });
  const getSnapshot = vi.fn((): SubtitleSessionSnapshot => {
    const timeline = { primary: [{ startTime: 1, endTime: 2, text }], secondary: [] };
    return { timeline, history: { past: emptyTimeline(), current: timeline, future: emptyTimeline() } };
  });
  const subscribe = vi.fn((listener: () => void): DisposeFn => {
    callback = listener;
    return unsubscribe;
  });
  return {
    session: { dispose, getSnapshot, subscribe }, unsubscribe, dispose, getSnapshot, subscribe, operations,
    /** 解除後の残存 callback も再現する。 */
    fire(): void { callback?.(); },
  };
};

describe('session-lifecycle の字幕データ境界', () => {
  const subtitle = { settings: { primaryLang: 'en', secondaryLang: 'ja' } };

  it('idle・waiting・字幕入力なし・dispose後はnullを返す', () => {
    const scheduler = createRetryScheduler();
    const lifecycle = createSessionLifecycle({ doc: document, subtitle, scheduleRetry: scheduler.schedule });
    const withoutSubtitle = createSessionLifecycle({ doc: document });
    try {
      expect(lifecycle.getSubtitleSnapshot()).toBeNull();
      lifecycle.start(null);
      expect(lifecycle.getSubtitleSnapshot()).toBeNull();
      lifecycle.start(createTarget());
      expect(lifecycle.getSubtitleSnapshot()).toBeNull();
      withoutSubtitle.start(createTarget(1));
      expect(withoutSubtitle.getSubtitleSnapshot()).toBeNull();
      lifecycle.dispose();
      expect(lifecycle.getSubtitleSnapshot()).toBeNull();
    } finally { lifecycle.dispose(); withoutSubtitle.dispose(); }
  });

  it('接続後の初回と更新を引数なしで通知し、取得時だけsessionへ委譲する', () => {
    const data = createSubtitleDataMock();
    createSubtitleSessionMock.mockReturnValue(data.session);
    const lifecycle = createSessionLifecycle({ doc: document, subtitle });
    const listener = vi.fn();
    const stateListener = vi.fn();
    try {
      lifecycle.subscribeSubtitle(listener);
      lifecycle.subscribe(stateListener);
      expect(listener).not.toHaveBeenCalled();
      lifecycle.start(createTarget(1));
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith();
      expect(data.getSnapshot).not.toHaveBeenCalled();
      expect(lifecycle.getSubtitleSnapshot()?.history.current.primary[0]?.text).toBe('subtitle');
      expect(data.getSnapshot).toHaveBeenCalledTimes(1);
      data.getSnapshot.mockClear();
      stateListener.mockClear();
      data.fire();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(data.getSnapshot).not.toHaveBeenCalled();
      expect(stateListener).not.toHaveBeenCalled();
    } finally { lifecycle.dispose(); }
  });

  it('ready到達まで接続せず、接続の空snapshotと接続なしのnullを区別する', () => {
    const data = createSubtitleDataMock();
    data.getSnapshot.mockReturnValue(emptySnapshot());
    createSubtitleSessionMock.mockReturnValue(data.session);
    const scheduler = createRetryScheduler();
    const lifecycle = createSessionLifecycle({ doc: document, subtitle, scheduleRetry: scheduler.schedule });
    const listener = vi.fn();
    try {
      lifecycle.subscribeSubtitle(listener);
      const target = createTarget();
      lifecycle.start(target);
      expect(listener).not.toHaveBeenCalled();
      expect(data.subscribe).not.toHaveBeenCalled();
      setTrackCount(target.videoEl, 1);
      scheduler.fire();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(lifecycle.getSubtitleSnapshot()).toEqual(emptySnapshot());
      lifecycle.stop();
      expect(lifecycle.getSubtitleSnapshot()).toBeNull();
    } finally { lifecycle.dispose(); }
  });

  it('stopでは参照を先に切り、購読解除からdisposeの順で一度だけ実行する', () => {
    const data = createSubtitleDataMock();
    createSubtitleSessionMock.mockReturnValue(data.session);
    const lifecycle = createSessionLifecycle({ doc: document, subtitle });
    const listener = vi.fn(() => lifecycle.getSubtitleSnapshot());
    try {
      lifecycle.subscribeSubtitle(listener);
      lifecycle.start(createTarget(1));
      // cleanup が例外を捕捉するため、解除時点の取得結果は戻り値で観測する。
      /** @returns 旧中継購読を解除する時点の字幕取得結果。 */
      data.unsubscribe.mockImplementation(() => {
        const snapshot = lifecycle.getSubtitleSnapshot();
        data.operations.push('unsubscribe');
        data.fire();
        return snapshot;
      });
      lifecycle.stop();
      expect(data.unsubscribe).toHaveReturnedTimes(1);
      expect(data.unsubscribe).toHaveLastReturnedWith(null);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveLastReturnedWith(null);
      expect(data.operations).toEqual(['unsubscribe', 'dispose']);
      listener.mockClear();
      data.fire();
      lifecycle.stop();
      lifecycle.dispose();
      expect(listener).not.toHaveBeenCalled();
      expect(data.unsubscribe).toHaveBeenCalledTimes(1);
      expect(data.dispose).toHaveBeenCalledTimes(1);
    } finally { lifecycle.dispose(); }
  });

  it('再開始では旧接続のクリアと新接続を通知し、旧callbackを無効化する', () => {
    const first = createSubtitleDataMock('first');
    const second = createSubtitleDataMock('second');
    createSubtitleSessionMock.mockReturnValueOnce(first.session).mockReturnValueOnce(second.session);
    const lifecycle = createSessionLifecycle({ doc: document, subtitle });
    const results: Array<string | null> = [];
    try {
      lifecycle.subscribeSubtitle(() => { results.push(lifecycle.getSubtitleSnapshot()?.history.current.primary[0]?.text ?? null); });
      const target = createTarget(1);
      lifecycle.start(target);
      lifecycle.start(target, 'manual-restart');
      expect(results).toEqual(['first', null, 'second']);
      first.fire();
      expect(results).toHaveLength(3);
      second.fire();
      expect(results).toEqual(['first', null, 'second', 'second']);
    } finally { lifecycle.dispose(); }
  });

  it('購読解除が失敗してもdisposeとnull通知を行い、旧callbackを無効化する', () => {
    observeCleanupErrors();
    const data = createSubtitleDataMock();
    data.unsubscribe.mockImplementation(() => { throw new Error('unsubscribe failed'); });
    createSubtitleSessionMock.mockReturnValue(data.session);
    const lifecycle = createSessionLifecycle({ doc: document, subtitle });
    const listener = vi.fn();
    try {
      lifecycle.subscribeSubtitle(listener);
      lifecycle.start(createTarget(1));
      expect(() => lifecycle.stop()).not.toThrow();
      expect(data.dispose).toHaveBeenCalledTimes(1);
      expect(lifecycle.getState().status).toBe('stopped');
      expect(lifecycle.getSubtitleSnapshot()).toBeNull();
      expect(listener).toHaveBeenCalledTimes(2);
      data.fire();
      expect(listener).toHaveBeenCalledTimes(2);
    } finally { lifecycle.dispose(); }
  });

  it.each(['create', 'subscribe'] as const)('%s失敗時は接続を残さず、readinessのrunningを維持する', (stage) => {
    observeCleanupErrors();
    const data = createSubtitleDataMock();
    if (stage === 'create') {
      createSubtitleSessionMock.mockImplementationOnce(() => { throw new Error('create failed'); });
    } else {
      data.subscribe.mockImplementationOnce(() => { throw new Error('subscribe failed'); });
      createSubtitleSessionMock.mockReturnValueOnce(data.session);
    }
    const lifecycle = createSessionLifecycle({ doc: document, subtitle });
    try {
      lifecycle.start(createTarget(1));
      expect(lifecycle.getState().status).toBe('running');
      expect(lifecycle.getSubtitleSnapshot()).toBeNull();
      expect(data.dispose).toHaveBeenCalledTimes(stage === 'subscribe' ? 1 : 0);
    } finally { lifecycle.dispose(); }
  });

  it('登録単位の解除と例外分離を行い、通知中の追加は次の更新から呼ぶ', () => {
    const errorLog = observeCleanupErrors();
    const data = createSubtitleDataMock();
    createSubtitleSessionMock.mockReturnValue(data.session);
    const lifecycle = createSessionLifecycle({ doc: document, subtitle });
    const next = vi.fn();
    let remove = () => {};
    let once = false;
    try {
      lifecycle.subscribeSubtitle(() => { throw new Error('listener failed'); });
      lifecycle.subscribeSubtitle(() => {
        if (once) return;
        once = true;
        remove(); remove();
        lifecycle.subscribeSubtitle(next);
      });
      remove = lifecycle.subscribeSubtitle(next);
      lifecycle.start(createTarget(1));
      expect(next).not.toHaveBeenCalled();
      data.fire();
      expect(next).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith('[atv-bilingual:subtitle] subtitle subscriber failed', expect.any(Error));
    } finally { lifecycle.dispose(); }
  });

  it('初回データ通知中のstopがrunningや接続を復活させない', () => {
    const data = createSubtitleDataMock();
    createSubtitleSessionMock.mockReturnValue(data.session);
    const lifecycle = createSessionLifecycle({ doc: document, subtitle });
    let once = false;
    const next = vi.fn();
    try {
      lifecycle.subscribeSubtitle(() => { if (!once) { once = true; lifecycle.stop(); } });
      lifecycle.subscribeSubtitle(next);
      lifecycle.start(createTarget(1));
      expect(lifecycle.getState().status).toBe('stopped');
      expect(lifecycle.getSubtitleSnapshot()).toBeNull();
      expect(next).toHaveBeenCalledTimes(1);
      expect(data.dispose).toHaveBeenCalledTimes(1);
    } finally { lifecycle.dispose(); }
  });

  it('クリア通知中の再開始を、外側の古い開始要求が上書きしない', () => {
    const first = createSubtitleDataMock('first');
    const second = createSubtitleDataMock('second');
    createSubtitleSessionMock.mockReturnValueOnce(first.session).mockReturnValueOnce(second.session);
    const lifecycle = createSessionLifecycle({ doc: document, subtitle });
    const target = createTarget(1);
    try {
      lifecycle.start(target);
      let once = false;
      lifecycle.subscribeSubtitle(() => {
        if (!once && lifecycle.getSubtitleSnapshot() === null) {
          once = true;
          lifecycle.start(target, 'video-replaced');
        }
      });
      lifecycle.start(target, 'manual-restart');
      expect(createSubtitleSessionMock).toHaveBeenCalledTimes(2);
      expect(lifecycle.getState().reason).toBe('video-replaced');
      expect(lifecycle.getSubtitleSnapshot()?.history.current.primary[0]?.text).toBe('second');
      expect(second.dispose).not.toHaveBeenCalled();
    } finally { lifecycle.dispose(); }
  });

  it('同一接続の再入更新で古い通知を打ち切り、dispose後の購読も無効にする', () => {
    const data = createSubtitleDataMock();
    createSubtitleSessionMock.mockReturnValue(data.session);
    const lifecycle = createSessionLifecycle({ doc: document, subtitle });
    try {
      lifecycle.start(createTarget(1));
      let once = false;
      lifecycle.subscribeSubtitle(() => { if (!once) { once = true; data.fire(); } });
      const next = vi.fn();
      lifecycle.subscribeSubtitle(next);
      data.fire();
      expect(next).toHaveBeenCalledTimes(1);
      lifecycle.dispose();
      lifecycle.subscribeSubtitle(next)();
      data.fire();
      expect(next).toHaveBeenCalledTimes(1);
      expect(lifecycle.getSubtitleSnapshot()).toBeNull();
    } finally { lifecycle.dispose(); }
  });

  it('通知中のdisposeで後続を止め、最終通知を送らない', () => {
    const data = createSubtitleDataMock();
    createSubtitleSessionMock.mockReturnValue(data.session);
    const lifecycle = createSessionLifecycle({ doc: document, subtitle });
    const next = vi.fn();
    lifecycle.subscribeSubtitle(() => { lifecycle.dispose(); });
    lifecycle.subscribeSubtitle(next);
    lifecycle.start(createTarget(1));
    expect(next).not.toHaveBeenCalled();
    expect(lifecycle.getState().status).toBe('stopped');
    expect(lifecycle.getSubtitleSnapshot()).toBeNull();
    expect(data.unsubscribe).toHaveBeenCalledTimes(1);
    expect(data.dispose).toHaveBeenCalledTimes(1);
  });
});

/** stop と最終 dispose で、target の解放と公開購読の寿命を区別する。 */
describe('session-lifecycle の停止後参照', () => {
  it.each([
    { method: 'stop' as const, trackCount: 0 },
    { method: 'dispose' as const, trackCount: 0 },
    { method: 'stop' as const, trackCount: 1 },
    { method: 'dispose' as const, trackCount: 1 },
  ])('$method は trackCount=$trackCount の target を保持しない',
    /**
     * waiting / running のどちらから終了しても参照が残らないことを検証する。
     * @param scenario 終了操作と readiness 用 track 件数。
     */
    ({ method, trackCount }) => {
      const scheduler = createRetryScheduler();
      const lifecycle = createSessionLifecycle({ doc: document, scheduleRetry: scheduler.schedule });
      try {
        const target = createTarget(trackCount);
        lifecycle.start(target);
        expect(lifecycle.getState().target).toBe(target);
        lifecycle[method]();
        expect(lifecycle.getState()).toEqual({ status: 'stopped', target: null, waiting: null, reason: null });
        expect(lifecycle.getSubtitleSnapshot()).toBeNull();
        lifecycle[method]();
        expect(lifecycle.getState().target).toBeNull();
      } finally {
        // waiting の予約も次のケースへ持ち越さない。
        lifecycle.dispose();
      }
    },
  );

  it('stop 後は公開購読を維持して新 target を受け付け、dispose 後は受け付けない',
    /** stop と最終 dispose の公開購読・再利用の契約を検証する。 */
    () => {
      const subtitle = { settings: { primaryLang: 'en', secondaryLang: 'ja' } };
      const first = createSubtitleDataMock('first');
      const second = createSubtitleDataMock('second');
      createSubtitleSessionMock.mockReturnValueOnce(first.session).mockReturnValueOnce(second.session);
      const lifecycle = createSessionLifecycle({ doc: document, subtitle });
      const states = vi.fn();
      const updates = vi.fn();
      try {
        lifecycle.subscribe(states);
        lifecycle.subscribeSubtitle(updates);
        lifecycle.start(createTarget(1));
        lifecycle.stop();
        expect(lifecycle.getState().target).toBeNull();
        expect(lifecycle.getSubtitleSnapshot()).toBeNull();
        states.mockClear();
        updates.mockClear();
        const nextTarget = createTarget(1);
        lifecycle.start(nextTarget);
        expect(lifecycle.getState().target).toBe(nextTarget);
        expect(lifecycle.getSubtitleSnapshot()?.history.current.primary[0]?.text).toBe('second');
        expect(states).toHaveBeenCalledTimes(1);
        expect(updates).toHaveBeenCalledTimes(1);
        first.fire();
        expect(updates).toHaveBeenCalledTimes(1);
        second.fire();
        expect(updates).toHaveBeenCalledTimes(2);
        states.mockClear();
        updates.mockClear();
        lifecycle.dispose();
        lifecycle.subscribe(states)();
        lifecycle.subscribeSubtitle(updates)();
        lifecycle.start(nextTarget);
        first.fire();
        second.fire();
        expect(states).not.toHaveBeenCalled();
        expect(updates).not.toHaveBeenCalled();
        expect(createSubtitleSessionMock).toHaveBeenCalledTimes(2);
        expect(lifecycle.getState()).toEqual({ status: 'stopped', target: null, waiting: null, reason: null });
        expect(lifecycle.getSubtitleSnapshot()).toBeNull();
      } finally {
        lifecycle.dispose();
      }
    },
  );
});

/** 実 host / renderer と字幕接続 mock で、処理 session 単位の panel 寿命を確認する。 */
describe('session-lifecycle の panel 接続',
  /** panel を使う接続ケースを登録する。 */
  () => {
    it('待機 retry と running 移行で host を維持し、字幕更新を描画する',
      /** readiness と panel の寿命を分離する契約を確認する。 */
      () => {
        const ui = createUiStateStore();
        ui.setExtensionEnabled(true);
        ui.setPanelOpen(true);
        const data = createSubtitleDataMock('first');
        createSubtitleSessionMock.mockReturnValue(data.session);
        const target = createTarget();
        const scheduler = createRetryScheduler();
        const lifecycle = createSessionLifecycle({ doc: document, subtitle: { settings: { primaryLang: 'en', secondaryLang: 'ja' } }, panel: { uiState: ui }, scheduleRetry: scheduler.schedule });
        try {
          lifecycle.start(target);
          const host = target.panelMountEl.querySelector('#atv-panel-host');
          expect(host).not.toBeNull();
          expect(host?.textContent).toBe('表示できる字幕はありません');
          scheduler.fire(0);
          expect(target.panelMountEl.querySelector('#atv-panel-host')).toBe(host);
          setTrackCount(target.videoEl, 1);
          scheduler.fire(1);
          expect(lifecycle.getState().status).toBe('running');
          expect(target.panelMountEl.querySelector('#atv-panel-host')).toBe(host);
          expect(host?.textContent).toBe('first');
          const next = createSubtitleDataMock('updated');
          data.getSnapshot.mockReturnValue(next.session.getSnapshot());
          data.fire();
          expect(host?.textContent).toBe('updated');
          ui.setPanelOpen(false);
          expect(target.panelMountEl.querySelector<HTMLElement>('[data-subtitle-panel]')?.hidden).toBe(true);
          expect(data.dispose).not.toHaveBeenCalled();
          expect(lifecycle.getState().status).toBe('running');
        } finally { lifecycle.dispose(); }
      },
    );

    it.each(['stop', 'dispose'] as const)('%s は panel を外し、旧 UI 更新を切り離す',
      /**
       * 公開停止操作が panel 資源の解放まで到達することを確認する。
       * @param method 停止または最終終了。
       */
      (method) => {
        const ui = createUiStateStore();
        ui.setExtensionEnabled(true); ui.setPanelOpen(true);
        const target = createTarget(1);
        const data = createSubtitleDataMock();
        createSubtitleSessionMock.mockReturnValue(data.session);
        const lifecycle = createSessionLifecycle({ doc: document, panel: { uiState: ui }, subtitle: { settings: { primaryLang: 'en', secondaryLang: 'ja' } } });
        try {
          lifecycle.start(target);
          const root = target.panelMountEl.querySelector<HTMLElement>('[data-subtitle-panel]')!;
          lifecycle[method]();
          expect(target.panelMountEl.children).toHaveLength(0);
          expect(lifecycle.getState().target).toBeNull();
          const hidden = root.hidden;
          data.getSnapshot.mockClear();
          ui.setPanelOpen(false); data.fire();
          expect(root.hidden).toBe(hidden);
          expect(data.getSnapshot).not.toHaveBeenCalled();
          expect(data.dispose).toHaveBeenCalledTimes(1);
        } finally { lifecycle.dispose(); }
      },
    );

    it('restart は旧 host を破棄し、手動 close を維持する',
      /** store を作り直さず、新 panel へ現在の意思を渡す。 */
      () => {
        const ui = createUiStateStore();
        ui.setExtensionEnabled(true); ui.setPanelOpen(true);
        const target = createTarget(1);
        const lifecycle = createSessionLifecycle({ doc: document, panel: { uiState: ui } });
        try {
          lifecycle.start(target);
          const oldHost = target.panelMountEl.querySelector('#atv-panel-host')!;
          ui.setPanelOpen(false);
          lifecycle.start(target, 'manual-restart');
          const newHost = target.panelMountEl.querySelector('#atv-panel-host');
          expect(newHost).not.toBeNull(); expect(newHost).not.toBe(oldHost);
          expect(oldHost.isConnected).toBe(false);
          expect(target.panelMountEl.querySelectorAll('#atv-panel-host')).toHaveLength(1);
          expect(ui.getState().panelOpen).toBe(false);
          expect(target.panelMountEl.querySelector<HTMLElement>('[data-subtitle-panel]')?.hidden).toBe(true);
        } finally { lifecycle.dispose(); }
      },
    );

    it('待機中に mount 先が差し替わると旧 panel を持ち越さない',
      /** 同じ video でも target snapshot の差を処理する。 */
      () => {
        const ui = createUiStateStore();
        const target = createTarget();
        const scheduler = createRetryScheduler();
        const lifecycle = createSessionLifecycle({ doc: document, panel: { uiState: ui }, scheduleRetry: scheduler.schedule });
        try {
          lifecycle.start(target);
          const oldHost = target.panelMountEl.querySelector('#atv-panel-host')!;
          const mount = document.createElement('div');
          mount.dataset.testid = 'video-player-content';
          target.panelMountEl.replaceWith(mount);
          scheduler.fire(0);
          expect(target.panelMountEl.children).toHaveLength(0);
          expect(oldHost.parentElement).toBeNull();
          expect(mount.querySelector('#atv-panel-host')).not.toBeNull();
          expect(lifecycle.getState().target?.panelMountEl).toBe(mount);
          expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);
        } finally { lifecycle.dispose(); }
      },
    );

    it('待機中の target 消失で panel と旧 retry を解放する',
      /** 解決不能な旧対象の DOM 参照を保持しない。 */
      () => {
        const target = createTarget();
        const scheduler = createRetryScheduler();
        const lifecycle = createSessionLifecycle({ doc: document, panel: { uiState: createUiStateStore() }, scheduleRetry: scheduler.schedule });
        try {
          lifecycle.start(target);
          target.rootEl.remove();
          scheduler.fire(0);
          expect(lifecycle.getState().target).toBeNull();
          expect(target.panelMountEl.children).toHaveLength(0);
          expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);
          scheduler.fire(0);
          expect(scheduler.schedule).toHaveBeenCalledTimes(1);
          lifecycle.start(null);
          expect(document.querySelector('#atv-panel-host')).toBeNull();
        } finally { lifecycle.dispose(); }
      },
    );

    it('panel 生成失敗でも字幕接続を開始する',
      /** 表示失敗を記録し、独立した字幕処理を妨げない。 */
      () => {
        const log = observeCleanupErrors();
        const error = new Error('panel start failed');
        vi.spyOn(panelConnection, 'createPanelSession').mockImplementationOnce(
          /** panel 初期化を失敗させる。@throws テスト用エラー。 */
          () => { throw error; },
        );
        const target = createTarget(1);
        const lifecycle = createSessionLifecycle({ doc: document, panel: { uiState: createUiStateStore() }, subtitle: { settings: { primaryLang: 'en', secondaryLang: 'ja' } } });
        try {
          lifecycle.start(target);
          expect(lifecycle.getState().status).toBe('running');
          expect(createSubtitleSessionMock).toHaveBeenCalledTimes(1);
          expect(log).toHaveBeenCalledWith('[atv-bilingual:panel] panel session start failed', error);
        } finally { lifecycle.dispose(); }
      },
    );

    it('stopped からの panel 初期化中でも stop が有効になる',
      /** 状態値だけで開始途中の停止を省略しないことを確認する。 */
      () => {
        const ui = createUiStateStore();
        const target = createTarget(1);
        let interrupt = false;
        const lifecycle = createSessionLifecycle({ doc: document, panel: { uiState: {
          /** 初期描画中に停止を再入させる。@returns store の現在値。 */
          getState: () => { if (interrupt) { interrupt = false; lifecycle.stop(); } return ui.getState(); },
          subscribe: ui.subscribe,
        } }, subtitle: { settings: { primaryLang: 'en', secondaryLang: 'ja' } } });
        try {
          lifecycle.stop();
          interrupt = true;
          lifecycle.start(target);
          expect(lifecycle.getState().status).toBe('stopped');
          expect(lifecycle.getState().target).toBeNull();
          expect(target.panelMountEl.children).toHaveLength(0);
          expect(createSubtitleSessionMock).not.toHaveBeenCalled();
        } finally { lifecycle.dispose(); }
      },
    );

    it('stop の panel cleanup 中に始まった新接続を古い stop が壊さない',
      /** 外側の停止要求より再入した開始要求を優先する。 */
      () => {
        const first = createSubtitleDataMock('first');
        const second = createSubtitleDataMock('second');
        createSubtitleSessionMock.mockReturnValueOnce(first.session).mockReturnValueOnce(second.session);
        const ui = createUiStateStore(); ui.setExtensionEnabled(true); ui.setPanelOpen(true);
        const target = createTarget(1);
        const lifecycle = createSessionLifecycle({ doc: document, panel: { uiState: ui }, subtitle: { settings: { primaryLang: 'en', secondaryLang: 'ja' } } });
        try {
          lifecycle.start(target);
          const host = target.panelMountEl.querySelector<HTMLElement>('#atv-panel-host')!;
          const remove = host.remove.bind(host);
          const removal = vi.spyOn(host, 'remove').mockImplementationOnce(
            /** 旧 host を外してから開始を再入させる。 */
            () => { remove(); lifecycle.start(target, 'manual-restart'); },
          );
          lifecycle.stop();
          expect(removal).toHaveReturnedTimes(1);
          expect(lifecycle.getState().status).toBe('running');
          expect(lifecycle.getState().reason).toBe('manual-restart');
          expect(target.panelMountEl.textContent).toBe('second');
          expect(first.dispose).toHaveBeenCalledTimes(1);
          expect(second.dispose).not.toHaveBeenCalled();
        } finally { lifecycle.dispose(); }
      },
    );
  },
);

/** panel の解除失敗を他資源の停止へ伝播させない契約を確認する。 */
describe('session-lifecycle の panel cleanup 失敗',
  /** 待機中と字幕接続中のケースを登録する。 */
  () => {
    it.each([0, 1])('trackCount=%s で UI 購読解除失敗後も停止を完了する',
      /**
       * 解除失敗を記録し、待機・字幕接続・DOM の停止を継続する。
       * @param trackCount readiness の判定に使う件数。
       */
      (trackCount) => {
        const target = createTarget(trackCount);
        const scheduler = createRetryScheduler();
        const ui = createUiStateStore();
        ui.setExtensionEnabled(true); ui.setPanelOpen(true);
        const error = new Error('UI unsubscribe failed');
        const log = observeCleanupErrors();
        const subscribe = ui.subscribe;
        const unsubscribe = vi.fn(
          /** 解除失敗を再現する。@throws テスト用の解除エラー。 */
          () => { throw error; },
        );
        const data = createSubtitleDataMock();
        createSubtitleSessionMock.mockReturnValue(data.session);
        const lifecycle = createSessionLifecycle({
          doc: document, scheduleRetry: scheduler.schedule,
          subtitle: { settings: { primaryLang: 'en', secondaryLang: 'ja' } },
          panel: { uiState: {
            getState: ui.getState,
            /**
             * callback を残したまま解除に失敗する境界を作る。
             * @param listener UI 更新の受信先。
             * @returns 失敗を再現する解除関数。
             */
            subscribe: (listener) => { subscribe(listener); return unsubscribe; },
          } },
        });
        try {
          lifecycle.start(target);
          lifecycle.stop();
          expect(lifecycle.getState().status).toBe('stopped');
          expect(lifecycle.getState().target).toBeNull();
          expect(target.panelMountEl.children).toHaveLength(0);
          expect(log).toHaveBeenCalledWith('[atv-bilingual:cleanup] panel session cleanup failed', expect.any(AggregateError));
          expect(unsubscribe).toHaveBeenCalledTimes(1);
          if (trackCount === 0) {
            expect(scheduler.getDisposer(0)).toHaveBeenCalledTimes(1);
            expect(data.dispose).not.toHaveBeenCalled();
          } else {
            expect(data.dispose).toHaveBeenCalledTimes(1);
          }
          data.getSnapshot.mockClear();
          ui.setPanelOpen(false); data.fire();
          expect(data.getSnapshot).not.toHaveBeenCalled();
          lifecycle.dispose();
          expect(unsubscribe).toHaveBeenCalledTimes(1);
        } finally { lifecycle.dispose(); }
      },
    );
  },
);
