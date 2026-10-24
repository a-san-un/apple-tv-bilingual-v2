/**
 * text-track-resolver.ts
 *
 * `video.textTracks` を候補配列へ正規化し、primaryLang / secondaryLang に対する
 * 採用 track を決める pure に近い判定 module。
 * 判定には `language`、`label`、`kind`、`mode` を合わせて使い、
 * 表示中 track の判定では `TextTrack.mode === 'showing'` を優先する。
 *
 * 担当しないこと:
 * - readiness 待機、retry、listener 登録（session-lifecycle / subtitle-source が持つ）
 * - `TextTrack.mode` の書き換え
 * - `activeCues` / active cue 数による表示中判定（hidden track にも active cue があるため）
 * - ブラウザ言語の取得（fallback 値は呼び出し側が引数で渡す）
 */

import type {
  LanguageCode,
  ResolvedSubtitleTrack,
  ResolvedTrackPair,
  SubtitleTrackCandidate,
} from '../shared/types';

/** 字幕として採用してよい `TextTrack.kind`。metadata / chapters などは除外する。 */
const SUBTITLE_KINDS = new Set<string>(['subtitles', 'captions']);

/** forced（強制字幕）らしい label。通常字幕の代わりにならないため候補から外す。 */
const FORCED_LABEL_PATTERN = /forced|強制/i;

/** 表示中判定の優先順位。数値が小さいほど優先する。 */
const MODE_PRIORITY: Record<TextTrackMode, number> = {
  showing: 0,
  hidden: 1,
  disabled: 2,
};

/** 言語一致の強さ。`exact` は完全一致、`base` は基本言語だけの一致。 */
type LanguageMatch = 'exact' | 'base' | 'none';

/** resolver が読む `TextTrack` 一覧の最小形。`TextTrackList` と配列の両方を受け取る。 */
export type TextTrackListLike = ArrayLike<TextTrack>;

/**
 * `resolveTrackPair()` の入力。
 * `secondaryLang` が null のときだけ `fallbackSecondaryLang` を使う。
 */
export type ResolveTrackPairArgs = {
  textTracks: TextTrackListLike;
  primaryLang: LanguageCode;
  secondaryLang: LanguageCode | null;
  fallbackSecondaryLang?: LanguageCode | null;
};

/**
 * 言語コードを比較用にそろえる。
 *
 * @param value `TextTrack.language` または設定値。空や未定義は空文字になる。
 * @returns 前後空白を除き、小文字化して `_` を `-` にそろえた値。
 */
export const normalizeLanguageCode = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase().replace(/_/g, '-');

/**
 * 正規化済み言語コードを基本言語と補助 subtag に分ける。
 *
 * @param normalized `normalizeLanguageCode()` 済みの値。
 * @returns `ja-jp` なら `{ base: 'ja', subtag: 'jp' }`。subtag がなければ空文字。
 */
const splitLanguage = (normalized: string): { base: string; subtag: string } => {
  const [base = '', ...rest] = normalized.split('-');
  return { base, subtag: rest.join('-') };
};

/**
 * 要求言語と track 言語の一致度を判定する。
 * 地域・script が両方にあって異なる場合（`zh-hans` と `zh-hant` など）は一致としない。
 *
 * @param requested 正規化済みの要求言語。
 * @param trackLanguage 正規化済みの track 言語。
 * @returns 完全一致なら `exact`、片側だけ subtag を持つ基本言語一致なら `base`、それ以外は `none`。
 */
const matchLanguage = (requested: string, trackLanguage: string): LanguageMatch => {
  if (requested === '' || trackLanguage === '') {
    return 'none';
  }

  if (requested === trackLanguage) {
    return 'exact';
  }

  const req = splitLanguage(requested);
  const trk = splitLanguage(trackLanguage);
  if (req.base !== trk.base) {
    return 'none';
  }

  // 両方が別の地域・script を指定しているときは別言語として扱い、誤採用を避ける。
  if (req.subtag !== '' && trk.subtag !== '') {
    return 'none';
  }

  return 'base';
};

/**
 * `TextTrackList` / `TextTrack[]` を候補配列へ正規化する。
 * 字幕以外の kind も含めた全 track を返し、採用可否は `isSubtitleCandidate()` で判定する。
 * `language` は比較用に正規化した値（小文字・`-` 区切り）を入れる。
 *
 * @param textTracks 正規化する track 一覧。readiness 通過後の `video.textTracks` を想定する。
 * @returns 取得時点の `language` / `label` / `kind` / `mode` を写した候補配列。
 */
export const normalizeTextTracks = (textTracks: TextTrackListLike): SubtitleTrackCandidate[] =>
  Array.from(textTracks, (track, index) => ({
    // Apple TV+ の `TextTrack.id` は空のことがあるため、空なら位置から識別子を作る。
    id: track.id !== '' ? track.id : `track-${index}`,
    index,
    language: normalizeLanguageCode(track.language),
    label: (track.label ?? '').trim().replace(/\s+/g, ' '),
    kind: track.kind,
    mode: track.mode,
    track,
  }));

/**
 * 候補が字幕 track として採用対象になり得るかを判定する。
 * `language` だけでは判定せず、`kind` と `label` も見る。
 *
 * @param candidate 正規化済み候補。
 * @returns kind が subtitles / captions、forced でない、language が空でないとき true。
 */
export const isSubtitleCandidate = (candidate: SubtitleTrackCandidate): boolean =>
  SUBTITLE_KINDS.has(candidate.kind) &&
  !FORCED_LABEL_PATTERN.test(candidate.label) &&
  candidate.language !== '';

/**
 * 候補同士の優先順位を比較する。
 * mode（showing → hidden → disabled）、言語一致度、kind、textTracks 内の位置の順で決める。
 *
 * @param a 比較対象の候補と一致度。
 * @param b 比較対象の候補と一致度。
 * @returns `Array.prototype.sort` 用の比較値。負なら a を優先する。
 */
const compareCandidates = (
  a: { candidate: SubtitleTrackCandidate; match: LanguageMatch },
  b: { candidate: SubtitleTrackCandidate; match: LanguageMatch },
): number => {
  const modeDiff = MODE_PRIORITY[a.candidate.mode] - MODE_PRIORITY[b.candidate.mode];
  if (modeDiff !== 0) {
    return modeDiff;
  }

  if (a.match !== b.match) {
    return a.match === 'exact' ? -1 : 1;
  }

  if (a.candidate.kind !== b.candidate.kind) {
    return a.candidate.kind === 'subtitles' ? -1 : 1;
  }

  return a.candidate.index - b.candidate.index;
};

/**
 * 指定言語の採用候補を優先順に並べて返す。
 *
 * @param candidates `normalizeTextTracks()` の結果。
 * @param lang 要求言語。null / 空文字なら候補なし。
 * @returns 採用対象の候補を、showing 優先の順に並べた新しい配列。
 */
export const findLanguageCandidates = (
  candidates: readonly SubtitleTrackCandidate[],
  lang: LanguageCode | null,
): SubtitleTrackCandidate[] => {
  const requested = normalizeLanguageCode(lang);
  if (requested === '') {
    return [];
  }

  return candidates
    .filter(isSubtitleCandidate)
    .map((candidate) => ({ candidate, match: matchLanguage(requested, candidate.language) }))
    .filter((entry) => entry.match !== 'none')
    .sort(compareCandidates)
    .map((entry) => entry.candidate);
};

/**
 * 画面に表示中の字幕 track を返す。
 * 判定は `mode === 'showing'` だけで行い、active cue の有無は使わない。
 *
 * @param candidates `normalizeTextTracks()` の結果。呼び出し直前に正規化した値を渡す。
 * @returns showing の字幕候補。複数あれば textTracks 内で先頭のもの、なければ null。
 */
export const findShowingTrack = (
  candidates: readonly SubtitleTrackCandidate[],
): SubtitleTrackCandidate | null =>
  candidates.find((candidate) => candidate.mode === 'showing' && isSubtitleCandidate(candidate)) ??
  null;

/**
 * primary / secondary の採用 track を決める。
 * 一致候補がない役割は null を返し、例外にはしない。
 * primary と secondary に同じ track は採用しない。
 *
 * @param args track 一覧と言語設定。`secondaryLang` が null なら `fallbackSecondaryLang` を使う。
 * @returns primary / secondary の採用結果。どちらも見つからなければ両方 null。
 */
export const resolveTrackPair = (args: ResolveTrackPairArgs): ResolvedTrackPair => {
  const candidates = normalizeTextTracks(args.textTracks);
  const primary = findLanguageCandidates(candidates, args.primaryLang)[0] ?? null;

  const secondaryLang = resolveSecondaryLang(args);
  const secondary =
    findLanguageCandidates(candidates, secondaryLang).find(
      (candidate) => candidate.track !== primary?.track,
    ) ?? null;

  return { primary, secondary };
};

/**
 * secondary の要求言語を決める。
 * fallback（ブラウザ言語）が primary と同じ基本言語なら、同一言語の二重表示を避けるため使わない。
 *
 * @param args `resolveTrackPair()` の入力。
 * @returns secondary として探す言語。使わない場合は null。
 */
const resolveSecondaryLang = (args: ResolveTrackPairArgs): LanguageCode | null => {
  if (args.secondaryLang !== null) {
    return args.secondaryLang;
  }

  const fallback = normalizeLanguageCode(args.fallbackSecondaryLang);
  if (fallback === '') {
    return null;
  }

  const primaryBase = splitLanguage(normalizeLanguageCode(args.primaryLang)).base;
  return splitLanguage(fallback).base === primaryBase ? null : fallback;
};

/**
 * ログ確認用に track を 1 行へ要約する。
 * 形式は `docs/apple-tv-dom-observations.md` の track 表記（index: kind: label: language）にそろえる。
 * `mode` は正規化した時点の値を出す。
 *
 * @param track 要約する track。候補型なら index を、そうでなければ id を先頭に出す。null は `none`。
 * @returns `82: subtitles: 日本語: ja (showing)` のような文字列。
 */
export const summarizeTrack = (
  track: ResolvedSubtitleTrack | SubtitleTrackCandidate | null,
): string => {
  if (track === null) {
    return 'none';
  }

  const head = 'index' in track ? String(track.index) : track.id;
  return `${head}: ${track.kind}: ${track.label}: ${track.language} (${track.mode})`;
};
