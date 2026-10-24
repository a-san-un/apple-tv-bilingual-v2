/**
 * debug / observe 用ログの共通窓口。
 * readiness / restart / cleanup の追跡に使う最小 API だけを置き、多機能な logger にはしない。
 */

/** ログのまとまりを識別する最小 category。 */
export type LogCategory = 'readiness' | 'restart' | 'cleanup' | 'subtitle' | 'general';

/** ログ出力時に付与する任意の補助情報。 */
export type LogMeta = Record<string, unknown>;

/** ログ窓口が公開する最小 API。 */
export type Logger = {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
};

/**
 * category と prefix を含む最小 logger を作る。
 *
 * @param category 出力を分類する category。readiness / restart / cleanup の追跡に使う。
 * @param prefix ログ先頭に付ける識別子。省略時は `atv-bilingual` を使う。
 * @returns 同じ出力形式で `debug` / `info` / `warn` / `error` を呼べる logger。
 */
export const createLogger = (
  category: LogCategory,
  prefix = 'atv-bilingual',
): Logger => {
  const tag = `[${prefix}:${category}]`;

  const write = (
    method: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    meta?: LogMeta,
  ): void => {
    // meta が無いときは message だけを出し、呼び出し側の負担を増やさない。
    if (meta === undefined) {
      console[method](tag, message);
      return;
    }

    console[method](tag, message, meta);
  };

  return {
    debug(message, meta) {
      write('debug', message, meta);
    },
    info(message, meta) {
      write('info', message, meta);
    },
    warn(message, meta) {
      write('warn', message, meta);
    },
    error(message, meta) {
      write('error', message, meta);
    },
  };
};

/**
 * readiness 待機の追跡用 logger を作る。
 *
 * @param prefix ログ先頭に付ける識別子。省略時は `atv-bilingual` を使う。
 * @returns readiness category に固定された logger。
 */
export const createReadinessLogger = (prefix?: string): Logger =>
  createLogger('readiness', prefix);

/**
 * restart 理由の追跡用 logger を作る。
 *
 * @param prefix ログ先頭に付ける識別子。省略時は `atv-bilingual` を使う。
 * @returns restart category に固定された logger。
 */
export const createRestartLogger = (prefix?: string): Logger =>
  createLogger('restart', prefix);

/**
 * cleanup 順序や dispose の追跡用 logger を作る。
 *
 * @param prefix ログ先頭に付ける識別子。省略時は `atv-bilingual` を使う。
 * @returns cleanup category に固定された logger。
 */
export const createCleanupLogger = (prefix?: string): Logger =>
  createLogger('cleanup', prefix);

/**
 * 採用 track、bind / unbind、source 内エラーの追跡用 logger を作る。
 *
 * @param prefix ログ先頭に付ける識別子。省略時は `atv-bilingual` を使う。
 * @returns subtitle category に固定された logger。
 */
export const createSubtitleLogger = (prefix?: string): Logger =>
  createLogger('subtitle', prefix);
