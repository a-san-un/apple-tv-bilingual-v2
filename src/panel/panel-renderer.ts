/**
 * 準備済みdisplayを描画し、世代とblocks内位置に対応するDOMを所有する。
 * 本文変換・字幕結合・時刻分類・購読・スクロールは担当しない。
 * 接続側がrendererを破棄し、その後にhostを破棄する。
 */
import type { Disposable, SubtitleDisplayBlock, SubtitleDisplaySnapshot } from '../shared/types';

/** 同じsnapshotから受け取った世代・表示結果とUI意思。 */
export type PanelRenderInput = Readonly<{
  generation: number | null;
  display: SubtitleDisplaySnapshot | null;
  panelOpen: boolean;
  extensionEnabled: boolean;
}>;

/** followへ借用するDOM。対応配列は画面順ではなくblocks内位置順。 */
export type PanelRenderResult = Readonly<{
  scrollEl: HTMLElement;
  resumeButton: HTMLButtonElement;
  blockElements: readonly HTMLElement[];
}>;

/** 自身の描画領域だけを更新・破棄する。 */
export type PanelRenderer = Disposable & {
  render(input: PanelRenderInput): PanelRenderResult | null;
};

/** @param doc 所属document。@returns 両言語の空間を持つ新しい表示枠DOM。 */
const createBlockElement = (doc: Document): HTMLElement => {
  const row = doc.createElement('div');
  for (const role of ['primary', 'secondary'] as const) {
    const region = doc.createElement('div');
    region.dataset.subtitleRole = role;
    region.style.whiteSpace = 'pre-wrap';
    region.style.minHeight = '1lh';
    row.append(region);
  }
  return row;
};

/**
 * 表示枠の本文を安全に反映する。同じ本文はDOMを作り直さない。
 * @param row rendererが所有する枠DOM。
 * @param block 構築済みの表示枠。入力を保持・変更しない。
 */
const updateBlockElement = (row: HTMLElement, block: SubtitleDisplayBlock): void => {
  row.dataset.subtitleKind = block.kind;
  for (const [index, role] of (['primary', 'secondary'] as const).entries()) {
    const region = row.children[index] as HTMLElement;
    const values = block[role];
    const unchanged = region.children.length === values.length && values.every((value, i) => {
      const entry = region.children[i] as HTMLElement | undefined;
      return entry?.textContent === value.text && entry.dataset.subtitleSourceIndex === String(value.sourceIndex);
    });
    if (unchanged) continue;
    const entries = values.map(value => {
      const entry = row.ownerDocument.createElement('div');
      entry.dataset.subtitleEntry = role;
      entry.dataset.subtitleSourceIndex = String(value.sourceIndex);
      entry.textContent = value.text;
      return entry;
    });
    region.replaceChildren(...entries);
  }
};

/**
 * host内に描画領域を作る。再開ボタンの操作listenerはfollowが所有する。
 * @param hostEl 呼出元が所有するhost。
 * @returns 接続側が保持・破棄するrenderer。
 * @throws DOM生成・更新・除去の例外。
 */
export const createPanelRenderer = (hostEl: HTMLElement): PanelRenderer => {
  const doc = hostEl.ownerDocument;
  let root: HTMLElement | null = doc.createElement('div');
  root.dataset.subtitlePanel = 'content';
  root.hidden = true;
  const scrollEl = doc.createElement('div');
  scrollEl.dataset.subtitleList = '';
  scrollEl.tabIndex = 0;
  scrollEl.style.overflowY = 'auto';
  const resumeButton = doc.createElement('button');
  resumeButton.type = 'button';
  resumeButton.textContent = '現在位置へ';
  root.append(resumeButton, scrollEl);
  hostEl.append(root);
  let generation: number | null = null;
  let rows: HTMLElement[] = [];
  let revision = 0;

  return {
    /** @param input 導出済み表示。@returns 所有DOMの借用。終了後はnull。@throws DOM更新失敗。 */
    render(input): PanelRenderResult | null {
      if (root === null) return null;
      const ownedRoot = root;
      const currentRevision = ++revision;
      const display = input.display;
      const blocks = display === null || display.status === 'unavailable' ? [] : display.blocks;
      const nextRows = input.generation === generation && rows.length === blocks.length
        ? rows : blocks.map(() => createBlockElement(doc));
      const indices = new Map(blocks.map((block, index) => [block, index]));
      blocks.forEach((block, index) => {
        const row = nextRows[index];
        if (row === undefined) throw new Error('Missing subtitle block DOM');
        row.dataset.subtitleBlock = String(index);
        row.removeAttribute('aria-current');
        row.style.fontWeight = '';
        updateBlockElement(row, block);
      });
      const ordered: HTMLElement[] = [];
      if (display?.status === 'ready') {
        for (const period of ['past', 'current', 'future'] as const) {
          for (const block of display.history[period]) {
            const index = indices.get(block);
            const row = index === undefined ? undefined : nextRows[index];
            if (row === undefined) throw new Error('Subtitle display history does not match blocks');
            row.dataset.subtitlePeriod = period;
            if (period === 'current') { row.setAttribute('aria-current', 'true'); row.style.fontWeight = '700'; }
            ordered.push(row);
          }
        }
      } else {
        for (const row of nextRows) { delete row.dataset.subtitlePeriod; ordered.push(row); }
      }
      if (root !== ownedRoot || revision !== currentRevision) return null;
      const sameOrder = scrollEl.children.length === ordered.length && ordered.every((row, index) => scrollEl.children[index] === row);
      // 同じ並びは取り外さず、選択中の本文とスクロール位置への影響を減らす。
      if (!sameOrder) scrollEl.replaceChildren(...ordered);
      if (root !== ownedRoot || revision !== currentRevision) return null;
      rows = nextRows;
      generation = input.generation;
      ownedRoot.hidden = !input.extensionEnabled || !input.panelOpen;
      return { scrollEl, resumeButton, blockElements: [...rows] };
    },

    /** 内部参照を先に解放する。@throws DOM除去失敗。反復時は再試行しない。 */
    dispose(): void {
      const ownedRoot = root;
      root = null;
      ++revision;
      rows = [];
      generation = null;
      ownedRoot?.remove();
    },
  };
};
