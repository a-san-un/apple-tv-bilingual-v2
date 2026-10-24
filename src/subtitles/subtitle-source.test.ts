/**
 * subtitle-source の small integration test。
 * listener 所有・通知・コピー保護と、登録・読取・解除失敗時の境界を確認する。
 * 実際の TextTrack の代わりに、listener 数を観測できる test double を使う。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSubtitleSource, type SubtitleSourceVideo } from './subtitle-source';
import { resolveTrackPair } from './text-track-resolver';
import type { Logger } from '../shared/log';
import type { ResolvedTrackPair, SubtitleSourceChange } from '../shared/types';

/** test double の cue。VTTCue と同じく text を持つ。 */
type FakeCue = { startTime: number; endTime: number; text: string };

/** TextTrack として渡しつつ、listener 数の観測と cuechange 発火ができる test double。 */
type FakeTrack = TextTrack & {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  fireCueChange(): void;
  listenerCount(): number;
};

/**
 * cuechange listener の登録・解除を数えられる TextTrack 相当を作る。
 *
 * @param language track の言語。
 * @param cues track.cues として返す cue。null なら未読込を表す。
 * @returns 観測用メソッド付きの test double。
 */
const createFakeTrack = (language: string, cues: FakeCue[] | null = []): FakeTrack => {
  const handlers = new Set<EventListener>();

  const track = {
    id: '',
    language,
    label: language,
    kind: 'subtitles',
    mode: 'hidden' as TextTrackMode,
    cues,
    activeCues: null,
    addEventListener: vi.fn((type: string, handler: EventListener) => {
      if (type === 'cuechange') {
        handlers.add(handler);
      }
    }),
    removeEventListener: vi.fn((type: string, handler: EventListener) => {
      if (type === 'cuechange') {
        handlers.delete(handler);
      }
    }),
    fireCueChange() {
      handlers.forEach((handler) => handler(new Event('cuechange')));
    },
    listenerCount() {
      return handlers.size;
    },
  };

  return track as unknown as FakeTrack;
};

/**
 * 出力を持たない logger を作る。エラー境界で log が呼ばれたかだけを確認する。
 *
 * @returns すべての method が spy の logger。
 */
const createSilentLogger = (): Logger & { error: ReturnType<typeof vi.fn> } => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

/**
 * readiness 通過後の video を想定した test fixture を作る。
 *
 * @returns ja / en / ko の track を持つ video と、ja primary・en secondary の採用結果。
 */
const createFixture = () => {
  const ja = createFakeTrack('ja', [{ startTime: 1, endTime: 2, text: 'こんにちは' }]);
  const en = createFakeTrack('en', [{ startTime: 1, endTime: 2, text: 'Hello' }]);
  const ko = createFakeTrack('ko');
  const video: SubtitleSourceVideo = { textTracks: [ja, en, ko] };
  const pair = resolveTrackPair({
    textTracks: video.textTracks,
    primaryLang: 'ja',
    secondaryLang: 'en',
  });
  const logger = createSilentLogger();
  const source = createSubtitleSource(video, { logger });

  return { ja, en, ko, video, pair, logger, source };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('createSubtitleSource', () => {
  it('ready な video の採用 track に bind し、必要な listener だけを登録する', () => {
    const { ja, en, ko, pair, source } = createFixture();
    const changes: SubtitleSourceChange[] = [];
    source.subscribe((change) => changes.push(change));

    source.bind(pair);

    expect(ja.addEventListener).toHaveBeenCalledTimes(1);
    expect(ja.addEventListener).toHaveBeenCalledWith('cuechange', expect.any(Function));
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
      { startTime: 1, endTime: 2, text: 'こんにちは', track: pair.primary },
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
      resolveTrackPair({ textTracks: video.textTracks, primaryLang: 'ja', secondaryLang: 'en' }),
    );

    source.bind(
      resolveTrackPair({ textTracks: video.textTracks, primaryLang: 'ko', secondaryLang: 'en' }),
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
    expect(source.getSnapshot().pair).toEqual({ primary: null, secondary: null });
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
    const source = createSubtitleSource({ textTracks: [] }, { logger: createSilentLogger() });

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

  it('購読者の例外は他の購読者と track 側の dispatch を止めない', () => {
    const { ja, pair, logger, source } = createFixture();
    const failing = vi.fn(() => {
      throw new Error('listener failed');
    });
    const healthy = vi.fn();
    source.subscribe(failing);
    source.subscribe(healthy);
    source.bind(pair);
    healthy.mockClear();

    expect(() => ja.fireCueChange()).not.toThrow();

    expect(healthy).toHaveBeenCalledWith({ type: 'cuechange', role: 'primary' });
    expect(logger.error).toHaveBeenCalled();
  });

  it('listener 登録の途中で失敗したら、付けた分を外して未 bind に戻す', () => {
    const { ja, en, pair, logger, source } = createFixture();
    en.addEventListener.mockImplementation(() => {
      throw new Error('add failed');
    });

    expect(() => source.bind(pair)).not.toThrow();

    expect(ja.addEventListener).toHaveBeenCalledTimes(1);
    expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
    expect(ja.listenerCount()).toBe(0);
    expect(source.getSnapshot().pair).toEqual({ primary: null, secondary: null });
    expect(logger.error).toHaveBeenCalled();
  });

  it('cue の読取に失敗しても snapshot は空配列で返す', () => {
    const { ja, pair, logger, source } = createFixture();
    Object.defineProperty(ja, 'cues', {
      get() {
        throw new Error('cues unavailable');
      },
    });
    source.bind(pair);

    const snapshot = source.getSnapshot();

    expect(snapshot.primaryCues).toEqual([]);
    expect(snapshot.secondaryCues.map((cue) => cue.text)).toEqual(['Hello']);
    expect(logger.error).toHaveBeenCalled();
  });

  // 管理情報は source の内外で分離し、実際の TextTrack だけを共有する境界を固定する。
  it('snapshot の pair を書き換えても内部の採用結果と listener は変わらない', () => {
    const { ja, en, pair, source } = createFixture();
    source.bind(pair);

    const snapshot = source.getSnapshot();
    snapshot.pair.primary = null;
    snapshot.pair.secondary = null;

    const nextSnapshot = source.getSnapshot();
    expect(nextSnapshot.pair).toEqual(pair);
    expect(ja.listenerCount()).toBe(1);
    expect(en.listenerCount()).toBe(1);

    // snapshot の変更で内部 pair が壊れると、同じ pair でも再登録されてしまう。
    source.bind(pair);
    expect(ja.addEventListener).toHaveBeenCalledTimes(1);
    expect(en.addEventListener).toHaveBeenCalledTimes(1);

    source.dispose();
  });

  it('snapshot の track 管理情報を書き換えても内部と次の snapshot は変わらない', () => {
    const { pair, source } = createFixture();
    source.bind(pair);

    const snapshot = source.getSnapshot();
    const primary = snapshot.pair.primary;
    const secondary = snapshot.pair.secondary;

    if (primary === null || secondary === null) {
      throw new Error('fixture must resolve both subtitle tracks');
    }

    primary.language = 'changed-primary';
    primary.label = '変更した学習言語';
    primary.mode = 'disabled';
    secondary.language = 'changed-secondary';
    secondary.label = '変更した母国語';
    secondary.mode = 'disabled';

    const nextSnapshot = source.getSnapshot();
    expect(nextSnapshot.pair).toEqual(pair);
    expect(nextSnapshot.pair).not.toBe(snapshot.pair);
    expect(nextSnapshot.pair.primary).not.toBe(primary);
    expect(nextSnapshot.pair.secondary).not.toBe(secondary);
    expect(pair.primary?.language).toBe('ja');
    expect(pair.secondary?.language).toBe('en');

    source.dispose();
  });

  it('snapshot の cue と cue 側の track 情報を書き換えても内部へ伝わらない', () => {
    const { pair, source } = createFixture();
    source.bind(pair);

    const snapshot = source.getSnapshot();
    const primaryCue = snapshot.primaryCues[0];
    const secondaryCue = snapshot.secondaryCues[0];

    if (
      primaryCue === undefined ||
      secondaryCue === undefined ||
      primaryCue.track === null ||
      secondaryCue.track === null
    ) {
      throw new Error('fixture must provide cues with track information');
    }

    // cue 側も内部情報ではなく、その snapshot 用の track 情報を参照する。
    expect(primaryCue.track).toBe(snapshot.pair.primary);
    expect(secondaryCue.track).toBe(snapshot.pair.secondary);

    primaryCue.text = '変更した字幕';
    primaryCue.startTime = 100;
    primaryCue.endTime = 101;
    primaryCue.track.label = '変更したprimaryラベル';
    secondaryCue.track.label = '変更したsecondaryラベル';
    snapshot.secondaryCues.length = 0;

    const nextSnapshot = source.getSnapshot();
    expect(nextSnapshot.primaryCues).toEqual([
      { startTime: 1, endTime: 2, text: 'こんにちは', track: pair.primary },
    ]);
    expect(nextSnapshot.secondaryCues).toEqual([
      { startTime: 1, endTime: 2, text: 'Hello', track: pair.secondary },
    ]);

    source.dispose();
  });

  it('bind 元の pair と track 管理情報を書き換えても内部へ伝わらない', () => {
    const { ja, en, ko, pair, source } = createFixture();
    const primary = pair.primary;
    const secondary = pair.secondary;

    if (primary === null || secondary === null) {
      throw new Error('fixture must resolve both subtitle tracks');
    }

    source.bind(pair);

    // 呼び出し元が持つ情報を変更しても、source は bind 時の写しを維持する。
    primary.language = 'changed-primary';
    primary.label = '変更したprimaryラベル';
    primary.track = ko;
    secondary.language = 'changed-secondary';
    secondary.label = '変更したsecondaryラベル';
    secondary.track = ko;
    pair.primary = null;
    pair.secondary = null;

    const snapshot = source.getSnapshot();
    expect(snapshot.pair.primary).toMatchObject({
      language: 'ja',
      label: 'ja',
      track: ja,
    });
    expect(snapshot.pair.secondary).toMatchObject({
      language: 'en',
      label: 'en',
      track: en,
    });
    expect(snapshot.primaryCues.map((cue) => cue.text)).toEqual(['こんにちは']);
    expect(snapshot.secondaryCues.map((cue) => cue.text)).toEqual(['Hello']);
    expect(ko.addEventListener).not.toHaveBeenCalled();

    source.dispose();
    expect(ja.listenerCount()).toBe(0);
    expect(en.listenerCount()).toBe(0);
  });

  it('未 bind の snapshot を書き換えても自分と別 source の未 bind 状態は変わらない', () => {
    const first = createFixture();
    const second = createFixture();

    // EMPTY_PAIR が外へ漏れていると、別 source の未 bind 状態まで変更される。
    // 失敗時も共有オブジェクトを元へ戻し、後続テストへの影響を避ける。
    const snapshot = first.source.getSnapshot();
    const originalPrimary = snapshot.pair.primary;
    const originalSecondary = snapshot.pair.secondary;

    try {
      snapshot.pair.primary = first.pair.primary;
      snapshot.pair.secondary = first.pair.secondary;

      const emptySnapshot = {
        pair: { primary: null, secondary: null },
        primaryCues: [],
        secondaryCues: [],
      };

      expect(first.source.getSnapshot()).toEqual(emptySnapshot);
      expect(second.source.getSnapshot()).toEqual(emptySnapshot);
    } finally {
      snapshot.pair.primary = originalPrimary;
      snapshot.pair.secondary = originalSecondary;
      first.source.dispose();
      second.source.dispose();
    }
  });

  it('管理情報をコピーしても実際の TextTrack は同一で通知と cleanup が機能する', () => {
    const { ja, en, pair, source } = createFixture();
    const listener = vi.fn();
    source.subscribe(listener);
    source.bind(pair);

    const first = source.getSnapshot();
    const second = source.getSnapshot();

    expect(first.pair.primary).not.toBe(pair.primary);
    expect(first.pair.secondary).not.toBe(pair.secondary);
    expect(first.pair.primary).not.toBe(second.pair.primary);
    expect(first.pair.secondary).not.toBe(second.pair.secondary);

    // コピーするのは管理情報だけで、listener の対象となる TextTrack は変えない。
    expect(first.pair.primary?.track).toBe(ja);
    expect(first.pair.secondary?.track).toBe(en);
    expect(second.pair.primary?.track).toBe(ja);
    expect(second.pair.secondary?.track).toBe(en);
    expect(first.primaryCues[0]?.track?.track).toBe(ja);
    expect(first.secondaryCues[0]?.track?.track).toBe(en);

    listener.mockClear();
    ja.fireCueChange();
    en.fireCueChange();

    expect(listener.mock.calls).toEqual([
      [{ type: 'cuechange', role: 'primary' }],
      [{ type: 'cuechange', role: 'secondary' }],
    ]);

    source.unbind();
    source.dispose();
    source.dispose();

    expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
    expect(en.removeEventListener).toHaveBeenCalledTimes(1);
    expect(ja.listenerCount()).toBe(0);
    expect(en.listenerCount()).toBe(0);
  });

  // 解除自体が失敗した resource の消失は保証せず、残りの解除と後処理の継続を確認する。
  it('一方の解除が失敗しても他方を解除し、unbind から例外を漏らさない', () => {
    const { ja, en, pair, logger, source } = createFixture();
    const listener = vi.fn();
    source.subscribe(listener);
    source.bind(pair);
    listener.mockClear();

    en.removeEventListener.mockImplementation(() => {
      throw new Error('secondary cleanup failed');
    });

    expect(() => source.unbind()).not.toThrow();

    // 逆順で先に解除する secondary が失敗しても、primary の解除は実行する。
    expect(en.removeEventListener).toHaveBeenCalledTimes(1);
    expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
    expect(en.listenerCount()).toBe(1);
    expect(ja.listenerCount()).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      'subtitle source unbind failed',
      { error: expect.any(AggregateError) },
    );
    expect(listener.mock.calls).toEqual([[{ type: 'unbound' }]]);
    expect(source.getSnapshot()).toEqual({
      pair: { primary: null, secondary: null },
      primaryCues: [],
      secondaryCues: [],
    });

    listener.mockClear();

    expect(() => source.dispose()).not.toThrow();

    // 解除に失敗した listener が残っていても、dispose 後は購読者へ通知しない。
    en.fireCueChange();
    expect(listener).not.toHaveBeenCalled();
    expect(en.removeEventListener).toHaveBeenCalledTimes(1);
    expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('登録失敗後の解除も失敗した場合に bind から例外を漏らさない', () => {
    const { ja, en, pair, logger, source } = createFixture();
    const listener = vi.fn();
    source.subscribe(listener);

    en.addEventListener.mockImplementation(() => {
      throw new Error('secondary registration failed');
    });
    ja.removeEventListener.mockImplementation(() => {
      throw new Error('primary rollback failed');
    });

    expect(() => source.bind(pair)).not.toThrow();

    expect(ja.addEventListener).toHaveBeenCalledTimes(1);
    expect(en.addEventListener).toHaveBeenCalledTimes(1);
    expect(ja.removeEventListener).toHaveBeenCalledTimes(1);

    // 登録の失敗と、その後の解除の失敗を区別して記録する。
    expect(logger.error).toHaveBeenCalledWith(
      'subtitle source bind rollback failed',
      { cleanupError: expect.any(AggregateError) },
    );
    expect(logger.error).toHaveBeenCalledWith(
      'subtitle source bind failed',
      { error: expect.any(Error) },
    );
    expect(listener).not.toHaveBeenCalled();
    expect(source.getSnapshot()).toEqual({
      pair: { primary: null, secondary: null },
      primaryCues: [],
      secondaryCues: [],
    });

    expect(() => source.dispose()).not.toThrow();
    ja.fireCueChange();

    expect(listener).not.toHaveBeenCalled();
    expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
  });

  // S1: 実際の解除に失敗しても、旧 binding からの通知は無効化する。
  it('解除に失敗した旧 listener は unbind 後に通知しない', () => {
    const { en, pair, source } = createFixture();
    const listener = vi.fn();

    try {
      source.subscribe(listener);
      source.bind(pair);

      en.removeEventListener.mockImplementation(() => {
        throw new Error('secondary cleanup failed');
      });

      expect(() => source.unbind()).not.toThrow();

      // listener 自体は残るため、通知の無効化を独立して確認する。
      expect(en.listenerCount()).toBe(1);
      expect(listener.mock.calls).toEqual([
        [{ type: 'bound' }],
        [{ type: 'unbound' }],
      ]);
      expect(source.getSnapshot().pair).toEqual({
        primary: null,
        secondary: null,
      });
      listener.mockClear();

      expect(() => en.fireCueChange()).not.toThrow();

      expect(listener).not.toHaveBeenCalled();
    } finally {
      source.dispose();
    }
  });

  // S2: 新 binding に含まれない旧 track のイベントを遮断する。
  it('別 pair への再 bind 後は解除に失敗した旧 track から通知しない', () => {
    const { ja, en, ko, video, pair, source } = createFixture();
    const listener = vi.fn();
    const nextPair = resolveTrackPair({
      textTracks: video.textTracks,
      primaryLang: 'ko',
      secondaryLang: 'en',
    });

    try {
      source.subscribe(listener);
      source.bind(pair);

      ja.removeEventListener.mockImplementation(() => {
        throw new Error('old primary cleanup failed');
      });

      expect(() => source.bind(nextPair)).not.toThrow();

      expect(ja.listenerCount()).toBe(1);
      expect(ko.listenerCount()).toBe(1);
      expect(en.listenerCount()).toBe(1);
      expect(source.getSnapshot().pair).toEqual(nextPair);
      listener.mockClear();

      expect(() => ja.fireCueChange()).not.toThrow();

      expect(listener).not.toHaveBeenCalled();

      // 旧イベントを遮断しても、新 binding の両役割は通知を継続する。
      ko.fireCueChange();
      en.fireCueChange();

      expect(listener.mock.calls).toEqual([
        [{ type: 'cuechange', role: 'primary' }],
        [{ type: 'cuechange', role: 'secondary' }],
      ]);
    } finally {
      source.dispose();
    }
  });

  // S3: 同じ track の旧 listener が残っても、新 binding の通知だけを通す。
  it('同じ track を含む再 bind 後に旧 listener が残っても通知を重複させない', () => {
    const { ja, en, video, pair, source } = createFixture();
    const listener = vi.fn();
    const nextPair = resolveTrackPair({
      textTracks: video.textTracks,
      primaryLang: 'en',
      secondaryLang: 'ja',
    });

    try {
      source.subscribe(listener);
      source.bind(pair);

      en.removeEventListener.mockImplementation(() => {
        throw new Error('old secondary cleanup failed');
      });

      // en の役割を secondary から primary へ変え、旧通知との区別も確認する。
      expect(() => source.bind(nextPair)).not.toThrow();

      expect(en.addEventListener).toHaveBeenCalledTimes(2);
      expect(en.listenerCount()).toBe(2);
      expect(ja.listenerCount()).toBe(1);
      expect(source.getSnapshot().pair).toEqual(nextPair);
      listener.mockClear();

      expect(() => en.fireCueChange()).not.toThrow();

      // 残った secondary listener ではなく、現在の primary として一度だけ通知する。
      expect(listener.mock.calls).toEqual([
        [{ type: 'cuechange', role: 'primary' }],
      ]);

      listener.mockClear();
      ja.fireCueChange();

      expect(listener.mock.calls).toEqual([
        [{ type: 'cuechange', role: 'secondary' }],
      ]);
    } finally {
      source.dispose();
    }
  });

  // S4: 通知開始後でも dispose された時点で、後続購読者への通知を止める。
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

      // bound の通知では破棄せず、cuechange の通知途中で dispose する。
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
