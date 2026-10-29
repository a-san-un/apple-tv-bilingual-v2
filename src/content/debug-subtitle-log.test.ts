import { describe, expect, it, vi } from 'vitest';
import { attachSubtitleSnapshotLog } from './debug-subtitle-log';
import { deriveSubtitleHistory } from '../subtitles/subtitle-history';
import type { SubtitleSessionSnapshot } from '../subtitles/subtitle-session';

/** @returns 解除後のcallbackも発火できる観測fixture。 */
const fixture = () => {
  let snapshot: SubtitleSessionSnapshot | null = null;
  let callback: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const lifecycle = {
    getSubtitleSnapshot: vi.fn(() => snapshot),
    subscribeSubtitle: vi.fn((listener: () => void) => { callback = listener; return unsubscribe; }),
  };
  const logger = { isEnabled: vi.fn(() => true), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    lifecycle, logger, unsubscribe,
    /** @param next 次の取得結果。 */
    set(next: SubtitleSessionSnapshot | null): void { snapshot = next; },
    /** 更新・残存callbackを発火する。 */
    fire(): void { callback?.(); },
  };
};

/** @returns 呼出しごとに独立した空の言語別配列。 */
const emptyTimeline = () => ({ primary: [], secondary: [] });

/** @returns 字幕を持たない接続中snapshot。 */
const emptySnapshot = (): SubtitleSessionSnapshot => ({ timeline: emptyTimeline(), history: { past: emptyTimeline(), current: emptyTimeline(), future: emptyTimeline() } });

/** @returns 元時刻と本文を持つ両言語timelineと、1.5秒で分類したhistory。 */
const snapshot = (): SubtitleSessionSnapshot => {
  const timeline = {
    primary: [{ startTime: 0, endTime: 1, text: 'previous' }, { startTime: 1, endTime: 2, text: 'current' }],
    secondary: [{ startTime: 1, endTime: 2, text: '現在' }, { startTime: 2, endTime: 3, text: '次' }],
  };
  return { timeline, history: deriveSubtitleHistory(timeline, 1.5) };
};

describe('字幕snapshotログ', () => {
  it('無効なら購読・取得・出力をしない', () => {
    const f = fixture();
    const observer = attachSubtitleSnapshotLog(f.lifecycle, false, f.logger);
    observer.dispose(); observer.dispose();
    expect(f.lifecycle.subscribeSubtitle).not.toHaveBeenCalled();
    expect(f.lifecycle.getSubtitleSnapshot).not.toHaveBeenCalled();
    expect(f.logger.info).not.toHaveBeenCalled();
  });

  it('初期値と要約の変化だけを文字列で出力する', () => {
    const f = fixture();
    const observer = attachSubtitleSnapshotLog(f.lifecycle, true, f.logger);
    try {
      expect(f.logger.info).toHaveBeenLastCalledWith('subtitle snapshot', { summary: '{"connected":false}' });
      f.fire();
      expect(f.logger.info).toHaveBeenCalledTimes(1);
      const data = snapshot();
      f.set(data); f.fire();
      expect(f.logger.info).toHaveBeenLastCalledWith('subtitle snapshot', { summary: JSON.stringify({
        connected: true,
        timelineCount: { primary: 2, secondary: 2 },
        first: { primary: data.timeline.primary[0], secondary: data.timeline.secondary[0] },
        last: { primary: data.timeline.primary[1], secondary: data.timeline.secondary[1] },
        current: data.history.current,
        pastCount: { primary: 1, secondary: 0 }, futureCount: { primary: 0, secondary: 1 },
        previous: { primary: data.timeline.primary[0], secondary: null }, next: { primary: null, secondary: data.timeline.secondary[1] },
      }) });
      f.set(snapshot()); f.fire();
      expect(f.logger.info).toHaveBeenCalledTimes(2);
    } finally { observer.dispose(); }
  });

  it('history変化・接続中の空結果・接続なしを区別する', () => {
    const f = fixture();
    f.set(snapshot());
    const observer = attachSubtitleSnapshotLog(f.lifecycle, true, f.logger);
    try {
      const data = snapshot();
      data.history = deriveSubtitleHistory(data.timeline, 0);
      f.set(data); f.fire();
      expect(f.logger.info).toHaveBeenCalledTimes(2);
      f.set(emptySnapshot()); f.fire();
      expect(f.logger.info).toHaveBeenCalledTimes(3);
      f.set(null); f.fire();
      expect(f.logger.info).toHaveBeenCalledTimes(4);
      expect(f.logger.info).toHaveBeenLastCalledWith('subtitle snapshot', { summary: '{"connected":false}' });
    } finally { observer.dispose(); }
  });

  it('info抑制時は取得せず、出力可能になった更新で復帰する', () => {
    const f = fixture();
    f.logger.isEnabled.mockReturnValue(false);
    const observer = attachSubtitleSnapshotLog(f.lifecycle, true, f.logger);
    try {
      f.fire();
      expect(f.lifecycle.getSubtitleSnapshot).not.toHaveBeenCalled();
      f.logger.isEnabled.mockReturnValue(true); f.fire();
      expect(f.lifecycle.getSubtitleSnapshot).toHaveBeenCalledTimes(1);
    } finally { observer.dispose(); }
  });

  it('取得失敗を記録して次の更新で復帰する', () => {
    const f = fixture();
    const error = new Error('read failed');
    f.lifecycle.getSubtitleSnapshot.mockImplementationOnce(() => { throw error; });
    const observer = attachSubtitleSnapshotLog(f.lifecycle, true, f.logger);
    try {
      expect(f.logger.error).toHaveBeenCalledWith('subtitle snapshot observation failed', { error });
      f.fire();
      expect(f.logger.info).toHaveBeenCalledTimes(1);
    } finally { observer.dispose(); }
  });

  it('dispose後の残存callbackから取得・出力しない', () => {
    const f = fixture();
    const observer = attachSubtitleSnapshotLog(f.lifecycle, true, f.logger);
    observer.dispose(); observer.dispose();
    f.lifecycle.getSubtitleSnapshot.mockClear(); f.logger.info.mockClear(); f.fire();
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect(f.lifecycle.getSubtitleSnapshot).not.toHaveBeenCalled();
    expect(f.logger.info).not.toHaveBeenCalled();
  });

  it('解除失敗後も二重解除や残存通知を行わない', () => {
    const f = fixture();
    f.unsubscribe.mockImplementation(() => { throw new Error('remove failed'); });
    const observer = attachSubtitleSnapshotLog(f.lifecycle, true, f.logger);
    expect(() => observer.dispose()).toThrow('remove failed');
    expect(() => observer.dispose()).not.toThrow();
    f.lifecycle.getSubtitleSnapshot.mockClear(); f.fire();
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect(f.lifecycle.getSubtitleSnapshot).not.toHaveBeenCalled();
  });
});
