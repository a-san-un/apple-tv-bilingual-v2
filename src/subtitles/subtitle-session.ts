/**
 * readiness 通過後の video に対し、resolver と source を接続する。
 * source とその購読を所有し、採用結果・cue 件数をログと任意 callback へ通知する。
 * playback session 全体の開始停止は session-lifecycle.ts が担当する。
 * readiness 待機、mode 変更、truth 構築、DOM、native menu 同期は担当しない。
 */
import type { ReadySettings } from '../settings/settings-store';
import { createDisposeBag } from '../shared/dispose';
import { createSubtitleLogger, type Logger } from '../shared/log';
import type {
    Disposable,
    LanguageCode,
    ResolvedSubtitleTrack,
    SubtitleSourceChange,
    SubtitleSourceSnapshot,
    SubtitleTrackRole,
} from '../shared/types';
import {
    createSubtitleSource,
    type SubtitleSource,
} from './subtitle-source';
import {
    resolveTrackPair,
    summarizeTrack,
} from './text-track-resolver';

/** 実 TextTrack を含まない、観測時点の採用 track 情報。 */
export type SubtitleTrackObservation = {
    language: string;
    label: string;
    mode: TextTrackMode | 'unknown';
    cueCount: number;
};

/** 字幕接続が提供する観測情報。字幕本文や実 TextTrack は保持しない。 */
export type SubtitleSessionObservation = {
    videoEl: HTMLVideoElement;
    event: SubtitleSourceChange['type'] | 'snapshot';
    role: SubtitleTrackRole | null;
    primary: SubtitleTrackObservation | null;
    secondary: SubtitleTrackObservation | null;
    primaryCueChanges: number;
    secondaryCueChanges: number;
};

/**
 * 字幕接続の入力。
 * settings は settings store の ready 結果を渡す。
 * fallback は呼び出し側が取得し、利用しない場合は null を渡す。
 * onObservation は観測用であり、その例外で字幕処理を停止しない。
 */
export type SubtitleSessionOptions = {
    videoEl: HTMLVideoElement;
    settings: ReadySettings;
    fallbackSecondaryLang: LanguageCode | null;
    logger?: Logger;
    onObservation?: (observation: SubtitleSessionObservation) => void;
};

/**
 * current video の track を解決し、source に接続する。
 * 候補なしや source 内で処理された bind 失敗はログで観測する。
 *
 * @param options video、設定、fallback と任意の logger・観測 callback。
 * @returns lifecycle が保持し、停止・再開始・破棄時に実行する Disposable。
 * @throws 初期化を継続できない場合。その cleanup も失敗した場合は AggregateError。
 */
export const createSubtitleSession = (
    options: SubtitleSessionOptions,
): Disposable => {
    const videoEl = options.videoEl;
    const settings = { ...options.settings };
    const fallbackSecondaryLang = options.fallbackSecondaryLang;
    const logger = options.logger ?? createSubtitleLogger();
    const onObservation = options.onObservation;
    const bag = createDisposeBag();

    let source: SubtitleSource | null = null;
    let disposed = false;
    let receivedSourceChange = false;
    let primaryCueChanges = 0;
    let secondaryCueChanges = 0;

    /**
     * snapshot の track を、実 TextTrack を含まない観測情報に変換する。
     *
     * @param track source が実際に保持する採用 track。null は未採用。
     * @param cueCount snapshot から読み取れた cue 件数。
     * @returns 言語・label・観測時点の mode・cue 件数。未採用なら null。
     */
    const observeTrack = (
        track: ResolvedSubtitleTrack | null,
        cueCount: number,
    ): SubtitleTrackObservation | null => {
        if (track === null) {
            return null;
        }

        let mode: SubtitleTrackObservation['mode'] = 'unknown';
        try {
            // 正規化時の mode ではなく、通知時点の実 track の値を読む。
            mode = track.track.mode;
        } catch (error) {
            logger.warn('subtitle observation failed to read mode', { error });
        }

        return {
            language: track.language,
            label: track.label,
            mode,
            cueCount,
        };
    };

    /**
     * snapshot の要約を観測先へ渡す。
     * callback の例外は記録し、字幕接続へ伝播させない。
     *
     * @param snapshot source が返した現在の snapshot。
     * @param event 観測契機。snapshot は source 通知がなかった初期状態の読取り。
     * @param role cuechange の役割。それ以外は null。
     */
    const publishObservation = (
        snapshot: SubtitleSourceSnapshot,
        event: SubtitleSessionObservation['event'],
        role: SubtitleTrackRole | null,
    ): void => {
        if (disposed || onObservation === undefined) {
            return;
        }

        try {
            onObservation({
                videoEl,
                event,
                role,
                primary: observeTrack(
                    snapshot.pair.primary,
                    snapshot.primaryCues.length,
                ),
                secondary: observeTrack(
                    snapshot.pair.secondary,
                    snapshot.secondaryCues.length,
                ),
                primaryCueChanges,
                secondaryCueChanges,
            });
        } catch (error) {
            logger.error('subtitle observation callback failed', { error });
        }
    };

    /**
     * source の変化を既存ログと観測 callback へ渡す。
     *
     * @param change source の bound / unbound / cuechange 通知。
     */
    const observeSourceChange = (change: SubtitleSourceChange): void => {
        if (disposed || source === null) {
            return;
        }

        receivedSourceChange = true;

        if (change.type === 'cuechange') {
            if (change.role === 'primary') {
                primaryCueChanges += 1;
            } else {
                secondaryCueChanges += 1;
            }
        } else {
            primaryCueChanges = 0;
            secondaryCueChanges = 0;
        }

        const snapshot = source.getSnapshot();
        const role = change.type === 'cuechange' ? change.role : null;

        logger.info('subtitle source snapshot', {
            event: change.type,
            role,
            primary: summarizeTrack(snapshot.pair.primary),
            secondary: summarizeTrack(snapshot.pair.secondary),
            primaryCueCount: snapshot.primaryCues.length,
            secondaryCueCount: snapshot.secondaryCues.length,
            currentTime: videoEl.currentTime,
        });

        publishObservation(snapshot, change.type, role);
    };

    /**
     * 通知を無効化し、購読解除と source の破棄を一度だけ試す。
     *
     * @throws bag の cleanup が失敗した場合は AggregateError。
     *   source 内で記録された listener 解除失敗は含まれないことがある。
     */
    const dispose = (): void => {
        if (disposed) {
            return;
        }

        disposed = true;

        try {
            bag.dispose();
        } finally {
            source = null;
            logger.info('subtitle session cleanup attempted');
        }
    };

    try {
        const pair = resolveTrackPair({
            textTracks: videoEl.textTracks,
            primaryLang: settings.primaryLang,
            secondaryLang: settings.secondaryLang,
            fallbackSecondaryLang,
        });

        logger.info('subtitle tracks resolved', {
            primaryLang: settings.primaryLang,
            secondaryLang: settings.secondaryLang,
            fallbackSecondaryLang,
            trackCount: videoEl.textTracks.length,
            primary: summarizeTrack(pair.primary),
            secondary: summarizeTrack(pair.secondary),
        });

        const createdSource = createSubtitleSource(videoEl, { logger });
        source = createdSource;

        // 逆順 cleanup で購読解除を先に試すため、source の破棄を先に登録する。
        bag.add(() => {
            createdSource.dispose();
        });

        // 初回 bound の通知を受け取れるよう、bind より先に購読する。
        bag.add(createdSource.subscribe(observeSourceChange));
        createdSource.bind(pair);

        const snapshot = createdSource.getSnapshot();

        // 未採用や bind 失敗で通知がなくても、未接続との違いを表示できるようにする。
        if (!receivedSourceChange) {
            publishObservation(snapshot, 'snapshot', null);
        }

        if (
            snapshot.pair.primary === null &&
            snapshot.pair.secondary === null
        ) {
            logger.warn('subtitle source has no bound track');
        }
    } catch (error) {
        try {
            dispose();
        } catch (cleanupError) {
            throw new AggregateError(
                [error, cleanupError],
                'Subtitle session initialization and cleanup failed',
            );
        }

        throw error;
    }

    return { dispose };
};
