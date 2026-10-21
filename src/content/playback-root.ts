/**
 * playback-root.ts
 *
 * Apple TV+ 再生画面から playback target を解決する薄い module。
 * readiness 待機、retry、observer、session start / stop はここに持ち込まない。
 */
import type {
  PlaybackTarget,
  PlaybackTargetComparison,
  PlaybackTargetSnapshot,
} from '../shared/types';

/** Apple TV+ 再生プレーヤー root の候補 selector。 */
const PLAYBACK_ROOT_SELECTOR = '[data-testid="apple-tv-player"]';

/** 右側字幕 panel を mount する基準要素の selector。 */
const PANEL_MOUNT_TARGET_SELECTOR = '.web-chrome';

/** panel layout 計算の基準に使う表示領域 selector。 */
const LAYOUT_TARGET_SELECTOR = '.web-player-video-view';

/**
 * `undefined` を持ち込ませず、未解決要素を `null` に正規化する。
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
  toElement(doc.querySelector<HTMLElement>(PLAYBACK_ROOT_SELECTOR));

/**
 * playback root 内の video 要素を解決する。
 *
 * @param root 既に解決した playback root。
 * @returns video 要素、未解決時は null。
 */
export const resolvePlaybackVideo = (
  root: HTMLElement | null,
): HTMLVideoElement | null =>
  toElement(root?.querySelector<HTMLVideoElement>('video'));

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
  const rootEl = resolvePlaybackRoot(doc);
  const videoEl = resolvePlaybackVideo(rootEl);
  const panelMountEl = resolvePanelMountTarget(rootEl);
  const layoutTargetEl = resolveLayoutTarget(rootEl);

  if (!rootEl || !videoEl || !panelMountEl || !layoutTargetEl) {
    return null;
  }

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
  const hasRootChanged = previous.rootEl !== next.rootEl;
  const hasVideoChanged = previous.videoEl !== next.videoEl;
  const hasPanelMountTargetChanged = previous.panelMountEl !== next.panelMountEl;
  const hasLayoutTargetChanged = previous.layoutTargetEl !== next.layoutTargetEl;

  return {
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
