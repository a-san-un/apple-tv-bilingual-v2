/**
 * settings-store の正規化・読込・保存結果を unit test で固定する。
 * Chrome 実環境に依存せず、fake storage を注入して ready / incomplete / error を確認する。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  classifySettings,
  getSupportedLanguageCodes,
  isSupportedLanguageCode,
  loadSettings,
  normalizeStoredSettings,
  saveSettings,
  type StorageAreaLike
} from './settings-store';

/**
 * test ごとに独立した fake storage を作る。
 * `chrome.storage.sync` と同形の最小 API だけを持たせ、settings-store の分岐を固定する。
 *
 * @param initial 初期状態として保持させる key-value。
 * @returns `StorageAreaLike` を満たす in-memory storage。
 */
function createStorageArea(initial: Record<string, unknown> = {}): StorageAreaLike {
  const state = { ...initial };

  return {
    get(keys, callback) {
      if (Array.isArray(keys)) {
        const result = Object.fromEntries(keys.map((key) => [key, state[key]]));
        callback(result);
        return;
      }

      callback({ ...state });
    },
    set(items, callback) {
      Object.assign(state, items);
      callback?.();
    }
  };
}

/**
 * popup 候補一覧と validation の前提になる代表的な言語コードが含まれることを確認する。
 */
function testSupportedLanguageListIncludesCommonLanguages(): void {
  expect(getSupportedLanguageCodes()).toContain('en');
  expect(getSupportedLanguageCodes()).toContain('ja');
}

/**
 * 候補一覧に含まれる言語コードだけを有効値として判定できることを確認する。
 */
function testChecksSupportedLanguageCodes(): void {
  expect(isSupportedLanguageCode('en')).toBe(true);
  expect(isSupportedLanguageCode('')).toBe(false);
  expect(isSupportedLanguageCode('xx')).toBe(false);
}

/**
 * 正常な保存値は余計な補正を受けず、そのまま使えることを確認する。
 */
function testNormalizesValidStoredSettingsAsIs(): void {
  expect(normalizeStoredSettings({ primaryLang: 'en', secondaryLang: 'ja' })).toEqual({
    primaryLang: 'en',
    secondaryLang: 'ja'
  });
}

/**
 * 旧形式の空文字や secondary の欠落を、母国語未選択として null に吸収することを確認する。
 */
function testNormalizesOldSecondaryEmptyStringAndMissingSecondaryToNull(): void {
  expect(normalizeStoredSettings({ primaryLang: 'en', secondaryLang: '' as never })).toEqual({
    primaryLang: 'en',
    secondaryLang: null
  });

  expect(normalizeStoredSettings({ primaryLang: 'en' })).toEqual({
    primaryLang: 'en',
    secondaryLang: null
  });
}

/**
 * 学習言語が不正なときは設定未完了として扱い、secondary も保持しないことを確認する。
 */
function testNormalizesInvalidPrimaryToIncompleteSettings(): void {
  const settings = normalizeStoredSettings({ primaryLang: 'xx', secondaryLang: 'ja' });

  expect(settings).toEqual({
    primaryLang: null,
    secondaryLang: null
  });
  expect(classifySettings(settings)).toEqual({
    status: 'incomplete',
    settings
  });
}

/**
 * 候補外または primary と同じ secondary は保存不能値なので null へ寄せることを確認する。
 */
function testNormalizesInvalidOrDuplicatedSecondaryToNull(): void {
  expect(normalizeStoredSettings({ primaryLang: 'en', secondaryLang: 'xx' })).toEqual({
    primaryLang: 'en',
    secondaryLang: null
  });

  expect(normalizeStoredSettings({ primaryLang: 'en', secondaryLang: 'en' })).toEqual({
    primaryLang: 'en',
    secondaryLang: null
  });
}

/**
 * storage 読込成功かつ正常値なら、そのまま ready として返せることを確認する。
 *
 * @returns `loadSettings()` の結果を検証する Promise。
 */
async function testLoadsReadySettingsFromStorage(): Promise<void> {
  const storage = createStorageArea({ primaryLang: 'en', secondaryLang: 'ja' });

  await expect(loadSettings(storage)).resolves.toEqual({
    status: 'ready',
    settings: {
      primaryLang: 'en',
      secondaryLang: 'ja'
    }
  });
}

/**
 * primaryLang が欠落している保存値は、secondary が残っていても incomplete で止まることを確認する。
 *
 * @returns `loadSettings()` の結果を検証する Promise。
 */
async function testLoadsIncompleteSettingsWhenPrimaryLangIsMissing(): Promise<void> {
  const storage = createStorageArea({ secondaryLang: 'ja' });

  await expect(loadSettings(storage)).resolves.toEqual({
    status: 'incomplete',
    settings: {
      primaryLang: null,
      secondaryLang: null
    }
  });
}

/**
 * 保存時も正規化を先に通し、同値 secondary を null に直してから書き込むことを確認する。
 *
 * @returns `saveSettings()` と storage.set 呼び出し内容を検証する Promise。
 */
async function testSavesNormalizedReadySettings(): Promise<void> {
  const set = vi.fn((items: Record<string, unknown>, callback?: () => void) => callback?.());
  const storage: StorageAreaLike = {
    get(_keys, callback) {
      callback({});
    },
    set
  };

  await expect(saveSettings({ primaryLang: 'en', secondaryLang: 'en' }, storage)).resolves.toEqual({
    status: 'ready',
    settings: {
      primaryLang: 'en',
      secondaryLang: null
    }
  });

  expect(set).toHaveBeenCalledWith(
    {
      primaryLang: 'en',
      secondaryLang: null
    },
    expect.any(Function)
  );
}

/**
 * primaryLang が不正な保存要求は storage へ書かず、入力修正待ちとして返すことを確認する。
 *
 * @returns `saveSettings()` の結果を検証する Promise。
 */
async function testRejectsSaveAsIncompleteWhenPrimaryLangIsInvalid(): Promise<void> {
  const storage = createStorageArea();

  await expect(saveSettings({ primaryLang: 'xx', secondaryLang: 'ja' }, storage)).resolves.toEqual({
    status: 'incomplete',
    settings: {
      primaryLang: null,
      secondaryLang: null
    }
  });
}

/**
 * storage read 失敗は throw を外へ漏らさず、error 結果へ変換することを確認する。
 *
 * @returns `loadSettings()` の結果を検証する Promise。
 */
async function testReturnsStorageReadFailedWhenGetThrows(): Promise<void> {
  const storage: StorageAreaLike = {
    get() {
      throw new Error('read failed');
    },
    set(_items, callback) {
      callback?.();
    }
  };

  await expect(loadSettings(storage)).resolves.toEqual({
    status: 'error',
    cause: 'storage-read-failed'
  });
}

/**
 * storage write 失敗も error 結果へ変換し、呼び出し側の分岐を固定できることを確認する。
 *
 * @returns `saveSettings()` の結果を検証する Promise。
 */
async function testReturnsStorageWriteFailedWhenSetThrows(): Promise<void> {
  const storage: StorageAreaLike = {
    get(_keys, callback) {
      callback({});
    },
    set() {
      throw new Error('write failed');
    }
  };

  await expect(saveSettings({ primaryLang: 'en', secondaryLang: 'ja' }, storage)).resolves.toEqual({
    status: 'error',
    cause: 'storage-write-failed'
  });
}

// test 本体は上で JSDoc 付きの名前付き関数として定義し、ここではケース名との対応だけを並べる。
// describe を末尾にまとめることで、上から順に helper → 各 test の意図 → 登録順を追える構成にする。
describe('settings-store', () => {
  // 対応言語一覧と単体 validation の前提を固定する。
  it('supported language list includes common languages', testSupportedLanguageListIncludesCommonLanguages);
  it('checks supported language codes', testChecksSupportedLanguageCodes);

  // 保存値の正規化ルールを、正常系・旧形式・不正値で分けて確認する。
  it('normalizes valid stored settings as-is', testNormalizesValidStoredSettingsAsIs);
  it(
    'normalizes old secondary empty string and missing secondary to null',
    testNormalizesOldSecondaryEmptyStringAndMissingSecondaryToNull
  );
  it('normalizes invalid primary to incomplete settings', testNormalizesInvalidPrimaryToIncompleteSettings);
  it('normalizes invalid or duplicated secondary to null', testNormalizesInvalidOrDuplicatedSecondaryToNull);

  // storage 読込時の ready / incomplete / error の分岐を固定する。
  it('loads ready settings from storage', testLoadsReadySettingsFromStorage);
  it('loads incomplete settings when primaryLang is missing', testLoadsIncompleteSettingsWhenPrimaryLangIsMissing);
  it('returns storage-read-failed when get throws', testReturnsStorageReadFailedWhenGetThrows);

  // storage 保存時の正規化と失敗時の error 変換を確認する。
  it('saves normalized ready settings', testSavesNormalizedReadySettings);
  it('rejects save as incomplete when primaryLang is invalid', testRejectsSaveAsIncompleteWhenPrimaryLangIsInvalid);
  it('returns storage-write-failed when set throws', testReturnsStorageWriteFailedWhenSetThrows);
});
