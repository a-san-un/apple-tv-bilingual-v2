/**
 * log.test.ts
 *
 * 共通 logger の最低出力レベル、category / prefix、補助情報の受渡しを検証する。
 * Console の各 method をテストごとに差し替え、終了時に元へ戻す。
 * 字幕取得、DOM、Chrome Storage、ブラウザの表示フィルターは対象外とする。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createCleanupLogger,
  createLogger,
  createReadinessLogger,
  createRestartLogger,
  createSubtitleLogger,
  DEFAULT_LOG_LEVEL,
} from './log';

/** logger と Console が共有する出力レベルの一覧。 */
const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

beforeEach(() => {
  for (const level of LEVELS) {
    vi.spyOn(console, level).mockImplementation(() => undefined);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger の出力レベル', () => {
  it.each([
    { minLevel: 'debug', visible: ['debug', 'info', 'warn', 'error'] },
    { minLevel: 'info', visible: ['info', 'warn', 'error'] },
    { minLevel: 'warn', visible: ['warn', 'error'] },
    { minLevel: 'error', visible: ['error'] },
  ] as const)(
    '最低レベル $minLevel 以上だけを出力する',
    ({ minLevel, visible }) => {
      const logger = createLogger('subtitle', 'test', minLevel);
      const meta = { role: 'primary' };
      const visibleLevels = new Set<string>(visible);

      for (const level of LEVELS) {
        expect(logger.isEnabled?.(level)).toBe(visibleLevels.has(level));
        logger[level]('message', meta);
      }

      for (const level of LEVELS) {
        if (visibleLevels.has(level)) {
          expect(console[level]).toHaveBeenCalledTimes(1);
          expect(console[level]).toHaveBeenCalledWith(
            '[test:subtitle]',
            'message',
            meta,
          );
        } else {
          expect(console[level]).not.toHaveBeenCalled();
        }
      }
    },
  );

  it('既定値 info では debug を抑制し、状態ログ・警告・エラーを残す', () => {
    expect(DEFAULT_LOG_LEVEL).toBe('info');
    const logger = createLogger('general');

    logger.debug('detail');
    logger.info('state');
    logger.warn('warning');
    logger.error('failure');

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith('[atv-bilingual:general]', 'state');
    expect(console.warn).toHaveBeenCalledWith('[atv-bilingual:general]', 'warning');
    expect(console.error).toHaveBeenCalledWith('[atv-bilingual:general]', 'failure');
  });

  it('出力可否を確認するだけでは Console に出力しない', () => {
    const logger = createLogger('subtitle');

    expect(logger.isEnabled?.('debug')).toBe(false);
    expect(logger.isEnabled?.('info')).toBe(true);
    expect(logger.isEnabled?.('warn')).toBe(true);
    expect(logger.isEnabled?.('error')).toBe(true);

    for (const level of LEVELS) {
      expect(console[level]).not.toHaveBeenCalled();
    }
  });

  it('meta 省略時は余分な undefined 引数を出力しない', () => {
    const logger = createLogger('general', 'test', 'debug');

    logger.debug('without meta');

    expect(console.debug).toHaveBeenCalledTimes(1);
    expect(console.debug).toHaveBeenCalledWith('[test:general]', 'without meta');
  });

  it('meta の内容や参照を変更せずに渡す', () => {
    const logger = createLogger('subtitle');
    const meta = { cueCount: 2 };

    logger.info('snapshot summary', meta);

    expect(vi.mocked(console.info).mock.calls[0]?.[2]).toBe(meta);
    expect(meta).toEqual({ cueCount: 2 });
  });

  it('logger ごとの最低レベルが他の logger に影響しない', () => {
    const detailed = createLogger('subtitle', 'detail', 'debug');
    const quiet = createLogger('subtitle', 'quiet', 'warn');

    detailed.debug('visible');
    quiet.debug('suppressed');
    quiet.warn('warning');

    expect(console.debug).toHaveBeenCalledTimes(1);
    expect(console.debug).toHaveBeenCalledWith('[detail:subtitle]', 'visible');
    expect(console.warn).toHaveBeenCalledWith('[quiet:subtitle]', 'warning');
  });
});

describe('category 専用 logger', () => {
  it.each([
    ['readiness', createReadinessLogger],
    ['restart', createRestartLogger],
    ['cleanup', createCleanupLogger],
    ['subtitle', createSubtitleLogger],
  ] as const)(
    '%s の category と指定 prefix を維持し、既定レベルを適用する',
    (category, create) => {
      const logger = create('custom');

      expect(logger.isEnabled?.('debug')).toBe(false);
      expect(logger.isEnabled?.('info')).toBe(true);
      logger.debug('detail');
      logger.info('state');

      expect(console.debug).not.toHaveBeenCalled();
      expect(console.info).toHaveBeenCalledTimes(1);
      expect(console.info).toHaveBeenCalledWith(`[custom:${category}]`, 'state');
    },
  );
});
