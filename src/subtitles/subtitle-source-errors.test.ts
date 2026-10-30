/**
 * subtitle-source-errors.test.ts
 *
 * 購読者例外、listener 登録・解除失敗、cue 読取失敗の境界を確認する。
 * 共通 helper の fake track と logger を使い、解除試行と残存 listener を観測する。
 * 通常の接続操作と snapshot のコピー保護は、専用のテストファイルで扱う。
 * cleanup の試行と成功を区別し、旧 binding や停止済み source の通知を遮断する
 * session cleanup の前提を検証する。
 */
import { describe, expect, it, vi } from 'vitest';

import { createFixture } from './subtitle-source-test-helpers';
import { resolveTrackPair } from './text-track-resolver';

describe('createSubtitleSource のエラー境界', () => {

    it.each([
        ['primary', 'cues'], ['secondary', 'cues'],
        ['primary', 'startTime'], ['secondary', 'startTime'],
        ['primary', 'endTime'], ['secondary', 'endTime'],
        ['primary', 'text'], ['secondary', 'text'],
    ] as const)('%sの%s読取失敗を取得単位で伝え、他方の取得と後続復帰を維持する', /**
     * 途中のcue読取例外も当該言語全体の失敗として扱う。
     * @param role 失敗させる言語役割。
     * @param field 例外を投げるプロパティ。
     */ (role, field) => {
        const { ja, en, pair, source } = createFixture();
        const track = role === 'primary' ? ja : en;
        const key = role === 'primary' ? 'primaryCues' : 'secondaryCues';
        const other = role === 'primary' ? 'secondaryCues' : 'primaryCues';
        let failed = true;
        const raw = { startTime: 1, endTime: 2, text: 'recovered' };
        const bad = { ...raw };
        if (field !== 'cues') Object.defineProperty(bad, field, {
            /** cueプロパティの例外を再現する。@throws Error 読取失敗。 */
            get() { throw new Error('cue field failed'); },
        });
        try {
            source.bind(pair);
            expect(source.getSnapshot().readFailed).toBe(false);
            Object.defineProperty(track, 'cues', {
                configurable: true,
                /** @returns 取得するcue配列。@throws Error cues読取失敗時。 */
                get() {
                    if (failed && field === 'cues') throw new Error('cues failed');
                    return failed ? [raw, bad] : [raw];
                },
            });
            const broken = source.getSnapshot();
            expect(broken.readFailed).toBe(true);
            expect(broken[key]).toEqual([]);
            expect(broken[other]).toHaveLength(1);
            broken.readFailed = false;
            expect(source.getSnapshot().readFailed).toBe(true);
            expect(source.getSummary()).not.toHaveProperty('readFailed');
            failed = false;
            const recovered = source.getSnapshot();
            expect(recovered.readFailed).toBe(false);
            expect(recovered[key][0]?.text).toBe('recovered');
            expect(recovered[other]).toHaveLength(1);
            recovered.readFailed = true;
            expect(source.getSnapshot().readFailed).toBe(false);
        } finally { source.dispose(); }
    });

    it('両言語が失敗しても両方を取得し、各失敗を記録する', /** 先行失敗で他方を省略しない。 */ () => {
        const { ja, en, pair, logger, source } = createFixture();
        const primaryRead = vi.fn(/** @throws Error 学習言語の読取失敗。 */ () => { throw new Error('primary failed'); });
        const secondaryRead = vi.fn(/** @throws Error 母国語の読取失敗。 */ () => { throw new Error('secondary failed'); });
        try {
            source.bind(pair);
            Object.defineProperty(ja, 'cues', { get: primaryRead });
            Object.defineProperty(en, 'cues', { get: secondaryRead });
            logger.error.mockClear();
            const snapshot = source.getSnapshot();
            expect(snapshot.readFailed).toBe(true);
            expect(snapshot.primaryCues).toEqual([]);
            expect(snapshot.secondaryCues).toEqual([]);
            expect(primaryRead).toHaveBeenCalledTimes(1);
            expect(secondaryRead).toHaveBeenCalledTimes(1);
            expect(logger.error).toHaveBeenCalledTimes(2);
        } finally { source.dispose(); }
    });

    it.each([null, []])('未採用・null・正常な空を読取失敗と扱わない: %j', /**
     * falseは読込み完了の保証ではなく、例外がないことだけを示す。
     * @param cues 読込み前のnullまたは正常な空一覧。
     */ (cues) => {
        const { ja, en, pair, source } = createFixture();
        try {
            expect(source.getSnapshot().readFailed).toBe(false);
            Object.defineProperty(ja, 'cues', { value: cues });
            Object.defineProperty(en, 'cues', { value: cues });
            source.bind(pair);
            expect(source.getSnapshot()).toEqual({ pair, primaryCues: [], secondaryCues: [], readFailed: false });
            source.unbind();
            expect(source.getSnapshot().readFailed).toBe(false);
            source.dispose();
            expect(source.getSnapshot().readFailed).toBe(false);
        } finally { source.dispose(); }
    });

    it('購読者の例外は他の購読者と track 側の dispatch を止めない', () => {
        const { ja, pair, logger, source } = createFixture();
        try {
            const failing = vi.fn(() => {
                throw new Error('listener failed');
            });
            const healthy = vi.fn();
            source.subscribe(failing);
            source.subscribe(healthy);
            source.bind(pair);
            healthy.mockClear();

            expect(() => ja.fireCueChange()).not.toThrow();

            expect(healthy).toHaveBeenCalledWith({
                type: 'cuechange',
                role: 'primary',
            });
            expect(logger.error).toHaveBeenCalled();
        } finally {
            source.dispose();
        }
    });

    it('listener 登録の途中で失敗したら、付けた分を外して未 bind に戻す', () => {
        const { ja, en, pair, logger, source } = createFixture();
        try {
            en.addEventListener.mockImplementation(() => {
                throw new Error('add failed');
            });

            expect(() => source.bind(pair)).not.toThrow();

            expect(ja.addEventListener).toHaveBeenCalledTimes(1);
            expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
            expect(ja.listenerCount()).toBe(0);
            expect(source.getSnapshot().pair).toEqual({
                primary: null,
                secondary: null,
            });
            expect(logger.error).toHaveBeenCalled();
        } finally {
            source.dispose();
        }
    });

    it('cue の読取に失敗しても snapshot は空配列で返す', () => {
        const { ja, pair, logger, source } = createFixture();
        try {
            Object.defineProperty(ja, 'cues', {
                get() {
                    throw new Error('cues unavailable');
                },
            });
            source.bind(pair);

            const snapshot = source.getSnapshot();

            expect(snapshot.readFailed).toBe(true);
            expect(snapshot.primaryCues).toEqual([]);
            expect(snapshot.secondaryCues.map((cue) => cue.text)).toEqual(['Hello']);
            expect(logger.error).toHaveBeenCalled();
        } finally {
            source.dispose();
        }
    });

    // 解除に失敗した resource の消失は保証せず、残りの解除試行を確認する。
    it('一方の解除が失敗しても他方を解除し、unbind から例外を漏らさない', () => {
        const { ja, en, pair, logger, source } = createFixture();
        try {
            const listener = vi.fn();
            source.subscribe(listener);
            source.bind(pair);
            listener.mockClear();

            en.removeEventListener.mockImplementation(() => {
                throw new Error('secondary cleanup failed');
            });

            expect(() => source.unbind()).not.toThrow();

            // 逆順で先に解除する secondary が失敗しても、primary の解除は試す。
            expect(en.removeEventListener).toHaveBeenCalledTimes(1);
            expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
            expect(en.listenerCount()).toBe(1);
            expect(ja.listenerCount()).toBe(0);
            expect(logger.error).toHaveBeenCalledWith(
                'subtitle source unbind failed',
                { error: expect.any(AggregateError) },
            );
            expect(listener.mock.calls).toEqual([[{ type: 'unbound' }]]);
            expect(source.getSnapshot()).toEqual({
                pair: { primary: null, secondary: null },
                primaryCues: [],
                secondaryCues: [], readFailed: false,
            });

            listener.mockClear();

            expect(() => source.dispose()).not.toThrow();

            // listener が残っていても、破棄後は購読者へ通知しない。
            en.fireCueChange();
            expect(listener).not.toHaveBeenCalled();
            expect(en.removeEventListener).toHaveBeenCalledTimes(1);
            expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
        } finally {
            source.dispose();
        }
    });

    it('登録失敗後の解除も失敗した場合に bind から例外を漏らさない', () => {
        const { ja, en, pair, logger, source } = createFixture();
        try {
            const listener = vi.fn();
            source.subscribe(listener);

            en.addEventListener.mockImplementation(() => {
                throw new Error('secondary registration failed');
            });
            ja.removeEventListener.mockImplementation(() => {
                throw new Error('primary rollback failed');
            });

            expect(() => source.bind(pair)).not.toThrow();

            expect(ja.addEventListener).toHaveBeenCalledTimes(1);
            expect(en.addEventListener).toHaveBeenCalledTimes(1);
            expect(ja.removeEventListener).toHaveBeenCalledTimes(1);

            // 登録失敗と rollback の解除失敗を、別々のログで確認する。
            expect(logger.error).toHaveBeenCalledWith(
                'subtitle source bind rollback failed',
                { cleanupError: expect.any(AggregateError) },
            );
            expect(logger.error).toHaveBeenCalledWith(
                'subtitle source bind failed',
                { error: expect.any(Error) },
            );
            expect(listener).not.toHaveBeenCalled();
            expect(source.getSnapshot()).toEqual({
                pair: { primary: null, secondary: null },
                primaryCues: [],
                secondaryCues: [], readFailed: false,
            });

            expect(() => source.dispose()).not.toThrow();
            ja.fireCueChange();

            expect(listener).not.toHaveBeenCalled();
            expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
        } finally {
            source.dispose();
        }
    });

    // 実際の解除が失敗しても、管理上は旧 binding の通知を無効化する。
    it('解除に失敗した旧 listener は unbind 後に通知しない', () => {
        const { en, pair, source } = createFixture();
        const listener = vi.fn();

        try {
            source.subscribe(listener);
            source.bind(pair);

            en.removeEventListener.mockImplementation(() => {
                throw new Error('secondary cleanup failed');
            });

            expect(() => source.unbind()).not.toThrow();

            // listener 自体が残っている状態で、通知の遮断を確認する。
            expect(en.listenerCount()).toBe(1);
            expect(listener.mock.calls).toEqual([
                [{ type: 'bound' }],
                [{ type: 'unbound' }],
            ]);
            expect(source.getSnapshot().pair).toEqual({
                primary: null,
                secondary: null,
            });
            listener.mockClear();

            expect(() => en.fireCueChange()).not.toThrow();

            expect(listener).not.toHaveBeenCalled();
        } finally {
            source.dispose();
        }
    });

    // 新 binding に含まれない旧 track のイベントを遮断する。
    it('別 pair への再 bind 後は解除に失敗した旧 track から通知しない', () => {
        const { ja, en, ko, video, pair, source } = createFixture();
        const listener = vi.fn();
        const nextPair = resolveTrackPair({
            textTracks: video.textTracks,
            primaryLang: 'ko',
            secondaryLang: 'en',
        });

        try {
            source.subscribe(listener);
            source.bind(pair);

            ja.removeEventListener.mockImplementation(() => {
                throw new Error('old primary cleanup failed');
            });

            expect(() => source.bind(nextPair)).not.toThrow();

            expect(ja.listenerCount()).toBe(1);
            expect(ko.listenerCount()).toBe(1);
            expect(en.listenerCount()).toBe(1);
            expect(source.getSnapshot().pair).toEqual(nextPair);
            listener.mockClear();

            expect(() => ja.fireCueChange()).not.toThrow();

            expect(listener).not.toHaveBeenCalled();

            // 旧通知を遮断しても、新 binding の両役割は通知を継続する。
            ko.fireCueChange();
            en.fireCueChange();

            expect(listener.mock.calls).toEqual([
                [{ type: 'cuechange', role: 'primary' }],
                [{ type: 'cuechange', role: 'secondary' }],
            ]);
        } finally {
            source.dispose();
        }
    });

    // 同じ track の旧 listener が残っても、現在の役割で一度だけ通知する。
    it('同じ track を含む再 bind 後に旧 listener が残っても通知を重複させない', () => {
        const { ja, en, video, pair, source } = createFixture();
        const listener = vi.fn();
        const nextPair = resolveTrackPair({
            textTracks: video.textTracks,
            primaryLang: 'en',
            secondaryLang: 'ja',
        });

        try {
            source.subscribe(listener);
            source.bind(pair);

            en.removeEventListener.mockImplementation(() => {
                throw new Error('old secondary cleanup failed');
            });

            // en の役割を変更し、旧 listener の通知との違いを確認する。
            expect(() => source.bind(nextPair)).not.toThrow();

            expect(en.addEventListener).toHaveBeenCalledTimes(2);
            expect(en.listenerCount()).toBe(2);
            expect(ja.listenerCount()).toBe(1);
            expect(source.getSnapshot().pair).toEqual(nextPair);
            listener.mockClear();

            expect(() => en.fireCueChange()).not.toThrow();

            expect(listener.mock.calls).toEqual([
                [{ type: 'cuechange', role: 'primary' }],
            ]);

            listener.mockClear();
            ja.fireCueChange();

            expect(listener.mock.calls).toEqual([
                [{ type: 'cuechange', role: 'secondary' }],
            ]);
        } finally {
            source.dispose();
        }
    });
});
