/**
 * subtitle-history.ts
 * 字幕 truth と再生時刻から current / past / future を導出する純関数。
 * source・TextTrack・video・DOM、購読・timer・スクロールは扱わない。
 */
import type { SubtitleBlock, SubtitleHistorySnapshot } from '../shared/types';

/**
 * 開始済みの最新開始時刻を持つ block を代表として選ぶ。
 * @param blocks builder が構築した表示順の字幕 truth。変更・並べ替えを行わない。
 * @param currentTime 有限の非負の再生時刻。
 * @returns 新しい snapshot と past / future 配列。block 自体は truth の参照を使う。
 * @throws RangeError 再生時刻が非有限または負の場合。
 */
export const deriveSubtitleHistory = (
  blocks: readonly SubtitleBlock[],
  currentTime: number,
): SubtitleHistorySnapshot => {
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
