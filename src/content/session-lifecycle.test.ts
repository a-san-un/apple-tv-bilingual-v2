/* @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';

import { createSessionLifecycle } from './session-lifecycle';
import { resolvePlaybackTarget } from './playback-root';
import type { DisposeFn } from '../shared/types';

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

const setPlaybackDom = (videoHtml = '<video></video>'): void => {
  document.body.innerHTML = `
    <dialog class="playback-view">
      <div data-testid="video-container"></div>
      <div data-testid="video-player-content"></div>
      ${videoHtml}
    </dialog>
  `;
};

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
