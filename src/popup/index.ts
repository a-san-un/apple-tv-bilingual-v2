/**
 * index.ts
 *
 * popup の最小 UI 骨組みを初期化し、言語候補一覧を select に描画する。
 * 依存先は language-options.ts の候補一覧だけに限定し、保存設定の読込や保存処理は担当しない。
 * popup は開くたびに DOM を作り直すため、この段階では session cleanup を持たない前提で扱う。
 */
import { getSupportedLanguageCodes } from '../settings/language-options';

/**
 * popup 内で必須とする DOM 要素をまとめた参照。
 */
type PopupElements = {
  primarySelect: HTMLSelectElement;
  secondarySelect: HTMLSelectElement;
  status: HTMLElement;
};

/**
 * select に追加する option 要素を 1 件作る。
 *
 * @param value option の value 属性に入れる文字列。未選択は空文字を渡す。
 * @param label popup 上に表示する文言。
 * @returns value と表示文言を設定した option 要素。
 */
function createOption(value: string, label: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

/**
 * 言語コードから popup 表示用の文言を作る。
 *
 * @param code language-options.ts から受け取る言語コード。
 * @returns 現段階ではコードをそのまま返す。表示名への変換は必要になった段階で追加する。
 */
function formatLanguageLabel(code: string): string {
  return code;
}

/**
 * 指定された select に言語候補一覧を追加する。
 *
 * @param select 候補を描画する対象の select 要素。
 * @param languageCodes 先頭に未選択項目を加えたあと順番に描画する言語コード一覧。
 * @param placeholder 先頭に置く未選択項目の表示文言。
 */
function populateLanguageSelect(
  select: HTMLSelectElement,
  languageCodes: readonly string[],
  placeholder: string,
): void {
  select.append(createOption('', placeholder));

  for (const code of languageCodes) {
    select.append(createOption(code, formatLanguageLabel(code)));
  }
}

/**
 * popup の初期化で必須になる DOM 要素を取得する。
 *
 * @returns 学習言語、母国語、ステータス表示の各要素参照。
 * @throws 必須要素が不足していて popup の初期化を継続できない場合。
 */
function getPopupElements(): PopupElements {
  const primarySelect = document.querySelector<HTMLSelectElement>('[data-role="primary-lang"]');
  const secondarySelect = document.querySelector<HTMLSelectElement>('[data-role="secondary-lang"]');
  const status = document.querySelector<HTMLElement>('[data-role="status"]');

  if (!primarySelect || !secondarySelect || !status) {
    throw new Error('Popup UI elements are missing.');
  }

  return { primarySelect, secondarySelect, status };
}

/**
 * popup を開いた直後の最小 UI を組み立てる。
 *
 * 候補一覧の描画だけを行い、保存設定の読込や保存処理は後続実装へ分離する。
 */
function initializePopup(): void {
  const elements = getPopupElements();
  const supportedLanguageCodes = getSupportedLanguageCodes();

  populateLanguageSelect(elements.primarySelect, supportedLanguageCodes, '選択してください');
  populateLanguageSelect(elements.secondarySelect, supportedLanguageCodes, '未選択');
  // 保存処理が未実装でも意図した段階差分だと分かるように、placeholder 状態を明示する。
  elements.status.textContent = '保存機能はまだ未実装です。';
}

/**
 * popup の DOM 構築完了後に最小 UI の初期化を始める。
 */
document.addEventListener('DOMContentLoaded', () => {
  initializePopup();
});
