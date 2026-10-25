/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import {
  comparePlaybackTargetSnapshots,
  createPlaybackTargetSnapshot,
  resolvePlaybackTarget,
} from './playback-root';

/**
 * playback-root.test.ts
 *
 * playback target snapshot の構築と比較だけを確認する unit test。
 * readiness 待機、observer、session restart はここでは扱わない。
 */
describe('playback-root', () => {
  it('builds a playback target snapshot', () => {
    document.body.innerHTML = `
      <dialog class="playback-view">
        <div data-testid="video-container"></div>
        <div data-testid="video-player-content"></div>
        <video></video>
      </dialog>
    `;

    const target = resolvePlaybackTarget(document);

    expect(target).not.toBeNull();
    expect(target?.rootEl).not.toBeNull();
    expect(target?.videoEl).not.toBeNull();
    expect(target?.panelMountEl).not.toBeNull();
    expect(target?.layoutTargetEl).not.toBeNull();
    expect(target?.snapshot).toEqual(
      createPlaybackTargetSnapshot({
        rootEl: target!.rootEl,
        videoEl: target!.videoEl,
        panelMountEl: target!.panelMountEl,
        layoutTargetEl: target!.layoutTargetEl,
      }),
    );
  });

  it('treats the same snapshot as the same target', () => {
    document.body.innerHTML = `
      <dialog class="playback-view">
        <div data-testid="video-container"></div>
        <div data-testid="video-player-content"></div>
        <video></video>
      </dialog>
    `;

    const target = resolvePlaybackTarget(document);
    expect(target).not.toBeNull();

    const comparison = comparePlaybackTargetSnapshots(
      target!.snapshot,
      target!.snapshot,
    );

    expect(comparison).toEqual({
      isSameTarget: true,
      hasRootChanged: false,
      hasVideoChanged: false,
      hasPanelMountTargetChanged: false,
      hasLayoutTargetChanged: false,
    });
  });

  it('detects video identity changes within the same root', () => {
    document.body.innerHTML = `
      <dialog class="playback-view">
        <div data-testid="video-container"></div>
        <div data-testid="video-player-content"></div>
        <video id="first"></video>
      </dialog>
    `;

    const first = resolvePlaybackTarget(document);
    expect(first).not.toBeNull();

    // 同じ root のまま video だけ差し替わったケースを模擬する。
    const root = document.querySelector('dialog.playback-view');
    const secondVideo = document.createElement('video');
    root?.querySelector('video')?.replaceWith(secondVideo);

    const second = resolvePlaybackTarget(document);
    expect(second).not.toBeNull();

    const comparison = comparePlaybackTargetSnapshots(
      first!.snapshot,
      second!.snapshot,
    );

    expect(comparison.isSameTarget).toBe(false);
    expect(comparison.hasRootChanged).toBe(false);
    expect(comparison.hasVideoChanged).toBe(true);
  });

  it('detects root, panel mount target, and layout target changes', () => {
    document.body.innerHTML = `
      <dialog class="playback-view" id="root-a">
        <div data-testid="video-container" id="layout-a"></div>
        <div data-testid="video-player-content" id="panel-a"></div>
        <video></video>
      </dialog>
    `;

    const first = resolvePlaybackTarget(document);
    expect(first).not.toBeNull();

    // DOM 全体を差し替えて、session restart 判定に必要な 3 要素変化をまとめて確認する。
    document.body.innerHTML = `
      <dialog class="playback-view" id="root-b">
        <div data-testid="video-container" id="layout-b"></div>
        <div data-testid="video-player-content" id="panel-b"></div>
        <video></video>
      </dialog>
    `;

    const second = resolvePlaybackTarget(document);
    expect(second).not.toBeNull();

    const comparison = comparePlaybackTargetSnapshots(
      first!.snapshot,
      second!.snapshot,
    );

    expect(comparison.isSameTarget).toBe(false);
    expect(comparison.hasRootChanged).toBe(true);
    expect(comparison.hasPanelMountTargetChanged).toBe(true);
    expect(comparison.hasLayoutTargetChanged).toBe(true);
  });

  it('root 外の video も指定された document 内から解決する', () => {
    const doc = document.implementation.createHTMLDocument('playback test');
    doc.body.innerHTML = `
      <dialog class="playback-view">
        <div data-testid="video-container"></div>
        <div data-testid="video-player-content"></div>
      </dialog>
      <video></video>
    `;

    const expectedVideo = doc.querySelector('video');

    expect(expectedVideo).not.toBeNull();

    const target = resolvePlaybackTarget(doc);

    expect(target).not.toBeNull();
    expect(target?.videoEl).toBe(expectedVideo);
    expect(target?.snapshot.videoEl).toBe(expectedVideo);
  });

  it('指定された document に video がなければ別 document から採用しない', () => {
    const doc = document.implementation.createHTMLDocument('playback test');
    doc.body.innerHTML = `
      <dialog class="playback-view">
        <div data-testid="video-container"></div>
        <div data-testid="video-player-content"></div>
      </dialog>
    `;

    const foreignVideo = document.createElement('video');
    document.body.appendChild(foreignVideo);

    try {
      expect(resolvePlaybackTarget(doc)).toBeNull();
    } finally {
      foreignVideo.remove();
    }
  });

  it('returns null when required elements are unresolved', () => {
    document.body.innerHTML = '<div></div>';

    const target = resolvePlaybackTarget(document);

    expect(target).toBeNull();
  });
});
