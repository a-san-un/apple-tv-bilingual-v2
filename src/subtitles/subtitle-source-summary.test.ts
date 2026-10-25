/**
 * subtitle-source-summary.test.ts
 *
 * 要約取得の件数読取、コピー保護、未採用・読取失敗・破棄後の契約を確認する。
 * cue 要素の走査や本文コピーが不要なことを、読取りを拒否する一覧で検証する。
 * 既存の getSnapshot の本文取得・コピー保護は snapshot テストで維持する。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFixture } from './subtitle-source-test-helpers';

/** 未 bind / 破棄後の期待値。source 内部の object とは共有しない。 */
const EMPTY_SUMMARY = {
  pair: { primary: null, secondary: null },
  primaryCueCount: 0,
  secondaryCueCount: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('subtitle-source の getSummary', () => {
  it('未 bind では未採用・0件を返す', () => {
    const { source } = createFixture();
    try {
      expect(source.getSummary()).toEqual(EMPTY_SUMMARY);
    } finally {
      source.dispose();
    }
  });

  it('採用した両言語の件数を返し、cue 配列を含めない', () => {
    const { source, pair, ja, en } = createFixture();
    try {
      source.bind(pair);
      const summary = source.getSummary();

      expect(summary.primaryCueCount).toBe(1);
      expect(summary.secondaryCueCount).toBe(1);
      expect(summary.pair.primary?.track).toBe(ja);
      expect(summary.pair.secondary?.track).toBe(en);
      expect(Object.keys(summary).sort()).toEqual([
        'pair', 'primaryCueCount', 'secondaryCueCount',
      ]);
    } finally {
      source.dispose();
    }
  });

  it('cue 要素・iterator・activeCues を読まず、length だけで取得する', () => {
    const { source, pair, ja, logger } = createFixture();
    const forbiddenRead = vi.fn(() => {
      throw new Error('cue elements must not be read');
    });
    const cues = { length: 723 };
    Object.defineProperties(cues, {
      0: { get: forbiddenRead },
      [Symbol.iterator]: { get: forbiddenRead },
      item: { value: forbiddenRead },
    });
    Object.defineProperty(ja, 'cues', { value: cues });
    Object.defineProperty(ja, 'activeCues', { get: forbiddenRead });

    try {
      source.bind(pair);
      expect(source.getSummary()).toMatchObject({
        primaryCueCount: 723,
        secondaryCueCount: 1,
      });
      expect(forbiddenRead).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      source.dispose();
    }
  });

  it('イベントがなくても毎回の現在値を読み、過去の結果を書き換えない', () => {
    const { source, pair, ja } = createFixture();
    try {
      source.bind(pair);
      const first = source.getSummary();
      Object.defineProperty(ja, 'cues', {
        value: [
          { startTime: 1, endTime: 2, text: 'one' },
          { startTime: 2, endTime: 3, text: 'two' },
        ],
      });
      const second = source.getSummary();

      expect(first.primaryCueCount).toBe(1);
      expect(second.primaryCueCount).toBe(2);
      expect(second).not.toBe(first);
      expect(second.pair).not.toBe(first.pair);
      expect(second.pair.primary).not.toBe(first.pair.primary);
    } finally {
      source.dispose();
    }
  });

  it('返した管理情報の変更を内部へ伝えず、実 TextTrack 参照は維持する', () => {
    const { source, pair, ja } = createFixture();
    try {
      source.bind(pair);
      const summary = source.getSummary();
      const primary = summary.pair.primary;
      if (primary === null) {
        throw new Error('primary must be bound');
      }
      expect(primary).not.toBe(pair.primary);
      expect(primary.track).toBe(ja);
      primary.language = 'changed';
      primary.label = 'changed';
      summary.pair.primary = null;
      summary.primaryCueCount = 999;

      expect(source.getSummary()).toMatchObject({
        pair: { primary: { language: 'ja', label: 'ja', track: ja } },
        primaryCueCount: 1,
      });
      expect(source.getSnapshot().pair.primary?.language).toBe('ja');
    } finally {
      source.dispose();
    }
  });

  it.each(['null', 'empty'] as const)(
    'cues が %s でも採用情報を維持して0件を返す',
    (state) => {
      const { source, pair, ja } = createFixture();
      Object.defineProperty(ja, 'cues', {
        value: state === 'null' ? null : [],
      });
      try {
        source.bind(pair);
        const summary = source.getSummary();
        expect(summary.pair.primary?.track).toBe(ja);
        expect(summary.primaryCueCount).toBe(0);
        expect(summary.secondaryCueCount).toBe(1);
      } finally {
        source.dispose();
      }
    },
  );

  it.each(['primary', 'secondary'] as const)(
    '%s の cues 読取失敗は記録して0件にし、他方は取得する',
    (role) => {
      const { source, pair, ja, en, logger } = createFixture();
      const target = role === 'primary' ? ja : en;
      const error = new Error('cues unavailable');
      Object.defineProperty(target, 'cues', {
        get() { throw error; },
      });
      try {
        source.bind(pair);
        expect(source.getSummary()).toMatchObject({
          primaryCueCount: role === 'primary' ? 0 : 1,
          secondaryCueCount: role === 'secondary' ? 0 : 1,
        });
        expect(logger.error).toHaveBeenCalledWith(
          'subtitle source failed to read cue count',
          expect.objectContaining({ error }),
        );
      } finally {
        source.dispose();
      }
    },
  );

  it('length の読取失敗も記録して0件にする', () => {
    const { source, pair, ja, logger } = createFixture();
    Object.defineProperty(ja, 'cues', {
      value: { get length() { throw new Error('length unavailable'); } },
    });
    try {
      source.bind(pair);
      expect(source.getSummary()).toMatchObject({
        primaryCueCount: 0, secondaryCueCount: 1,
      });
      expect(logger.error).toHaveBeenCalledWith(
        'subtitle source failed to read cue count',
        expect.objectContaining({ error: expect.any(Error) }),
      );
    } finally {
      source.dispose();
    }
  });

  it.each(['unbind', 'dispose'] as const)(
    '%s 後は旧 track の cues を読まず、未採用・0件を返す',
    (operation) => {
      const { source, pair, ja, en } = createFixture();
      const forbiddenRead = vi.fn(() => {
        throw new Error('old track must not be read');
      });
      try {
        source.bind(pair);
        source[operation]();
        Object.defineProperty(ja, 'cues', { get: forbiddenRead });
        Object.defineProperty(en, 'cues', { get: forbiddenRead });

        expect(source.getSummary()).toEqual(EMPTY_SUMMARY);
        expect(forbiddenRead).not.toHaveBeenCalled();
        expect(ja.listenerCount()).toBe(0);
        expect(en.listenerCount()).toBe(0);
      } finally {
        source.dispose();
      }
    },
  );

  it('繰り返し取得しても listener・通知を増やさず mode を変えない', () => {
    const { source, pair, ja, en } = createFixture();
    const observe = vi.fn();
    const unsubscribe = source.subscribe(observe);
    try {
      source.bind(pair);
      observe.mockClear();
      for (let index = 0; index < 5; index += 1) {
        source.getSummary();
      }

      expect(ja.addEventListener).toHaveBeenCalledTimes(1);
      expect(en.addEventListener).toHaveBeenCalledTimes(1);
      expect(ja.removeEventListener).not.toHaveBeenCalled();
      expect(en.removeEventListener).not.toHaveBeenCalled();
      expect(observe).not.toHaveBeenCalled();
      expect(ja.mode).toBe('hidden');
      expect(en.mode).toBe('hidden');
    } finally {
      unsubscribe();
      source.dispose();
    }
  });
});
