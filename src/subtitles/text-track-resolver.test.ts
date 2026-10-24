/**
 * text-track-resolver.test.ts
 *
 * track の正規化・採用判定と、settings store からの設定受け渡しを確認する。
 * fake track と読込用 storage を使い、正規化済み設定と runtime fallback を区別する。
 * readiness、source の listener、実ブラウザの字幕切替は扱わない。
 * session resource は生成せず、track 選定後の binding と cleanup は source 側で確認する。
 */
import { describe, expect, it } from 'vitest';

import {
  findLanguageCandidates,
  findShowingTrack,
  normalizeTextTracks,
  resolveTrackPair,
  summarizeTrack,
} from './text-track-resolver';
import {
  loadSettings,
  type ReadySettings,
  type StorageAreaLike,
} from '../settings/settings-store';

/** test double の初期値。省略した項目は字幕 track の典型値で埋める。 */
type FakeTrackInit = {
  language: string;
  label?: string;
  kind?: string;
  mode?: TextTrackMode;
  id?: string;
  activeCueCount?: number;
};

/**
 * resolver が読む項目だけを持つ TextTrack 相当を作る。
 * activeCues も持たせ、表示中判定に使わないことを確認する。
 *
 * @param init track の初期値。
 * @returns TextTrack として渡せる test double。
 */
const fakeTrack = (init: FakeTrackInit): TextTrack =>
  ({
    id: init.id ?? '',
    language: init.language,
    label: init.label ?? init.language,
    kind: init.kind ?? 'subtitles',
    mode: init.mode ?? 'hidden',
    activeCues: { length: init.activeCueCount ?? 0 },
    cues: null,
  }) as unknown as TextTrack;

/**
 * 保存値を test double の storage から読み、実際の settings store で正規化する。
 * 想定外の設定状態は、後続の resolver 判定へ進めずテストを失敗させる。
 *
 * @param stored storage が返す保存値。欠落キーや旧形式値を含めてよい。
 * @returns 正規化済みの ready 設定。
 * @throws 設定が ready にならない場合、Promise を reject する。
 */
const readReadyTestSettings = async (
  stored: Record<string, unknown>,
): Promise<ReadySettings> => {
  const storage: StorageAreaLike = {
    /**
     * テストで指定した保存値を返す。
     *
     * @param keys settings store が要求するキー。この fixture では一覧を限定しない。
     * @param callback 保存値の写しを受け取る callback。
     */
    get(keys, callback): void {
      void keys;
      callback({ ...stored });
    },

    /**
     * 読込テスト中の意図しない書込を拒否する。
     *
     * @throws 常に例外を投げる。設定取得では呼ばれないことを前提とする。
     */
    set(): void {
      throw new Error('settings integration test must not write to storage');
    },
  };

  const result = await loadSettings(storage);
  if (result.status !== 'ready') {
    throw new Error(`test settings must be ready: ${result.status}`);
  }

  return result.settings;
};

describe('normalizeTextTracks', () => {
  it('TextTrackList 相当の ArrayLike を候補配列に正規化する', () => {
    const ja = fakeTrack({
      language: ' JA_jp ',
      label: ' 日本語  字幕 ',
      mode: 'showing',
    });
    const en = fakeTrack({ language: 'en', id: 'apple-28' });
    const list = { length: 2, 0: ja, 1: en } as ArrayLike<TextTrack>;

    const candidates = normalizeTextTracks(list);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      id: 'track-0',
      index: 0,
      language: 'ja-jp',
      label: '日本語 字幕',
      kind: 'subtitles',
      mode: 'showing',
      track: ja,
    });
    expect(candidates[1]).toMatchObject({ id: 'apple-28', index: 1, track: en });
  });
});

describe('findLanguageCandidates', () => {
  it('language が一致しても kind が字幕でなければ採用しない', () => {
    const candidates = normalizeTextTracks([
      fakeTrack({ language: 'ja', kind: 'metadata' }),
      fakeTrack({ language: 'ja', kind: 'chapters' }),
    ]);

    expect(findLanguageCandidates(candidates, 'ja')).toEqual([]);
  });

  it('language が一致しても forced の label は採用しない', () => {
    const forced = fakeTrack({
      language: 'en',
      label: 'English (Forced)',
      mode: 'showing',
    });
    const normal = fakeTrack({ language: 'en', label: 'English' });

    const result = findLanguageCandidates(
      normalizeTextTracks([forced, normal]),
      'en',
    );

    expect(result.map((candidate) => candidate.track)).toEqual([normal]);
  });

  it('同じ mode なら kind は subtitles を captions より優先する', () => {
    const captions = fakeTrack({ language: 'en', kind: 'captions' });
    const subtitles = fakeTrack({ language: 'en', kind: 'subtitles' });

    const result = findLanguageCandidates(
      normalizeTextTracks([captions, subtitles]),
      'en',
    );

    expect(result.map((candidate) => candidate.track)).toEqual([
      subtitles,
      captions,
    ]);
  });

  it('kind や一致度より mode === showing を優先する', () => {
    const disabledSubtitles = fakeTrack({
      language: 'en-US',
      mode: 'disabled',
    });
    const showingCaptions = fakeTrack({
      language: 'en',
      kind: 'captions',
      mode: 'showing',
    });

    const result = findLanguageCandidates(
      normalizeTextTracks([disabledSubtitles, showingCaptions]),
      'en-US',
    );

    expect(result[0]?.track).toBe(showingCaptions);
  });

  it('同じ mode なら完全一致を基本言語一致より優先する', () => {
    const base = fakeTrack({ language: 'en' });
    const exact = fakeTrack({ language: 'en-US' });

    const result = findLanguageCandidates(
      normalizeTextTracks([base, exact]),
      'en-US',
    );

    expect(result.map((candidate) => candidate.track)).toEqual([exact, base]);
  });

  it('地域や script が両方にあって異なる場合は一致としない', () => {
    const candidates = normalizeTextTracks([
      fakeTrack({ language: 'zh-Hant' }),
      fakeTrack({ language: 'en-GB' }),
    ]);

    expect(findLanguageCandidates(candidates, 'zh-Hans')).toEqual([]);
    expect(findLanguageCandidates(candidates, 'en-US')).toEqual([]);
  });

  it('言語指定が null や空文字なら候補を返さない', () => {
    const candidates = normalizeTextTracks([
      fakeTrack({ language: 'ja' }),
    ]);

    expect(findLanguageCandidates(candidates, null)).toEqual([]);
    expect(findLanguageCandidates(candidates, '')).toEqual([]);
  });
});

describe('findShowingTrack', () => {
  it('mode === showing の字幕 track を返す', () => {
    const hidden = fakeTrack({ language: 'ja' });
    const showing = fakeTrack({ language: 'en', mode: 'showing' });

    expect(
      findShowingTrack(normalizeTextTracks([hidden, showing]))?.track,
    ).toBe(showing);
  });

  it('hidden track に active cue があっても表示中とは判定しない', () => {
    const hiddenWithActiveCues = fakeTrack({
      language: 'en',
      activeCueCount: 3,
    });
    const showingWithoutActiveCues = fakeTrack({
      language: 'ja',
      mode: 'showing',
      activeCueCount: 0,
    });

    const candidates = normalizeTextTracks([
      hiddenWithActiveCues,
      showingWithoutActiveCues,
    ]);

    expect(findShowingTrack(candidates)?.track).toBe(showingWithoutActiveCues);
  });

  it('showing がなければ active cue があっても null を返す', () => {
    const candidates = normalizeTextTracks([
      fakeTrack({ language: 'en', activeCueCount: 5 }),
    ]);

    expect(findShowingTrack(candidates)).toBeNull();
  });
});

describe('resolveTrackPair', () => {
  it('primary / secondary を別 track として解決する', () => {
    const ja = fakeTrack({ language: 'ja', mode: 'showing' });
    const en = fakeTrack({ language: 'en' });

    const pair = resolveTrackPair({
      textTracks: [ja, en],
      primaryLang: 'en',
      secondaryLang: 'ja',
    });

    expect(pair.primary?.track).toBe(en);
    expect(pair.secondary?.track).toBe(ja);
  });

  it('同じ言語の候補が複数あるとき、active cue ではなく showing を採用する', () => {
    const hiddenWithActiveCues = fakeTrack({
      language: 'ja',
      activeCueCount: 2,
    });
    const showing = fakeTrack({ language: 'ja', mode: 'showing' });

    const pair = resolveTrackPair({
      textTracks: [hiddenWithActiveCues, showing],
      primaryLang: 'ja',
      secondaryLang: null,
    });

    expect(pair.primary?.track).toBe(showing);
  });

  it('未一致の役割は null で返し、例外にしない', () => {
    const en = fakeTrack({ language: 'en' });

    expect(
      resolveTrackPair({
        textTracks: [en],
        primaryLang: 'ko',
        secondaryLang: 'en',
      }),
    ).toMatchObject({ primary: null, secondary: { track: en } });
    expect(
      resolveTrackPair({
        textTracks: [],
        primaryLang: 'ja',
        secondaryLang: 'en',
      }),
    ).toEqual({
      primary: null,
      secondary: null,
    });
  });

  it('primary と secondary に同じ track を採用しない', () => {
    const en = fakeTrack({ language: 'en' });

    const pair = resolveTrackPair({
      textTracks: [en],
      primaryLang: 'en',
      secondaryLang: 'en-US',
    });

    expect(pair.primary?.track).toBe(en);
    expect(pair.secondary).toBeNull();
  });

  it('secondaryLang 未選択時は fallback 言語で secondary を探す', () => {
    const ja = fakeTrack({ language: 'ja' });
    const en = fakeTrack({ language: 'en' });

    const pair = resolveTrackPair({
      textTracks: [ja, en],
      primaryLang: 'en',
      secondaryLang: null,
      fallbackSecondaryLang: 'ja-JP',
    });

    expect(pair.secondary?.track).toBe(ja);
  });

  it('fallback 言語が primary と同じ基本言語なら secondary を採用しない', () => {
    const enUs = fakeTrack({ language: 'en-US' });
    const en = fakeTrack({ language: 'en' });

    const pair = resolveTrackPair({
      textTracks: [enUs, en],
      primaryLang: 'en',
      secondaryLang: null,
      fallbackSecondaryLang: 'en-GB',
    });

    expect(pair.primary).not.toBeNull();
    expect(pair.secondary).toBeNull();
  });

  it('fallback 言語がなければ secondary は null になる', () => {
    const pair = resolveTrackPair({
      textTracks: [fakeTrack({ language: 'ja' })],
      primaryLang: 'ja',
      secondaryLang: null,
    });

    expect(pair.secondary).toBeNull();
  });
});

describe('summarizeTrack', () => {
  it('観測ログと同じ形式で track を 1 行に要約する', () => {
    const tracks = Array.from({ length: 83 }, (_, index) =>
      index === 82
        ? fakeTrack({ language: 'ja', label: '日本語', mode: 'showing' })
        : fakeTrack({ language: 'xx', kind: 'metadata' }),
    );
    const pair = resolveTrackPair({
      textTracks: tracks,
      primaryLang: 'ja',
      secondaryLang: null,
    });

    expect(summarizeTrack(pair.primary)).toBe(
      '82: subtitles: 日本語: ja (showing)',
    );
    expect(summarizeTrack(null)).toBe('none');
  });
});

describe('settings store から resolver への設定受け渡し', () => {
  it('読込済みの明示 secondary を fallback より優先する', async () => {
    const settings = await readReadyTestSettings({
      primaryLang: 'en',
      secondaryLang: 'ja',
    });
    const en = fakeTrack({ language: 'en' });
    const ja = fakeTrack({ language: 'ja' });
    const ko = fakeTrack({ language: 'ko' });

    const pair = resolveTrackPair({
      textTracks: [en, ja, ko],
      primaryLang: settings.primaryLang,
      secondaryLang: settings.secondaryLang,
      fallbackSecondaryLang: 'ko',
    });

    expect(pair.primary?.track).toBe(en);
    expect(pair.secondary?.track).toBe(ja);
    expect(settings).toEqual({
      primaryLang: 'en',
      secondaryLang: 'ja',
    });
  });

  it('旧形式の空 secondary を null に補正し、runtime fallback を渡せる', async () => {
    const stored = {
      primaryLang: 'en',
      secondaryLang: '',
    };
    const settings = await readReadyTestSettings(stored);
    const en = fakeTrack({ language: 'en' });
    const ja = fakeTrack({ language: 'ja' });

    expect(settings.secondaryLang).toBeNull();

    const pair = resolveTrackPair({
      textTracks: [en, ja],
      primaryLang: settings.primaryLang,
      secondaryLang: settings.secondaryLang,
      fallbackSecondaryLang: 'ja-JP',
    });

    expect(pair.primary?.track).toBe(en);
    expect(pair.secondary?.track).toBe(ja);

    // fallback は採用にだけ使い、設定や元の保存値へ書き戻さない。
    expect(settings.secondaryLang).toBeNull();
    expect(stored.secondaryLang).toBe('');
  });

  it('同一言語の secondary を null に補正し、同じ基本言語の fallback も採用しない', async () => {
    const settings = await readReadyTestSettings({
      primaryLang: 'en',
      secondaryLang: 'en',
    });
    const en = fakeTrack({ language: 'en' });
    const enUs = fakeTrack({ language: 'en-US' });

    expect(settings.secondaryLang).toBeNull();

    const pair = resolveTrackPair({
      textTracks: [en, enUs],
      primaryLang: settings.primaryLang,
      secondaryLang: settings.secondaryLang,
      fallbackSecondaryLang: 'en-US',
    });

    expect(pair.primary?.track).toBe(en);
    expect(pair.secondary).toBeNull();
    expect(settings).toEqual({
      primaryLang: 'en',
      secondaryLang: null,
    });
  });
});
