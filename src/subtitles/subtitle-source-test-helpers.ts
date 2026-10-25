/**
 * subtitle-source-test-helpers.ts
 *
 * source テストで共有する fake track、logger、fixture を提供する。
 * 実際の subtitle-source と resolver に接続し、listener 数と通知を観測する。
 * テスト本体、hook 登録、readiness 待機、実ブラウザの再現は担当しない。
 * fixture ごとに独立した source を生成し、unbind / dispose は各テストが実行する。
 */
import { vi } from 'vitest';

import {
    createSubtitleSource,
    type SubtitleSourceVideo,
} from './subtitle-source';
import { resolveTrackPair } from './text-track-resolver';
import type { Logger } from '../shared/log';

/** source が読み取る時刻と本文を持つ、最小の cue。 */
export type FakeCue = {
    startTime: number;
    endTime: number;
    text: string;
};

/**
 * TextTrack として渡せる test double。
 * listener の登録・解除を spy で観測し、残存 listener を手動発火できる。
 */
export type FakeTrack = TextTrack & {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    fireCueChange(): void;
    listenerCount(): number;
};

/**
 * cuechange listener の登録・解除を観測できる track を作る。
 * removeEventListener の mock を失敗させた場合、listener は残存する。
 *
 * @param language resolver が読む track の言語コード。
 * @param cues track.cues として返す一覧。省略時は空配列、null は未読込。
 * @returns 独立した listener 集合と、観測用 method を持つ track。
 */
export const createFakeTrack = (
    language: string,
    cues: FakeCue[] | null = [],
): FakeTrack => {
    const handlers = new Set<EventListener>();

    /**
     * cuechange listener を登録する。
     *
     * @param type イベント名。cuechange 以外は登録しない。
     * @param handler 登録する callback。
     */
    const addEventListener = vi.fn(
        (type: string, handler: EventListener): void => {
            if (type === 'cuechange') {
                handlers.add(handler);
            }
        },
    );

    /**
     * 登録済みの cuechange listener を解除する。
     *
     * @param type イベント名。cuechange 以外は処理しない。
     * @param handler 解除する callback。登録時と同じ参照を渡す。
     */
    const removeEventListener = vi.fn(
        (type: string, handler: EventListener): void => {
            if (type === 'cuechange') {
                handlers.delete(handler);
            }
        },
    );

    const track = {
        id: '',
        language,
        label: language,
        kind: 'subtitles',
        mode: 'hidden' as TextTrackMode,
        cues,
        activeCues: null,
        addEventListener,
        removeEventListener,

        /**
         * 保持している cuechange listener を手動実行する。
         * 実際の TextTrack のイベント処理全体を再現するものではない。
         */
        fireCueChange(): void {
            handlers.forEach((handler) => {
                handler(new Event('cuechange'));
            });
        },

        /**
         * 実際に残っている cuechange listener の数を取得する。
         *
         * @returns 登録済みで、まだ集合から削除されていない listener 数。
         */
        listenerCount(): number {
            return handlers.size;
        },
    };

    return track as unknown as FakeTrack;
};

/**
 * Console へ出力せず、ログ呼出しだけを観測する logger を作る。
 *
 * @returns 各 method が独立した spy の logger。error の呼出し内容を検証できる。
 */
export const createSilentLogger = (): Logger & {
    error: ReturnType<typeof vi.fn>;
} => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
});

/**
 * readiness 通過後の video を想定した、未 bind の source を作る。
 * resolver は実際の実装を使い、ja primary・en secondary を採用する。
 *
 * @returns ja / en / ko の track、video、採用 pair、logger、source。
 *   source の unbind / dispose は、利用するテストが実行する。
 */
export const createFixture = () => {
    const ja = createFakeTrack('ja', [
        { startTime: 1, endTime: 2, text: 'こんにちは' },
    ]);
    const en = createFakeTrack('en', [
        { startTime: 1, endTime: 2, text: 'Hello' },
    ]);
    const ko = createFakeTrack('ko');
    const video: SubtitleSourceVideo = {
        textTracks: [ja, en, ko],
    };

    const pair = resolveTrackPair({
        textTracks: video.textTracks,
        primaryLang: 'ja',
        secondaryLang: 'en',
    });
    const logger = createSilentLogger();
    const source = createSubtitleSource(video, { logger });

    return { ja, en, ko, video, pair, logger, source };
};
