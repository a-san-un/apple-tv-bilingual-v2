/**
 * 外部から渡された history と UI state を panel 内へ描画する。
 * 描画領域だけを所有し、host の mount / unmount は panel-host に任せる。
 * source・TextTrack・再生時刻の読取、購読、自動追従、layout は担当しない。
 * 接続側は処理 session 終了時に dispose し、renderer の参照も手放す。
 */
import type { SubtitleBlock, SubtitleHistoryView } from '../shared/types';

/** 接続側が取得した表示データと現在の表示意思。renderer は保持しない。 */
export type PanelRenderInput = {
  history: SubtitleHistoryView;
  panelOpen: boolean;
  extensionEnabled: boolean;
};

/** 描画領域を更新・破棄する API。host 自体の所有権は持たない。 */
export type PanelRenderer = {
  render(input: PanelRenderInput): void;
  dispose(): void;
};

/**
 * 言語ごとの本文領域を作り、改行と欠損側の高さを保持する。
 *
 * @param doc host が所属する document。
 * @param text block の本文。null は本文なしとして空行の高さを確保する。
 * @returns HTML として解釈せず本文を表示する要素。
 */
const createTextRegion = (doc: Document, text: string | null): HTMLElement => {
  const region = doc.createElement('div');
  region.style.whiteSpace = 'pre-wrap';
  region.style.minHeight = '1lh';
  region.textContent = text ?? '';
  return region;
};

/**
 * block を二言語の表示行へ変換する。時刻や本文から current を再選択しない。
 *
 * @param doc host が所属する document。
 * @param block history に含まれる block。変更しない。
 * @param current history が選択した current かどうか。
 * @returns 学習言語、母国語の順で本文を持つ行。
 */
const createBlockRow = (
  doc: Document,
  block: SubtitleBlock,
  current: boolean,
): HTMLElement => {
  const row = doc.createElement('div');
  row.dataset.subtitleBlock = current ? 'current' : 'other';
  if (current) {
    row.setAttribute('aria-current', 'true');
    row.style.fontWeight = '700';
  }
  row.append(
    createTextRegion(doc, block.primaryText),
    createTextRegion(doc, block.secondaryText),
  );
  return row;
};

/**
 * host に独立した描画領域を追加する。初回 render までは非表示にする。
 *
 * @param hostEl panel-host が所有する要素。renderer より長く生存させる。
 * @returns 接続側が保持・破棄する renderer。dispose 後の render は何もしない。
 * @throws DOM の生成・追加に失敗した場合、その例外。
 */
export const createPanelRenderer = (hostEl: HTMLElement): PanelRenderer => {
  let root: HTMLElement | null = hostEl.ownerDocument.createElement('div');
  root.dataset.subtitlePanel = 'content';
  root.hidden = true;
  hostEl.append(root);

  return {
    /**
     * history の順序と本文を維持して描画領域を更新する。入力は保持しない。
     *
     * @param input 表示用 history と UI state。空 history も受け付ける。
     * @throws DOM の生成・更新に失敗した場合、その例外。
     */
    render(input: PanelRenderInput): void {
      if (root === null) return;
      const doc = root.ownerDocument;
      const fragment = doc.createDocumentFragment();
      for (const block of input.history.past) {
        fragment.append(createBlockRow(doc, block, false));
      }
      if (input.history.current !== null) {
        fragment.append(createBlockRow(doc, input.history.current, true));
      }
      for (const block of input.history.future) {
        fragment.append(createBlockRow(doc, block, false));
      }
      if (fragment.childNodes.length === 0) {
        const empty = doc.createElement('p');
        empty.textContent = '表示できる字幕はありません';
        fragment.append(empty);
      }
      // host の他の子要素には触れず、所有する描画領域だけを置き換える。
      root.replaceChildren(fragment);
      root.hidden = !input.extensionEnabled || !input.panelOpen;
    },

    /**
     * 描画領域の内部参照を解放してから、その DOM の除去を一度だけ試す。
     * host 自体や外部が取得済みの DOM 参照は破棄しない。
     *
     * @throws DOM の除去に失敗した場合、その例外。反復呼出しでは再試行しない。
     */
    dispose(): void {
      const ownedRoot = root;
      // 除去に失敗しても、停止後の render が旧 DOM を更新しないよう切り離す。
      root = null;
      ownedRoot?.remove();
    },
  };
};
