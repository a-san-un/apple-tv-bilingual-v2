/**
 * chrome.storage.sync に保存する言語設定の読込・保存・正規化をまとめる。
 * popup / content は storage の詳細を持たず、この module が返す結果だけで分岐する。
 */

import type { ExtensionSettings, LanguageCode, StoredSettings } from '../shared/types';

const STORAGE_KEY_PRIMARY_LANG = 'primaryLang';
const STORAGE_KEY_SECONDARY_LANG = 'secondaryLang';

const SUPPORTED_LANGUAGE_CODES = [
  'ar',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'en-AU',
  'en-CA',
  'en-GB',
  'en-US',
  'es',
  'es-419',
  'es-ES',
  'fi',
  'fr',
  'fr-CA',
  'hi',
  'hu',
  'id',
  'it',
  'ja',
  'ko',
  'ms',
  'nl',
  'no',
  'pl',
  'pt',
  'pt-BR',
  'pt-PT',
  'ro',
  'sk',
  'sv',
  'th',
  'tr',
  'uk',
  'vi',
  'yue',
  'zh',
  'zh-Hans',
  'zh-Hant'
] as const satisfies readonly LanguageCode[];

const SUPPORTED_LANGUAGE_CODE_SET = new Set<LanguageCode>(SUPPORTED_LANGUAGE_CODES);

/** storage 読込・書込失敗を呼び出し元へ伝える最小原因コード。 */
export type SettingsStoreErrorCause = 'storage-read-failed' | 'storage-write-failed';

/**
 * content 側が次の処理へ進める正規化済み設定。
 * `secondaryLang: null` は未選択を表し、実行時 fallback は content 側で解決する。
 */
export type ReadySettings = {
  primaryLang: LanguageCode;
  secondaryLang: LanguageCode | null;
};

/**
 * 設定読込結果。
 * `ready` は track 解決へ進める状態、`incomplete` は primaryLang 未完了、
 * `error` は storage 読込失敗で安全側停止すべき状態を表す。
 */
export type SettingsLoadResult =
  | {
      status: 'ready';
      settings: ReadySettings;
    }
  | {
      status: 'incomplete';
      settings: ExtensionSettings;
    }
  | {
      status: 'error';
      cause: 'storage-read-failed';
    };

/**
 * 設定保存結果。
 * `ready` は正規化済み設定を保存済み、`incomplete` は primaryLang 未完了で保存拒否、
 * `error` は storage 書込失敗を表す。
 */
export type SettingsSaveResult =
  | {
      status: 'ready';
      settings: ReadySettings;
    }
  | {
      status: 'incomplete';
      settings: ExtensionSettings;
    }
  | {
      status: 'error';
      cause: 'storage-write-failed';
    };

/**
 * `chrome.storage.sync` と同形で注入できる最小 storage API。
 * test ではこの型を満たす fake storage を渡して挙動を固定する。
 */
export type StorageAreaLike = {
  get(
    keys: string[] | Record<string, unknown> | null,
    callback: (items: Record<string, unknown>) => void
  ): void;
  set(items: Record<string, unknown>, callback?: () => void): void;
};

/**
 * popup 候補一覧と validation に使う対応言語コード一覧を返す。
 *
 * @returns 順序固定の対応言語コード一覧。
 */
export function getSupportedLanguageCodes(): readonly LanguageCode[] {
  return SUPPORTED_LANGUAGE_CODES;
}

/**
 * 値が保存可能な言語コードかを判定する。
 *
 * @param value 判定対象の値。
 * @returns 対応一覧に含まれる言語コードなら true。
 */
export function isSupportedLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && SUPPORTED_LANGUAGE_CODE_SET.has(value);
}

/**
 * storage 値や保存要求値を、未完了を含みうる設定 shape に正規化する。
 * primary の不正値は null に落とし、secondary の不正値・空文字・同値は禁止して null に吸収する。
 *
 * @param input storage 値または保存要求値。null / undefined を含んでよい。
 * @returns `primaryLang` と `secondaryLang` を仕様どおりに寄せた設定。
 */
export function normalizeStoredSettings(input: Partial<StoredSettings> | null | undefined): ExtensionSettings {
  const primaryLang = normalizePrimaryLang(input?.primaryLang);
  const secondaryLang = normalizeSecondaryLang(input?.secondaryLang, primaryLang);

  return {
    primaryLang,
    secondaryLang
  };
}

/**
 * 正規化済み設定を ready / incomplete に分類する。
 *
 * @param settings `normalizeStoredSettings()` 通過後の設定。
 * @returns `primaryLang` が有効なら ready、未完了なら incomplete。
 */
export function classifySettings(settings: ExtensionSettings): SettingsLoadResult {
  const readySettings = toReadySettings(settings);

  if (!readySettings) {
    return {
      status: 'incomplete',
      settings
    };
  }

  return {
    status: 'ready',
    settings: readySettings
  };
}

/**
 * storage から設定を読み、正規化と状態分類まで行う。
 * 読込失敗は例外として外へ投げず、error 結果に吸収して返す。
 *
 * @param storageArea 読み出し先。省略時は chrome.storage.sync を使う。
 * @returns 正常時は ready / incomplete、storage 読込失敗時は error。
 */
export async function loadSettings(storageArea: StorageAreaLike = getChromeStorageSync()): Promise<SettingsLoadResult> {
  try {
    const stored = await readStoredSettings(storageArea);
    return classifySettings(normalizeStoredSettings(stored));
  } catch {
    return {
      status: 'error',
      cause: 'storage-read-failed'
    };
  }
}

/**
 * 保存要求値を正規化してから storage へ保存する。
 * primaryLang が未完了の値は保存せず、書込失敗も例外ではなく結果値で返す。
 *
 * @param input popup などから渡される保存要求値。
 * @param storageArea 書き込み先。省略時は chrome.storage.sync を使う。
 * @returns 保存成功時は ready、primaryLang 未完了時は incomplete、書込失敗時は error。
 */
export async function saveSettings(
  input: Partial<StoredSettings>,
  storageArea: StorageAreaLike = getChromeStorageSync()
): Promise<SettingsSaveResult> {
  const normalized = normalizeStoredSettings(input);
  const readySettings = toReadySettings(normalized);

  if (!readySettings) {
    return {
      status: 'incomplete',
      settings: normalized
    };
  }

  try {
    await writeStoredSettings(storageArea, readySettings);
    return {
      status: 'ready',
      settings: readySettings
    };
  } catch {
    return {
      status: 'error',
      cause: 'storage-write-failed'
    };
  }
}

/**
 * 実行可能な設定だけを ReadySettings に絞り込む。
 * primaryLang が欠けている場合は null を返し、呼び出し側で incomplete 判定に使う。
 *
 * @param settings 正規化済みだが未完了を含みうる設定。
 * @returns playback 開始に使える設定、または primaryLang 未完了を表す null。
 */
function toReadySettings(settings: ExtensionSettings): ReadySettings | null {
  if (settings.primaryLang === null) {
    return null;
  }

  return {
    primaryLang: settings.primaryLang,
    secondaryLang: settings.secondaryLang
  };
}

/**
 * primaryLang 値を検証し、有効な言語コードだけを残す。
 * 不正値や欠損は null を返して設定未完了として扱う。
 *
 * @param value storage や popup から来た primaryLang 値。
 * @returns 有効な言語コード、または未完了を表す null。
 */
function normalizePrimaryLang(value: unknown): LanguageCode | null {
  if (!isSupportedLanguageCode(value)) {
    return null;
  }

  return value;
}

/**
 * secondaryLang 値を検証し、未選択として扱うべき値を null に寄せる。
 * primaryLang 未完了時も secondary は未選択へ寄せ、同値禁止もここで吸収する。
 *
 * @param value storage や popup から来た secondaryLang 値。
 * @param primaryLang 先に正規化済みの primaryLang。未完了判定と secondary の同値禁止判定に使う。
 * @returns 有効な secondaryLang、または未選択を表す null。
 */
function normalizeSecondaryLang(
  value: unknown,
  primaryLang: LanguageCode | null
): LanguageCode | null {
  if (primaryLang === null) {
    return null;
  }

  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (!isSupportedLanguageCode(value)) {
    return null;
  }

  // secondary は primary と同値にできないため、保存不能値は null に落として未選択へ寄せる。
  if (value === primaryLang) {
    return null;
  }

  return value;
}

/**
 * storage から保存済みの raw 値だけを読み出す。
 * 正規化や validation は行わず、storageGet が reject した失敗だけをそのまま外へ返す。
 *
 * @param storageArea 読み出し先。chrome.storage.sync か test double を渡す。
 * @returns 保存済みキーだけを含む部分設定。キー欠落時はその項目を含めない。
 */
async function readStoredSettings(storageArea: StorageAreaLike): Promise<Partial<StoredSettings>> {
  const items = await storageGet(storageArea, [STORAGE_KEY_PRIMARY_LANG, STORAGE_KEY_SECONDARY_LANG]);
  const stored: Partial<StoredSettings> = {};

  if (STORAGE_KEY_PRIMARY_LANG in items) {
    stored.primaryLang = items[STORAGE_KEY_PRIMARY_LANG] as StoredSettings['primaryLang'];
  }

  if (STORAGE_KEY_SECONDARY_LANG in items) {
    stored.secondaryLang = items[STORAGE_KEY_SECONDARY_LANG] as StoredSettings['secondaryLang'];
  }

  return stored;
}

/**
 * 正規化済みの ready 設定だけを storage へ書き込む。
 * 完了は保存成功を意味し、失敗は storageSet の reject として呼び出し元へ返る。
 *
 * @param storageArea 書き込み先。chrome.storage.sync か test double を渡す。
 * @param settings 保存可能な状態まで正規化済みの設定。
 */
async function writeStoredSettings(storageArea: StorageAreaLike, settings: ReadySettings): Promise<void> {
  await storageSet(storageArea, {
    [STORAGE_KEY_PRIMARY_LANG]: settings.primaryLang,
    [STORAGE_KEY_SECONDARY_LANG]: settings.secondaryLang
  });
}

/**
 * callback 形式の storage.get を Promise 化する。
 * runtime.lastError と同期例外は throw ではなく reject にそろえて返す。
 *
 * @param storageArea 読み出し先。chrome.storage.sync か test double を渡す。
 * @param keys 読み出すキー。null の場合はすべてを対象にする。
 * @returns 取得できたキーと値の組。失敗時は Promise が reject される。
 */
function storageGet(
  storageArea: StorageAreaLike,
  keys: string[] | Record<string, unknown> | null
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    try {
      storageArea.get(keys, (items) => {
        // runtime.lastError は callback 内で読まないと、その呼び出し結果に対応する失敗を拾えない。
        const lastError = getChromeRuntime()?.lastError;
        if (lastError) {
          reject(lastError);
          return;
        }

        resolve(items);
      });
    } catch (error) {
      // storage 実装差や test double の同期例外も Promise reject にそろえて呼び出し側の分岐を単純化する。
      reject(error);
    }
  });
}

/**
 * callback 形式の storage.set を Promise 化する。
 * runtime.lastError と同期例外は throw ではなく reject にそろえて返す。
 *
 * @param storageArea 書き込み先。chrome.storage.sync か test double を渡す。
 * @param items 保存するキーと値の組。
 */
function storageSet(storageArea: StorageAreaLike, items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      storageArea.set(items, () => {
        // runtime.lastError は callback 内で読まないと、その呼び出し結果に対応する失敗を拾えない。
        const lastError = getChromeRuntime()?.lastError;
        if (lastError) {
          reject(lastError);
          return;
        }

        resolve();
      });
    } catch (error) {
      // storage 実装差や test double の同期例外も Promise reject にそろえて呼び出し側の分岐を単純化する。
      reject(error);
    }
  });
}

/** runtime.lastError を読むための最小 runtime 形状。 */
type ChromeRuntimeLike = {
  lastError?: { message?: string };
};

/** helper から参照する chrome グローバルの最小形状。 */
type ChromeGlobalLike = {
  runtime?: ChromeRuntimeLike;
  storage?: {
    sync?: StorageAreaLike;
  };
};

/**
 * 実行環境の globalThis から chrome 互換オブジェクトを安全に取り出す。
 * グローバル型が読めない tsconfig でも、この関数内の局所型に閉じ込めて扱う。
 *
 * @returns 利用可能な chrome 互換オブジェクト。存在しない環境では undefined。
 */
function getChromeGlobal(): ChromeGlobalLike | undefined {
  return (globalThis as typeof globalThis & { chrome?: ChromeGlobalLike }).chrome;
}

/**
 * 実行環境から runtime.lastError 参照用の runtime を安全に取得する。
 * chrome が無い環境では undefined を返し、呼び出し元が存在確認して使う前提とする。
 *
 * @returns runtime.lastError を参照できる runtime、または undefined。
 */
function getChromeRuntime(): ChromeRuntimeLike | undefined {
  return getChromeGlobal()?.runtime;
}

/**
 * 既定で使う chrome.storage.sync を取得する。
 * test では注入引数で置き換える想定で、未対応環境では例外を投げる。
 *
 * @returns 利用可能な chrome.storage.sync 互換 API。
 * @throws chrome.storage.sync が存在しない環境で既定引数解決を行った場合。
 */
function getChromeStorageSync(): StorageAreaLike {
  const storageArea = getChromeGlobal()?.storage?.sync;
  if (!storageArea) {
    throw new Error('chrome.storage.sync is not available');
  }

  return storageArea;
}
