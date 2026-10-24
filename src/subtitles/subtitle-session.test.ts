/**
 * subtitle-session の small integration test。
 * 実際の resolver / source と fake track を接続し、採用・通知・cleanup を確認する。
 * readiness と playback session 全体の制御は session-lifecycle.test.ts で確認する。
 */
import { describe, expect, it, vi } from 'vitest';

import {
    createSubtitleSession,
    type SubtitleSessionOptions,
} from './subtitle-session';
import type { ReadySettings } from '../settings/settings-store';

/** listener を手動発火し、実際の残存数を確認できる track。 */
type FakeTrack = TextTrack & {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    fireCueChange(): void;
    listenerCount(): number;
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
 * 英語・日本語の track と観測用 logger を用意する。
 *
 * @param settings 正規化済み設定。省略時は英語 primary・日本語 secondary。
 * @param fallbackSecondaryLang runtime fallback。省略時は利用しない。
 * @returns 字幕接続の入力、track、logger、listener 操作順。
 */
const createFixture = (
    settings: ReadySettings = { primaryLang: 'en', secondaryLang: 'ja' },
    fallbackSecondaryLang: string | null = null,
) => {
    const operations: string[] = [];
    const en = createTrack('en', operations);
    const ja = createTrack('ja', operations);
    const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
    const videoEl = {
        textTracks: [en, ja],
        currentTime: 1.5,
    } as unknown as HTMLVideoElement;
    const options: SubtitleSessionOptions = {
        videoEl,
        settings,
        fallbackSecondaryLang,
        logger,
    };
    return { options, en, ja, logger, operations };
};

describe('createSubtitleSession', () => {
    it('採用 track を bind し、初回 bound で cue 件数を観測する', () => {
        const { options, en, ja, logger } = createFixture();
        const session = createSubtitleSession(options);
        try {
            expect(en.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(1);
            expect(logger.info).toHaveBeenCalledWith(
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
            en.fireCueChange();
            ja.fireCueChange();
            expect(logger.info.mock.calls).toEqual([
                ['subtitle source snapshot', expect.objectContaining({
                    event: 'cuechange',
                    role: 'primary',
                    primaryCueCount: 1,
                    secondaryCueCount: 1,
                })],
                ['subtitle source snapshot', expect.objectContaining({
                    event: 'cuechange',
                    role: 'secondary',
                    primaryCueCount: 1,
                    secondaryCueCount: 1,
                })],
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
            expect(logger.info).toHaveBeenCalledWith(
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
            expect(logger.info).toHaveBeenCalledWith(
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
            expect(logger.info).toHaveBeenCalledWith(
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

    it('採用候補なしは例外にせず、未 bind を警告する', () => {
        const { options, en, ja, logger } = createFixture({
            primaryLang: 'fr',
            secondaryLang: null,
        });
        const session = createSubtitleSession(options);
        try {
            expect(en.listenerCount()).toBe(0);
            expect(ja.listenerCount()).toBe(0);
            expect(logger.warn).toHaveBeenCalledWith(
                'subtitle source has no bound track',
            );
            expect(logger.error).not.toHaveBeenCalled();
        } finally {
            session.dispose();
        }
    });

    it('dispose は listener を逆順で一度だけ解除し、以後は観測しない', () => {
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

    it('listener 解除失敗を記録し、残った旧 listener の通知を遮断する', () => {
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

    it('listener 登録失敗は source のログと未 bind 警告で区別する', () => {
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
        } finally {
            session.dispose();
        }
    });

    it('cue 読取失敗は空配列として観測し、他方の cue 取得を続ける', () => {
        const { options, en, logger } = createFixture();
        Object.defineProperty(en, 'cues', {
            get() {
                throw new Error('cues unavailable');
            },
        });
        const session = createSubtitleSession(options);
        try {
            expect(logger.info).toHaveBeenCalledWith(
                'subtitle source snapshot',
                expect.objectContaining({
                    primaryCueCount: 0,
                    secondaryCueCount: 1,
                }),
            );
            expect(logger.error).toHaveBeenCalledWith(
                'subtitle source failed to read cues',
                expect.objectContaining({ error: expect.any(Error) }),
            );
        } finally {
            session.dispose();
        }
    });

    it('初期化途中の例外では登録済み listener を解除して例外を返す', () => {
        const { options, en, ja, logger } = createFixture();
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
