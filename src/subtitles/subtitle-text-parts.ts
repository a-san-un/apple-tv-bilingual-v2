/**
 * subtitle-text-parts.ts
 *
 * 言語別timelineの本文を表示用へ変換し、元字幕ごとにセリフ・補助へ分類する。
 * 元データ・時刻・入力順は変更せず、枠構築・ログ・session管理は担当しない。
 * 作業用DOMの寿命は既存の本文変換に閉じ、購読・キャッシュを保持しない。
 */
import { toSubtitlePlainText } from '../panel/subtitle-text';
import type { SubtitleTimeline, TimedSubtitleText } from '../shared/types';

/** 表示用本文と分類。sourceIndexは同世代の所属言語配列の元入力位置。 */
export type PreparedSubtitleItem = Readonly<{
  kind: 'dialogue' | 'auxiliary';
  sourceIndex: number;
  text: string;
}>;

/** 言語別の準備結果。conversionFailedは原文fallbackが1件でもあればtrue。 */
export type PreparedSubtitleItems = Readonly<{
  primary: readonly PreparedSubtitleItem[];
  secondary: readonly PreparedSubtitleItem[];
  conversionFailed: boolean;
}>;

/** 完全な非入れ子の囲み1組以上と、前後・組間の空白だけを受け付ける。 */
const AUXILIARY_TEXT = /^(?:\s*〝[^〝〟]*〟)+\s*$/u;

/**
 * 元字幕の表示用本文を準備し、完全囲みだけを補助へ分類する。
 * 変換失敗は当該字幕の原文をセリフ側へ残し、後続の変換も続ける。
 * @param timeline 構築済みの同世代timeline。元時刻・本文・順序は検証済みであること。
 * @param convert 本文変換。省略時は既存のWebVTT解析・ruby注釈除去を使う。
 * @returns 元入力位置・言語別要素数を保持する新しい配列と要素。ログは出さない。
 */
export const prepareSubtitleDisplayItems = (
  timeline: SubtitleTimeline,
  convert: (text: string) => string = toSubtitlePlainText,
): PreparedSubtitleItems => {
  let conversionFailed = false;

  /**
   * 1言語の各字幕を独立に変換する。補助分類後も添字を振り直さない。
   * @param values 元入力順の字幕。配列と各字幕は変更・保持しない。
   * @returns 入力と同じ件数・順序の準備結果。
   */
  const prepareLanguage = (values: readonly TimedSubtitleText[]): PreparedSubtitleItem[] =>
    values.map(/**
     * 変換境界の失敗だけを原文fallbackとして扱う。
     * @param value 元時刻とタグ付き原文を持つ字幕。
     * @param sourceIndex 所属言語配列の元入力位置。
     * @returns 分類済みの表示要素。変換失敗時は囲み判定を行わない。
     */ (value, sourceIndex): PreparedSubtitleItem => {
      let text: string;
      try {
        text = convert(value.text);
      } catch {
        // 原文の囲みを補助と誤認せず、この字幕だけセリフとして残す。
        conversionFailed = true;
        return { kind: 'dialogue', sourceIndex, text: value.text };
      }
      return { kind: AUXILIARY_TEXT.test(text) ? 'auxiliary' : 'dialogue', sourceIndex, text };
    });

  const primary = prepareLanguage(timeline.primary);
  const secondary = prepareLanguage(timeline.secondary);
  return { primary, secondary, conversionFailed };
};
