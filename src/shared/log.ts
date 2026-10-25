/**
 * debug / observe 用ログの共通窓口。
 * readiness / restart / cleanup の追跡に使う最小 API だけを置き、多機能な logger にはしない。
 */

/** ログのまとまりを識別する最小 category。 */
export type LogCategory = 'readiness' | 'restart' | 'cleanup' | 'subtitle' | 'general';

/** ログ出力時に付与する任意の補助情報。 */
export type LogMeta = Record<string, unknown>;

/** 重要度の低い順に並ぶログ出力レベル。 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 開発用の既定出力レベル。変更後は再 build・拡張とページの再読み込みが必要。 */
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/** 出力レベルを比較するための重要度。 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** ログ窓口が公開する最小 API。 */
export type Logger = {
  /**
   * ログ引数を生成する前に出力可否を確認する。
   *
   * @param level 確認する出力レベル。
   * @returns 最低レベル以上なら true。未実装の差し替え logger では呼び出し側が従来動作を維持する。
   */
  isEnabled?(level: LogLevel): boolean;
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
 * @param minLevel 出力する最低レベル。省略時は DEFAULT_LOG_LEVEL。生成時に固定する。
 * @returns 指定レベル以上を同じ形式で出力する logger。抑制は Console 出力だけに適用する。
 */
export const createLogger = (
  category: LogCategory,
  prefix = 'atv-bilingual',
  minLevel: LogLevel = DEFAULT_LOG_LEVEL,
): Logger => {
  const tag = `[${prefix}:${category}]`;

  /**
   * 生成時に指定された最低レベルと比較する。
   *
   * @param level 確認する出力レベル。
   * @returns 最低レベル以上なら true。Console 側の表示フィルターは判定しない。
   */
  const isEnabled = (level: LogLevel): boolean =>
    LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];

  /**
   * 最低レベル以上のログだけを Console へ出力する。
   *
   * @param method 出力レベルと対応する Console method。
   * @param message 出力するメッセージ。
   * @param meta 任意の補助情報。省略時は Console の第3引数を渡さない。
   */
  const write = (
    method: LogLevel,
    message: string,
    meta?: LogMeta,
  ): void => {
    if (!isEnabled(method)) {
      return;
    }

    // meta が無いときは message だけを出し、呼び出し側の負担を増やさない。
    if (meta === undefined) {
      console[method](tag, message);
      return;
    }

    console[method](tag, message, meta);
  };

  return {
    isEnabled,
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
