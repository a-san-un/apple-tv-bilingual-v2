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

describe('settings-store', () => {
  it('supported language list includes common languages', () => {
    expect(getSupportedLanguageCodes()).toContain('en');
    expect(getSupportedLanguageCodes()).toContain('ja');
  });

  it('checks supported language codes', () => {
    expect(isSupportedLanguageCode('en')).toBe(true);
    expect(isSupportedLanguageCode('')).toBe(false);
    expect(isSupportedLanguageCode('xx')).toBe(false);
  });

  it('normalizes valid stored settings as-is', () => {
    expect(normalizeStoredSettings({ primaryLang: 'en', secondaryLang: 'ja' })).toEqual({
      primaryLang: 'en',
      secondaryLang: 'ja'
    });
  });

  it('normalizes old secondary empty string and missing secondary to null', () => {
    expect(normalizeStoredSettings({ primaryLang: 'en', secondaryLang: '' as never })).toEqual({
      primaryLang: 'en',
      secondaryLang: null
    });

    expect(normalizeStoredSettings({ primaryLang: 'en' })).toEqual({
      primaryLang: 'en',
      secondaryLang: null
    });
  });

  it('normalizes invalid primary to incomplete settings', () => {
    const settings = normalizeStoredSettings({ primaryLang: 'xx', secondaryLang: 'ja' });
    expect(settings).toEqual({
      primaryLang: null,
      secondaryLang: null
    });
    expect(classifySettings(settings)).toEqual({
      status: 'incomplete',
      settings
    });
  });

  it('normalizes invalid or duplicated secondary to null', () => {
    expect(normalizeStoredSettings({ primaryLang: 'en', secondaryLang: 'xx' })).toEqual({
      primaryLang: 'en',
      secondaryLang: null
    });

    expect(normalizeStoredSettings({ primaryLang: 'en', secondaryLang: 'en' })).toEqual({
      primaryLang: 'en',
      secondaryLang: null
    });
  });

  it('loads ready settings from storage', async () => {
    const storage = createStorageArea({ primaryLang: 'en', secondaryLang: 'ja' });

    await expect(loadSettings(storage)).resolves.toEqual({
      status: 'ready',
      settings: {
        primaryLang: 'en',
        secondaryLang: 'ja'
      }
    });
  });

  it('loads incomplete settings when primaryLang is missing', async () => {
    const storage = createStorageArea({ secondaryLang: 'ja' });

    await expect(loadSettings(storage)).resolves.toEqual({
      status: 'incomplete',
      settings: {
        primaryLang: null,
        secondaryLang: null
      }
    });
  });

  it('saves normalized ready settings', async () => {
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
  });

  it('rejects save as incomplete when primaryLang is invalid', async () => {
    const storage = createStorageArea();

    await expect(saveSettings({ primaryLang: 'xx', secondaryLang: 'ja' }, storage)).resolves.toEqual({
      status: 'incomplete',
      settings: {
        primaryLang: null,
        secondaryLang: null
      }
    });
  });

  it('returns storage-read-failed when get throws', async () => {
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
  });

  it('returns storage-write-failed when set throws', async () => {
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
  });
});
