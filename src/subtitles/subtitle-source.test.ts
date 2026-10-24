/**
 * subtitle-source.test.ts
 *
 * subtitle-source の bind、通知、unbind、dispose を確認する。
 * 共通 helper の fake track を使い、listener の登録数と解除を観測する。
 * snapshot のコピー保護とエラー境界は、専用のテストファイルで扱う。
 * source は session 単位で使われ、unbind / dispose で listener の解除を
 * 試す前提を検証する。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSubtitleSource,
  type SubtitleSourceVideo,
} from './subtitle-source';
import {
  createFakeTrack,
  createFixture,
  createSilentLogger,
} from './subtitle-source-test-helpers';
import { resolveTrackPair } from './text-track-resolver';
import type {
  ResolvedTrackPair,
  SubtitleSourceChange,
} from '../shared/types';

/** fake timer を使用したテストの設定を、後続テストへ持ち越さない。 */
afterEach(() => {
  vi.useRealTimers();
});

describe('createSubtitleSource の基本動作', () => {
  it('ready な video の採用 track に bind し、必要な listener だけを登録する', () => {
    const { ja, en, ko, pair, source } = createFixture();
    const changes: SubtitleSourceChange[] = [];
    source.subscribe((change) => changes.push(change));

    source.bind(pair);

    expect(ja.addEventListener).toHaveBeenCalledTimes(1);
    expect(ja.addEventListener).toHaveBeenCalledWith(
      'cuechange',
      expect.any(Function),
    );
    expect(en.addEventListener).toHaveBeenCalledTimes(1);
    expect(ko.addEventListener).not.toHaveBeenCalled();
    expect(changes).toEqual([{ type: 'bound' }]);
    expect(source.getSnapshot().pair).toEqual(pair);
  });

  it('同じ pair で bind を繰り返しても listener を二重登録しない', () => {
    const { ja, en, pair, source } = createFixture();

    source.bind(pair);
    source.bind(pair);
    source.bind({ ...pair });

    expect(ja.addEventListener).toHaveBeenCalledTimes(1);
    expect(en.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('cue 変化を role 付きで通知し、snapshot で cue を読める', () => {
    const { ja, en, pair, source } = createFixture();
    const listener = vi.fn();
    source.subscribe(listener);
    source.bind(pair);
    listener.mockClear();

    ja.fireCueChange();
    en.fireCueChange();

    expect(listener.mock.calls).toEqual([
      [{ type: 'cuechange', role: 'primary' }],
      [{ type: 'cuechange', role: 'secondary' }],
    ]);

    const snapshot = source.getSnapshot();
    expect(snapshot.primaryCues).toEqual([
      {
        startTime: 1,
        endTime: 2,
        text: 'こんにちは',
        track: pair.primary,
      },
    ]);
    expect(snapshot.secondaryCues.map((cue) => cue.text)).toEqual(['Hello']);
  });

  it('unbind と dispose を重ねても listener の解除は一度だけ行う', () => {
    const { ja, en, pair, source } = createFixture();
    const listener = vi.fn();
    source.subscribe(listener);
    source.bind(pair);
    listener.mockClear();

    source.unbind();
    source.unbind();
    source.dispose();
    source.dispose();

    expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
    expect(en.removeEventListener).toHaveBeenCalledTimes(1);
    expect(ja.listenerCount()).toBe(0);
    expect(en.listenerCount()).toBe(0);
    expect(listener.mock.calls).toEqual([[{ type: 'unbound' }]]);
    expect(source.getSnapshot()).toEqual({
      pair: { primary: null, secondary: null },
      primaryCues: [],
      secondaryCues: [],
    });
  });

  it('dispose 後は listener を残さず、通知も bind も行わない', () => {
    const { ja, en, pair, source } = createFixture();
    const listener = vi.fn();
    source.subscribe(listener);
    source.bind(pair);
    listener.mockClear();

    source.dispose();
    ja.fireCueChange();
    source.bind(pair);
    const unsubscribe = source.subscribe(vi.fn());
    unsubscribe();

    expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
    expect(en.removeEventListener).toHaveBeenCalledTimes(1);
    expect(ja.addEventListener).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('別の pair へ bind し直すと旧 listener を外してから新 listener を付ける', () => {
    const { ja, en, ko, video, source } = createFixture();
    source.bind(
      resolveTrackPair({
        textTracks: video.textTracks,
        primaryLang: 'ja',
        secondaryLang: 'en',
      }),
    );

    source.bind(
      resolveTrackPair({
        textTracks: video.textTracks,
        primaryLang: 'ko',
        secondaryLang: 'en',
      }),
    );

    expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
    expect(en.removeEventListener).toHaveBeenCalledTimes(1);
    expect(en.addEventListener).toHaveBeenCalledTimes(2);
    expect(ko.addEventListener).toHaveBeenCalledTimes(1);
    expect(ja.listenerCount()).toBe(0);
    expect(en.listenerCount()).toBe(1);
  });

  it('track 未一致の pair でも例外を投げず、未 bind のまま返す', () => {
    const { video, source } = createFixture();
    const listener = vi.fn();
    source.subscribe(listener);

    const pair = resolveTrackPair({
      textTracks: video.textTracks,
      primaryLang: 'fr',
      secondaryLang: null,
    });
    expect(() => source.bind(pair)).not.toThrow();

    expect(listener).not.toHaveBeenCalled();
    expect(source.getSnapshot().pair).toEqual({
      primary: null,
      secondary: null,
    });
  });

  it('textTracks が 0 件の video でも待機せず、timer を作らない', () => {
    vi.useFakeTimers();
    const ja = createFakeTrack('ja');
    const staleVideo: SubtitleSourceVideo = { textTracks: [ja] };
    const stalePair = resolveTrackPair({
      textTracks: staleVideo.textTracks,
      primaryLang: 'ja',
      secondaryLang: null,
    });
    const source = createSubtitleSource(
      { textTracks: [] },
      { logger: createSilentLogger() },
    );

    expect(() => source.bind(stalePair)).not.toThrow();

    expect(vi.getTimerCount()).toBe(0);
    expect(ja.addEventListener).not.toHaveBeenCalled();
    expect(source.getSnapshot().pair.primary).toBeNull();
  });

  it('現在の video に含まれない track は bind しない', () => {
    const { source } = createFixture();
    const foreign = createFakeTrack('ja');
    const foreignPair: ResolvedTrackPair = resolveTrackPair({
      textTracks: [foreign],
      primaryLang: 'ja',
      secondaryLang: null,
    });

    source.bind(foreignPair);

    expect(foreign.addEventListener).not.toHaveBeenCalled();
    expect(source.getSnapshot().pair.primary).toBeNull();
  });

  // 通知途中の破棄でも、後続購読者へ停止済みの更新を流さない。
  it('購読者が通知中に dispose したら後続の購読者を呼ばない', () => {
    const { ja, en, pair, source } = createFixture();
    const firstListener = vi.fn((change: SubtitleSourceChange) => {
      if (change.type === 'cuechange') {
        source.dispose();
      }
    });
    const laterListener = vi.fn();

    try {
      source.subscribe(firstListener);
      source.subscribe(laterListener);
      source.bind(pair);

      // bound では破棄せず、cuechange の通知途中で dispose する。
      expect(firstListener).toHaveBeenCalledWith({ type: 'bound' });
      expect(laterListener).toHaveBeenCalledWith({ type: 'bound' });
      firstListener.mockClear();
      laterListener.mockClear();

      expect(() => ja.fireCueChange()).not.toThrow();

      expect(firstListener.mock.calls).toEqual([
        [{ type: 'cuechange', role: 'primary' }],
      ]);
      expect(laterListener).not.toHaveBeenCalled();
      expect(ja.listenerCount()).toBe(0);
      expect(en.listenerCount()).toBe(0);
      expect(source.getSnapshot()).toEqual({
        pair: { primary: null, secondary: null },
        primaryCues: [],
        secondaryCues: [],
      });

      firstListener.mockClear();
      en.fireCueChange();

      expect(firstListener).not.toHaveBeenCalled();
      expect(laterListener).not.toHaveBeenCalled();
    } finally {
      source.dispose();
    }
  });
});
