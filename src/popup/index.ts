/**
 * index.ts
 *
 * popup の言語設定 UI を初期化し、保存設定の読込・validation・保存結果表示を担当する。
 * 候補一覧は language-options.ts から受け取り、保存値の正規化と storage 操作は settings-store.ts へ委譲する。
 * popup は開くたびに DOM を作り直すため、この段階では session cleanup を持たない前提で扱う。
 */
import { getSupportedLanguageCodes } from '../settings/language-options';
import {
  getSettingsValidationError,
  loadSettings,
  saveSettings,
  type SettingsLoadResult,
  type SettingsSaveResult,
  type SettingsValidationErrorCause
} from '../settings/settings-store';

/**
 * popup 内で必須とする DOM 要素をまとめた参照。
 */
type PopupElements = {
  primarySelect: HTMLSelectElement;
  secondarySelect: HTMLSelectElement;
  saveButton: HTMLButtonElement;
  status: HTMLElement;
};

/** popup から保存処理へ渡す入力値。 */
type PopupFormValues = {
  primaryLang: string;
  secondaryLang: string | null;
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
 * 言語コードから popup 表示用の文言を作る。
 *
 * @param code language-options.ts から受け取る言語コード。
 * @returns 現段階ではコードをそのまま返す。表示名への変換は必要になった段階で追加する。
 */
function formatLanguageLabel(code: string): string {
  return code;
}

/**
 * 指定された select に言語候補一覧を追加する。
 *
 * @param select 候補を描画する対象の select 要素。
 * @param languageCodes 先頭に未選択項目を加えたあと順番に描画する言語コード一覧。
 * @param placeholder 先頭に置く未選択項目の表示文言。
 */
function populateLanguageSelect(
  select: HTMLSelectElement,
  languageCodes: readonly string[],
  placeholder: string
): void {
  select.append(createOption('', placeholder));

  for (const code of languageCodes) {
    select.append(createOption(code, formatLanguageLabel(code)));
  }
}

/**
 * popup の初期化で必須になる DOM 要素を取得する。
 *
 * @returns 学習言語、母国語、保存ボタン、ステータス表示の各要素参照。
 * @throws 必須要素が不足していて popup の初期化を継続できない場合。
 */
function getPopupElements(): PopupElements {
  const primarySelect = document.querySelector<HTMLSelectElement>('[data-role="primary-lang"]');
  const secondarySelect = document.querySelector<HTMLSelectElement>('[data-role="secondary-lang"]');
  const saveButton = document.querySelector<HTMLButtonElement>('[data-role="save"]');
  const status = document.querySelector<HTMLElement>('[data-role="status"]');

  if (!primarySelect || !secondarySelect || !saveButton || !status) {
    throw new Error('Popup UI elements are missing.');
  }

  return { primarySelect, secondarySelect, saveButton, status };
}

/**
 * popup 上の入力値を保存用 shape に読み取る。
 *
 * @param elements popup の DOM 要素参照。
 * @returns primary は文字列、secondary の未選択は null に寄せた入力値。
 */
function readFormValues(elements: PopupElements): PopupFormValues {
  return {
    primaryLang: elements.primarySelect.value,
    secondaryLang: elements.secondarySelect.value === '' ? null : elements.secondarySelect.value
  };
}

/**
 * status 領域へ短い状態文言を反映する。
 *
 * @param elements popup の DOM 要素参照。
 * @param message 利用者へ見せる文言。
 */
function setStatus(elements: PopupElements, message: string): void {
  elements.status.textContent = message;
}

/**
 * 非同期処理中の多重操作を避けるため、form 要素の disabled をまとめて切り替える。
 *
 * @param elements popup の DOM 要素参照。
 * @param disabled 無効化するなら true。
 */
function setFormDisabled(elements: PopupElements, disabled: boolean): void {
  elements.primarySelect.disabled = disabled;
  elements.secondarySelect.disabled = disabled;
  elements.saveButton.disabled = disabled;
}

/**
 * popup 側 validation エラーを利用者向け文言へ変換する。
 *
 * @param cause settings-store.ts が返す validation エラー種別。
 * @returns popup の status 領域に出す短い文言。
 */
function getValidationMessage(cause: SettingsValidationErrorCause): string {
  if (cause === 'duplicate-languages') {
    return '学習言語と母国語に同じ言語は保存できません。';
  }

  return '学習言語を選択してください。';
}

/**
 * 初期読込結果を select と status に反映する。
 *
 * @param elements popup の DOM 要素参照。
 * @param result settings-store.ts の読込結果。
 */
function applyLoadResult(elements: PopupElements, result: SettingsLoadResult): void {
  if (result.status === 'ready') {
    elements.primarySelect.value = result.settings.primaryLang;
    elements.secondarySelect.value = result.settings.secondaryLang ?? '';
    setStatus(elements, '保存済み設定を読み込みました。');
    return;
  }

  if (result.status === 'incomplete') {
    elements.primarySelect.value = result.settings.primaryLang ?? '';
    elements.secondarySelect.value = result.settings.secondaryLang ?? '';
    setStatus(elements, '学習言語を選択してください。');
    return;
  }

  elements.primarySelect.value = '';
  elements.secondarySelect.value = '';
  setStatus(elements, '保存済み設定を読み込めませんでした。');
}

/**
 * 保存結果を status 領域へ反映し、保存済み値を select に戻す。
 *
 * @param elements popup の DOM 要素参照。
 * @param result settings-store.ts の保存結果。
 */
function applySaveResult(elements: PopupElements, result: SettingsSaveResult): void {
  if (result.status === 'ready') {
    elements.primarySelect.value = result.settings.primaryLang;
    elements.secondarySelect.value = result.settings.secondaryLang ?? '';
    setStatus(elements, '設定を保存しました。');
    return;
  }

  if (result.status === 'incomplete') {
    setStatus(elements, getValidationMessage(result.cause));
    return;
  }

  setStatus(elements, '設定の保存に失敗しました。');
}

/**
 * popup 起動時に保存設定を読み込み、初期表示へ反映する。
 *
 * @param elements popup の DOM 要素参照。
 * @returns 読込完了を待つ Promise。
 */
async function loadInitialSettings(elements: PopupElements): Promise<void> {
  setFormDisabled(elements, true);
  setStatus(elements, '保存済み設定を読み込み中です。');

  try {
    const result = await loadSettings();
    applyLoadResult(elements, result);
  } finally {
    setFormDisabled(elements, false);
  }
}

/**
 * 保存ボタン押下時に popup 側 validation と storage 保存を実行する。
 *
 * @param elements popup の DOM 要素参照。
 * @returns 保存完了を待つ Promise。
 */
async function handleSave(elements: PopupElements): Promise<void> {
  const values = readFormValues(elements);
  const validationError = getSettingsValidationError(values);

  if (validationError) {
    setStatus(elements, getValidationMessage(validationError));
    return;
  }

  setFormDisabled(elements, true);
  setStatus(elements, '設定を保存中です。');

  try {
    const result = await saveSettings(values);
    applySaveResult(elements, result);
  } finally {
    setFormDisabled(elements, false);
  }
}

/**
 * popup を開いた直後の UI を組み立て、初期読込と保存処理を結線する。
 *
 * @returns 初期読込を含む popup 初期化の完了を待つ Promise。
 */
async function initializePopup(): Promise<void> {
  const elements = getPopupElements();
  const supportedLanguageCodes = getSupportedLanguageCodes();

  populateLanguageSelect(elements.primarySelect, supportedLanguageCodes, '選択してください');
  populateLanguageSelect(elements.secondarySelect, supportedLanguageCodes, '未選択');
  elements.saveButton.addEventListener('click', () => {
    void handleSave(elements);
  });

  await loadInitialSettings(elements);
}

/**
 * popup の DOM 構築完了後に UI 初期化を始める。
 */
document.addEventListener('DOMContentLoaded', () => {
  void initializePopup();
});
