/**
 * playback-root.ts
 *
 * Apple TV+ 再生画面から playback target を解決する薄い module。
 * readiness 待機、retry、observer、session start / stop はここに持ち込まない。
 * selector の優先順位と target 構築だけを担当する。
 */
import type {
  PlaybackTarget,
  PlaybackTargetComparison,
  PlaybackTargetSnapshot,
} from '../shared/types';

/** Apple TV+ 再生プレーヤー root の候補 selector。 */
const PLAYBACK_ROOT_SELECTORS = ['dialog.playback-view', '[data-testid="playback-view"]'];

/** 右側字幕 panel を mount する基準要素の selector。 */
const PANEL_MOUNT_TARGET_SELECTOR = '[data-testid="video-player-content"]';

/** panel layout 計算の基準に使う表示領域 selector。 */
const LAYOUT_TARGET_SELECTOR = '[data-testid="video-container"]';

/**
 * selector 候補を順に試し、最初に解決できた element を返す。
 *
 * @param doc 探索対象の document。
 * @param selectors 候補 selector 一覧。
 * @returns 最初に見つかった element。未解決時は null。
 */
const queryFirst = <T extends Element>(
  doc: ParentNode,
  selectors: readonly string[],
): T | null => {
  // selector 配列の順序を優先順位として扱い、最初に一致した候補だけを採用する。
  for (const selector of selectors) {
    const element = doc.querySelector<T>(selector);
    if (element) {
      return element;
    }
  }

  return null;
};

/**
 * `undefined` を持ち込ませず、未解決要素を `null` に正規化する。
 *
 * @param value 解決結果の element。
 * @returns element、または未解決時は null。
 */
const toElement = <T extends Element>(value: T | null | undefined): T | null =>
  value ?? null;

/**
 * playback root を解決する。
 *
 * @param doc 探索対象の document。
 * @returns playback root、未解決時は null。
 */
export const resolvePlaybackRoot = (
  doc: Document = document,
): HTMLElement | null =>
  // 実機では dialog.playback-view が主候補なので先に試し、testid は fallback として使う。
  toElement(queryFirst<HTMLElement>(doc, PLAYBACK_ROOT_SELECTORS));

/**
 * playback root 内の video 要素を解決する。
 * root 配下にない場合だけ document 全体を fallback 探索する。
 *
 * @param root 既に解決した playback root。
 * @param doc 探索対象の document。
 * @returns video 要素、未解決時は null。
 */
export const resolvePlaybackVideo = (
  root: HTMLElement | null,
  doc: Document = document,
): HTMLVideoElement | null =>
  // まず root 配下の video を優先し、見つからない場合だけ document 全体を fallback 探索する。
  toElement(root?.querySelector<HTMLVideoElement>('video')) ??
  toElement(doc.querySelector<HTMLVideoElement>('video'));

/**
 * playback root 内の panel mount target を解決する。
 *
 * @param root 既に解決した playback root。
 * @returns panel mount target、未解決時は null。
 */
export const resolvePanelMountTarget = (
  root: HTMLElement | null,
): HTMLElement | null =>
  toElement(root?.querySelector<HTMLElement>(PANEL_MOUNT_TARGET_SELECTOR));

/**
 * playback root 内の layout 基準領域を解決する。
 *
 * @param root 既に解決した playback root。
 * @returns layout target、未解決時は null。
 */
export const resolveLayoutTarget = (
  root: HTMLElement | null,
): HTMLElement | null =>
  toElement(root?.querySelector<HTMLElement>(LAYOUT_TARGET_SELECTOR));

/**
 * 比較専用の playback target snapshot を作る。
 *
 * @param target 解決済み target 群。
 * @returns DOM 参照比較だけに使う軽量 snapshot。
 */
export const createPlaybackTargetSnapshot = (
  target: Omit<PlaybackTarget, 'snapshot'>,
): PlaybackTargetSnapshot => ({
  rootEl: target.rootEl,
  videoEl: target.videoEl,
  panelMountEl: target.panelMountEl,
  layoutTargetEl: target.layoutTargetEl,
});

/**
 * document から playback target 一式と snapshot を解決する。
 *
 * @param doc 探索対象の document。
 * @returns target 一式。必要要素が欠ける場合は null。
 */
export const resolvePlaybackTarget = (
  doc: Document = document,
): PlaybackTarget | null => {
  // session の起点になる playback root を先に解決する。
  const rootEl = resolvePlaybackRoot(doc);

  // readiness 判定と session 紐付けの基準になる video を解決する。
  const videoEl = resolvePlaybackVideo(rootEl);

  // 将来 panel host を mount する基準要素を解決する。
  const panelMountEl = resolvePanelMountTarget(rootEl);

  // 将来の layout 計算で使う基準要素を解決する。
  const layoutTargetEl = resolveLayoutTarget(rootEl);

  // session で必要な4要素がそろわない場合は、中途半端な target を返さず null にする。
  if (!rootEl || !videoEl || !panelMountEl || !layoutTargetEl) {
    return null;
  }

  // session lifecycle 側で使う完全な target と、比較専用 snapshot をまとめて返す。
  return {
    rootEl,
    videoEl,
    panelMountEl,
    layoutTargetEl,
    snapshot: createPlaybackTargetSnapshot({
      rootEl,
      videoEl,
      panelMountEl,
      layoutTargetEl,
    }),
  };
};

/**
 * 2 つの playback target snapshot を比較する。
 *
 * @param previous 直前 snapshot。
 * @param next 現在 snapshot。
 * @returns root / video / mount / layout 単位の変化結果。
 */
export const comparePlaybackTargetSnapshots = (
  previous: PlaybackTargetSnapshot,
  next: PlaybackTargetSnapshot,
): PlaybackTargetComparison => {
  // 各 DOM 参照の identity を個別に比較し、どの要素が差し替わったかを切り分ける。
  const hasRootChanged = previous.rootEl !== next.rootEl;
  const hasVideoChanged = previous.videoEl !== next.videoEl;
  const hasPanelMountTargetChanged = previous.panelMountEl !== next.panelMountEl;
  const hasLayoutTargetChanged = previous.layoutTargetEl !== next.layoutTargetEl;

  return {
    // 4つすべてに差分がないときだけ、同じ playback target とみなす。
    isSameTarget:
      !hasRootChanged &&
      !hasVideoChanged &&
      !hasPanelMountTargetChanged &&
      !hasLayoutTargetChanged,
    hasRootChanged,
    hasVideoChanged,
    hasPanelMountTargetChanged,
    hasLayoutTargetChanged,
  };
};
