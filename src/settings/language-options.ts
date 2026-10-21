/**
 * 設定 UI と validation が共通で使う言語候補を提供する。
 * Apple TV+ の track 解決、未選択 option、表示ラベルはこの module に持たない。
 */

import type { LanguageCode } from '../shared/types';

const SUPPORTED_LANGUAGE_CODES = [
  'ar',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'en-AU',
  'en-CA',
  'en-GB',
  'en-US',
  'es',
  'es-419',
  'es-ES',
  'fi',
  'fr',
  'fr-CA',
  'hi',
  'hu',
  'id',
  'it',
  'ja',
  'ko',
  'ms',
  'nl',
  'no',
  'pl',
  'pt',
  'pt-BR',
  'pt-PT',
  'ro',
  'sk',
  'sv',
  'th',
  'tr',
  'uk',
  'vi',
  'yue',
  'zh',
  'zh-Hans',
  'zh-Hant'
] as const satisfies readonly LanguageCode[];

const SUPPORTED_LANGUAGE_CODE_SET = new Set<LanguageCode>(SUPPORTED_LANGUAGE_CODES);

/**
 * 設定 UI と validation で共通に使う対応言語コード一覧を返す。
 *
 * @param なし。
 * @returns 順序固定の対応言語コード一覧。
 */
export function getSupportedLanguageCodes(): readonly LanguageCode[] {
  return SUPPORTED_LANGUAGE_CODES;
}

/**
 * 値が保存可能な言語コードかを判定する。
 *
 * @param value 判定対象の値。
 * @returns 対応一覧に含まれる言語コードなら true。
 */
export function isSupportedLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && SUPPORTED_LANGUAGE_CODE_SET.has(value);
}

export {};
