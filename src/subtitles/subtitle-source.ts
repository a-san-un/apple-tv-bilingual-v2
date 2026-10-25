/**
 * subtitle-source.ts
 *
 * readiness 通過後の video に採用 track を bind し、cuechange 通知・要約・snapshot を提供する。
 * cue listener は bind 単位の DisposeBag で所有し、再 bind / unbind / dispose で解除する。
 * 解除に失敗して旧 listener が残っても、現在の binding 以外からは通知しない。
 * 管理情報は入出力時にコピーし、実際の TextTrack 参照だけを共有する。
 * 待機・retry、track 選定、mode 変更、panel / UI 更新は担当しない。
 * 購読・cue 読取・listener 登録解除の失敗はログに記録する。
 */

import { createDisposeBag, type DisposeBag } from '../shared/dispose';
import { createSubtitleLogger, type Logger } from '../shared/log';
import type {
  DisposeFn,
  ResolvedSubtitleTrack,
  ResolvedTrackPair,
  SubtitleCueSnapshot,
  SubtitleSourceChange,
  SubtitleSourceListener,
  SubtitleSourceSnapshot,
  SubtitleTrackRole,
} from '../shared/types';
import { summarizeTrack } from './text-track-resolver';

/** source が読む video の最小形。`HTMLVideoElement` と test double の両方を受け取る。 */
export type SubtitleSourceVideo = {
  readonly textTracks: ArrayLike<TextTrack>;
};

/**
 * 採用情報と cue 件数だけを持つ、取得時点の要約。
 * 管理情報はコピーし、実 TextTrack の参照だけを共有する。cue 本文・時刻は含めない。
 */
export type SubtitleSourceSummary = {
  pair: ResolvedTrackPair;
  primaryCueCount: number;
  secondaryCueCount: number;
};

/**
 * subtitle source の公開 API。
 * bind / unbind / dispose は再呼び出し可能で、listener 登録解除の失敗を内部で記録する。
 */
export type SubtitleSource = {
  bind(pair: ResolvedTrackPair): void;
  unbind(): void;
  getSummary(): SubtitleSourceSummary;
  getSnapshot(): SubtitleSourceSnapshot;
  subscribe(listener: SubtitleSourceListener): DisposeFn;
  dispose(): void;
};

/** test などで差し替える任意依存。 */
export type SubtitleSourceOptions = {
  logger?: Logger;
};

/** primary / secondary の両方が未採用の pair。source 内部だけで使い、外へ直接返さない。 */
const EMPTY_PAIR: ResolvedTrackPair = { primary: null, secondary: null };

/** dispose 後の購読要求に返す、何もしない購読解除関数。 */
const noop: DisposeFn = () => { };

/**
 * track の管理情報をコピーする。
 * listener の登録先と同一性を保つため、実際の TextTrack は同じ参照を維持する。
 *
 * @param resolved コピーする track 情報。null なら未採用として扱う。
 * @returns 独立した track 情報。実際の TextTrack だけは共有し、null はそのまま返す。
 */
const copyResolvedTrack = (
  resolved: ResolvedSubtitleTrack | null,
): ResolvedSubtitleTrack | null => (resolved === null ? null : { ...resolved });

/**
 * cue の表示テキストを読む。
 * TextTrackCue 型には text がないため、VTTCue 相当の値だけを文字列として取り出す。
 *
 * @param cue 読み取り対象の cue。
 * @returns text が文字列ならその値、なければ空文字。
 */
const readCueText = (cue: TextTrackCue): string => {
  const text: unknown = (cue as { text?: unknown }).text;
  return typeof text === 'string' ? text : '';
};

/**
 * subtitle source を作る。
 *
 * @param videoEl readiness 通過後の current video。textTracks の待機はしない。
 * @param options logger の差し替え。省略時は subtitle category の logger を使う。
 * @returns bind / unbind / 要約 / snapshot / 購読を提供する source。
 *   dispose は session owner が保持して実行する。2 回目以降は何もしない。
 */
export const createSubtitleSource = (
  videoEl: SubtitleSourceVideo,
  options: SubtitleSourceOptions = {},
): SubtitleSource => {
  const logger = options.logger ?? createSubtitleLogger();
  const listeners = new Set<SubtitleSourceListener>();

  let pair: ResolvedTrackPair = EMPTY_PAIR;
  // listener の所有と、通知を許可する現在の binding の識別を兼ねる。
  let bindingBag: DisposeBag | null = null;
  let disposed = false;

  /**
   * 購読者へ変化を通知する。
   * 1 つの購読者が例外を投げても、他の購読者と source 自体は止めない。
   * 通知中に dispose された場合は、その時点で後続の通知を止める。
   *
   * @param change 通知内容。
   */
  const notify = (change: SubtitleSourceChange): void => {
    if (disposed) {
      return;
    }

    for (const listener of [...listeners]) {
      // 購読者の callback 内で dispose される場合も、後続購読者を呼ばない。
      if (disposed) {
        return;
      }

      try {
        listener(change);
      } catch (error) {
        logger.error('subtitle source listener failed', { change, error });
      }
    }
  };

  /**
   * track が現在の video の textTracks に含まれるかを確かめる。
   * 差し替え前の video の track を誤って bind しないための確認。
   *
   * @param track 確認する track。
   * @returns 現在の video に含まれていれば true。
   */
  const belongsToVideo = (track: TextTrack): boolean =>
    Array.from(videoEl.textTracks).includes(track);

  /**
   * 1 つの track に cuechange listener を付け、解除関数を bag に登録する。
   * 登録時の bag が現在の binding と一致する間だけ、通知を許可する。
   *
   * @param bag 現在の bind 用 bag。解除はこの bag の dispose で行う。
   * @param role 通知に載せる役割。
   * @param resolved 対象 track。
   */
  const attachCueListener = (
    bag: DisposeBag,
    role: SubtitleTrackRole,
    resolved: ResolvedSubtitleTrack,
  ): void => {
    const { track } = resolved;

    /**
     * 現在の binding の cuechange だけを変化通知へ変換する。
     * 解除失敗で残った旧 listener や、登録完了前の listener からは通知しない。
     */
    const handleCueChange = (): void => {
      if (disposed || bindingBag !== bag) {
        return;
      }

      notify({ type: 'cuechange', role });
    };

    track.addEventListener('cuechange', handleCueChange);
    bag.add(() => {
      track.removeEventListener('cuechange', handleCueChange);
    });

    // disabled の track は cue が読み込まれないことがあるが、mode の変更はこの Phase では行わない。
    if (track.mode === 'disabled') {
      logger.warn('bound track is disabled; cues may not arrive', {
        role,
        track: summarizeTrack(resolved),
      });
    }
  };

  /**
   * 現在の bind を切り離し、listener の解除を試す。
   * 解除前に binding を無効化し、解除失敗で残った listener からの通知を防ぐ。
   * 解除失敗はログに記録し、例外を外へ漏らさない。通知は呼び出し側が担当する。
   *
   * @returns 解除前に bind していたら true。実際の解除が全件成功したことは表さない。
   */
  const releaseBinding = (): boolean => {
    if (bindingBag === null) {
      return false;
    }

    const bag = bindingBag;
    // 実際の解除に失敗しても、旧 bag の listener は通知できない状態にする。
    bindingBag = null;
    pair = EMPTY_PAIR;

    try {
      bag.dispose();
    } catch (error) {
      logger.error('subtitle source unbind failed', { error });
    }

    return true;
  };

  /**
   * 採用済み pair に bind する。
   * 同じ track の組み合わせなら listener を二重登録しないため何もしない。
   * 管理情報はコピーし、呼び出し元による変更を内部へ伝えない。
   * listener 登録に失敗した場合は、登録済み分の解除を試して未 bind のまま戻る。
   *
   * @param next resolver が返した採用結果。両方 null なら unbind と同じ扱い。
   */
  const bind = (next: ResolvedTrackPair): void => {
    if (disposed) {
      return;
    }

    if (
      bindingBag !== null &&
      next.primary?.track === pair.primary?.track &&
      next.secondary?.track === pair.secondary?.track
    ) {
      return;
    }

    // 旧 binding を先に無効化して解除を試し、新しい listener を登録する。
    const hadBinding = releaseBinding();

    const primary =
      next.primary !== null && belongsToVideo(next.primary.track)
        ? copyResolvedTrack(next.primary)
        : null;
    const secondary =
      next.secondary !== null &&
        next.secondary.track !== primary?.track &&
        belongsToVideo(next.secondary.track)
        ? copyResolvedTrack(next.secondary)
        : null;

    if (primary === null && secondary === null) {
      logger.info('subtitle source has no track to bind', {
        requestedPrimary: summarizeTrack(next.primary),
        requestedSecondary: summarizeTrack(next.secondary),
      });
      if (hadBinding) {
        notify({ type: 'unbound' });
      }
      return;
    }

    const bag = createDisposeBag();
    try {
      if (primary !== null) {
        attachCueListener(bag, 'primary', primary);
      }
      if (secondary !== null) {
        attachCueListener(bag, 'secondary', secondary);
      }
    } catch (error) {
      // この bag は現在の binding にしていないため、解除失敗で残っても通知しない。
      // 登録済み listener の解除をすべて試し、解除失敗も bind の外へ漏らさない。
      try {
        bag.dispose();
      } catch (cleanupError) {
        logger.error('subtitle source bind rollback failed', { cleanupError });
      }

      logger.error('subtitle source bind failed', { error });
      if (hadBinding) {
        notify({ type: 'unbound' });
      }
      return;
    }

    // 両役割の登録が完了してから、この bag の listener に通知を許可する。
    bindingBag = bag;
    pair = { primary, secondary };
    logger.info('subtitle source bound', {
      primary: summarizeTrack(primary),
      secondary: summarizeTrack(secondary),
    });
    notify({ type: 'bound' });
  };

  /**
   * 現在の bind を解除し、購読者へ unbound を通知する。未 bind なら何もしない。
   * listener 解除に失敗しても、管理上は未 bind とし、旧 binding の通知を止める。
   * 実際の解除失敗はログに残す。
   */
  const unbind = (): void => {
    if (disposed) {
      return;
    }

    if (releaseBinding()) {
      notify({ type: 'unbound' });
    }
  };

  /**
   * 1 つの track の cue 一覧を snapshot に写す。
   * cue の読取に失敗しても空配列で返し、source 全体を止めない。
   *
   * @param resolved snapshot 用にコピー済みの track 情報。null なら空配列。
   * @returns 新しく作った cue 配列。各 cue の track は、渡された snapshot 用の情報を参照する。
   */
  const readCues = (resolved: ResolvedSubtitleTrack | null): SubtitleCueSnapshot[] => {
    if (resolved === null) {
      return [];
    }

    try {
      const cues = resolved.track.cues;
      if (cues === null) {
        return [];
      }

      return Array.from(cues, (cue) => ({
        startTime: cue.startTime,
        endTime: cue.endTime,
        text: readCueText(cue),
        track: resolved,
      }));
    } catch (error) {
      logger.error('subtitle source failed to read cues', {
        track: summarizeTrack(resolved),
        error,
      });
      return [];
    }
  };

  /**
   * cue 一覧を走査せず、その時点の件数だけを読む。
   *
   * @param resolved 要約用にコピー済みの採用情報。null は未採用。
   * @returns cue 件数。未採用・未読込・空の一覧・読取失敗は0件。失敗は記録する。
   */
  const readCueCount = (resolved: ResolvedSubtitleTrack | null): number => {
    if (resolved === null) {
      return 0;
    }

    try {
      return resolved.track.cues?.length ?? 0;
    } catch (error) {
      logger.error('subtitle source failed to read cue count', {
        track: summarizeTrack(resolved),
        error,
      });
      return 0;
    }
  };

  /**
   * cue 本文・時刻を読まず、採用情報と件数だけの要約を返す。
   * 取得結果は source 内へ保持せず、呼び出すたびに現在値を読む。
   *
   * @returns pair と管理情報の新しい写し、および両役割の cue 件数。
   *   実 TextTrack のみ共有する。未 bind / dispose 後は両役割とも未採用・0件。
   */
  const getSummary = (): SubtitleSourceSummary => {
    const summaryPair: ResolvedTrackPair = {
      primary: copyResolvedTrack(pair.primary),
      secondary: copyResolvedTrack(pair.secondary),
    };

    return {
      pair: summaryPair,
      primaryCueCount: readCueCount(summaryPair.primary),
      secondaryCueCount: readCueCount(summaryPair.secondary),
    };
  };

  /**
   * 現在の bind 状態と cue 一覧の snapshot を返す。
   * pair と track の管理情報はコピーし、受け手による変更が source 内部へ伝わらないようにする。
   * 実際の TextTrack は共有するため、その参照を通したブラウザ状態の変更までは防がない。
   *
   * @returns 呼び出し時点の管理情報と cue の写し。未 bind なら pair は両方 null、cue は空配列。
   */
  const getSnapshot = (): SubtitleSourceSnapshot => {
    const snapshotPair: ResolvedTrackPair = {
      primary: copyResolvedTrack(pair.primary),
      secondary: copyResolvedTrack(pair.secondary),
    };

    return {
      pair: snapshotPair,
      primaryCues: readCues(snapshotPair.primary),
      secondaryCues: readCues(snapshotPair.secondary),
    };
  };

  /**
   * 変化通知を購読する。
   *
   * @param listener 通知を受け取る callback。
   * @returns 購読解除関数。呼び出し側が保持して実行する。dispose 後は何もしない関数を返す。
   */
  const subscribe = (listener: SubtitleSourceListener): DisposeFn => {
    if (disposed) {
      return noop;
    }

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  /**
   * listener の解除を試し、購読者を破棄する。2 回目以降は何もしない。
   * 解除失敗はログに記録し、stop 済み session に通知しないよう unbound は送らない。
   * 通知中に呼ばれた場合も、後続購読者への通知を止める。
   */
  const dispose = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;
    releaseBinding();
    listeners.clear();
  };

  return {
    bind,
    unbind,
    getSummary,
    getSnapshot,
    subscribe,
    dispose,
  };
};
