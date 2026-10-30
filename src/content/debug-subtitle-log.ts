/**
 * lifecycle の字幕データ境界だけを読む開発用ログ観測。
 * DOM・source・video は直接読まず、全 snapshot を保持しない。
 * 購読と重複抑制用の要約文字列を所有し、content の bag が dispose する。
 */
import type { SessionLifecycleController } from './session-lifecycle';
import { createSubtitleLogger, type Logger } from '../shared/log';
import type { Disposable } from '../shared/types';

/**
 * 字幕 snapshot の要約を既存の subtitle logger へ出力する。
 * @param lifecycle 字幕取得と更新購読だけを使う controller。
 * @param enabled false なら購読・取得をしない。
 * @param logger info 出力の窓口。省略時は既存の subtitle logger。
 * @returns 呼出元が保持・破棄する観測。解除失敗後も通知を無効化する。
 */
export const attachSubtitleSnapshotLog = (
  lifecycle: Pick<SessionLifecycleController, 'getSubtitleSnapshot' | 'subscribeSubtitle'>,
  enabled: boolean,
  logger: Logger = createSubtitleLogger(),
): Disposable => {
  if (!enabled) return { dispose: () => {} };
  let disposed = false;
  let lastSummary: string | null = null;

  /** 出力可能なときだけ取得し、変化した要約を安定した文字列で出力する。 */
  const observe = (): void => {
    if (disposed || logger.isEnabled?.('info') === false) return;
    try {
      const snapshot = lifecycle.getSubtitleSnapshot();
      const summary = JSON.stringify(snapshot === null ? { connected: false } : {
        connected: true,
        generation: snapshot.generation,
        updateReason: snapshot.updateReason,
        timelineCount: { primary: snapshot.timeline.primary.length, secondary: snapshot.timeline.secondary.length },
        first: { primary: snapshot.timeline.primary[0] ?? null, secondary: snapshot.timeline.secondary[0] ?? null },
        last: { primary: snapshot.timeline.primary.at(-1) ?? null, secondary: snapshot.timeline.secondary.at(-1) ?? null },
        current: snapshot.history.current,
        pastCount: { primary: snapshot.history.past.primary.length, secondary: snapshot.history.past.secondary.length },
        futureCount: { primary: snapshot.history.future.primary.length, secondary: snapshot.history.future.secondary.length },
        previous: { primary: snapshot.history.past.primary.at(-1) ?? null, secondary: snapshot.history.past.secondary.at(-1) ?? null },
        next: { primary: snapshot.history.future.primary[0] ?? null, secondary: snapshot.history.future.secondary[0] ?? null },
      });

      if (disposed || summary === lastSummary) return;
      logger.info('subtitle snapshot', { summary });
      lastSummary = summary;
    } catch (error) {
      logger.error('subtitle snapshot observation failed', { error });
    }
  };

  const unsubscribe = lifecycle.subscribeSubtitle(observe);
  observe();
  return {
    /** 一度だけ解除し、要約と残存 callback を無効化する。 */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      lastSummary = null;
      unsubscribe();
    },
  };
};
