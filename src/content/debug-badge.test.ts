/* @vitest-environment jsdom */
/**
 * debug-badge.test.ts
 *
 * session debug badge の表示、配置、更新、track 件数の追従、破棄を確認する。
 * 実際の playback dialog の見え方と字幕取得は、このテストの対象外。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubtitleSessionObservation } from '../subtitles/subtitle-session';

import {
    createSessionDebugBadge,
    type SessionDebugBadge,
} from './debug-badge';
import type { PlaybackTarget, SessionState } from '../shared/types';

/** テスト終了時に破棄する debug view。 */
const badges: SessionDebugBadge[] = [];

/**
 * 後処理の対象として badge を登録する。
 *
 * @param enabled 表示を有効にするか。
 * @returns 各テストで状態を渡す debug view。
 */
const createBadge = (enabled = true): SessionDebugBadge => {
    const badge = createSessionDebugBadge(enabled);
    badges.push(badge);
    return badge;
};

/**
 * 件数とイベント送出だけを提供する track 一覧の test double を作る。
 *
 * @param count 初期件数。
 * @returns video.textTracks へ差し替える EventTarget。
 */
const createTrackList = (
    count: number,
): EventTarget & { length: number } =>
    Object.assign(new EventTarget(), { length: count });

/**
 * badge の配置先として使う最小 target を作る。
 *
 * @param trackCount video に見せる track 件数。
 * @param rootEl 配置先。省略時は新しい root を作る。
 * @returns document に接続した root と video を持つ target。
 */
const createTarget = (
    trackCount = 0,
    rootEl: HTMLElement = document.createElement('div'),
): PlaybackTarget => {
    const videoEl = document.createElement('video');
    const tracks = createTrackList(trackCount);

    Object.defineProperty(videoEl, 'textTracks', {
        configurable: true,
        value: tracks,
    });

    rootEl.appendChild(videoEl);
    if (!rootEl.isConnected) {
        document.body.appendChild(rootEl);
    }

    const snapshot = {
        rootEl,
        videoEl,
        panelMountEl: rootEl,
        layoutTargetEl: rootEl,
    };

    return {
        ...snapshot,
        snapshot,
    };
};

/**
 * track 件数を変更して、一覧の変化イベントを送る。
 *
 * @param target 件数を変更する video を持つ target。
 * @param count 変更後の件数。
 * @param eventName 追加または削除のイベント名。
 */
const changeTrackCount = (
    target: PlaybackTarget,
    count: number,
    eventName: 'addtrack' | 'removetrack',
): void => {
    const tracks = target.videoEl.textTracks;

    Object.defineProperty(tracks, 'length', {
        configurable: true,
        writable: true,
        value: count,
    });

    tracks.dispatchEvent(new Event(eventName));
};

/**
 * readiness 通過後の状態を作る。
 *
 * @param target 表示対象の playback target。
 * @returns running 状態。
 */
const createRunningState = (target: PlaybackTarget): SessionState => ({
    status: 'running',
    target,
    waiting: null,
    reason: 'initial-start',
});

/**
 * target を保持した readiness 待機状態を作る。
 *
 * @param target 待機対象の playback target。
 * @returns waiting 状態。
 */
const createWaitingState = (target: PlaybackTarget): SessionState => ({
    status: 'waiting',
    target,
    waiting: {
        startedAt: 0,
        retryCount: 0,
        targetVideo: target.videoEl,
    },
    reason: 'initial-start',
});

/**
 * root 内の badge を取得する。
 *
 * @param rootEl 検索する root。
 * @returns 存在する場合は badge、なければ null。
 */
const findBadge = (rootEl: HTMLElement): HTMLDivElement | null =>
    rootEl.querySelector<HTMLDivElement>(
        '[data-atv-bilingual-debug="session"]',
    );

afterEach(() => {
    for (const badge of badges) {
        badge.dispose();
    }
    badges.length = 0;
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe('debug-badge', () => {
    it('shows the existing session, reason, and track count', () => {
        const target = createTarget(4);
        const badge = createBadge();

        badge.update(createRunningState(target));

        const element = findBadge(target.rootEl);

        expect(element).not.toBeNull();
        expect(element?.textContent).toBe(
            'session: running | reason: initial-start | tracks: 4',
        );
        expect(element?.style.background).toContain('22, 101, 52');
        expect(element?.style.pointerEvents).toBe('none');
    });

    it('shows waiting and updates its color when running', () => {
        const target = createTarget();
        const badge = createBadge();

        badge.update(createWaitingState(target));

        const element = findBadge(target.rootEl);

        expect(element?.textContent).toContain('session: waiting');
        expect(element?.style.background).toContain('180, 83, 9');

        badge.update(createRunningState(target));

        expect(findBadge(target.rootEl)).toBe(element);
        expect(element?.textContent).toContain('session: running');
        expect(element?.style.background).toContain('22, 101, 52');
    });

    it('moves the same badge to a new root without leaving old DOM', () => {
        const first = createTarget(2);
        const second = createTarget(3);
        const badge = createBadge();

        badge.update(createRunningState(first));
        const element = findBadge(first.rootEl);

        badge.update(createRunningState(second));

        expect(findBadge(first.rootEl)).toBeNull();
        expect(findBadge(second.rootEl)).toBe(element);
        expect(element?.textContent).toContain('tracks: 3');
        expect(
            document.querySelectorAll('[data-atv-bilingual-debug="session"]'),
        ).toHaveLength(1);
    });

    it('does not replace the text node when the display is unchanged', () => {
        const target = createTarget(2);
        const state = createRunningState(target);
        const badge = createBadge();

        badge.update(state);
        const element = findBadge(target.rootEl);
        const textNode = element?.firstChild;

        expect(textNode).not.toBeNull();
        expect(textNode).not.toBeUndefined();

        badge.update(state);

        expect(findBadge(target.rootEl)).toBe(element);
        expect(element?.firstChild).toBe(textNode);
        expect(
            target.rootEl.querySelectorAll('[data-atv-bilingual-debug="session"]'),
        ).toHaveLength(1);
    });

    it('removes the badge when stopped even if the target is retained', () => {
        const target = createTarget(2);
        const badge = createBadge();

        badge.update(createRunningState(target));
        expect(findBadge(target.rootEl)).not.toBeNull();

        badge.update({
            status: 'stopped',
            target,
            waiting: null,
            reason: null,
        });

        expect(findBadge(target.rootEl)).toBeNull();

        badge.update(createRunningState(target));
        expect(findBadge(target.rootEl)).not.toBeNull();
    });

    it('removes the badge when the target becomes unresolved', () => {
        const target = createTarget();
        const badge = createBadge();

        badge.update(createWaitingState(target));
        expect(findBadge(target.rootEl)).not.toBeNull();

        badge.update({
            status: 'waiting',
            target: null,
            waiting: null,
            reason: 'spa-navigation',
        });

        expect(findBadge(target.rootEl)).toBeNull();
    });

    it('does not mount DOM for idle state', () => {
        const badge = createBadge();

        badge.update({
            status: 'idle',
            target: null,
            waiting: null,
            reason: null,
        });

        expect(
            document.querySelector('[data-atv-bilingual-debug="session"]'),
        ).toBeNull();
    });

    it('disposes once and does not remount after disposal', () => {
        const target = createTarget(2);
        const badge = createBadge();

        badge.update(createRunningState(target));
        expect(findBadge(target.rootEl)).not.toBeNull();

        badge.dispose();
        expect(findBadge(target.rootEl)).toBeNull();

        expect(() => badge.dispose()).not.toThrow();

        badge.update(createRunningState(target));
        expect(findBadge(target.rootEl)).toBeNull();
    });

    it('does not create badge DOM or listeners when disabled', () => {
        const target = createTarget(2);
        const addListener = vi.spyOn(
            target.videoEl.textTracks,
            'addEventListener',
        );
        const badge = createBadge(false);

        badge.update(createRunningState(target));

        expect(findBadge(target.rootEl)).toBeNull();
        expect(addListener).not.toHaveBeenCalled();
        expect(() => badge.dispose()).not.toThrow();
    });

    it('updates from 1 to 281 tracks without another state update', () => {
        const target = createTarget(1);
        const badge = createBadge();

        badge.update(createRunningState(target));
        const element = findBadge(target.rootEl);

        expect(element?.textContent).toBe(
            'session: running | reason: initial-start | tracks: 1',
        );

        changeTrackCount(target, 281, 'addtrack');

        expect(findBadge(target.rootEl)).toBe(element);
        expect(element?.textContent).toBe(
            'session: running | reason: initial-start | tracks: 281',
        );
    });

    it('updates the count when a track is removed', () => {
        const target = createTarget(281);
        const badge = createBadge();

        badge.update(createRunningState(target));
        changeTrackCount(target, 280, 'removetrack');

        expect(findBadge(target.rootEl)?.textContent).toContain(
            'tracks: 280',
        );
    });

    it('updates track count while keeping the waiting state', () => {
        const target = createTarget();
        const badge = createBadge();

        badge.update(createWaitingState(target));
        changeTrackCount(target, 1, 'addtrack');

        const element = findBadge(target.rootEl);

        expect(element?.textContent).toBe(
            'session: waiting | reason: initial-start | tracks: 1',
        );
        expect(element?.style.background).toContain('180, 83, 9');
    });

    it('does not replace text for an event with an unchanged count', () => {
        const target = createTarget(2);
        const badge = createBadge();

        badge.update(createRunningState(target));

        const element = findBadge(target.rootEl);
        const textNode = element?.firstChild;

        changeTrackCount(target, 2, 'addtrack');

        expect(element?.firstChild).toBe(textNode);
    });

    it('does not register duplicate listeners for the same track list', () => {
        const target = createTarget(2);
        const addListener = vi.spyOn(
            target.videoEl.textTracks,
            'addEventListener',
        );
        const badge = createBadge();

        badge.update(createWaitingState(target));
        badge.update(createRunningState(target));
        badge.update(createRunningState(target));

        expect(addListener).toHaveBeenCalledTimes(2);
        expect(addListener).toHaveBeenCalledWith(
            'addtrack',
            expect.any(Function),
        );
        expect(addListener).toHaveBeenCalledWith(
            'removetrack',
            expect.any(Function),
        );
    });

    it('releases the old list when video changes within the same root', () => {
        const first = createTarget(1);
        const second = createTarget(2, first.rootEl);
        const removeOldListener = vi.spyOn(
            first.videoEl.textTracks,
            'removeEventListener',
        );
        const badge = createBadge();

        badge.update(createRunningState(first));
        const element = findBadge(first.rootEl);

        badge.update(createRunningState(second));

        expect(removeOldListener).toHaveBeenCalledTimes(2);
        expect(findBadge(second.rootEl)).toBe(element);
        expect(element?.textContent).toContain('tracks: 2');

        changeTrackCount(first, 281, 'addtrack');

        expect(element?.textContent).toContain('tracks: 2');

        changeTrackCount(second, 284, 'addtrack');

        expect(element?.textContent).toContain('tracks: 284');
    });

    it('releases observation when stopped and restores it on restart', () => {
        const target = createTarget(1);
        const tracks = target.videoEl.textTracks;
        const removeListener = vi.spyOn(tracks, 'removeEventListener');
        const addListener = vi.spyOn(tracks, 'addEventListener');
        const badge = createBadge();

        badge.update(createRunningState(target));
        const element = findBadge(target.rootEl);

        badge.update({
            status: 'stopped',
            target,
            waiting: null,
            reason: null,
        });

        expect(removeListener).toHaveBeenCalledTimes(2);
        expect(findBadge(target.rootEl)).toBeNull();

        const stoppedText = element?.textContent;
        changeTrackCount(target, 281, 'addtrack');

        expect(element?.textContent).toBe(stoppedText);
        expect(findBadge(target.rootEl)).toBeNull();

        badge.update(createRunningState(target));

        expect(addListener).toHaveBeenCalledTimes(4);
        expect(findBadge(target.rootEl)?.textContent).toContain(
            'tracks: 281',
        );
    });

    it('releases observation when the target becomes unresolved', () => {
        const target = createTarget(1);
        const removeListener = vi.spyOn(
            target.videoEl.textTracks,
            'removeEventListener',
        );
        const badge = createBadge();

        badge.update(createRunningState(target));
        const element = findBadge(target.rootEl);

        badge.update({
            status: 'waiting',
            target: null,
            waiting: null,
            reason: 'spa-navigation',
        });

        expect(removeListener).toHaveBeenCalledTimes(2);
        expect(findBadge(target.rootEl)).toBeNull();

        const unresolvedText = element?.textContent;
        changeTrackCount(target, 281, 'addtrack');

        expect(element?.textContent).toBe(unresolvedText);
        expect(findBadge(target.rootEl)).toBeNull();
    });

    it('releases both listeners once and ignores events after disposal', () => {
        const target = createTarget(1);
        const removeListener = vi.spyOn(
            target.videoEl.textTracks,
            'removeEventListener',
        );
        const badge = createBadge();

        badge.update(createRunningState(target));
        const element = findBadge(target.rootEl);
        const previousText = element?.textContent;

        badge.dispose();
        badge.dispose();

        expect(removeListener).toHaveBeenCalledTimes(2);
        expect(removeListener).toHaveBeenCalledWith(
            'addtrack',
            expect.any(Function),
        );
        expect(removeListener).toHaveBeenCalledWith(
            'removetrack',
            expect.any(Function),
        );

        changeTrackCount(target, 281, 'addtrack');

        expect(element?.textContent).toBe(previousText);
        expect(findBadge(target.rootEl)).toBeNull();
    });
});

/**
 * 字幕表示用の観測情報を作る。
 *
 * @param target 観測対象の video を持つ target。
 * @returns 実 TextTrack や字幕本文を含まないテスト用観測情報。
 */
const createSubtitleObservation = (
    target: PlaybackTarget,
): SubtitleSessionObservation => ({
    videoEl: target.videoEl,
    event: 'bound',
    role: null,
    primary: {
        language: 'en',
        label: 'English',
        mode: 'showing',
        cueCount: 3,
    },
    secondary: {
        language: 'ja',
        label: '日本語',
        mode: 'hidden',
        cueCount: 2,
    },
    primaryCueChanges: 0,
    secondaryCueChanges: 0,
});

describe('debug-badge の字幕観測表示', () => {
    it('running より先に届いた初回 bound を表示する', () => {
        const target = createTarget(2);
        const badge = createBadge();

        badge.updateSubtitle(createSubtitleObservation(target));
        badge.update(createRunningState(target));

        const text = findBadge(target.rootEl)?.textContent;

        expect(text).toContain(
            'session: running | reason: initial-start | tracks: 2',
        );
        expect(text).toContain(
            'primary: en — English | mode: showing | cues: 3',
        );
        expect(text).toContain(
            'secondary: ja — 日本語 | mode: hidden | cues: 2',
        );
        expect(text).toContain('last event: bound');
        expect(text).toContain('cuechange: primary 0 / secondary 0');
    });

    it('cuechange の役割と各言語の通知回数を表示する', () => {
        const target = createTarget(2);
        const badge = createBadge();

        badge.update(createRunningState(target));
        badge.updateSubtitle({
            ...createSubtitleObservation(target),
            event: 'cuechange',
            role: 'secondary',
            primaryCueChanges: 2,
            secondaryCueChanges: 1,
        });

        const text = findBadge(target.rootEl)?.textContent;

        expect(text).toContain('last event: cuechange / secondary');
        expect(text).toContain('cuechange: primary 2 / secondary 1');
    });

    it('未採用と未接続を区別する', () => {
        const target = createTarget(1);
        const badge = createBadge();

        badge.update(createRunningState(target));
        badge.updateSubtitle({
            ...createSubtitleObservation(target),
            secondary: null,
        });

        expect(findBadge(target.rootEl)?.textContent).toContain(
            'secondary: 未採用',
        );

        badge.updateSubtitle(null);

        expect(findBadge(target.rootEl)?.textContent).toContain(
            '字幕: 未接続',
        );
        expect(findBadge(target.rootEl)?.textContent).not.toContain(
            'English',
        );
    });

    it('外部からの観測情報の変更を保持情報へ反映しない', () => {
        const target = createTarget(2);
        const badge = createBadge();
        const observation = createSubtitleObservation(target);

        badge.update(createRunningState(target));
        badge.updateSubtitle(observation);

        if (observation.primary !== null) {
            observation.primary.label = 'changed';
            observation.primary.cueCount = 99;
        }

        changeTrackCount(target, 3, 'addtrack');

        const text = findBadge(target.rootEl)?.textContent;
        expect(text).toContain('English | mode: showing | cues: 3');
        expect(text).not.toContain('changed');
        expect(text).toContain('tracks: 3');
    });

    it('video 切替後に旧字幕情報を表示しない', () => {
        const first = createTarget(2);
        const second = createTarget(3, first.rootEl);
        const badge = createBadge();

        badge.update(createRunningState(first));
        badge.updateSubtitle(createSubtitleObservation(first));
        badge.update(createRunningState(second));

        const text = findBadge(second.rootEl)?.textContent;

        expect(text).toContain('tracks: 3');
        expect(text).toContain('字幕: 未接続');
        expect(text).not.toContain('English');
    });

    it('同じ観測情報で text node を再生成しない', () => {
        const target = createTarget(2);
        const badge = createBadge();
        const observation = createSubtitleObservation(target);

        badge.update(createRunningState(target));
        badge.updateSubtitle(observation);

        const element = findBadge(target.rootEl);
        const textNode = element?.firstChild;

        badge.updateSubtitle(observation);

        expect(element?.firstChild).toBe(textNode);
    });

    it('dispose 後の字幕通知で DOM を再生成しない', () => {
        const target = createTarget(2);
        const badge = createBadge();

        badge.update(createRunningState(target));
        badge.dispose();
        badge.updateSubtitle(createSubtitleObservation(target));

        expect(findBadge(target.rootEl)).toBeNull();
    });
});
