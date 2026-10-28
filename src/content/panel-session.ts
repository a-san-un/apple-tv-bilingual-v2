/**
 * panel-session.ts
 *
 * 字幕データ境界と UI store を panel の描画へ接続する。
 * 自身の購読と host / renderer の disposer を保持し、
 * 処理 session 終了時には lifecycle が返された dispose を呼ぶ。
 *
 * target の探索、字幕処理の開始停止、truth 構築、
 * UI 意思の変更、自動追従、layout は担当しない。
 */
import { mountPanelHost } from '../panel/panel-host';
import {
  createPanelRenderer,
  type PanelRenderer,
} from '../panel/panel-renderer';
import { createDisposeBag } from '../shared/dispose';
import type {
  Disposable,
  DisposeFn,
  UiStateStore,
} from '../shared/types';
import type {
  SubtitleSessionSnapshot,
} from '../subtitles/subtitle-session';

/** panel の生成と表示更新に必要な、取得・購読だけの入力。 */
export type PanelSessionOptions = {
  /** 呼出元が解決した配置先。接続中は同じ要素を使う。 */
  mountEl: HTMLElement;

  /** 操作側 runtime が所有する既存 store。接続側から更新しない。 */
  uiState: Pick<UiStateStore, 'getState' | 'subscribe'>;

  /**
   * 現在の字幕 snapshot を取得する。
   * 呼出元は receiver の this に依存しない関数を渡す。
   *
   * @returns 接続中の snapshot。字幕接続がなければ null。
   * @throws 取得処理の失敗。
   */
  getSubtitleSnapshot: () => SubtitleSessionSnapshot | null;

  /**
   * 字幕データの更新通知を登録する。
   * 登録失敗時は、通知元が途中の登録を残さないことを前提とする。
   *
   * @param listener 更新時に引数なしで呼ぶ関数。
   * @returns この panel 接続が保持し、終了時に呼ぶ購読解除関数。
   * @throws 購読登録の失敗。
   */
  subscribeSubtitle: (listener: () => void) => DisposeFn;
};

/** dispose でまとめて切り離す、描画先と取得元の参照。 */
type PanelConnection = {
  renderer: PanelRenderer;
  uiState: PanelSessionOptions['uiState'];
  getSubtitleSnapshot: PanelSessionOptions['getSubtitleSnapshot'];
};

/**
 * panel の初回描画と更新購読を接続する。
 *
 * @param options 解決済み mount 先、既存 UI store、字幕データ境界。
 *   同じ host ID を持つ接続を重複生成しない。
 * @returns lifecycle が保持し、処理 session 終了時に dispose する接続。
 *   反復 dispose は何もしない。UI store と字幕接続自体は破棄しない。
 * @throws 初期化に失敗した場合、その例外。
 *   cleanup も失敗した場合は、両方の原因を持つ AggregateError。
 */
export const createPanelSession = (
  options: PanelSessionOptions,
): Disposable => {
  const bag = createDisposeBag();

  let connection: PanelConnection | null = null;
  let disposed = false;
  let renderRevision = 0;

  /**
   * 最新データと UI state を取得し、有効な接続だけを描画する。
   * 入力の取得中に再入した場合、古い取得結果は描画しない。
   *
   * @throws snapshot 取得、UI state 取得、DOM 更新の失敗。
   */
  const renderCurrent = (): void => {
    if (disposed || connection === null) {
      return;
    }

    const revision = ++renderRevision;
    const current = connection;
    const snapshot = current.getSubtitleSnapshot();

    // 取得中の停止や更新を、外側の古い描画で上書きしない。
    if (
      disposed ||
      connection !== current ||
      revision !== renderRevision
    ) {
      return;
    }

    const uiState = current.uiState.getState();

    if (
      disposed ||
      connection !== current ||
      revision !== renderRevision
    ) {
      return;
    }

    current.renderer.render({
      history: snapshot?.history ?? {
        current: null,
        past: [],
        future: [],
      },
      panelOpen: uiState.panelOpen,
      extensionEnabled: uiState.extensionEnabled,
    });
  };

  /**
   * 通知経由の表示更新を行う。
   * 失敗は記録し、字幕更新や UI store の通知処理へ伝播させない。
   */
  const handleUpdate = (): void => {
    try {
      renderCurrent();
    } catch (error) {
      console.error(
        '[atv-bilingual:panel] panel update failed',
        error,
      );
    }
  };

  /**
   * 旧 callback を無効化してから、購読と panel 資源の解除を試す。
   * 外部が所有する UI store・字幕接続自体は破棄しない。
   *
   * @throws 解除に失敗した場合、全件試行後に AggregateError。
   *   失敗後の反復呼出しでも同じ cleanup は再実行しない。
   */
  const dispose = (): void => {
    if (disposed) {
      return;
    }

    // 解除失敗で callback が残っても、取得元や旧 DOM へ到達させない。
    disposed = true;
    ++renderRevision;
    connection = null;

    bag.dispose();
  };

  try {
    const host = mountPanelHost(options.mountEl);
    bag.add(host);

    const hostEl = host.element;
    if (hostEl === null) {
      throw new Error('Panel host is unavailable');
    }

    const renderer = createPanelRenderer(hostEl);
    bag.add(renderer);

    connection = {
      renderer,
      uiState: options.uiState,
      getSubtitleSnapshot: options.getSubtitleSnapshot,
    };

    // 先に購読してから最新値を読み、取得と登録の間の更新を取りこぼさない。
    bag.add(options.subscribeSubtitle(handleUpdate));
    bag.add(options.uiState.subscribe(handleUpdate));

    // 初回だけは失敗を隠さず、作成済み資源を解放して呼出元へ返す。
    renderCurrent();

    return { dispose };
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Panel session initialization and cleanup failed',
      );
    }

    throw error;
  }
};
