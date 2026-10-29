/**
 * subtitle-timeline.ts
 *
 * sourceの言語別cueを検証し、元の時刻・本文だけのtimelineを構築する純関数。
 * 対訳推測・本文結合・重複除去・時刻分類・DOM・購読・キャッシュは扱わない。
 * sourceや入力参照を保持せず、失敗時の公開状態のクリアは呼出元に任せる。
 */
import type { SubtitleCueSnapshot, SubtitleTimeline, TimedSubtitleText } from '../shared/types';

/**
 * 1言語の全入力を順に検証し、必要な値だけをコピーする。
 * @param cues 開始時刻の非減少順のcue。空配列と同じ開始時刻を許可する。
 * @returns 入力と独立した配列・字幕単位。本文や時刻を補正しない。
 * @throws RangeError 時刻・本文・入力順が条件に違反する場合。
 */
const copyLanguageCues = (cues: readonly SubtitleCueSnapshot[]): TimedSubtitleText[] => {
  const result: TimedSubtitleText[] = [];
  let previousStartTime = 0;
  for (const cue of cues) {
    const { startTime, endTime, text } = cue;
    if (
      !Number.isFinite(startTime) || !Number.isFinite(endTime) ||
      startTime < 0 || startTime >= endTime ||
      startTime < previousStartTime || text.trim().length === 0
    ) {
      throw new RangeError('Subtitle timeline cue time, text, or input order is invalid');
    }
    // trackなどの追加属性を読まず、元cueとの参照共有も避ける。
    result.push({ startTime, endTime, text });
    previousStartTime = startTime;
  }
  return result;
};

/**
 * 言語間で対応を決めず、各入力要素をそのまま1字幕単位として保持する。
 * @param primaryCues 学習言語のcue。有限の時刻、0 <= startTime < endTime、空白だけでない本文、開始時刻順を満たす。
 * @param secondaryCues 母国語のcue。primaryと同じ条件。空配列も許可する。
 * @returns 元時刻・本文・言語内順序を保持する新しいtimeline。track・cue参照を含めない。
 * @throws RangeError どちらかの言語の入力が条件に違反する場合。
 */
export const buildSubtitleTimeline = (
  primaryCues: readonly SubtitleCueSnapshot[],
  secondaryCues: readonly SubtitleCueSnapshot[],
): SubtitleTimeline => ({
  primary: copyLanguageCues(primaryCues),
  secondary: copyLanguageCues(secondaryCues),
});
