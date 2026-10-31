/**
 * subtitle-history.ts
 * 元字幕単位と表示枠単位を、それぞれの時間範囲で過去・現在・未来へ分類する純関数。
 * 本文変換・枠構築・source・TextTrack・video・DOM、購読・timer・スクロールは扱わない。
 */
import type { SubtitleHistorySnapshot, SubtitleTimeline, TimedSubtitleText } from '../shared/types';
import type { SubtitleDisplayBlock, SubtitleDisplayHistory } from '../shared/types';

/**
 * 構築済みの表示枠を枠全体の時間範囲で、ちょうど1つの区分へ分類する。
 * @param blocks 構築・検証済みの固定順の表示枠。セリフ・補助とも同じ規則を使う。
 * @param currentTime 有限の非負再生時刻。秒単位。判定時に丸めない。
 * @returns 独立した3区分配列。各区分は入力順と枠参照を保持し、現在も0件・複数件を許可する。
 * @throws RangeError 再生時刻が非有限または負の場合。空入力でも拒否する。
 */
export const deriveSubtitleDisplayHistory = (
  blocks: readonly SubtitleDisplayBlock[],
  currentTime: number,
): SubtitleDisplayHistory => {
  if (!Number.isFinite(currentTime) || currentTime < 0) {
    throw new RangeError('Subtitle display history currentTime must be finite and non-negative');
  }
  const past: SubtitleDisplayBlock[] = [];
  const current: SubtitleDisplayBlock[] = [];
  const future: SubtitleDisplayBlock[] = [];
  for (const block of blocks) {
    // 個別字幕の切替や内部空白ではなく、構築済み枠の開始以上・終了未満で判定する。
    if (block.endTime <= currentTime) past.push(block);
    else if (block.startTime <= currentTime) current.push(block);
    else future.push(block);
  }
  return { past, current, future };
};

/**
 * 各言語の字幕を自身の開始・終了時刻で、ちょうど1つの区分へ分類する。
 * @param timeline 構築済みの言語別truth。各単位の時刻と本文は構築時に検証済みであること。
 * @param currentTime 有限の非負再生時刻。秒単位。
 * @returns 新しい言語別区分配列。字幕単位は読み取り専用のtruth参照を共有し、順序・本文を保持する。
 * @throws RangeError 再生時刻が非有限または負の場合。空timelineでも拒否する。
 */
export const deriveSubtitleHistory = (
  timeline: SubtitleTimeline,
  currentTime: number,
): SubtitleHistorySnapshot => {
  if (!Number.isFinite(currentTime) || currentTime < 0) {
    throw new RangeError('Subtitle history currentTime must be finite and non-negative');
  }
  const result = {
    past: { primary: [] as TimedSubtitleText[], secondary: [] as TimedSubtitleText[] },
    current: { primary: [] as TimedSubtitleText[], secondary: [] as TimedSubtitleText[] },
    future: { primary: [] as TimedSubtitleText[], secondary: [] as TimedSubtitleText[] },
  };
  for (const role of ['primary', 'secondary'] as const) {
    for (const cue of timeline[role]) {
      // 終了時刻ちょうどをpastへ入れ、重なる字幕も各自の期間で独立に扱う。
      if (cue.endTime <= currentTime) result.past[role].push(cue);
      else if (cue.startTime <= currentTime) result.current[role].push(cue);
      else result.future[role].push(cue);
    }
  }
  return result;
};
