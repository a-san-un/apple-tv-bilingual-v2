import { describe, expect, it, vi } from 'vitest';
import { attachSubtitleSnapshotLog } from './debug-subtitle-log';
import { deriveSubtitleHistory, deriveSubtitleDisplayHistory } from '../subtitles/subtitle-history';
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
const emptySnapshot = (): SubtitleSessionSnapshot => ({ generation: 1, updateReason: 'source', display: { status: 'ready', blocks: [], history: { past: [], current: [], future: [] } }, timeline: emptyTimeline(), history: { past: emptyTimeline(), current: emptyTimeline(), future: emptyTimeline() } });

/** @returns 元時刻と本文を持つ両言語timelineと、1.5秒で分類したhistory。 */
const snapshot = (): SubtitleSessionSnapshot => {
  const timeline = {
    primary: [{ startTime: 0, endTime: 1, text: 'previous' }, { startTime: 1, endTime: 2, text: 'current' }],
    secondary: [{ startTime: 1, endTime: 2, text: '現在' }, { startTime: 2, endTime: 3, text: '次' }],
  };
  const blocks = [
    { kind: 'dialogue' as const, startTime: 0, endTime: 1, primary: [{ sourceIndex: 0, text: 'previous' }], secondary: [] },
    { kind: 'dialogue' as const, startTime: 1, endTime: 2, primary: [{ sourceIndex: 1, text: 'current' }], secondary: [{ sourceIndex: 0, text: '現在' }] },
    { kind: 'dialogue' as const, startTime: 2, endTime: 3, primary: [], secondary: [{ sourceIndex: 1, text: '次' }] },
  ];
  return { generation: 1, updateReason: 'source', display: { status: 'ready', blocks, history: deriveSubtitleDisplayHistory(blocks, 1.5) }, timeline, history: deriveSubtitleHistory(timeline, 1.5) };
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
        generation: 1,
        updateReason: 'source',
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
      const initial = snapshot();
      if (initial.display.status !== 'ready') throw new Error('Expected ready fixture');
      const data = { ...initial, history: deriveSubtitleHistory(initial.timeline, 0), display: { ...initial.display, history: deriveSubtitleDisplayHistory(initial.display.blocks, 0) } };
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


describe('字幕snapshotログの世代情報', () => {
  it.each([
    ['generation', 2, 'source'],
    ['time', 1, 'time'],
    ['seek', 1, 'seek'],
  ] as const)('%sだけの変化も出力し、同じ要約の再通知は抑制する', (_label, generation, updateReason) => {
    const f = fixture();
    const initial = snapshot();
    f.set(initial);
    const observer = attachSubtitleSnapshotLog(f.lifecycle, true, f.logger);
    try {
      expect(f.logger.info).toHaveBeenCalledTimes(1);
      const initialCall = f.logger.info.mock.calls[0];
      if (initialCall === undefined) throw new Error('Expected initial log');
      const initialSummary = JSON.parse(initialCall[1].summary);
      expect(initialSummary).toMatchObject({ connected: true, generation: 1, updateReason: 'source' });
      const next: SubtitleSessionSnapshot = { ...initial, generation, updateReason };
      f.set(next);
      f.fire();
      expect(f.logger.info).toHaveBeenCalledTimes(2);
      const nextCall = f.logger.info.mock.calls[1];
      if (nextCall === undefined) throw new Error('Expected updated log');
      expect(nextCall[0]).toBe('subtitle snapshot');
      expect(JSON.parse(nextCall[1].summary)).toEqual({ ...initialSummary, generation, updateReason });
      f.set({ ...next });
      f.fire();
      expect(f.logger.info).toHaveBeenCalledTimes(2);
      expect(f.logger.error).not.toHaveBeenCalled();
    } finally { observer.dispose(); }
  });
});
