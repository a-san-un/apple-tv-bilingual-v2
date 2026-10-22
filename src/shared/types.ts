/**
 * types.ts
 *
 * module 境界で共有する最小共通型の置き場。
 * Phase 3-A では runtime UI state と playback target snapshot の境界もここに含める。
 * Apple TV+ 固有の一時観測情報や debug 専用情報は持ち込まず、
 * 保存設定、runtime state、subtitle truth、session 状態の境界で使う型だけを定義する。
 */

/** 言語設定や字幕 track 解決で使う言語コード。 */
export type LanguageCode = string;

/**
 * settings-store が扱う保存設定。
 * Chrome Storage に保存される値であり、runtime 専用 state は含めない。
 */
export type StoredSettings = {
  primaryLang: LanguageCode | null;
  secondaryLang: LanguageCode | null;
};

/**
 * module 間で設定値を受け渡すときの共通名。
 * Phase 1-1 では保存形式と同一構造に留める。
 */
export type ExtensionSettings = StoredSettings;

/**
 * `TextTrack` を resolver が正規化した字幕 track。
 * subtitles 系 module 間で共有し、保存はしない。
 */
export type ResolvedSubtitleTrack = {
  id: string;
  language: LanguageCode;
  label: string;
  kind: TextTrackKind | string;
  mode: TextTrackMode;
  track: TextTrack;
};

/**
 * `ResolvedSubtitleTrack` を module 境界で短く参照するための別名。
 */
export type SubtitleTrack = ResolvedSubtitleTrack;

/**
 * primary / secondary の採用結果。
 * resolver と source の境界で使う。
 */
export type ResolvedTrackPair = {
  primary: ResolvedSubtitleTrack | null;
  secondary: ResolvedSubtitleTrack | null;
};

/**
 * 生 cue から切り出した最小 snapshot。
 * block 構築前の一時表現であり、保存対象ではない。
 */
export type SubtitleCueSnapshot = {
  startTime: number;
  endTime: number;
  text: string;
  track: ResolvedSubtitleTrack | null;
};

/**
 * panel 表示の truth になる字幕表示単位。
 * UI は raw cue ではなく、この block 配列を正本として扱う。
 */
export type SubtitleBlock = {
  startTime: number;
  endTime: number;
  primaryText: string;
  secondaryText: string | null;
};

/**
 * panel renderer が読む current / past / future の snapshot。
 * truth から導出した runtime 表現であり、保存しない。
 */
export type SubtitleHistorySnapshot = {
  current: SubtitleBlock | null;
  past: SubtitleBlock[];
  future: SubtitleBlock[];
};

/**
 * `SubtitleHistorySnapshot` を view 層で短く参照するための別名。
 */
export type SubtitleHistoryView = SubtitleHistorySnapshot;

/**
 * runtime 上の UI 意思だけを表す state。
 * 保存設定とは分離し、Chrome Storage には保存しない。
 */
export type ExtensionUiState = {
  extensionEnabled: boolean;
  panelOpen: boolean;
};

/**
 * `ExtensionUiState` を module 内で短く参照するための別名。
 */
export type UiState = ExtensionUiState;

/** UI state 更新の購読コールバック。 */
export type UiStateListener = (state: ExtensionUiState) => void;

/**
 * playback-root が解決した再生対象。
 * session が利用できる解決済み target だけを表す。
 */
export type PlaybackTarget = {
  rootEl: HTMLElement;
  videoEl: HTMLVideoElement;
  panelMountEl: HTMLElement;
  layoutTargetEl: HTMLElement;
  snapshot: PlaybackTargetSnapshot;
};

/**
 * playback target の比較用 snapshot。
 * 解決済み target の DOM 参照比較だけに使う純粋 snapshot とする。
 */
export type PlaybackTargetSnapshot = {
  rootEl: HTMLElement;
  videoEl: HTMLVideoElement;
  panelMountEl: HTMLElement;
  layoutTargetEl: HTMLElement;
};

/**
 * 2 つの playback target snapshot を比較した結果。
 * session 再初期化の判断材料だけを返す。
 */
export type PlaybackTargetComparison = {
  isSameTarget: boolean;
  hasRootChanged: boolean;
  hasVideoChanged: boolean;
  hasPanelMountTargetChanged: boolean;
  hasLayoutTargetChanged: boolean;
};

/**
 * panel layout 適用のための runtime 幾何状態。
 * `ui-state.ts` では保持せず、layout owner 専用とする。
 */
export type PlayerLayoutState = {
  active: boolean;
  availableWidth: number | null;
  playerWidth: number | null;
  panelWidth: number | null;
};

/**
 * session を再初期化した理由。
 * readiness / restart / cleanup の観測と分岐で使う。
 */
export type RestartReason =
  | 'initial-start'
  | 'spa-navigation'
  | 'playback-target-appeared'
  | 'video-replaced'
  | 'settings-changed'
  | 'subtitle-track-changed'
  | 'subtitle-unavailable'
  | 'manual-restart'
  | 'unknown';

/**
 * readiness 待機中だけ `session-lifecycle.ts` が持つ一時状態。
 * retry 制御のための runtime 情報であり、保存しない。
 */
export type WaitingState = {
  startedAt: number;
  retryCount: number;
  targetVideo: HTMLVideoElement;
};

/**
 * playback session の進行状態。
 * session owner と周辺 module の境界で使う runtime state。
 */
export type PlaybackSessionState =
  | {
      status: 'idle';
      target: null;
      waiting: null;
      reason: RestartReason | null;
    }
  | {
      status: 'waiting';
      target: PlaybackTarget | null;
      waiting: WaitingState | null;
      reason: RestartReason;
    }
  | {
      status: 'running';
      target: PlaybackTarget;
      waiting: null;
      reason: RestartReason;
    }
  | {
      status: 'stopped';
      target: PlaybackTarget | null;
      waiting: null;
      reason: RestartReason | null;
    };

/**
 * `PlaybackSessionState` を module 境界で短く参照するための別名。
 */
export type SessionState = PlaybackSessionState;

/**
 * cleanup 1 件分の最小単位。
 * listener / timer / observer / binding / DOM の解放を表す。
 */
export type DisposeFn = () => void;

/**
 * `dispose()` を公開する最小 contract。
 */
export type Disposable = {
  dispose: DisposeFn;
};

/**
 * `ui-state.ts` が提供する small store の最小 API。
 * 保存設定や layout state はここに含めない。
 */
export type UiStateStore = {
  getState(): ExtensionUiState;
  setExtensionEnabled(enabled: boolean): void;
  setPanelOpen(open: boolean): void;
  subscribe(listener: UiStateListener): DisposeFn;
};

