/**
 * subtitle-session.ts
 *
 * 正規化済み設定を使い、text-track-resolver.ts と subtitle-source.ts を接続する。
 * track 一覧の追加・削除と、未取得 track の cue 読込みに応じて採用結果を再評価する。
 * source、その購読、track 一覧と video の再生イベントの監視を所有する。
 * playback session 単位で生成され、返す dispose は session-lifecycle.ts が保持・実行する。
 * truth 構築と history 導出は純関数へ委譲し、結果の保持と更新・解放を所有する。
 * readiness 待機、mode 変更、DOM 描画、native menu 同期は担当しない。
 */
import type { ReadySettings } from '../settings/settings-store';
import { createDisposeBag } from '../shared/dispose';
import { createSubtitleLogger, type Logger } from '../shared/log';
import type {
    Disposable,
    DisposeFn,
    LanguageCode,
    ResolvedSubtitleTrack,
    ResolvedTrackPair,
    SubtitleSourceChange,
    SubtitleTimeline,
    SubtitleHistorySnapshot,
    TimedSubtitleText,

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

import { buildSubtitleTimeline } from './subtitle-timeline';
import { deriveSubtitleHistory } from './subtitle-history';

/** session の取得境界。cue・track・video の参照を含めない。 */
export type SubtitleSessionSnapshot = {
    timeline: SubtitleTimeline;
    history: SubtitleHistorySnapshot;
};

/** データの取得と破棄を提供する字幕接続。 */
export type SubtitleSession = Disposable & {
    getSnapshot(): SubtitleSessionSnapshot;
    subscribe(listener: () => void): DisposeFn;
};

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

/** @returns 呼出しごとに独立した空の言語別timeline。 */
const createEmptyTimeline = (): SubtitleTimeline => ({ primary: [], secondary: [] });

/** @returns 全区分の言語別配列が空のhistory。内部状態のクリアに使う。 */
const createEmptyHistory = (): SubtitleHistorySnapshot => ({
    past: createEmptyTimeline(), current: createEmptyTimeline(), future: createEmptyTimeline(),
});

/**
 * current video の track を選定し、source へ接続する。
 * 一覧変化と未取得 track の cue 読込みを再評価し、同じ採用結果なら再 bind しない。
 *
 * @param options video、設定、fallback と任意の logger・観測 callback。
 * @returns snapshot の取得と、停止・再開始・破棄時の dispose を提供する接続。
 * @throws 初期化を継続できない場合。その cleanup も失敗した場合は AggregateError。
 */
export const createSubtitleSession = (
    options: SubtitleSessionOptions,
): SubtitleSession => {
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
    let timeline: SubtitleTimeline = createEmptyTimeline();
    let history: SubtitleHistorySnapshot = createEmptyHistory();
    let truthRevision = 0;
    const snapshotListeners = new Set<{ listener: () => void }>();

    // 読込み完了の検出用に、最後に観測した cue 件数を覚える。
    let observedCueCounts = {
        primary: 0,
        secondary: 0,
    };

    /** @returns 元の内部状態を変更できない写し。同じ取得結果内では対応する字幕単位を共有する。 */
    const getSnapshot = (): SubtitleSessionSnapshot => {
        const copies = new Map<TimedSubtitleText, TimedSubtitleText>();
        /** @param value 内部の読み取り専用字幕単位。@returns この取得結果だけが共有する写し。 */
        const copy = (value: TimedSubtitleText): TimedSubtitleText => {
            const existing = copies.get(value);
            if (existing !== undefined) return existing;
            const cloned = { ...value };
            copies.set(value, cloned);
            return cloned;
        };
        /** @param value 言語別の内部配列。@returns 入力と独立した2配列。 */
        const copyPeriod = (value: SubtitleTimeline): SubtitleTimeline => ({
            primary: value.primary.map(copy), secondary: value.secondary.map(copy),
        });
        return {
            timeline: copyPeriod(timeline),
            history: { past: copyPeriod(history.past), current: copyPeriod(history.current), future: copyPeriod(history.future) },
        };
    };

    /**
     * データ更新を購読する。登録時の通知や snapshot コピーは行わない。
     * @param listener 更新後に呼ぶ、引数なしの callback。
     * @returns 登録単位の解除関数。dispose 後の購読は無効。
     */
    const subscribe = (listener: () => void): DisposeFn => {
        if (disposed) return () => {};
        const entry = { listener };
        snapshotListeners.add(entry);
        return () => { snapshotListeners.delete(entry); };
    };

    /**
     * 保持結果の更新後に通知する。古い更新の通知は途中でも打ち切る。
     * @param revision 通知するデータ更新の世代。
     */
    const notifySnapshotChange = (revision: number): void => {
        for (const entry of [...snapshotListeners]) {
            if (disposed || revision !== truthRevision) return;
            if (!snapshotListeners.has(entry)) continue;
            try {
                entry.listener();
            } catch (error) {
                logger.error('subtitle snapshot listener failed', { error });
            }
        }
    };

    /**
     * 次のtimelineと同じ世代の分類結果をそろえてから公開する。
     * @param nextTimeline 検証済みの次のtruth。時刻だけの更新では保持済みtruthを渡す。
     * @param revision 更新の世代。再入・停止で変わった場合は公開しない。
     * @throws 予期しない時刻取得・分類の例外。クリアと通知後に再送出する。
     */
    const publishHistory = (nextTimeline: SubtitleTimeline, revision: number): void => {
        try {
            const nextHistory = deriveSubtitleHistory(nextTimeline, videoEl.currentTime);
            if (disposed || revision !== truthRevision) return;
            // 時刻取得中に旧データを観測されても、新旧のtruthとhistoryを混在させない。
            timeline = nextTimeline;
            history = nextHistory;
            notifySnapshotChange(revision);
        } catch (error) {
            if (disposed || revision !== truthRevision) return;
            timeline = nextTimeline;
            history = createEmptyHistory();
            if (error instanceof RangeError) {
                logger.warn('subtitle history input rejected', { error });
                notifySnapshotChange(revision);
                return;
            }
            logger.error('subtitle history update failed', { error });
            notifySnapshotChange(revision);
            throw error;
        }
    };

    /** 保持済みtruthから分類だけを更新し、現在字幕のためのsource再走査は行わない。 */
    const refreshHistory = (): void => {
        if (disposed) return;
        publishHistory(timeline, ++truthRevision);
    };

    /** source 更新だけで cue を取得する。入力違反時は古い truth を残さない。 */
    const rebuildTruth = (): void => {
        if (disposed || source === null) return;
        const activeSource = source;
        const revision = ++truthRevision;
        let building = false;
        let nextTimeline: SubtitleTimeline;
        try {
            const snapshot = activeSource.getSnapshot();
            building = true;
            nextTimeline = buildSubtitleTimeline(snapshot.primaryCues, snapshot.secondaryCues);
        } catch (error) {
            if (disposed || revision !== truthRevision || source !== activeSource) return;
            timeline = createEmptyTimeline();
            history = createEmptyHistory();
            if (building && error instanceof RangeError) {
                logger.warn('subtitle truth input rejected', { error });
                notifySnapshotChange(revision);
                return;
            }
            logger.error('subtitle truth update failed', { error });
            notifySnapshotChange(revision);
            throw error;
        }
        if (disposed || revision !== truthRevision || source !== activeSource) return;
        publishHistory(nextTimeline, revision);
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

        rebuildTruth();
        if (disposed) return;

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
     * source の要約を debug ログへ出力する。
     * debug 無効時は、ログ専用の文字列や現在時刻を取得しない。
     * 観測通知や字幕接続の状態更新は担当しない。
     *
     * @param summary source から取得済みの採用情報と cue 件数。
     * @param event ログに記録する通知種別。
     * @param role cuechange の役割。それ以外は null。
     */
    const logSourceSummary = (
        summary: SubtitleSourceSummary,
        event: SubtitleSessionObservation['event'],
        role: SubtitleTrackRole | null,
    ): void => {
        if (!(logger.isEnabled?.('debug') ?? true)) {
            return;
        }

        logger.debug('subtitle source snapshot', {
            event,
            role,
            primary: summarizeTrack(summary.pair.primary),
            secondary: summarizeTrack(summary.pair.secondary),
            primaryCueCount: summary.primaryCueCount,
            secondaryCueCount: summary.secondaryCueCount,
            currentTime: videoEl.currentTime,
        });
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

        logSourceSummary(snapshot, change.type, role);

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

            logSourceSummary(snapshot, 'snapshot', null);

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
                const revision = truthRevision;
                reevaluateUnavailableCues(reason);
                if (!disposed && revision === truthRevision) refreshHistory();
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
        snapshotListeners.clear();
        pendingResolutionReason = null;
        truthRevision += 1;
        timeline = createEmptyTimeline();
        history = createEmptyHistory();

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

    return { dispose, getSnapshot, subscribe };
};
