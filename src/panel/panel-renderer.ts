/**
 * panel-renderer.ts
 *
 * 外部から渡された history と UI state を panel 内へ描画する。
 * 描画領域だけを所有し、host の mount / unmount は panel-host に任せる。
 * source・TextTrack・再生時刻の読取、購読、自動追従、layout は担当しない。
 * 接続側は処理 session 終了時に dispose し、renderer の参照も手放す。
 */
import type { SubtitleTimeline, SubtitleHistoryView } from '../shared/types';
import { toSubtitlePlainText } from './subtitle-text';

/** 接続側が取得した表示データと現在の表示意思。renderer は保持しない。 */
export type PanelRenderInput = {
  /** 導出済みの表示順と current。renderer は再選択・並べ替えをしない。 */
  history: SubtitleHistoryView;
  /** panel の表示意思。字幕処理 session の停止指示ではない。 */
  panelOpen: boolean;
  /** 拡張の有効状態。false なら panelOpen にかかわらず非表示にする。 */
  extensionEnabled: boolean;
};

/** 描画領域を更新・破棄する API。host 自体の所有権は持たない。 */
export type PanelRenderer = {
  /** 入力を保持せず描画する。dispose 後は無効。DOM 更新の例外は呼出元へ伝える。 */
  render(input: PanelRenderInput): void;
  /** 自身の描画領域だけを除去する。host の dispose より先に呼ぶ。失敗は呼出元へ伝える。 */
  dispose(): void;
};

/**
 * 言語ごとの本文領域を作り、改行と欠損側の高さを保持する。
 *
 * @param doc host が所属する document。
 * @param text 字幕単位の本文。null は本文なしとして空行の高さを確保する。
 * @param convert 変換失敗時の fallback を含む表示用変換。
 * @returns HTML として解釈せず本文を表示する要素。
 */
const createTextRegion = (
  doc: Document,
  text: string | null,
  convert: (text: string) => string,
): HTMLElement => {
  const region = doc.createElement('div');
  region.style.whiteSpace = 'pre-wrap';
  region.style.minHeight = '1lh';
  // 変換結果も fallback も HTML として挿入せず、欠損側の領域を維持する。
  region.textContent = text === null ? '' : convert(text);
  return region;
};

/**
 * 1区分を学習言語・母国語の順で描画し、言語内の字幕順を維持する。
 * @param doc hostが所属するdocument。
 * @param period 描画する区分。時刻判定は呼出元が完了していること。
 * @param values 区分に属する言語別字幕。変更・保持しない。
 * @param convert fallbackを含む表示用本文変換。
 * @returns 空の言語領域も保持する区分要素。対訳ペアは作らない。
 */
const createPeriodRegion = (
  doc: Document,
  period: keyof SubtitleHistoryView,
  values: SubtitleTimeline,
  convert: (text: string) => string,
): HTMLElement => {
  const region = doc.createElement('div');
  region.dataset.subtitlePeriod = period;
  for (const role of ['primary', 'secondary'] as const) {
    const language = doc.createElement('div');
    language.dataset.subtitleRole = role;
    if (values[role].length === 0) language.append(createTextRegion(doc, null, convert));
    for (const value of values[role]) {
      const entry = createTextRegion(doc, value.text, convert);
      entry.dataset.subtitleEntry = role;
      if (period === 'current') {
        entry.setAttribute('aria-current', 'true');
        entry.style.fontWeight = '700';
      }
      language.append(entry);
    }
    region.append(language);
  }
  return region;
};

/**
 * host に独立した描画領域を追加する。初回 render までは非表示にする。
 *
 * @param hostEl panel-host が所有する要素。renderer より長く生存させ、
 *   同じ host に有効な renderer を重複作成しない。
 * @returns 接続側が保持・破棄する renderer。dispose 後の render は何もしない。
 * @throws DOM の生成・追加に失敗した場合、その例外。
 */
export const createPanelRenderer = (hostEl: HTMLElement): PanelRenderer => {
  let root: HTMLElement | null = hostEl.ownerDocument.createElement('div');
  root.dataset.subtitlePanel = 'content';
  // 初回入力を受け取る前に、空の領域が表示されるのを防ぐ。
  root.hidden = true;
  // host の所有権は移さず、renderer が破棄する子領域だけを追加する。
  hostEl.append(root);
  let conversionFailureReported = false;

  /**
   * 本文を表示用へ変換し、失敗時も元の文字列で描画を継続する。
   * @param text 入力字幕単位の本文。変更・保持しない。
   * @returns 変換結果、または失敗した場合の元本文。
   */
  const convertText = (text: string): string => {
    try {
      return toSubtitlePlainText(text);
    } catch (error) {
      // 毎回の描画で警告を連発せず、後続本文の変換試行は止めない。
      if (!conversionFailureReported) {
        conversionFailureReported = true;
        console.warn('[atv-bilingual:panel] subtitle text conversion failed; using original text', error);
      }
      return text;
    }
  };

  return {
    /**
     * history の順序と本文を維持して描画領域を更新する。入力は保持しない。
     *
     * @param input 表示用 history と UI state。空 history も受け付ける。
     * @throws DOM の生成・更新に失敗した場合、その例外。
     */
    render(input: PanelRenderInput): void {
      // 破棄済みの renderer に遅れて入力が届いても、DOM を再生成しない。
      if (root === null) return;
      const doc = root.ownerDocument;
      const fragment = doc.createDocumentFragment();
      let subtitleCount = 0;
      for (const period of ['past', 'current', 'future'] as const) {
        const values = input.history[period];
        subtitleCount += values.primary.length + values.secondary.length;
        fragment.append(createPeriodRegion(doc, period, values, convertText));
      }
      // 空 history だけでは未取得と track 不在を区別できないため、原因を断定しない。
      if (subtitleCount === 0) {
        fragment.textContent = '';
        const empty = doc.createElement('p');
        empty.textContent = '表示できる字幕はありません';
        fragment.append(empty);
      }
      // host の他の子要素には触れず、所有する描画領域だけを置き換える。
      root.replaceChildren(fragment);
      // 表示の切替だけを行い、UI store の意思や処理 session は変更しない。
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
