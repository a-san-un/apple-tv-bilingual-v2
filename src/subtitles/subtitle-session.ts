/**
 * readiness 通過後の video に対し、resolver と source を接続する。
 * source インスタンスとその購読を所有し、採用結果・cue 件数をログで観測する。
 * playback session 全体の開始停止は session-lifecycle.ts が担当し、
 * この module が返す dispose を保持・実行する。
 * readiness 待機、mode 変更、truth 構築、panel、native menu 同期は担当しない。
 */
import type { ReadySettings } from '../settings/settings-store';
import { createDisposeBag } from '../shared/dispose';
import { createSubtitleLogger, type Logger } from '../shared/log';
import type {
    Disposable,
    LanguageCode,
    SubtitleSourceChange,
} from '../shared/types';
import {
    createSubtitleSource,
    type SubtitleSource,
} from './subtitle-source';
import {
    resolveTrackPair,
    summarizeTrack,
} from './text-track-resolver';

/**
 * 字幕接続の入力。
 * settings は settings store の ready 結果を渡す。
 * fallback は呼び出し側が取得し、利用しない場合は null を渡す。
 */
export type SubtitleSessionOptions = {
    videoEl: HTMLVideoElement;
    settings: ReadySettings;
    fallbackSecondaryLang: LanguageCode | null;
    logger?: Logger;
};

/**
 * current video の track を解決し、source に接続する。
 * 候補なしや source 内で処理された bind 失敗はログで観測する。
 * それ以外の初期化例外は、作成済み資源の cleanup を試してから呼び出し元へ返す。
 *
 * @param options readiness 通過後の video、正規化済み設定、fallback と任意 logger。
 * @returns lifecycle が保持し、停止・再開始・破棄時に実行する Disposable。
 * @throws 初期化を継続できない場合、その例外。cleanup も失敗した場合は AggregateError。
 */
export const createSubtitleSession = (
    options: SubtitleSessionOptions,
): Disposable => {
    const videoEl = options.videoEl;
    const settings = { ...options.settings };
    const fallbackSecondaryLang = options.fallbackSecondaryLang;
    const logger = options.logger ?? createSubtitleLogger();
    const bag = createDisposeBag();

    let source: SubtitleSource | null = null;
    let disposed = false;

    /**
     * source の変化から、採用結果と cue 件数をログへ出す。
     * snapshot と字幕本文は保持せず、停止後の通知は処理しない。
     *
     * @param change source の bound / unbound / cuechange 通知。
     */
    const observeSourceChange = (change: SubtitleSourceChange): void => {
        if (disposed || source === null) {
            return;
        }

        const snapshot = source.getSnapshot();

        logger.info('subtitle source snapshot', {
            event: change.type,
            role: change.type === 'cuechange' ? change.role : null,
            primary: summarizeTrack(snapshot.pair.primary),
            secondary: summarizeTrack(snapshot.pair.secondary),
            primaryCueCount: snapshot.primaryCues.length,
            secondaryCueCount: snapshot.secondaryCues.length,
            currentTime: videoEl.currentTime,
        });
    };

    /**
     * 通知を無効化し、購読解除と source の破棄を一度だけ試す。
     * cleanup に失敗しても source の保持参照を破棄する。
     *
     * @throws bag の cleanup が失敗した場合は AggregateError。
     *   source 内で記録された listener 解除失敗は、この例外に含まれないことがある。
     */
    const dispose = (): void => {
        if (disposed) {
            return;
        }

        // 実際の解除に失敗しても、停止済みの接続から観測処理を実行させない。
        disposed = true;

        try {
            bag.dispose();
        } finally {
            source = null;
            // 全解除成功ではなく、cleanup を試行したことだけを記録する。
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

        // bind が送る初回 bound を取りこぼさないよう、先に購読する。
        bag.add(createdSource.subscribe(observeSourceChange));
        createdSource.bind(pair);

        const snapshot = createdSource.getSnapshot();

        if (
            snapshot.pair.primary === null &&
            snapshot.pair.secondary === null
        ) {
            // 候補不足と bind 失敗は、採用結果と source のエラーログで区別する。
            logger.warn('subtitle source has no bound track');
        }
    } catch (error) {
        // 初期化途中でも、登録済みの cleanup をすべて試してから失敗を返す。
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
