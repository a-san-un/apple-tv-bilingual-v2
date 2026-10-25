/**
 * subtitle-session.ts
 *
 * 正規化済み設定を使い、text-track-resolver.ts と subtitle-source.ts を接続する。
 * track 一覧の追加・削除と、未取得 track の cue 読込みに応じて採用結果を再評価する。
 * source、その購読、track 一覧と video の再生イベントの監視を所有する。
 * playback session 単位で生成され、返す dispose は session-lifecycle.ts が保持・実行する。
 * readiness 待機、mode 変更、字幕 truth の構築、DOM 描画、native menu 同期は担当しない。
 */
import type { ReadySettings } from '../settings/settings-store';
import { createDisposeBag } from '../shared/dispose';
import { createSubtitleLogger, type Logger } from '../shared/log';
import type {
    Disposable,
    LanguageCode,
    ResolvedSubtitleTrack,
    ResolvedTrackPair,
    SubtitleSourceChange,

    SubtitleTrackRole,
} from '../shared/types';
import {
    createSubtitleSource,
    type SubtitleSource,
    type SubtitleSourceSummary,
} from './subtitle-source';
import {
    resolveTrackPair,
    summarizeTrack,
} from './text-track-resolver';

/** cue の読込みを再確認する video のイベント。独自 timer は使わない。 */
const PLAYBACK_SIGNALS = [
    'timeupdate',
    'loadeddata',
    'playing',
    'seeked',
] as const;

/** cue の読込み確認に利用する再生イベント名。 */
type PlaybackSignal = (typeof PLAYBACK_SIGNALS)[number];

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

/** track を選定し直す契機。 */
type TrackResolutionReason =
    | 'initial'
    | 'addtrack'
    | 'removetrack'
    | 'cuechange'
    | PlaybackSignal;

/**
 * current video の track を選定し、source へ接続する。
 * 一覧変化と未取得 track の cue 読込みを再評価し、同じ採用結果なら再 bind しない。
 *
 * @param options video、設定、fallback と任意の logger・観測 callback。
 * @returns lifecycle が保持し、停止・再開始・破棄時に実行する Disposable。
 * @throws 初期化を継続できない場合。その cleanup も失敗した場合は AggregateError。
 */
export const createSubtitleSession = (
    options: SubtitleSessionOptions,
): Disposable => {
    const videoEl = options.videoEl;
    const textTracks = videoEl.textTracks;
    const settings = { ...options.settings };
    const fallbackSecondaryLang = options.fallbackSecondaryLang;
    const logger = options.logger ?? createSubtitleLogger();
    const onObservation = options.onObservation;
    const bag = createDisposeBag();

    let source: SubtitleSource | null = null;
    let boundPair: ResolvedTrackPair = {
        primary: null,
        secondary: null,
    };
    let lastRequestedPair: ResolvedTrackPair | null = null;
    let hasResolved = false;
    let sourceChangeCount = 0;
    let resolving = false;
    let pendingResolutionReason: TrackResolutionReason | null = null;
    let disposed = false;
    let primaryCueChanges = 0;
    let secondaryCueChanges = 0;

    // 本文や track 参照は保持せず、最後に通知した cue 件数だけを覚える。
    let observedCueCounts = {
        primary: 0,
        secondary: 0,
    };

    /**
     * 要約の track を、実 TextTrack を含まない観測情報に変換する。
     *
     * @param track source が実際に保持する採用 track。null は未採用。
     * @param cueCount 要約から読み取れた cue 件数。
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
     * 本文を含まない source の要約を観測先へ渡す。
     * callback の例外は記録し、字幕接続へ伝播させない。
     *
     * @param snapshot source が返した現在の要約。cue 配列は含まない。
     * @param event 観測契機。snapshot は source 通知がなかった選定後の読取り。
     * @param role cuechange の役割。それ以外は null。
     */
    const publishObservation = (
        snapshot: SubtitleSourceSummary,
        event: SubtitleSessionObservation['event'],
        role: SubtitleTrackRole | null,
    ): void => {
        if (disposed) {
            return;
        }

        observedCueCounts = {
            primary: snapshot.primaryCueCount,
            secondary: snapshot.secondaryCueCount,
        };

        if (onObservation === undefined) {
            return;
        }

        try {
            onObservation({
                videoEl,
                event,
                role,
                primary: observeTrack(
                    snapshot.pair.primary,
                    snapshot.primaryCueCount,
                ),
                secondary: observeTrack(
                    snapshot.pair.secondary,
                    snapshot.secondaryCueCount,
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
     * cuechange の後は、未取得の別役割がある場合だけ選定を再評価する。
     *
     * @param change source の bound / unbound / cuechange 通知。
     */
    const observeSourceChange = (change: SubtitleSourceChange): void => {
        if (disposed || source === null) {
            return;
        }

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

        const snapshot = source.getSummary();
        // 通知先を呼ぶ前に実際の採用結果を反映し、bind 後の再取得を不要にする。
        boundPair = snapshot.pair;
        sourceChangeCount += 1;
        const role = change.type === 'cuechange' ? change.role : null;

        // 出力しないログの要約・補助情報は生成しない。判定 API がなければ従来動作を維持する。
        if (logger.isEnabled?.('debug') ?? true) {
            logger.debug('subtitle source snapshot', {
                event: change.type,
                role,
                primary: summarizeTrack(snapshot.pair.primary),
                secondary: summarizeTrack(snapshot.pair.secondary),
                primaryCueCount: snapshot.primaryCueCount,
                secondaryCueCount: snapshot.secondaryCueCount,
                currentTime: videoEl.currentTime,
            });
        }

        publishObservation(snapshot, change.type, role);

        if (change.type === 'cuechange') {
            reevaluateUnavailableCues('cuechange');
        }
    };

    /**
     * 現在の一覧を1回選定し、実際の binding と異なる場合に更新する。
     * 再入制御は resolveAndBind が担当する。
     *
     * @param reason 初期選定、一覧変化、cue 読込み確認の契機。
     * @throws track 情報の読取りや依存処理が例外を投げた場合。
     */
    const resolveCurrentPair = (reason: TrackResolutionReason): void => {
        if (disposed || source === null) {
            return;
        }

        const currentSource = source;
        const pair = resolveTrackPair({
            textTracks,
            primaryLang: settings.primaryLang,
            secondaryLang: settings.secondaryLang,
            fallbackSecondaryLang,
        });

        lastRequestedPair = pair;

        if (
            hasResolved &&
            pair.primary?.track === boundPair.primary?.track &&
            pair.secondary?.track === boundPair.secondary?.track
        ) {
            return;
        }

        logger.info('subtitle tracks resolved', {
            reason,
            primaryLang: settings.primaryLang,
            secondaryLang: settings.secondaryLang,
            fallbackSecondaryLang,
            trackCount: textTracks.length,
            primary: summarizeTrack(pair.primary),
            secondary: summarizeTrack(pair.secondary),
        });

        const previousChangeCount = sourceChangeCount;
        currentSource.bind(pair);

        // bind の同期通知中に破棄された場合、旧 source の処理を続けない。
        if (disposed || source !== currentSource) {
            return;
        }

        hasResolved = true;

        // 同期通知で採用結果を取得済みなら、同じ要約を取り直さない。
        // 候補なし・bind 失敗など、通知で取得できなかった場合だけ読み取る。
        if (sourceChangeCount === previousChangeCount) {
            const snapshot = currentSource.getSummary();
            boundPair = snapshot.pair;
            publishObservation(snapshot, 'snapshot', null);
        }

        if (disposed) {
            return;
        }

        const hasRequestedTrack =
            pair.primary !== null || pair.secondary !== null;
        const hasBoundTrack =
            boundPair.primary !== null || boundPair.secondary !== null;

        if (!hasRequestedTrack) {
            // 候補がまだない場合は、一覧の追加・削除を引き続き受け付ける。
            logger.info('subtitle tracks unavailable', {
                reason,
                trackCount: textTracks.length,
                primaryLang: settings.primaryLang,
                secondaryLang: settings.secondaryLang,
                fallbackSecondaryLang,
            });
        } else if (!hasBoundTrack) {
            logger.warn('subtitle source has no bound track');
        }
    };

    /**
     * 再選定を実行し、通知中に発生した再選定要求を直列に処理する。
     * 同期 callback からの再入で bind を入れ子にしない。
     *
     * @param reason 選定を要求した契機。
     * @throws 選定や binding の依存処理が例外を投げた場合。
     *   初期化側では cleanup 後に再送出し、イベント処理側では記録する。
     */
    const resolveAndBind = (reason: TrackResolutionReason): void => {
        if (disposed || source === null) {
            return;
        }

        if (resolving) {
            pendingResolutionReason = reason;
            return;
        }

        resolving = true;

        try {
            let nextReason: TrackResolutionReason | null = reason;

            while (!disposed && nextReason !== null) {
                pendingResolutionReason = null;
                resolveCurrentPair(nextReason);
                nextReason = pendingResolutionReason;
            }
        } finally {
            resolving = false;
            pendingResolutionReason = null;
        }
    };

    /**
     * 選定済み候補がある役割に、未取得の track が残っているか確認する。
     * cue の件数だけを読み、本文コピーや active cue 判定は行わない。
     *
     * @returns 候補があるのに未 bind、または cue が空・未取得・読取失敗なら true。
     *   候補自体がない役割の再確認は、track 一覧の追加・削除に任せる。
     */
    const hasUnavailableRequestedTrack = (): boolean => {
        if (lastRequestedPair === null) {
            return false;
        }

        for (const role of ['primary', 'secondary'] as const) {
            if (lastRequestedPair[role] === null) {
                continue;
            }

            const bound = boundPair[role];
            if (bound === null) {
                return true;
            }

            try {
                if ((bound.track.cues?.length ?? 0) === 0) {
                    return true;
                }
            } catch {
                return true;
            }
        }

        return false;
    };

    /**
     * 未取得 track の選定と、同じ採用 track の読込み完了を確認する。
     * 通常再生では cue 件数だけを確認し、0件からの読込み完了時だけ
     * 本文を含まない要約を取得して通知する。
     *
     * @param reason 再生イベントまたは既存 cuechange。
     */
    const reevaluateUnavailableCues = (
        reason: PlaybackSignal | 'cuechange',
    ): void => {
        if (disposed || source === null) {
            return;
        }

        try {
            if (hasUnavailableRequestedTrack()) {
                resolveAndBind(reason);
            }

            // bind 中の同期 callback から再入した場合は、外側の選定完了を待つ。
            if (disposed || source === null || resolving) {
                return;
            }

            let hasNewlyLoadedCues = false;

            for (const role of ['primary', 'secondary'] as const) {
                const bound = boundPair[role];

                if (
                    bound === null ||
                    observedCueCounts[role] !== 0
                ) {
                    continue;
                }

                try {
                    if ((bound.track.cues?.length ?? 0) > 0) {
                        hasNewlyLoadedCues = true;
                        break;
                    }
                } catch {
                    // まだ読めない役割は、次のイベントで確認する。
                    continue;
                }
            }

            if (!hasNewlyLoadedCues) {
                return;
            }

            const snapshot = source.getSummary();

            // ログを抑制しても、後続の読込み完了通知は必ず処理する。
            if (logger.isEnabled?.('debug') ?? true) {
                logger.debug('subtitle source snapshot', {
                    event: 'snapshot',
                    role: null,
                    primary: summarizeTrack(snapshot.pair.primary),
                    secondary: summarizeTrack(snapshot.pair.secondary),
                    primaryCueCount: snapshot.primaryCueCount,
                    secondaryCueCount: snapshot.secondaryCueCount,
                    currentTime: videoEl.currentTime,
                });
            }

            // 読込み完了は cuechange ではないので、通知回数は加算しない。
            publishObservation(snapshot, 'snapshot', null);
        } catch (error) {
            logger.error('subtitle cue availability update failed', {
                reason,
                error,
            });
        }
    };

    /**
     * track 一覧の追加・削除を処理する。
     *
     * @param event TextTrackList の addtrack / removetrack。
     */
    const handleTrackListChange = (event: Event): void => {
        if (disposed) {
            return;
        }

        const reason: TrackResolutionReason =
            event.type === 'addtrack' ? 'addtrack' : 'removetrack';

        try {
            resolveAndBind(reason);
        } catch (error) {
            logger.error('subtitle track update failed', { reason, error });
        }
    };

    /**
     * video のイベントを、未取得 track の読込み確認へ変換する。
     * session 全体の再開始や cuechange 回数の加算は行わない。
     *
     * @param event 監視対象の video が送ったイベント。
     */
    const handlePlaybackSignal = (event: Event): void => {
        if (disposed) {
            return;
        }

        for (const reason of PLAYBACK_SIGNALS) {
            if (event.type === reason) {
                reevaluateUnavailableCues(reason);
                return;
            }
        }
    };

    /**
     * track 一覧の監視を登録し、その解除を字幕接続の bag に所有させる。
     *
     * @param eventName 監視する addtrack または removetrack。
     * @throws listener 登録に失敗した場合。初期化側で cleanup 後に再送出する。
     */
    const attachTrackListListener = (
        eventName: 'addtrack' | 'removetrack',
    ): void => {
        // 登録処理が途中まで成功してから失敗する場合も、解除を試せるよう先に登録する。
        bag.add(() => {
            textTracks.removeEventListener(eventName, handleTrackListChange);
        });
        textTracks.addEventListener(eventName, handleTrackListChange);
    };

    /**
     * video の再生イベントを登録し、その解除を字幕接続の bag に所有させる。
     *
     * @param eventName cue の読込み確認に利用する再生イベント。
     * @throws listener 登録に失敗した場合。初期化側で cleanup 後に再送出する。
     */
    const attachPlaybackListener = (eventName: PlaybackSignal): void => {
        bag.add(() => {
            videoEl.removeEventListener(eventName, handlePlaybackSignal);
        });
        videoEl.addEventListener(eventName, handlePlaybackSignal);
    };

    /**
     * 通知を無効化し、video・一覧の監視、購読、source を一度だけ破棄する。
     *
     * @throws bag の cleanup が失敗した場合は AggregateError。
     *   source 内で記録された listener 解除失敗は含まれないことがある。
     */
    const dispose = (): void => {
        if (disposed) {
            return;
        }

        // 解除に失敗して listener が残っても、旧接続の処理を実行させない。
        disposed = true;
        pendingResolutionReason = null;

        try {
            bag.dispose();
        } finally {
            source = null;
            boundPair = { primary: null, secondary: null };
            lastRequestedPair = null;
            logger.info('subtitle session cleanup attempted');
        }
    };

    try {
        const createdSource = createSubtitleSource(videoEl, { logger });
        source = createdSource;

        // 逆順 cleanup で監視と購読を先に止めてから source を破棄する。
        bag.add(() => {
            createdSource.dispose();
        });
        bag.add(createdSource.subscribe(observeSourceChange));

        attachTrackListListener('addtrack');
        attachTrackListListener('removetrack');

        for (const eventName of PLAYBACK_SIGNALS) {
            attachPlaybackListener(eventName);
        }

        resolveAndBind('initial');
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
