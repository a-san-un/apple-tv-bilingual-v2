/**
 * text-track-resolver.ts
 *
 * video.textTracks を正規化し、言語設定に対応する primary / secondary を選定する。
 * shared/types.ts の track 型を使い、kind、label、mode、言語一致度、
 * 選定時点の cue の有無から、取得に使う track の優先順位を決める。
 * 表示中字幕の判定は mode === 'showing' とし、取得候補の選定とは区別する。
 * session resource は所有せず、readiness 待機、retry、listener 登録、
 * mode 変更、ブラウザ言語の取得、DOM 描画は担当しない。
 */
import type {
  LanguageCode,
  ResolvedSubtitleTrack,
  ResolvedTrackPair,
  SubtitleTrackCandidate,
} from '../shared/types';

/** 字幕として採用可能な kind。metadata / chapters などは除外する。 */
const SUBTITLE_KINDS = new Set<string>(['subtitles', 'captions']);

/** 通常字幕の代わりに採用しない forced label の判定。 */
const FORCED_LABEL_PATTERN = /forced|強制/i;

/** mode の優先順位。表示中、非表示で有効、無効の順とする。 */
const MODE_PRIORITY: Record<TextTrackMode, number> = {
  showing: 0,
  hidden: 1,
  disabled: 2,
};

/** 要求言語と候補言語の一致度。 */
type LanguageMatch = 'exact' | 'base' | 'none';

/**
 * 選定1回分の比較情報。
 * cue の有無は比較のたびに読み直さず、候補化した時点の値を使う。
 */
type RankedCandidate = {
  candidate: SubtitleTrackCandidate;
  match: LanguageMatch;
  hasCues: boolean;
};

/** resolver が読む一覧の最小形。TextTrackList と配列の両方を受け取る。 */
export type TextTrackListLike = ArrayLike<TextTrack>;

/**
 * primary / secondary 選定の入力。
 * secondaryLang が null のときだけ fallbackSecondaryLang を利用する。
 * fallback の取得と保存設定の検証は呼び出し側が担当する。
 */
export type ResolveTrackPairArgs = {
  textTracks: TextTrackListLike;
  primaryLang: LanguageCode;
  secondaryLang: LanguageCode | null;
  fallbackSecondaryLang?: LanguageCode | null;
};

/**
 * 言語コードを比較用に正規化する。
 *
 * @param value track または設定の言語コード。null / undefined は空文字になる。
 * @returns 前後空白を除き、小文字化し、区切りのアンダースコアをハイフンへ変えた値。
 */
export const normalizeLanguageCode = (
  value: string | null | undefined,
): string => (value ?? '').trim().toLowerCase().replace(/_/g, '-');

/**
 * 正規化済み言語コードを基本言語と残りの subtag に分ける。
 *
 * @param normalized normalizeLanguageCode 済みの値。
 * @returns 基本言語と subtag。subtag がなければ空文字。
 */
const splitLanguage = (
  normalized: string,
): { base: string; subtag: string } => {
  const [base = '', ...rest] = normalized.split('-');
  return { base, subtag: rest.join('-') };
};

/**
 * 要求言語と track 言語の一致度を判定する。
 * 両方が異なる地域・script を指定している場合は一致させない。
 *
 * @param requested 正規化済みの要求言語。
 * @param trackLanguage 正規化済みの track 言語。
 * @returns 完全一致、片側だけ subtag を持つ基本言語一致、または不一致。
 */
const matchLanguage = (
  requested: string,
  trackLanguage: string,
): LanguageMatch => {
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

  // 異なる地域・script を、cue の有無だけで代替採用しない。
  if (req.subtag !== '' && trk.subtag !== '') {
    return 'none';
  }

  return 'base';
};

/**
 * track 一覧を正規化した候補配列へ変換する。
 * 字幕以外の kind も含め、採用可否は isSubtitleCandidate で判定する。
 *
 * @param textTracks 正規化する一覧。空の一覧も受け付ける。
 * @returns 取得時点の管理情報と実 TextTrack 参照を持つ新しい候補配列。
 * @throws language、label、kind、mode などの track 情報を読み取れない場合。
 */
export const normalizeTextTracks = (
  textTracks: TextTrackListLike,
): SubtitleTrackCandidate[] => {
  const candidates: SubtitleTrackCandidate[] = [];

  for (const [index, track] of Array.from(textTracks).entries()) {
    candidates.push({
      // id が空でも候補を識別できるよう位置を補助に使う。永続識別子ではない。
      id: track.id !== '' ? track.id : `track-${index}`,
      index,
      language: normalizeLanguageCode(track.language),
      label: (track.label ?? '').trim().replace(/\s+/g, ' '),
      kind: track.kind,
      mode: track.mode,
      track,
    });
  }

  return candidates;
};

/**
 * 字幕の採用対象になり得る候補かを判定する。
 *
 * @param candidate 正規化済み候補。
 * @returns subtitles / captions で、forced ではなく、言語が空でない場合は true。
 */
export const isSubtitleCandidate = (
  candidate: SubtitleTrackCandidate,
): boolean =>
  SUBTITLE_KINDS.has(candidate.kind) &&
  !FORCED_LABEL_PATTERN.test(candidate.label) &&
  candidate.language !== '';

/**
 * 選定時点で track が cue を持つかを確認する。
 * 本文のコピー、active cue の確認、mode の変更は行わない。
 *
 * @param track 確認する実 TextTrack。
 * @returns cue が1件以上あれば true。null、空、読取失敗の場合は false。
 */
const hasReadableCues = (track: TextTrack): boolean => {
  try {
    return (track.cues?.length ?? 0) > 0;
  } catch {
    // 読めない候補だけで選定全体を止めず、他の候補を引き続き比較する。
    return false;
  }
};

/**
 * 言語条件を満たす候補同士の優先順位を比較する。
 * mode、言語一致度、cue の有無、kind、元の位置の順で決める。
 *
 * @param a 比較する候補と、今回の選定で読み取った比較情報。
 * @param b もう一方の候補と比較情報。
 * @returns sort 用の比較値。負なら a、正なら b を優先する。
 */
const compareCandidates = (
  a: RankedCandidate,
  b: RankedCandidate,
): number => {
  const modeDiff =
    MODE_PRIORITY[a.candidate.mode] - MODE_PRIORITY[b.candidate.mode];

  if (modeDiff !== 0) {
    return modeDiff;
  }

  if (a.match !== b.match) {
    return a.match === 'exact' ? -1 : 1;
  }

  // 同じ条件なら、空の subtitles より cue を持つ captions を優先する。
  if (a.hasCues !== b.hasCues) {
    return a.hasCues ? -1 : 1;
  }

  if (a.candidate.kind !== b.candidate.kind) {
    return a.candidate.kind === 'subtitles' ? -1 : 1;
  }

  // 同等候補は元の順序を維持し、発話の有無や cue 件数で選択を揺らさない。
  return a.candidate.index - b.candidate.index;
};

/**
 * 指定言語の候補を、取得用の優先順で返す。
 * cue の有無は呼び出しごとに読むが、active cue は順位に使わない。
 *
 * @param candidates 正規化済み候補。元の配列は変更しない。
 * @param lang 要求言語。null または空文字なら候補なし。
 * @returns 採用可能な候補を優先順に並べた新しい配列。
 */
export const findLanguageCandidates = (
  candidates: readonly SubtitleTrackCandidate[],
  lang: LanguageCode | null,
): SubtitleTrackCandidate[] => {
  const requested = normalizeLanguageCode(lang);

  if (requested === '') {
    return [];
  }

  const ranked: RankedCandidate[] = [];

  for (const candidate of candidates) {
    if (!isSubtitleCandidate(candidate)) {
      continue;
    }

    const match = matchLanguage(requested, candidate.language);
    if (match === 'none') {
      continue;
    }

    ranked.push({
      candidate,
      match,
      hasCues: hasReadableCues(candidate.track),
    });
  }

  ranked.sort(compareCandidates);

  const result: SubtitleTrackCandidate[] = [];
  for (const entry of ranked) {
    result.push(entry.candidate);
  }

  return result;
};

/**
 * 画面に表示中の字幕 track を返す。
 * cue や active cue の有無ではなく、mode === 'showing' で判定する。
 *
 * @param candidates 呼び出し直前に正規化した候補。
 * @returns showing の字幕候補。複数なら一覧内で先頭の候補、なければ null。
 */
export const findShowingTrack = (
  candidates: readonly SubtitleTrackCandidate[],
): SubtitleTrackCandidate | null => {
  for (const candidate of candidates) {
    if (
      candidate.mode === 'showing' &&
      isSubtitleCandidate(candidate)
    ) {
      return candidate;
    }
  }

  return null;
};

/**
 * secondary の要求言語を決める。
 * 明示 secondary がある場合は、fallback で置き換えない。
 *
 * @param args 選定の入力。fallback が未指定・null・空文字なら利用しない。
 * @returns secondary の要求言語。同じ基本言語の fallback は null。
 */
const resolveSecondaryLang = (
  args: ResolveTrackPairArgs,
): LanguageCode | null => {
  if (args.secondaryLang !== null) {
    return args.secondaryLang;
  }

  const fallback = normalizeLanguageCode(args.fallbackSecondaryLang);
  if (fallback === '') {
    return null;
  }

  const primaryBase = splitLanguage(
    normalizeLanguageCode(args.primaryLang),
  ).base;

  return splitLanguage(fallback).base === primaryBase ? null : fallback;
};

/**
 * 設定言語に対応する primary / secondary の採用 track を決める。
 * 同じ実 TextTrack を両方の役割へ採用しない。
 *
 * @param args 一覧と言語設定。secondaryLang が null のときだけ fallback を使う。
 * @returns 採用結果。候補がない役割は null。cue が空でも候補自体は返せる。
 * @throws track の管理情報を正規化できない場合。cue の読取失敗だけでは投げない。
 */
export const resolveTrackPair = (
  args: ResolveTrackPairArgs,
): ResolvedTrackPair => {
  const candidates = normalizeTextTracks(args.textTracks);
  const primary =
    findLanguageCandidates(candidates, args.primaryLang)[0] ?? null;
  const secondaryLang = resolveSecondaryLang(args);

  let secondary: SubtitleTrackCandidate | null = null;

  for (const candidate of findLanguageCandidates(candidates, secondaryLang)) {
    if (candidate.track !== primary?.track) {
      secondary = candidate;
      break;
    }
  }

  return { primary, secondary };
};

/**
 * track をログ確認用の1行へ要約する。
 *
 * @param track 要約対象。候補型なら index、それ以外は id を使う。null は未採用。
 * @returns index または id、kind、label、language、正規化時点の mode を含む文字列。
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
