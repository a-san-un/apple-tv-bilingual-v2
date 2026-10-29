/**
 * WebVTT 本文を表示用文字列へ変換する。source / truth は変更しない。
 * 作業用 fragment は画面へ挿入せず、購読・キャッシュ・DOM 参照を保持しない。
 */

/**
 * 本文から、この呼出しだけが所有する作業用 fragment を作る境界。
 * 引数は元の文字列。戻り値は画面未接続・共有しない fragment。失敗は例外で返す。
 */
export type SubtitleTextParser = (text: string) => DocumentFragment;

/**
 * 標準 WebVTT パーサーで、一時 cue の fragment を作る。
 * @param text 元の字幕本文。空文字も受け付ける。
 * @returns この呼出しが所有する未接続 fragment。
 * @throws API 不在、cue 作成・解析の失敗。
 */
const parseWebVttText: SubtitleTextParser = (text) => {
  if (typeof VTTCue !== 'function') {
    throw new Error('VTTCue is unavailable');
  }
  return new VTTCue(0, 1, text).getCueAsHTML();
};

/**
 * WebVTT を一度解析し、ruby 注釈を除いたプレーンテキストを取得する。
 * @param text 元の本文。trim・空白圧縮・再帰的な再解釈はしない。
 * @param parse 作業用 fragment の生成。通常は標準 VTTCue、テストでは境界を差し替える。
 *   戻り値の rt はこの関数が除去するため、画面や他の呼出しと共有しない。
 * @returns 親文字・空白・改行を保持した表示文字列。空結果もそのまま返す。
 * @throws パーサー・fragment 操作の失敗。fallback やログは呼出元が判断する。
 */
export const toSubtitlePlainText = (
  text: string,
  parse: SubtitleTextParser = parseWebVttText,
): string => {
  const fragment = parse(text);
  for (const annotation of Array.from(fragment.querySelectorAll('rt'))) {
    annotation.remove();
  }
  return fragment.textContent ?? '';
};
