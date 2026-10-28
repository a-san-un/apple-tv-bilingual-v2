/**
 * panel DOM の土台の生成・mount・unmount を所有する。
 * 汎用 DOM helper を使い、所有中の host 要素だけを保持する。
 * mount 先の解決、字幕描画、表示状態、layout は担当しない。
 * 呼出元は処理 session の終了時に dispose し、返された host の参照も手放す。
 */
import { mountElement, removeElement } from '../shared/dom';

/** panel DOM の参照と、その所有権を終了する API。 */
export type PanelHost = {
  readonly element: HTMLElement | null;
  dispose(): void;
};

/**
 * 指定先に字幕 panel の空の土台を作る。Apple TV+ 固有の探索は行わない。
 *
 * @param mountEl 呼出元が解決した mount 先。接続前の要素も受け付ける。
 * @returns 呼出元が保持・破棄する host。element は dispose 後に null になる。
 * @throws 同じ document または mount 先の配下に host ID が存在する場合、
 *   既存 DOM を変更せず Error。DOM の生成・mount に失敗した場合はその例外。
 */
export const mountPanelHost = (mountEl: HTMLElement): PanelHost => {
  const doc = mountEl.ownerDocument;
  // 別 owner の DOM を奪わず、未接続の mount 先でも同じ ID の重複を防ぐ。
  if (
    doc.getElementById('atv-panel-host') !== null ||
    mountEl.id === 'atv-panel-host' ||
    mountEl.querySelector('#atv-panel-host') !== null
  ) {
    throw new Error('Panel host already exists');
  }

  let element: HTMLElement | null = doc.createElement('div');
  element.id = 'atv-panel-host';
  mountElement(mountEl, element);

  return {
    /**
     * renderer などの呼出元へ、所有中の DOM を渡す。
     *
     * @returns 所有中の host 要素。dispose 後は null。
     */
    get element(): HTMLElement | null {
      return element;
    },

    /**
     * 内部参照を切り離してから host の除去を一度だけ試す。
     * 外部が取得済みの DOM 参照までは解放しない。
     *
     * @throws DOM の除去に失敗した場合、その例外。再呼出しでは再試行しない。
     */
    dispose(): void {
      const ownedElement = element;
      // 除去に失敗しても旧 DOM を保持せず、反復 cleanup で再操作しない。
      element = null;
      removeElement(ownedElement);
    },
  };
};
