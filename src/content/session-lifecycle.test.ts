/* @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';

import { createSessionLifecycle } from './session-lifecycle';
import { resolvePlaybackTarget } from './playback-root';
import type { DisposeFn } from '../shared/types';

/**
 * session-lifecycle.test.ts
 *
 * readiness 待機、video 差し替え、stop / dispose の cleanup を確認する unit test。
 * subtitle source や panel 描画の起動はここでは扱わない。
 */
/**
 * retry 登録、手動発火、cleanup 回数の観測をまとめて扱う test double を作る。
 * 実時間の `setTimeout` を使わず、waiting retry の張り替えだけを決定的に検証するために使う。
 *
 * @returns 登録済み retry の発火と disposer 観測を行う test helper 群。
 */
const createRetryScheduler = () => {
  const disposers: DisposeFn[] = [];
  const callbacks: Array<() => void> = [];

  return {
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
    runNext(): void {
      const callback = callbacks.shift();
      callback?.();
    },
    getDisposer(index: number) {
      return disposers[index];
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
 * @param length readiness 判定で参照する track 数。
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

    // waiting 中に video だけ差し替わると、旧 retry を破棄して新 target へ結び直す必要がある。
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
});
