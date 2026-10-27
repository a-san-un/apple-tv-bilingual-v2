/**
 * subtitle-block-builder.ts
 *
 * 両言語の cue snapshot から字幕 truth を構築する純関数。
 * 現段階では空入力、片言語1件、同時刻範囲の二言語各1件だけを扱う。
 * track、DOM、source の取得・購読、history は扱わず、資源や入力参照を保持しない。
 */
import type { SubtitleBlock, SubtitleCueSnapshot } from '../shared/types';

/**
 * 最小実装で受け付ける時刻範囲と本文かを確認する。
 * @param cue 検証する cue snapshot。track は参照しない。
 * @returns 有限の非負時刻、正の長さ、空白だけでない本文なら true。
 */
const isSupportedCue = (cue: SubtitleCueSnapshot): boolean =>
  Number.isFinite(cue.startTime) &&
  Number.isFinite(cue.endTime) &&
  cue.startTime >= 0 &&
  cue.startTime < cue.endTime &&
  cue.text.trim().length > 0;

/**
 * 最小4ケースの cue 配列から、新しい block 配列を構築する。
 * 未対応入力の拒否は開発途中のガードであり、完成版の劣化動作ではない。
 * @param primaryCues 学習言語の cue。空配列または有効な1件。
 * @param secondaryCues 母国語の cue。空配列または有効な1件。両言語がある場合は primary と同時刻範囲。
 * @returns 新しい配列と block。時刻・本文をそのまま使い、track と入力参照を残さない。
 * @throws RangeError 最小4ケース以外、または時刻・本文が有効入力の条件を満たさない場合。
 */
export const buildSubtitleBlocks = (
  primaryCues: readonly SubtitleCueSnapshot[],
  secondaryCues: readonly SubtitleCueSnapshot[],
): SubtitleBlock[] => {
  if (primaryCues.length === 0 && secondaryCues.length === 0) {
    return [];
  }

  if (primaryCues.length === 0 && secondaryCues.length === 1) {
    const secondary = secondaryCues[0];
    if (secondary === undefined || !isSupportedCue(secondary)) {
      throw new RangeError('Subtitle block builder input is outside the minimal supported cases');
    }

    return [{
      startTime: secondary.startTime,
      endTime: secondary.endTime,
      primaryText: null,
      secondaryText: secondary.text,
    }];
  }

  if (primaryCues.length !== 1 || secondaryCues.length > 1) {
    throw new RangeError('Subtitle block builder input is outside the minimal supported cases');
  }

  const primary = primaryCues[0];
  const secondary = secondaryCues[0];
  if (
    primary === undefined ||
    !isSupportedCue(primary) ||
    (secondaryCues.length === 1 && secondary === undefined) ||
    (secondary !== undefined &&
      (!isSupportedCue(secondary) ||
        primary.startTime !== secondary.startTime ||
        primary.endTime !== secondary.endTime))
  ) {
    throw new RangeError('Subtitle block builder input is outside the minimal supported cases');
  }

  return [{
    startTime: primary.startTime,
    endTime: primary.endTime,
    primaryText: primary.text,
    secondaryText: secondary === undefined ? null : secondary.text,
  }];
};
