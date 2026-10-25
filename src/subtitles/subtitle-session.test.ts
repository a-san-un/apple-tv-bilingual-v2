/**
 * subtitle-session.test.ts
 *
 * 実際の resolver / source と fake track 一覧を接続する small integration test。
 * 一覧変化と後からの cue 読込みによる再選定、観測通知、cleanup を確認する。
 * 各テストが字幕接続を生成・破棄し、旧 listener の無効化と解除失敗も検証する。
 * readiness、実 DOM、Apple TV+ 実画面、mode 制御は対象外とする。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createSubtitleSession,
    type SubtitleSessionObservation,
    type SubtitleSessionOptions,
} from './subtitle-session';
import type { ReadySettings } from '../settings/settings-store';
import * as trackResolver from './text-track-resolver';

/** listener を手動発火し、実際の残存数を確認できる track。 */
type FakeTrack = TextTrack & {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    fireCueChange(): void;
    listenerCount(): number;
};

/** ArrayLike と一覧変化イベントを提供する、テスト専用の track 一覧。 */
type FakeTrackList = TextTrack[] & {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    append(track: TextTrack): void;
    remove(track: TextTrack): void;
    fire(type: 'addtrack' | 'removetrack'): void;
    listenerCount(type: string): number;
};

/**
 * イベント登録・解除・手動発火を観測する test double を作る。
 *
 * @returns listener の登録 spy、解除 spy、手動発火、残存数の確認を提供する registry。
 */
const createEventRegistry = () => {
    const handlers = new Map<string, Set<EventListener>>();

    return {
        addEventListener: vi.fn((type: string, handler: EventListener) => {
            const listeners = handlers.get(type) ?? new Set<EventListener>();
            listeners.add(handler);
            handlers.set(type, listeners);
        }),
        removeEventListener: vi.fn((type: string, handler: EventListener) => {
            handlers.get(type)?.delete(handler);
        }),

        /**
         * 現在登録されている listener を手動実行する。
         *
         * @param type 発火するイベント名。
         */
        fire(type: string): void {
            for (const handler of [...(handlers.get(type) ?? [])]) {
                handler(new Event(type));
            }
        },

        /**
         * 指定イベントの listener 残存数を返す。
         *
         * @param type 確認するイベント名。
         * @returns 現在登録されている listener 数。
         */
        listenerCount(type: string): number {
            return handlers.get(type)?.size ?? 0;
        },
    };
};

/**
 * resolver / source が読む最小 track を作る。
 *
 * @param language track の言語コード。
 * @param operations listener 登録・解除順の記録先。
 * @returns cue 一覧と通知観測用 method を持つ fake track。
 */
const createTrack = (
    language: string,
    operations: string[],
): FakeTrack => {
    const handlers = new Set<EventListener>();
    const track = {
        id: language,
        language,
        label: language,
        kind: 'subtitles',
        mode: 'hidden' as TextTrackMode,
        cues: [{ startTime: 1, endTime: 2, text: `${language} subtitle` }],
        activeCues: null,
        addEventListener: vi.fn((type: string, handler: EventListener) => {
            if (type === 'cuechange') {
                operations.push(`add:${language}`);
                handlers.add(handler);
            }
        }),
        removeEventListener: vi.fn((type: string, handler: EventListener) => {
            if (type === 'cuechange') {
                operations.push(`remove:${language}`);
                handlers.delete(handler);
            }
        }),

        /** 登録済み cuechange listener を手動実行する。 */
        fireCueChange(): void {
            for (const handler of [...handlers]) {
                handler(new Event('cuechange'));
            }
        },

        /** @returns 実際に残っている cuechange listener 数。 */
        listenerCount(): number {
            return handlers.size;
        },
    };
    return track as unknown as FakeTrack;
};

/**
 * fake track の cue 一覧を変更する。イベントは自動発火しない。
 *
 * @param track 変更する track。
 * @param texts cue 本文の一覧。空配列は cue がまだない状態。
 */
const setTrackCues = (
    track: TextTrack,
    texts: readonly string[],
): void => {
    Object.defineProperty(track, 'cues', {
        configurable: true,
        value: texts.map((text, index) => ({
            startTime: index + 1,
            endTime: index + 2,
            text,
        })),
    });
};

/**
 * 配列として読み取れ、一覧変化を通知できる test double を作る。
 *
 * @param initial 初期 track。元の配列は変更しない。
 * @returns track 追加・削除と listener の残存確認ができる一覧。
 */
const createTrackList = (initial: readonly TextTrack[]): FakeTrackList => {
    const tracks = [...initial];
    const events = createEventRegistry();

    return Object.assign(tracks, events, {
        /**
         * track を追加してイベントを送る。
         *
         * @param track 追加する track。
         */
        append(track: TextTrack): void {
            tracks.push(track);
            events.fire('addtrack');
        },

        /**
         * 指定 track を削除してイベントを送る。存在しなければ何もしない。
         *
         * @param track 削除する track。
         */
        remove(track: TextTrack): void {
            const index = tracks.indexOf(track);
            if (index === -1) {
                return;
            }
            tracks.splice(index, 1);
            events.fire('removetrack');
        },
    });
};

/**
 * 英語・日本語の track、video、観測用 logger を用意する。
 *
 * @param settings 正規化済み設定。省略時は英語 primary・日本語 secondary。
 * @param fallbackSecondaryLang runtime fallback。省略時は利用しない。
 * @param initialLanguages 一覧に初めから含める track。空配列は候補なし。
 * @returns 字幕接続の入力、一覧、track、video、logger、listener 操作順。
 */
const createFixture = (
    settings: ReadySettings = { primaryLang: 'en', secondaryLang: 'ja' },
    fallbackSecondaryLang: string | null = null,
    initialLanguages: readonly ('en' | 'ja')[] = ['en', 'ja'],
) => {
    const operations: string[] = [];
    const en = createTrack('en', operations);
    const ja = createTrack('ja', operations);
    const available = { en, ja };
    const tracks = createTrackList(
        initialLanguages.map((language) => available[language]),
    );
    const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
    const video = Object.assign(createEventRegistry(), {
        textTracks: tracks,
        currentTime: 1.5,
    });
    const options: SubtitleSessionOptions = {
        videoEl: video as unknown as HTMLVideoElement,
        settings,
        fallbackSecondaryLang,
        logger,
    };

    return { options, tracks, en, ja, video, logger, operations };
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('createSubtitleSession', () => {
    it('採用 track を bind し、初回 bound で cue 件数を観測する', () => {
        const { options, en, ja, logger } = createFixture();
        const session = createSubtitleSession(options);

        try {
            expect(en.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(1);
            expect(logger.debug).toHaveBeenCalledWith(
                'subtitle source snapshot',
                expect.objectContaining({
                    event: 'bound',
                    primary: '0: subtitles: en: en (hidden)',
                    secondary: '1: subtitles: ja: ja (hidden)',
                    primaryCueCount: 1,
                    secondaryCueCount: 1,
                    currentTime: 1.5,
                }),
            );
            expect(logger.error).not.toHaveBeenCalled();
        } finally {
            session.dispose();
        }
    });

    it('cuechange の役割と snapshot をログへ渡す', () => {
        const { options, en, ja, logger } = createFixture();
        const session = createSubtitleSession(options);

        try {
            logger.info.mockClear();
            logger.debug.mockClear();
            en.fireCueChange();
            ja.fireCueChange();

            expect(logger.info).not.toHaveBeenCalled();
            expect(logger.debug.mock.calls).toEqual([
                [
                    'subtitle source snapshot',
                    expect.objectContaining({
                        event: 'cuechange',
                        role: 'primary',
                        primaryCueCount: 1,
                        secondaryCueCount: 1,
                    }),
                ],
                [
                    'subtitle source snapshot',
                    expect.objectContaining({
                        event: 'cuechange',
                        role: 'secondary',
                        primaryCueCount: 1,
                        secondaryCueCount: 1,
                    }),
                ],
            ]);
        } finally {
            session.dispose();
        }
    });

    it('secondary 未選択時は fallback を使い、保存設定を書き換えない', () => {
        const settings: ReadySettings = {
            primaryLang: 'en',
            secondaryLang: null,
        };
        const { options, ja, logger } = createFixture(settings, 'ja-JP');
        const session = createSubtitleSession(options);

        try {
            expect(ja.listenerCount()).toBe(1);
            expect(settings.secondaryLang).toBeNull();
            expect(logger.debug).toHaveBeenCalledWith(
                'subtitle source snapshot',
                expect.objectContaining({
                    secondary: '1: subtitles: ja: ja (hidden)',
                    secondaryCueCount: 1,
                }),
            );
        } finally {
            session.dispose();
        }
    });

    it('明示 secondary がある場合は別言語の fallback で置き換えない', () => {
        const { options, ja, logger } = createFixture(
            { primaryLang: 'en', secondaryLang: 'ja' },
            'ko',
        );
        const session = createSubtitleSession(options);

        try {
            expect(ja.listenerCount()).toBe(1);
            expect(logger.debug).toHaveBeenCalledWith(
                'subtitle source snapshot',
                expect.objectContaining({
                    secondary: '1: subtitles: ja: ja (hidden)',
                }),
            );
        } finally {
            session.dispose();
        }
    });

    it('primary と同じ基本言語の fallback は secondary に採用しない', () => {
        const { options, en, ja, logger } = createFixture(
            { primaryLang: 'en', secondaryLang: null },
            'en-US',
        );
        const session = createSubtitleSession(options);

        try {
            expect(en.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(0);
            expect(logger.debug).toHaveBeenCalledWith(
                'subtitle source snapshot',
                expect.objectContaining({
                    secondary: 'none',
                    secondaryCueCount: 0,
                }),
            );
        } finally {
            session.dispose();
        }
    });

    it('採用候補なしは通常状態として記録し、一覧監視を維持する', () => {
        const { options, tracks, en, ja, logger } = createFixture({
            primaryLang: 'fr',
            secondaryLang: null,
        });
        const session = createSubtitleSession(options);

        try {
            expect(en.listenerCount()).toBe(0);
            expect(ja.listenerCount()).toBe(0);
            expect(logger.info).toHaveBeenCalledWith(
                'subtitle tracks unavailable',
                expect.objectContaining({
                    primaryLang: 'fr',
                    reason: 'initial',
                }),
            );
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
            expect(tracks.listenerCount('addtrack')).toBe(1);
            expect(tracks.listenerCount('removetrack')).toBe(1);
        } finally {
            session.dispose();
        }
    });

    it('dispose は cue listener を逆順で一度だけ解除し、以後は観測しない', () => {
        const { options, en, ja, logger, operations } = createFixture();
        const session = createSubtitleSession(options);

        try {
            operations.length = 0;
            session.dispose();
            session.dispose();

            expect(operations).toEqual(['remove:ja', 'remove:en']);
            expect(en.listenerCount()).toBe(0);
            expect(ja.listenerCount()).toBe(0);

            logger.info.mockClear();
            en.fireCueChange();
            ja.fireCueChange();

            expect(logger.info).not.toHaveBeenCalled();
        } finally {
            session.dispose();
        }
    });

    it('cue listener 解除失敗を記録し、残った旧 listener の通知を遮断する', () => {
        const { options, en, ja, logger } = createFixture();
        const session = createSubtitleSession(options);

        try {
            ja.removeEventListener.mockImplementation(() => {
                throw new Error('secondary cleanup failed');
            });

            expect(() => session.dispose()).not.toThrow();
            expect(ja.listenerCount()).toBe(1);
            expect(en.listenerCount()).toBe(0);
            expect(logger.error).toHaveBeenCalledWith(
                'subtitle source unbind failed',
                { error: expect.any(AggregateError) },
            );

            logger.info.mockClear();
            ja.fireCueChange();

            expect(logger.info).not.toHaveBeenCalled();
            session.dispose();
            expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
        } finally {
            session.dispose();
        }
    });

    it('候補がある場合の listener 登録失敗は、候補不足と区別する', () => {
        const { options, en, ja, logger } = createFixture();

        ja.addEventListener.mockImplementation(() => {
            throw new Error('secondary registration failed');
        });

        const session = createSubtitleSession(options);

        try {
            expect(en.listenerCount()).toBe(0);
            expect(ja.listenerCount()).toBe(0);
            expect(logger.error).toHaveBeenCalledWith(
                'subtitle source bind failed',
                { error: expect.any(Error) },
            );
            expect(logger.warn).toHaveBeenCalledWith(
                'subtitle source has no bound track',
            );
            expect(logger.info).not.toHaveBeenCalledWith(
                'subtitle tracks unavailable',
                expect.anything(),
            );
        } finally {
            session.dispose();
        }
    });

    it('cue 件数の読取失敗は0件として観測し、他方の件数取得を続ける', () => {
        const { options, en, logger } = createFixture();

        Object.defineProperty(en, 'cues', {
            get() {
                throw new Error('cues unavailable');
            },
        });

        const session = createSubtitleSession(options);

        try {
            expect(logger.debug).toHaveBeenCalledWith(
                'subtitle source snapshot',
                expect.objectContaining({
                    primaryCueCount: 0,
                    secondaryCueCount: 1,
                }),
            );
            expect(logger.error).toHaveBeenCalledWith(
                'subtitle source failed to read cue count',
                expect.objectContaining({ error: expect.any(Error) }),
            );
        } finally {
            session.dispose();
        }
    });

    it('初期化途中の例外では登録済み listener を解除して例外を返す', () => {
        const { options, tracks, en, ja, logger } = createFixture();
        const failure = new Error('initialization interrupted');

        logger.info.mockImplementation((message: string) => {
            if (message === 'subtitle source bound') {
                throw failure;
            }
        });

        expect(() => createSubtitleSession(options)).toThrow(failure);
        expect(en.addEventListener).toHaveBeenCalledTimes(1);
        expect(ja.addEventListener).toHaveBeenCalledTimes(1);
        expect(en.removeEventListener).toHaveBeenCalledTimes(1);
        expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
        expect(en.listenerCount()).toBe(0);
        expect(ja.listenerCount()).toBe(0);
        expect(tracks.listenerCount('addtrack')).toBe(0);
        expect(tracks.listenerCount('removetrack')).toBe(0);
    });

    it('接続・破棄で track の mode を変更しない', () => {
        const { options, en, ja } = createFixture();
        const session = createSubtitleSession(options);

        try {
            expect(en.mode).toBe('hidden');
            expect(ja.mode).toBe('hidden');
        } finally {
            session.dispose();
        }

        expect(en.mode).toBe('hidden');
        expect(ja.mode).toBe('hidden');
    });
});

describe('subtitle-session の観測通知', () => {
    it('初回 bind の言語・mode・cue 件数と通知回数を渡す', () => {
        const { options } = createFixture();
        const observations: SubtitleSessionObservation[] = [];
        const session = createSubtitleSession({
            ...options,
            onObservation: (observation) => {
                observations.push(observation);
            },
        });

        try {
            expect(observations).toHaveLength(1);
            expect(observations[0]).toMatchObject({
                videoEl: options.videoEl,
                event: 'bound',
                role: null,
                primary: {
                    language: 'en',
                    mode: 'hidden',
                    cueCount: 1,
                },
                secondary: {
                    language: 'ja',
                    mode: 'hidden',
                    cueCount: 1,
                },
                primaryCueChanges: 0,
                secondaryCueChanges: 0,
            });
            expect(observations[0]?.primary).not.toHaveProperty('track');
        } finally {
            session.dispose();
        }
    });

    it('各言語の cuechange を接続単位で数える', () => {
        const { options, en, ja } = createFixture();
        const observations: SubtitleSessionObservation[] = [];
        const session = createSubtitleSession({
            ...options,
            onObservation: (observation) => {
                observations.push(observation);
            },
        });

        try {
            en.fireCueChange();
            en.fireCueChange();
            ja.fireCueChange();

            expect(observations[observations.length - 1]).toMatchObject({
                event: 'cuechange',
                role: 'secondary',
                primaryCueChanges: 2,
                secondaryCueChanges: 1,
            });
            expect(observations[0]?.primaryCueChanges).toBe(0);
        } finally {
            session.dispose();
        }
    });

    it('候補なしでも未採用の初期状態を通知する', () => {
        const { options } = createFixture({
            primaryLang: 'fr',
            secondaryLang: null,
        });
        const observe = vi.fn();
        const session = createSubtitleSession({
            ...options,
            onObservation: observe,
        });

        try {
            expect(observe).toHaveBeenCalledWith(
                expect.objectContaining({
                    primary: null,
                    secondary: null,
                    primaryCueChanges: 0,
                    secondaryCueChanges: 0,
                }),
            );
        } finally {
            session.dispose();
        }
    });

    it('観測先が例外を投げても bind と cuechange 処理を続ける', () => {
        const { options, en, ja, logger } = createFixture();
        const observe = vi.fn(() => {
            throw new Error('display failed');
        });
        const session = createSubtitleSession({
            ...options,
            onObservation: observe,
        });

        try {
            expect(en.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(1);
            expect(() => en.fireCueChange()).not.toThrow();
            expect(observe).toHaveBeenCalledTimes(2);
            expect(logger.error).toHaveBeenCalledWith(
                'subtitle observation callback failed',
                { error: expect.any(Error) },
            );
        } finally {
            session.dispose();
        }
    });

    it('dispose 後は観測 callback を呼ばない', () => {
        const { options, en, ja } = createFixture();
        const observe = vi.fn();
        const session = createSubtitleSession({
            ...options,
            onObservation: observe,
        });

        session.dispose();
        observe.mockClear();

        en.fireCueChange();
        ja.fireCueChange();

        expect(observe).not.toHaveBeenCalled();
    });
});

describe('subtitle-session の track 一覧の変化', () => {
    it('字幕以外の1件から始まり、後から届いた両言語を採用する', () => {
        const { options, tracks, en, ja, logger, operations } = createFixture(
            { primaryLang: 'en', secondaryLang: 'ja' },
            null,
            [],
        );
        const metadata = createTrack('', operations);
        Object.assign(metadata, { kind: 'metadata', label: 'metadata' });
        tracks.append(metadata);

        const session = createSubtitleSession(options);

        try {
            expect(tracks.length).toBe(1);
            expect(en.listenerCount()).toBe(0);
            expect(ja.listenerCount()).toBe(0);
            expect(logger.warn).not.toHaveBeenCalled();

            tracks.append(en);
            expect(en.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(0);

            tracks.append(ja);
            expect(en.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(1);
            expect(logger.info).toHaveBeenCalledWith(
                'subtitle source bound',
                expect.objectContaining({
                    primary: '1: subtitles: en: en (hidden)',
                    secondary: '2: subtitles: ja: ja (hidden)',
                }),
            );
        } finally {
            session.dispose();
        }
    });

    it('初期一覧が空でも、追加された字幕を採用する', () => {
        const { options, tracks, en } = createFixture(
            { primaryLang: 'en', secondaryLang: null },
            null,
            [],
        );
        const session = createSubtitleSession(options);

        try {
            expect(en.listenerCount()).toBe(0);
            tracks.append(en);
            expect(en.listenerCount()).toBe(1);
        } finally {
            session.dispose();
        }
    });

    it('採用結果が同じなら cue listener を登録し直さない', () => {
        const { options, tracks, en, ja, operations } = createFixture();
        const session = createSubtitleSession(options);

        try {
            operations.length = 0;
            tracks.fire('addtrack');
            tracks.fire('removetrack');

            const unrelated = createTrack('fr', operations);
            tracks.append(unrelated);
            tracks.remove(unrelated);

            expect(operations).toEqual([]);
            expect(en.addEventListener).toHaveBeenCalledTimes(1);
            expect(ja.addEventListener).toHaveBeenCalledTimes(1);
            expect(en.removeEventListener).not.toHaveBeenCalled();
            expect(ja.removeEventListener).not.toHaveBeenCalled();
        } finally {
            session.dispose();
        }
    });

    it('採用 track の削除後に、同じ言語の別 track へ切り替える', () => {
        const { options, tracks, en, ja, operations } = createFixture();
        const replacement = createTrack('en', operations);
        tracks.append(replacement);

        const session = createSubtitleSession(options);

        try {
            expect(en.listenerCount()).toBe(1);
            expect(replacement.listenerCount()).toBe(0);

            tracks.remove(en);

            expect(en.listenerCount()).toBe(0);
            expect(replacement.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(1);
        } finally {
            session.dispose();
        }
    });

    it('片方の採用 track がなくなっても、他方を利用する', () => {
        const { options, tracks, en, ja } = createFixture();
        const observe = vi.fn();
        const session = createSubtitleSession({
            ...options,
            onObservation: observe,
        });

        try {
            tracks.remove(ja);

            expect(en.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(0);
            expect(observe).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    primary: expect.objectContaining({ language: 'en' }),
                    secondary: null,
                }),
            );
        } finally {
            session.dispose();
        }
    });

    it('両方が削除されたら未採用を通知し、後からの追加で復帰する', () => {
        const { options, tracks, en, ja } = createFixture();
        const observe = vi.fn();
        const session = createSubtitleSession({
            ...options,
            onObservation: observe,
        });

        try {
            tracks.remove(en);
            tracks.remove(ja);

            expect(en.listenerCount()).toBe(0);
            expect(ja.listenerCount()).toBe(0);
            expect(observe).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    primary: null,
                    secondary: null,
                }),
            );

            tracks.append(en);
            tracks.append(ja);

            expect(en.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(1);
        } finally {
            session.dispose();
        }
    });

    it('後から追加された secondary にも fallback を適用する', () => {
        const { options, tracks, ja } = createFixture(
            { primaryLang: 'en', secondaryLang: null },
            'ja-JP',
            ['en'],
        );
        const session = createSubtitleSession(options);

        try {
            expect(ja.listenerCount()).toBe(0);
            tracks.append(ja);
            expect(ja.listenerCount()).toBe(1);
            expect(options.settings.secondaryLang).toBeNull();
        } finally {
            session.dispose();
        }
    });

    it('一覧変化で観測先が例外を投げても binding を更新する', () => {
        const { options, tracks, en, ja, logger } = createFixture(
            { primaryLang: 'en', secondaryLang: 'ja' },
            null,
            [],
        );
        const session = createSubtitleSession({
            ...options,
            onObservation: () => {
                throw new Error('display failed');
            },
        });

        try {
            expect(() => tracks.append(en)).not.toThrow();
            expect(() => tracks.append(ja)).not.toThrow();
            expect(en.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(1);
            expect(logger.error).toHaveBeenCalledWith(
                'subtitle observation callback failed',
                { error: expect.any(Error) },
            );
        } finally {
            session.dispose();
        }
    });

    it('dispose で一覧監視を一度だけ解除し、追加後も再接続しない', () => {
        const { options, tracks, en, ja, logger } = createFixture(
            { primaryLang: 'en', secondaryLang: 'ja' },
            null,
            [],
        );
        const session = createSubtitleSession(options);

        try {
            expect(tracks.listenerCount('addtrack')).toBe(1);
            expect(tracks.listenerCount('removetrack')).toBe(1);

            session.dispose();
            session.dispose();

            expect(tracks.removeEventListener).toHaveBeenCalledTimes(2);
            expect(tracks.listenerCount('addtrack')).toBe(0);
            expect(tracks.listenerCount('removetrack')).toBe(0);

            logger.info.mockClear();
            tracks.append(en);
            tracks.append(ja);

            expect(en.listenerCount()).toBe(0);
            expect(ja.listenerCount()).toBe(0);
            expect(logger.info).not.toHaveBeenCalled();
        } finally {
            session.dispose();
        }
    });

    it('一覧監視の登録失敗では、登録済み資源を解除して例外を返す', () => {
        const { options, tracks, en, ja } = createFixture();
        const originalAdd = tracks.addEventListener.getMockImplementation();

        tracks.addEventListener.mockImplementation(
            (type: string, handler: EventListener) => {
                if (type === 'removetrack') {
                    throw new Error('track list registration failed');
                }
                originalAdd?.(type, handler);
            },
        );

        expect(() => createSubtitleSession(options)).toThrow(
            'track list registration failed',
        );
        expect(tracks.listenerCount('addtrack')).toBe(0);
        expect(tracks.listenerCount('removetrack')).toBe(0);
        expect(tracks.removeEventListener).toHaveBeenCalledTimes(2);
        expect(en.listenerCount()).toBe(0);
        expect(ja.listenerCount()).toBe(0);
    });

    it('一覧監視の解除失敗でも残りを解除し、旧イベントを無効化する', () => {
        const { options, tracks, en, ja, logger } = createFixture();
        const session = createSubtitleSession(options);
        const originalRemove =
            tracks.removeEventListener.getMockImplementation();

        tracks.removeEventListener.mockImplementation(
            (type: string, handler: EventListener) => {
                if (type === 'addtrack') {
                    throw new Error('track list cleanup failed');
                }
                originalRemove?.(type, handler);
            },
        );

        expect(() => session.dispose()).toThrow(AggregateError);
        expect(tracks.listenerCount('addtrack')).toBe(1);
        expect(tracks.listenerCount('removetrack')).toBe(0);
        expect(en.listenerCount()).toBe(0);
        expect(ja.listenerCount()).toBe(0);

        logger.info.mockClear();
        logger.error.mockClear();

        tracks.fire('addtrack');

        expect(logger.info).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        expect(en.listenerCount()).toBe(0);
        expect(ja.listenerCount()).toBe(0);
        expect(() => session.dispose()).not.toThrow();
        expect(tracks.removeEventListener).toHaveBeenCalledTimes(2);
    });

    it('一覧変化時の再選定例外を記録し、後のイベントで復帰できる', () => {
        const { options, tracks, ja, logger } = createFixture();
        const session = createSubtitleSession(options);

        try {
            const broken = createTrack('fr', []);
            Object.defineProperty(broken, 'language', {
                configurable: true,
                get() {
                    throw new Error('track language unavailable');
                },
            });

            expect(() => tracks.append(broken)).not.toThrow();
            expect(logger.error).toHaveBeenCalledWith(
                'subtitle track update failed',
                {
                    reason: 'addtrack',
                    error: expect.any(Error),
                },
            );

            tracks.remove(broken);
            tracks.remove(ja);
            expect(ja.listenerCount()).toBe(0);

            tracks.append(ja);
            expect(ja.listenerCount()).toBe(1);
        } finally {
            session.dispose();
        }
    });
});

describe('subtitle-session の一覧変更を伴わない cue 読込み', () => {
    it.each(['timeupdate', 'loadeddata', 'playing', 'seeked'])(
        '%s で、後から cue を持った同言語の captions へ切り替える',
        (eventName) => {
            const { options, tracks, en, ja, video, operations, logger } =
                createFixture();
            const captions = createTrack('en', operations);
            Object.assign(captions, { kind: 'captions' });

            setTrackCues(en, []);
            setTrackCues(captions, []);
            tracks.append(captions);

            const session = createSubtitleSession(options);

            try {
                expect(en.listenerCount()).toBe(1);
                expect(captions.listenerCount()).toBe(0);

                const trackCount = tracks.length;
                setTrackCues(captions, ['loaded English']);
                video.fire(eventName);

                expect(tracks.length).toBe(trackCount);
                expect(en.listenerCount()).toBe(0);
                expect(captions.listenerCount()).toBe(1);
                expect(ja.listenerCount()).toBe(1);
                expect(logger.info).toHaveBeenCalledWith(
                    'subtitle tracks resolved',
                    expect.objectContaining({ reason: eventName }),
                );
            } finally {
                session.dispose();
            }
        },
    );

    it('他方の cuechange でも、未取得側の候補を再評価する', () => {
        const { options, tracks, en, ja, operations, logger } = createFixture();
        const captions = createTrack('en', operations);
        Object.assign(captions, { kind: 'captions' });

        setTrackCues(en, []);
        setTrackCues(captions, []);
        tracks.append(captions);

        const session = createSubtitleSession(options);

        try {
            setTrackCues(captions, ['loaded English']);
            ja.fireCueChange();

            expect(en.listenerCount()).toBe(0);
            expect(captions.listenerCount()).toBe(1);
            expect(logger.info).toHaveBeenCalledWith(
                'subtitle tracks resolved',
                expect.objectContaining({ reason: 'cuechange' }),
            );
        } finally {
            session.dispose();
        }
    });

    it('両言語とも空でも、再生イベントから読込み済み候補へ切り替える', () => {
        const { options, tracks, en, ja, video, operations } = createFixture();
        const captions = createTrack('en', operations);
        Object.assign(captions, { kind: 'captions' });

        setTrackCues(en, []);
        setTrackCues(ja, []);
        setTrackCues(captions, []);
        tracks.append(captions);

        const session = createSubtitleSession(options);

        try {
            setTrackCues(captions, ['loaded English']);
            video.fire('playing');

            expect(en.listenerCount()).toBe(0);
            expect(captions.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(1);
        } finally {
            session.dispose();
        }
    });

    it('再選定しても採用結果が同じなら listener を登録し直さない', () => {
        const { options, en, ja, video, operations } = createFixture();
        setTrackCues(en, []);

        const session = createSubtitleSession(options);

        try {
            operations.length = 0;

            video.fire('timeupdate');
            video.fire('timeupdate');
            video.fire('playing');
            ja.fireCueChange();

            expect(operations).toEqual([]);
            expect(en.addEventListener).toHaveBeenCalledTimes(1);
            expect(ja.addEventListener).toHaveBeenCalledTimes(1);
            expect(en.removeEventListener).not.toHaveBeenCalled();
            expect(ja.removeEventListener).not.toHaveBeenCalled();
        } finally {
            session.dispose();
        }
    });

    it('取得済みなら、再生イベントで全候補を再走査しない', () => {
        const { options, tracks, video, logger } = createFixture();
        const unrelated = createTrack('fr', []);
        tracks.append(unrelated);

        const session = createSubtitleSession(options);

        try {
            let languageReads = 0;
            Object.defineProperty(unrelated, 'language', {
                configurable: true,
                get() {
                    languageReads += 1;
                    throw new Error('unrelated track must not be read');
                },
            });

            video.fire('timeupdate');
            video.fire('playing');
            video.fire('seeked');

            expect(languageReads).toBe(0);
            expect(logger.error).not.toHaveBeenCalled();
        } finally {
            session.dispose();
        }
    });

    it('bind 失敗後は、再生イベントで接続を再試行できる', () => {
        const { options, en, ja, video, logger } = createFixture();

        ja.addEventListener.mockImplementationOnce(() => {
            throw new Error('temporary registration failure');
        });

        const session = createSubtitleSession(options);

        try {
            expect(en.listenerCount()).toBe(0);
            expect(ja.listenerCount()).toBe(0);
            expect(logger.warn).toHaveBeenCalledWith(
                'subtitle source has no bound track',
            );

            video.fire('playing');

            expect(en.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(1);
        } finally {
            session.dispose();
        }
    });

    it('video の各 listener は一度だけ登録し、dispose で解除する', () => {
        const { options, video } = createFixture();
        const session = createSubtitleSession(options);
        const eventNames = ['timeupdate', 'loadeddata', 'playing', 'seeked'];

        try {
            expect(video.addEventListener).toHaveBeenCalledTimes(4);
            for (const eventName of eventNames) {
                expect(video.listenerCount(eventName)).toBe(1);
            }

            session.dispose();
            session.dispose();

            expect(video.removeEventListener).toHaveBeenCalledTimes(4);
            for (const eventName of eventNames) {
                expect(video.listenerCount(eventName)).toBe(0);
            }
        } finally {
            session.dispose();
        }
    });

    it('dispose 後の再生イベントで binding や観測を再開しない', () => {
        const { options, tracks, en, video, operations, logger } = createFixture();
        const captions = createTrack('en', operations);
        Object.assign(captions, { kind: 'captions' });

        setTrackCues(en, []);
        setTrackCues(captions, []);
        tracks.append(captions);

        const observe = vi.fn();
        const session = createSubtitleSession({
            ...options,
            onObservation: observe,
        });

        session.dispose();
        observe.mockClear();
        logger.info.mockClear();

        setTrackCues(captions, ['loaded after disposal']);
        video.fire('timeupdate');
        video.fire('playing');

        expect(captions.listenerCount()).toBe(0);
        expect(observe).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalled();
    });

    it('video 監視の登録失敗では、登録済み資源を解除して例外を返す', () => {
        const { options, tracks, video, en, ja } = createFixture();
        const originalAdd = video.addEventListener.getMockImplementation();

        video.addEventListener.mockImplementation(
            (type: string, handler: EventListener) => {
                if (type === 'playing') {
                    throw new Error('playback registration failed');
                }
                originalAdd?.(type, handler);
            },
        );

        expect(() => createSubtitleSession(options)).toThrow(
            'playback registration failed',
        );

        expect(tracks.listenerCount('addtrack')).toBe(0);
        expect(tracks.listenerCount('removetrack')).toBe(0);

        for (const type of ['timeupdate', 'loadeddata', 'playing', 'seeked']) {
            expect(video.listenerCount(type)).toBe(0);
        }

        expect(en.listenerCount()).toBe(0);
        expect(ja.listenerCount()).toBe(0);
    });

    it('video 監視の解除失敗でも残りを解除し、旧 callback を無効化する', () => {
        const { options, tracks, video, en, ja, logger } = createFixture();
        const session = createSubtitleSession(options);
        const originalRemove =
            video.removeEventListener.getMockImplementation();

        video.removeEventListener.mockImplementation(
            (type: string, handler: EventListener) => {
                if (type === 'timeupdate') {
                    throw new Error('playback cleanup failed');
                }
                originalRemove?.(type, handler);
            },
        );

        expect(() => session.dispose()).toThrow(AggregateError);

        expect(video.listenerCount('timeupdate')).toBe(1);
        expect(video.listenerCount('loadeddata')).toBe(0);
        expect(video.listenerCount('playing')).toBe(0);
        expect(video.listenerCount('seeked')).toBe(0);
        expect(tracks.listenerCount('addtrack')).toBe(0);
        expect(tracks.listenerCount('removetrack')).toBe(0);
        expect(en.listenerCount()).toBe(0);
        expect(ja.listenerCount()).toBe(0);

        logger.info.mockClear();
        logger.error.mockClear();
        video.fire('timeupdate');

        expect(logger.info).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        expect(() => session.dispose()).not.toThrow();
        expect(video.removeEventListener).toHaveBeenCalledTimes(4);
    });

    it('観測通知中の再生イベントで bind を入れ子にしない', () => {
        const { options, video, en, ja } = createFixture();
        let fired = false;

        const session = createSubtitleSession({
            ...options,
            onObservation: () => {
                if (!fired) {
                    fired = true;
                    video.fire('timeupdate');
                }
            },
        });

        try {
            expect(en.addEventListener).toHaveBeenCalledTimes(1);
            expect(ja.addEventListener).toHaveBeenCalledTimes(1);
            expect(en.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(1);
        } finally {
            session.dispose();
        }
    });
});

describe('subtitle-session の同じ track の読込み完了通知', () => {
    it.each([
        ['primary', 'timeupdate'],
        ['primary', 'loadeddata'],
        ['primary', 'playing'],
        ['primary', 'seeked'],
        ['secondary', 'timeupdate'],
        ['secondary', 'loadeddata'],
        ['secondary', 'playing'],
        ['secondary', 'seeked'],
    ] as const)(
        '%s の cue が届いたら、%s で再 bind せず一度だけ通知する',
        (role, eventName) => {
            const { options, en, ja, video, operations, logger } =
                createFixture();
            const target = role === 'primary' ? en : ja;

            setTrackCues(target, []);

            const observe = vi.fn();
            const session = createSubtitleSession({
                ...options,
                onObservation: observe,
            });

            try {
                expect(observe).toHaveBeenLastCalledWith(
                    expect.objectContaining({
                        [role]: expect.objectContaining({
                            cueCount: 0,
                        }),
                    }),
                );

                observe.mockClear();
                logger.info.mockClear();
                logger.debug.mockClear();
                operations.length = 0;

                // 一覧変更も cuechange も起こさず、同じ track に cue を届ける。
                setTrackCues(target, ['loaded subtitle']);
                video.fire(eventName);

                expect(observe).toHaveBeenCalledTimes(1);
                expect(observe).toHaveBeenLastCalledWith(
                    expect.objectContaining({
                        event: 'snapshot',
                        role: null,
                        [role]: expect.objectContaining({
                            cueCount: 1,
                        }),
                        primaryCueChanges: 0,
                        secondaryCueChanges: 0,
                    }),
                );
                expect(logger.debug).toHaveBeenCalledWith(
                    'subtitle source snapshot',
                    expect.objectContaining({
                        event: 'snapshot',
                        primaryCueCount: 1,
                        secondaryCueCount: 1,
                    }),
                );

                // 同じ track のため、cue listener は登録し直さない。
                expect(operations).toEqual([]);
                expect(en.addEventListener).toHaveBeenCalledTimes(1);
                expect(ja.addEventListener).toHaveBeenCalledTimes(1);
                expect(en.removeEventListener).not.toHaveBeenCalled();
                expect(ja.removeEventListener).not.toHaveBeenCalled();

                // 後続イベントでは、読込み完了を重複通知しない。
                observe.mockClear();
                logger.info.mockClear();
                logger.debug.mockClear();

                video.fire('timeupdate');
                video.fire('playing');
                video.fire('seeked');

                expect(observe).not.toHaveBeenCalled();
                expect(logger.info).not.toHaveBeenCalled();
                expect(logger.debug).not.toHaveBeenCalled();
                expect(operations).toEqual([]);
            } finally {
                session.dispose();
            }
        },
    );

    it('既存 cuechange で読込み完了を通知済みなら snapshot を重複通知しない', () => {
        const { options, en, video } = createFixture();
        setTrackCues(en, []);

        const observe = vi.fn();
        const session = createSubtitleSession({
            ...options,
            onObservation: observe,
        });

        try {
            observe.mockClear();

            setTrackCues(en, ['loaded English']);
            en.fireCueChange();

            expect(observe).toHaveBeenCalledTimes(1);
            expect(observe).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    event: 'cuechange',
                    role: 'primary',
                    primary: expect.objectContaining({
                        cueCount: 1,
                    }),
                    primaryCueChanges: 1,
                    secondaryCueChanges: 0,
                }),
            );

            observe.mockClear();
            video.fire('timeupdate');
            video.fire('playing');

            expect(observe).not.toHaveBeenCalled();
        } finally {
            session.dispose();
        }
    });

    it('読込み完了の観測 callback から再入しても通知を繰り返さない', () => {
        const { options, en, video } = createFixture();
        setTrackCues(en, []);

        const observe = vi.fn(
            (observation: SubtitleSessionObservation): void => {
                if (observation.event === 'snapshot') {
                    video.fire('timeupdate');
                }
            },
        );
        const session = createSubtitleSession({
            ...options,
            onObservation: observe,
        });

        try {
            observe.mockClear();

            setTrackCues(en, ['loaded English']);

            expect(() => video.fire('timeupdate')).not.toThrow();
            expect(observe).toHaveBeenCalledTimes(1);
            expect(en.addEventListener).toHaveBeenCalledTimes(1);
        } finally {
            session.dispose();
        }
    });
});

/**
 * cue のコピー時に読まれる startTime を spy にした一覧を設定する。
 * resolver の件数確認では増えず、source の cue コピーごとに1回増える。
 *
 * @param track コピー回数を確認する fake track。
 * @returns startTime の読取 spy。テストが回数を確認・クリアする。
 */
const watchCueCopies = (track: TextTrack) => {
    const readStartTime = vi.fn(() => 1);
    const cue = { endTime: 2, text: 'subtitle' };
    Object.defineProperty(cue, 'startTime', { get: readStartTime });
    Object.defineProperty(track, 'cues', {
        configurable: true,
        value: [cue],
    });
    return readStartTime;
};

describe('subtitle-session の診断用要約取得', () => {
    it.each([false, true])(
        '観測 callback 有効=%s の初回 bind で cue をコピーしない',
        (observationEnabled) => {
            const { options, en, ja } = createFixture();
            const primaryCopies = watchCueCopies(en);
            const secondaryCopies = watchCueCopies(ja);
            const observe = vi.fn();
            const session = createSubtitleSession({
                ...options,
                ...(observationEnabled ? { onObservation: observe } : {}),
            });

            try {
                expect(primaryCopies).not.toHaveBeenCalled();
                expect(secondaryCopies).not.toHaveBeenCalled();
                expect(en.listenerCount()).toBe(1);
                expect(ja.listenerCount()).toBe(1);
                expect(observe).toHaveBeenCalledTimes(
                    observationEnabled ? 1 : 0,
                );
                if (observationEnabled) {
                    expect(observe).toHaveBeenLastCalledWith(
                        expect.objectContaining({
                            event: 'bound',
                            primary: expect.objectContaining({ cueCount: 1 }),
                            secondary: expect.objectContaining({ cueCount: 1 }),
                        }),
                    );
                }
            } finally {
                session.dispose();
            }
        },
    );

    it('別 track への切替でも cue をコピーせず要約を通知する', () => {
        const { options, tracks, en, ja, operations } = createFixture();
        const replacement = createTrack('en', operations);
        const primaryCopies = watchCueCopies(replacement);
        const secondaryCopies = watchCueCopies(ja);
        tracks.append(replacement);
        const observe = vi.fn();
        const session = createSubtitleSession({
            ...options,
            onObservation: observe,
        });

        try {
            expect(primaryCopies).not.toHaveBeenCalled();
            secondaryCopies.mockClear();
            observe.mockClear();

            tracks.remove(en);

            expect(primaryCopies).not.toHaveBeenCalled();
            expect(secondaryCopies).not.toHaveBeenCalled();
            expect(en.listenerCount()).toBe(0);
            expect(replacement.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(1);
            expect(observe).toHaveBeenCalledTimes(1);
            expect(observe).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    event: 'bound',
                    primary: expect.objectContaining({ cueCount: 1 }),
                    secondary: expect.objectContaining({ cueCount: 1 }),
                }),
            );
        } finally {
            session.dispose();
        }
    });

    it('bind 失敗時の未採用通知を維持し、再試行成功時も cue をコピーしない', () => {
        const { options, en, ja, video } = createFixture();
        const primaryCopies = watchCueCopies(en);
        const secondaryCopies = watchCueCopies(ja);
        ja.addEventListener.mockImplementationOnce(() => {
            throw new Error('temporary registration failure');
        });
        const observe = vi.fn();
        const session = createSubtitleSession({
            ...options,
            onObservation: observe,
        });

        try {
            expect(observe).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    event: 'snapshot',
                    primary: null,
                    secondary: null,
                }),
            );
            expect(primaryCopies).not.toHaveBeenCalled();
            expect(secondaryCopies).not.toHaveBeenCalled();
            observe.mockClear();

            video.fire('playing');

            expect(primaryCopies).not.toHaveBeenCalled();
            expect(secondaryCopies).not.toHaveBeenCalled();
            expect(en.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(1);
            expect(observe).toHaveBeenCalledTimes(1);
            expect(observe).toHaveBeenLastCalledWith(
                expect.objectContaining({ event: 'bound' }),
            );
        } finally {
            session.dispose();
        }
    });
});

/**
 * ログ引数にだけ使われる currentTime の読取回数を観測する。
 *
 * @param video fixture が作成した video test double。実 DOM は渡さない。
 * @returns 時刻読取 spy。テストが回数を確認・クリアする。
 */
const watchLogTimeReads = (video: { currentTime: number }) => {
    const readCurrentTime = vi.fn(() => 1.5);
    Object.defineProperty(video, 'currentTime', {
        configurable: true,
        get: readCurrentTime,
    });
    return readCurrentTime;
};

describe('subtitle-session の読込み完了と cuechange の要約取得', () => {
    it.each(['primary', 'secondary'] as const)(
        '%s の読込み完了と両役割の cuechange でも cue 本文をコピーしない',
        (role) => {
            const { options, en, ja, video } = createFixture();
            const target = role === 'primary' ? en : ja;
            setTrackCues(target, []);
            const observe = vi.fn();
            const session = createSubtitleSession({
                ...options,
                onObservation: observe,
            });

            try {
                expect(observe).toHaveBeenLastCalledWith(
                    expect.objectContaining({
                        [role]: expect.objectContaining({ cueCount: 0 }),
                    }),
                );
                const primaryCopies = watchCueCopies(en);
                const secondaryCopies = watchCueCopies(ja);
                observe.mockClear();

                video.fire('timeupdate');

                expect(observe).toHaveBeenCalledTimes(1);
                expect(observe).toHaveBeenLastCalledWith(
                    expect.objectContaining({
                        event: 'snapshot',
                        primary: expect.objectContaining({ cueCount: 1 }),
                        secondary: expect.objectContaining({ cueCount: 1 }),
                        primaryCueChanges: 0,
                        secondaryCueChanges: 0,
                    }),
                );

                en.fireCueChange();
                ja.fireCueChange();

                expect(observe).toHaveBeenCalledTimes(3);
                expect(observe).toHaveBeenLastCalledWith(
                    expect.objectContaining({
                        event: 'cuechange',
                        role: 'secondary',
                        primaryCueChanges: 1,
                        secondaryCueChanges: 1,
                    }),
                );
                expect(primaryCopies).not.toHaveBeenCalled();
                expect(secondaryCopies).not.toHaveBeenCalled();
            } finally {
                session.dispose();
            }
        },
    );
});

describe('subtitle-session のログ引数生成の抑制', () => {
    it('debug 無効でも bind と cuechange を観測し、ログ専用の値は生成しない', () => {
        const { options, en, ja, video, logger } = createFixture();
        const summarize = vi.spyOn(trackResolver, 'summarizeTrack');
        const readTime = watchLogTimeReads(video);
        const observe = vi.fn();
        const session = createSubtitleSession({
            ...options,
            logger: { ...logger, isEnabled: () => false },
            onObservation: observe,
        });

        try {
            expect(observe).toHaveBeenLastCalledWith(
                expect.objectContaining({ event: 'bound' }),
            );
            expect(readTime).not.toHaveBeenCalled();
            summarize.mockClear();
            observe.mockClear();

            en.fireCueChange();
            ja.fireCueChange();

            expect(observe).toHaveBeenCalledTimes(2);
            expect(observe).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    event: 'cuechange',
                    role: 'secondary',
                    primary: expect.objectContaining({ cueCount: 1 }),
                    secondary: expect.objectContaining({ cueCount: 1 }),
                    primaryCueChanges: 1,
                    secondaryCueChanges: 1,
                }),
            );
            expect(logger.debug).not.toHaveBeenCalled();
            expect(summarize).not.toHaveBeenCalled();
            expect(readTime).not.toHaveBeenCalled();
            expect(en.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(1);
        } finally {
            session.dispose();
        }
    });

    it.each(['primary', 'secondary'] as const)(
        'debug 無効でも %s の同じ track の読込み完了を通知する',
        (role) => {
            const { options, en, ja, video, logger, operations } =
                createFixture();
            const target = role === 'primary' ? en : ja;
            setTrackCues(target, []);
            const summarize = vi.spyOn(trackResolver, 'summarizeTrack');
            const readTime = watchLogTimeReads(video);
            const observe = vi.fn();
            const session = createSubtitleSession({
                ...options,
                logger: { ...logger, isEnabled: () => false },
                onObservation: observe,
            });

            try {
                observe.mockClear();
                summarize.mockClear();
                operations.length = 0;

                setTrackCues(target, ['loaded subtitle']);
                video.fire('timeupdate');

                expect(observe).toHaveBeenCalledTimes(1);
                expect(observe).toHaveBeenLastCalledWith(
                    expect.objectContaining({
                        event: 'snapshot',
                        role: null,
                        [role]: expect.objectContaining({ cueCount: 1 }),
                        primaryCueChanges: 0,
                        secondaryCueChanges: 0,
                    }),
                );
                expect(logger.debug).not.toHaveBeenCalled();
                expect(summarize).not.toHaveBeenCalled();
                expect(readTime).not.toHaveBeenCalled();
                expect(operations).toEqual([]);

                observe.mockClear();
                video.fire('playing');
                expect(observe).not.toHaveBeenCalled();
            } finally {
                session.dispose();
            }
        },
    );

    it('debug 有効時はログ引数を生成し、観測通知も維持する', () => {
        const { options, en, video, logger } = createFixture();
        const summarize = vi.spyOn(trackResolver, 'summarizeTrack');
        const readTime = watchLogTimeReads(video);
        const observe = vi.fn();
        const session = createSubtitleSession({
            ...options,
            logger: { ...logger, isEnabled: () => true },
            onObservation: observe,
        });

        try {
            summarize.mockClear();
            readTime.mockClear();
            logger.debug.mockClear();
            observe.mockClear();

            en.fireCueChange();

            expect(summarize).toHaveBeenCalledTimes(2);
            expect(readTime).toHaveBeenCalledTimes(1);
            expect(logger.debug).toHaveBeenCalledTimes(1);
            expect(logger.debug).toHaveBeenCalledWith(
                'subtitle source snapshot',
                expect.objectContaining({
                    event: 'cuechange',
                    role: 'primary',
                    primaryCueCount: 1,
                    secondaryCueCount: 1,
                    currentTime: 1.5,
                }),
            );
            expect(observe).toHaveBeenCalledTimes(1);
        } finally {
            session.dispose();
        }
    });
});
