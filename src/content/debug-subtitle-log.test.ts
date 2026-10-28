import { describe, expect, it, vi } from 'vitest';
import { attachSubtitleSnapshotLog } from './debug-subtitle-log';
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

/** @returns 本文・時刻を含む3blockのデータ。 */
const snapshot = (): SubtitleSessionSnapshot => {
  const blocks = [
    { startTime: 0, endTime: 1, primaryText: 'previous', secondaryText: null },
    { startTime: 1, endTime: 2, primaryText: 'current', secondaryText: '現在' },
    { startTime: 2, endTime: 3, primaryText: null, secondaryText: '次' },
  ];
  return { blocks, history: { current: blocks[1] ?? null, past: blocks.slice(0, 1), future: blocks.slice(2) } };
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
        connected: true, blockCount: 3, firstBlock: data.blocks[0], lastBlock: data.blocks[2],
        current: data.history.current, pastCount: 1, futureCount: 1, previous: data.blocks[0], next: data.blocks[2],
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
      data.history = { current: null, past: [], future: data.blocks };
      f.set(data); f.fire();
      expect(f.logger.info).toHaveBeenCalledTimes(2);
      f.set({ blocks: [], history: { current: null, past: [], future: [] } }); f.fire();
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
