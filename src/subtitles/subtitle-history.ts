/**
 * subtitle-history.ts
 * 言語別timelineを元時刻で過去・現在・未来へ分類する純関数。
 * Legacy関数は旧再生経路の移行が終わるまで、その呼出元だけが使う。
 * source・TextTrack・video・DOM、購読・timer・スクロールは扱わない。
 */
import type { SubtitleBlock, LegacySubtitleHistorySnapshot, SubtitleHistorySnapshot, SubtitleTimeline, TimedSubtitleText } from '../shared/types';

/**
 * 旧再生経路用に、開始済みの最新開始時刻を持つblockを代表として選ぶ。
 * @param blocks builder が構築した表示順の字幕 truth。変更・並べ替えを行わない。
 * @param currentTime 有限の非負の再生時刻。
 * @returns 新しい snapshot と past / future 配列。block 自体は truth の参照を使う。
 * @throws RangeError 再生時刻が非有限または負の場合。
 */
export const deriveLegacySubtitleHistory = (
  blocks: readonly SubtitleBlock[],
  currentTime: number,
): LegacySubtitleHistorySnapshot => {
  if (!Number.isFinite(currentTime) || currentTime < 0) {
    throw new RangeError('Subtitle history currentTime must be finite and non-negative');
  }
  let currentIndex = -1;
  let latestStartTime = -Infinity;
  blocks.forEach((block, index) => {
    if (block.startTime <= currentTime && block.startTime > latestStartTime) {
      currentIndex = index;
      latestStartTime = block.startTime;
    }
  });
  if (currentIndex === -1) {
    return { current: null, past: [], future: blocks.slice() };
  }
  const current = blocks[currentIndex];
  if (current === undefined) throw new Error('Missing current subtitle block');
  return {
    current,
    past: blocks.slice(0, currentIndex),
    future: blocks.slice(currentIndex + 1),
  };
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
