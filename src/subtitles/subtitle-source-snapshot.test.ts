/**
 * subtitle-source-snapshot.test.ts
 *
 * bind 入力と snapshot のコピー保護、実際の TextTrack 参照の共有を確認する。
 * 共通 helper の fixture を使い、管理情報と track 本体の参照を区別する。
 * 基本的な bind 操作とエラー境界は、専用のテストファイルで扱う。
 * コピー後も session の通知と listener cleanup が機能する前提を検証する。
 */
import { describe, expect, it, vi } from 'vitest';

import { createFixture } from './subtitle-source-test-helpers';

describe('createSubtitleSource の snapshot と参照', () => {
    it('snapshot の pair を書き換えても内部の採用結果と listener は変わらない', () => {
        const { ja, en, pair, source } = createFixture();
        try {
            source.bind(pair);

            const snapshot = source.getSnapshot();
            snapshot.pair.primary = null;
            snapshot.pair.secondary = null;

            const nextSnapshot = source.getSnapshot();
            expect(nextSnapshot.pair).toEqual(pair);
            expect(ja.listenerCount()).toBe(1);
            expect(en.listenerCount()).toBe(1);

            // snapshot の変更で内部 pair が壊れると、同じ pair でも再登録されてしまう。
            source.bind(pair);
            expect(ja.addEventListener).toHaveBeenCalledTimes(1);
            expect(en.addEventListener).toHaveBeenCalledTimes(1);
        } finally {
            source.dispose();
        }
    });

    it('snapshot の track 管理情報を書き換えても内部と次の snapshot は変わらない', () => {
        const { pair, source } = createFixture();
        try {
            source.bind(pair);

            const snapshot = source.getSnapshot();
            const primary = snapshot.pair.primary;
            const secondary = snapshot.pair.secondary;

            if (primary === null || secondary === null) {
                throw new Error('fixture must resolve both subtitle tracks');
            }

            primary.language = 'changed-primary';
            primary.label = '変更した学習言語';
            primary.mode = 'disabled';
            secondary.language = 'changed-secondary';
            secondary.label = '変更した母国語';
            secondary.mode = 'disabled';

            const nextSnapshot = source.getSnapshot();
            expect(nextSnapshot.pair).toEqual(pair);
            expect(nextSnapshot.pair).not.toBe(snapshot.pair);
            expect(nextSnapshot.pair.primary).not.toBe(primary);
            expect(nextSnapshot.pair.secondary).not.toBe(secondary);
            expect(pair.primary?.language).toBe('ja');
            expect(pair.secondary?.language).toBe('en');
        } finally {
            source.dispose();
        }
    });

    it('snapshot の cue と cue 側の track 情報を書き換えても内部へ伝わらない', () => {
        const { pair, source } = createFixture();
        try {
            source.bind(pair);

            const snapshot = source.getSnapshot();
            const primaryCue = snapshot.primaryCues[0];
            const secondaryCue = snapshot.secondaryCues[0];

            if (
                primaryCue === undefined ||
                secondaryCue === undefined ||
                primaryCue.track === null ||
                secondaryCue.track === null
            ) {
                throw new Error('fixture must provide cues with track information');
            }

            // cue 側も内部情報ではなく、その snapshot 用の track 情報を参照する。
            expect(primaryCue.track).toBe(snapshot.pair.primary);
            expect(secondaryCue.track).toBe(snapshot.pair.secondary);

            primaryCue.text = '変更した字幕';
            primaryCue.startTime = 100;
            primaryCue.endTime = 101;
            primaryCue.track.label = '変更したprimaryラベル';
            secondaryCue.track.label = '変更したsecondaryラベル';
            snapshot.secondaryCues.length = 0;

            const nextSnapshot = source.getSnapshot();
            expect(nextSnapshot.primaryCues).toEqual([
                {
                    startTime: 1,
                    endTime: 2,
                    text: 'こんにちは',
                    track: pair.primary,
                },
            ]);
            expect(nextSnapshot.secondaryCues).toEqual([
                {
                    startTime: 1,
                    endTime: 2,
                    text: 'Hello',
                    track: pair.secondary,
                },
            ]);
        } finally {
            source.dispose();
        }
    });

    it('bind 元の pair と track 管理情報を書き換えても内部へ伝わらない', () => {
        const { ja, en, ko, pair, source } = createFixture();
        try {
            const primary = pair.primary;
            const secondary = pair.secondary;

            if (primary === null || secondary === null) {
                throw new Error('fixture must resolve both subtitle tracks');
            }

            source.bind(pair);

            // 呼び出し元の変更にかかわらず、source は bind 時の管理情報を維持する。
            primary.language = 'changed-primary';
            primary.label = '変更したprimaryラベル';
            primary.track = ko;
            secondary.language = 'changed-secondary';
            secondary.label = '変更したsecondaryラベル';
            secondary.track = ko;
            pair.primary = null;
            pair.secondary = null;

            const snapshot = source.getSnapshot();
            expect(snapshot.pair.primary).toMatchObject({
                language: 'ja',
                label: 'ja',
                track: ja,
            });
            expect(snapshot.pair.secondary).toMatchObject({
                language: 'en',
                label: 'en',
                track: en,
            });
            expect(snapshot.primaryCues.map((cue) => cue.text)).toEqual(['こんにちは']);
            expect(snapshot.secondaryCues.map((cue) => cue.text)).toEqual(['Hello']);
            expect(ko.addEventListener).not.toHaveBeenCalled();

            source.dispose();
            expect(ja.listenerCount()).toBe(0);
            expect(en.listenerCount()).toBe(0);
        } finally {
            source.dispose();
        }
    });

    it('未 bind の snapshot を書き換えても自分と別 source の未 bind 状態は変わらない', () => {
        const first = createFixture();
        const second = createFixture();

        // 共有された未 bind 情報が漏れた場合も、後続テストへ変更を持ち越さない。
        const snapshot = first.source.getSnapshot();
        const originalPrimary = snapshot.pair.primary;
        const originalSecondary = snapshot.pair.secondary;

        try {
            snapshot.pair.primary = first.pair.primary;
            snapshot.pair.secondary = first.pair.secondary;

            const emptySnapshot = {
                pair: { primary: null, secondary: null },
                primaryCues: [],
                secondaryCues: [], readFailed: false,
            };

            expect(first.source.getSnapshot()).toEqual(emptySnapshot);
            expect(second.source.getSnapshot()).toEqual(emptySnapshot);
        } finally {
            snapshot.pair.primary = originalPrimary;
            snapshot.pair.secondary = originalSecondary;
            first.source.dispose();
            second.source.dispose();
        }
    });

    it('管理情報をコピーしても実際の TextTrack は同一で通知と cleanup が機能する', () => {
        const { ja, en, pair, source } = createFixture();
        try {
            const listener = vi.fn();
            source.subscribe(listener);
            source.bind(pair);

            const first = source.getSnapshot();
            const second = source.getSnapshot();

            expect(first.pair.primary).not.toBe(pair.primary);
            expect(first.pair.secondary).not.toBe(pair.secondary);
            expect(first.pair.primary).not.toBe(second.pair.primary);
            expect(first.pair.secondary).not.toBe(second.pair.secondary);

            // 管理情報はコピーするが、listener の対象となる TextTrack は共有する。
            expect(first.pair.primary?.track).toBe(ja);
            expect(first.pair.secondary?.track).toBe(en);
            expect(second.pair.primary?.track).toBe(ja);
            expect(second.pair.secondary?.track).toBe(en);
            expect(first.primaryCues[0]?.track?.track).toBe(ja);
            expect(first.secondaryCues[0]?.track?.track).toBe(en);

            listener.mockClear();
            ja.fireCueChange();
            en.fireCueChange();

            expect(listener.mock.calls).toEqual([
                [{ type: 'cuechange', role: 'primary' }],
                [{ type: 'cuechange', role: 'secondary' }],
            ]);

            source.unbind();
            source.dispose();
            source.dispose();

            expect(ja.removeEventListener).toHaveBeenCalledTimes(1);
            expect(en.removeEventListener).toHaveBeenCalledTimes(1);
            expect(ja.listenerCount()).toBe(0);
            expect(en.listenerCount()).toBe(0);
        } finally {
            source.dispose();
        }
    });
});
