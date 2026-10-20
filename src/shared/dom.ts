/**
 * Apple TV+ 固有 selector を置かない汎用 DOM helper。
 * panel host や controls などの土台として使い、描画差分更新や字幕固有処理は担当しない。
 */

/**
 * 指定 root から要素を安全に検索する。
 * 要素が無い場合は null を返し、呼び出し側で分岐させる。
 */
export const queryElement = <T extends Element>(
  root: ParentNode,
  selector: string,
): T | null => root.querySelector<T>(selector);

/**
 * 必須要素を取得する。
 *
 * @param root 検索を開始する DOM 範囲。
 * @param selector 検索する CSS selector。
 * @returns 見つかった要素。呼び出し側は owner として後続処理に渡せる。
 * @throws {Error} selector に一致する要素がなく、後続処理を継続できない場合。
 */
export const requireElement = <T extends Element>(
  root: ParentNode,
  selector: string,
): T => {
  const element = queryElement<T>(root, selector);

  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  return element;
};

/**
 * 子要素を mount する。
 *
 * @param parent 追加先の owner DOM。
 * @param child mount する要素。
 * @param options `prepend` が true の場合は先頭へ追加する。
 * @returns mount 後の child。同じ参照を呼び出し側が保持し、owner が後で cleanup する。
 */
export const mountElement = (
  parent: Node,
  child: Node,
  options: { prepend?: boolean } = {},
): Node => {
  // prepend と append を分けるのは、既存 DOM 内での見た目順と tab 順を呼び出し側が選べるようにするため。
  if (options.prepend && 'prepend' in parent) {
    (parent as ParentNode).prepend(child);
    return child;
  }

  parent.appendChild(child);
  return child;
};

/** 既存の子要素をすべて外して mount し直しや再描画の前提を整える。 */
export const clearChildren = (element: Element): void => {
  element.replaceChildren();
};

/**
 * owner が不要になった要素を安全に取り外す。
 * null / undefined は何もしないため、cleanup 側で条件分岐を増やさず使える。
 */
export const removeElement = (element: Element | null | undefined): void => {
  element?.remove();
};
