/**
 * debug-badge.ts
 *
 * 実機確認用の session 状態と字幕観測情報を表示する。
 * DOM、配置、track 総数の監視、表示用情報、破棄を所有する。
 * session の開始停止、readiness 待機、track 選定、mode 変更は行わない。
 */
import type { Disposable, SessionState } from '../shared/types';
import type {
    SubtitleSessionObservation,
    SubtitleTrackObservation,
} from '../subtitles/subtitle-session';

/** 状態と字幕観測情報の表示・破棄を提供する debug view。 */
export type SessionDebugBadge = Disposable & {
    update(state: SessionState): void;
    updateSubtitle(observation: SubtitleSessionObservation | null): void;
};

/**
 * track の観測情報を1行へ整形する。
 *
 * @param role 表示する役割名。
 * @param track bind 結果の要約。null は未採用。
 * @returns 字幕本文や実 TextTrack を含まない表示文字列。
 */
const formatTrackObservation = (
    role: 'primary' | 'secondary',
    track: SubtitleTrackObservation | null,
): string => {
    if (track === null) {
        return `${role}: 未採用`;
    }

    const language = track.language || 'unknown';
    const label = track.label.replace(/\s+/g, ' ').trim() || '(no label)';

    return (
        `${role}: ${language} — ${label}` +
        ` | mode: ${track.mode} | cues: ${track.cueCount}`
    );
};

/**
 * playback root 配下へ配置する観測用 UI を作る。
 * running は字幕取得成功を保証しない。
 *
 * @param enabled false の場合は DOM と track 監視を生成しない。
 * @returns coordinator が更新し、top-level cleanup で破棄する debug view。
 */
export const createSessionDebugBadge = (
    enabled = true,
): SessionDebugBadge => {
    if (!enabled) {
        return {
            /**
             * 表示無効時は状態を描画しない。
             *
             * @param state 受信した session 状態。
             */
            update(state): void {
                void state;
            },

            /**
             * 表示無効時は字幕観測情報を保持しない。
             *
             * @param observation 受信した字幕観測情報。
             */
            updateSubtitle(observation): void {
                void observation;
            },

            /** 表示無効時は解放する DOM や listener を持たない。 */
            dispose(): void { },
        };
    }

    const badge = document.createElement('div');
    let mountedRoot: HTMLElement | null = null;
    let latestState: SessionState | null = null;
    let observedTracks: TextTrackList | null = null;
    let subtitleObservation: SubtitleSessionObservation | null = null;
    let showSubtitleObservation = false;
    let disposed = false;

    badge.setAttribute('data-atv-bilingual-debug', 'session');
    Object.assign(badge.style, {
        position: 'absolute',
        top: '48px',
        right: '16px',
        zIndex: '2147483647',
        padding: '6px 8px',
        borderRadius: '6px',
        fontSize: '12px',
        lineHeight: '1.4',
        fontFamily: 'monospace',
        color: '#ffffff',
        background: 'rgba(55, 65, 81, 0.88)',
        pointerEvents: 'none',
        whiteSpace: 'pre-wrap',
        maxWidth: 'calc(100% - 32px)',
        overflowWrap: 'anywhere',
    });

    /**
     * target の変更に合わせて配置先を同期する。
     *
     * @param rootEl 現在の playback root。null は配置先なし。
     */
    const syncMountTarget = (rootEl: HTMLElement | null): void => {
        if (mountedRoot === rootEl) {
            return;
        }

        badge.remove();
        mountedRoot = rootEl;
        mountedRoot?.appendChild(badge);
    };

    /** 最新 session 状態と観測情報を、変更がある場合だけ描画する。 */
    const render = (): void => {
        if (disposed || latestState === null) {
            return;
        }

        const trackCount = latestState.target?.videoEl.textTracks.length ?? 0;
        const lines = [
            [
                `session: ${latestState.status}`,
                `reason: ${latestState.reason ?? 'none'}`,
                `tracks: ${trackCount}`,
            ].join(' | '),
        ];

        if (showSubtitleObservation) {
            const observation =
                latestState.status === 'running' &&
                    subtitleObservation?.videoEl === latestState.target.videoEl
                    ? subtitleObservation
                    : null;

            if (observation === null) {
                lines.push('字幕: 未接続');
            } else {
                const event =
                    observation.role === null
                        ? observation.event
                        : `${observation.event} / ${observation.role}`;

                lines.push(
                    '',
                    formatTrackObservation('primary', observation.primary),
                    formatTrackObservation('secondary', observation.secondary),
                    '',
                    `last event: ${event}`,
                    `cuechange: primary ${observation.primaryCueChanges}` +
                    ` / secondary ${observation.secondaryCueChanges}`,
                );
            }
        }

        const text = lines.join('\n');
        if (badge.textContent !== text) {
            badge.textContent = text;
        }

        const colors: Record<SessionState['status'], string> = {
            idle: 'rgba(55, 65, 81, 0.88)',
            waiting: 'rgba(180, 83, 9, 0.88)',
            running: 'rgba(22, 101, 52, 0.88)',
            stopped: 'rgba(55, 65, 81, 0.88)',
        };
        const background = colors[latestState.status];
        if (badge.style.background !== background) {
            badge.style.background = background;
        }
    };

    /**
     * 現在の track 一覧の追加・削除を件数表示へ反映する。
     *
     * @param event TextTrackList の addtrack / removetrack。
     */
    const refreshTrackCount = (event: Event): void => {
        if (
            disposed ||
            observedTracks === null ||
            event.currentTarget !== observedTracks
        ) {
            return;
        }

        render();
    };

    /** 監視先を切り離し、両方の listener の解除を試す。 */
    const releaseTrackObservation = (): void => {
        const tracks = observedTracks;
        observedTracks = null;

        if (tracks === null) {
            return;
        }

        for (const eventName of ['addtrack', 'removetrack'] as const) {
            try {
                tracks.removeEventListener(eventName, refreshTrackCount);
            } catch (error) {
                console.error(
                    '[atv-bilingual:debug] track observation cleanup failed',
                    eventName,
                    error,
                );
            }
        }
    };

    /**
     * 表示対象の track 一覧へ監視を切り替える。
     *
     * @param nextTracks 新しい一覧。null は監視停止。
     */
    const syncTrackObservation = (
        nextTracks: TextTrackList | null,
    ): void => {
        if (observedTracks === nextTracks) {
            return;
        }

        releaseTrackObservation();
        if (nextTracks === null) {
            return;
        }

        observedTracks = nextTracks;

        try {
            nextTracks.addEventListener('addtrack', refreshTrackCount);
            nextTracks.addEventListener('removetrack', refreshTrackCount);
        } catch (error) {
            releaseTrackObservation();
            console.error(
                '[atv-bilingual:debug] track observation setup failed',
                error,
            );
        }
    };

    return {
        /**
         * session 状態、配置先、track 監視先を更新する。
         *
         * @param state lifecycle が公開する session 状態。
         */
        update(state): void {
            if (disposed) {
                return;
            }

            latestState = { ...state };

            const active =
                state.status === 'waiting' || state.status === 'running';
            const rootEl = active ? state.target?.rootEl ?? null : null;
            const tracks = active ? state.target?.videoEl.textTracks ?? null : null;

            // 新しい状態に属さない観測情報を持ち越さない。
            if (
                !active ||
                state.target === null ||
                subtitleObservation?.videoEl !== state.target.videoEl
            ) {
                subtitleObservation = null;
            }

            syncTrackObservation(tracks);
            syncMountTarget(rootEl);
            render();
        },

        /**
         * 字幕観測情報をコピーして表示へ反映する。
         * 初回 bound は running 通知より前に届くため、状態確定まで保持する。
         *
         * @param observation 現在の接続の観測情報。null はクリア。
         */
        updateSubtitle(observation): void {
            if (disposed) {
                return;
            }

            showSubtitleObservation = true;
            subtitleObservation =
                observation === null
                    ? null
                    : {
                        ...observation,
                        primary:
                            observation.primary === null
                                ? null
                                : { ...observation.primary },
                        secondary:
                            observation.secondary === null
                                ? null
                                : { ...observation.secondary },
                    };

            render();
        },

        /** 監視、DOM、session と字幕の保持参照を一度だけ破棄する。 */
        dispose(): void {
            if (disposed) {
                return;
            }

            disposed = true;
            releaseTrackObservation();
            badge.remove();
            mountedRoot = null;
            latestState = null;
            subtitleObservation = null;
        },
    };
};
