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
 * primary / secondary のどちら側かを表す役割名。
 * resolver の採用結果と source の通知で同じ語を使う。
 */
export type SubtitleTrackRole = 'primary' | 'secondary';

/**
 * resolver が `TextTrackList` から正規化した track 候補。
 * `index` は取得時点の `textTracks` 内の位置であり、永続識別子には使わない。
 * `mode` も取得時点の値なので、表示中判定が必要なときは再正規化する。
 */
export type SubtitleTrackCandidate = ResolvedSubtitleTrack & {
  index: number;
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

/** 1言語の元時刻と本文。実cue・track・DOMの参照を含めない。 */
export type TimedSubtitleText = Readonly<Pick<SubtitleCueSnapshot, 'startTime' | 'endTime' | 'text'>>;

/** 言語別字幕を保持するtruthの型。対訳ペアを作らず、空の言語は空配列で表す。 */
export type SubtitleTimeline = Readonly<{
  primary: readonly TimedSubtitleText[];
  secondary: readonly TimedSubtitleText[];
}>;

/**
 * `subtitle-source.ts` が返す source 全体の snapshot。
 * bind 中の track pair と、その track から読んだ cue 一覧だけを持つ。
 * 未 bind または読取失敗時は cue 配列を空にする。
 */
export type SubtitleSourceSnapshot = {
  pair: ResolvedTrackPair;
  primaryCues: SubtitleCueSnapshot[];
  secondaryCues: SubtitleCueSnapshot[];
};

/**
 * `subtitle-source.ts` が購読者へ送る変化通知。
 * 中身は持たせず、受け手は必要なときに `getSnapshot()` を読む。
 */
export type SubtitleSourceChange =
  | { type: 'bound' }
  | { type: 'unbound' }
  | { type: 'cuechange'; role: SubtitleTrackRole };

/** `subtitle-source.ts` の変化通知を受け取る callback。 */
export type SubtitleSourceListener = (change: SubtitleSourceChange) => void;

/**
 * panel 表示の truth になる字幕表示単位。
 * UI は raw cue ではなく、この block 配列を正本として扱う。
 */
/** 欠けている言語の本文は null。両側欠損の block は builder が生成しない。 */
export type SubtitleBlock = {
  startTime: number;
  endTime: number;
  primaryText: string | null;
  secondaryText: string | null;
};

/** 移行中の旧再生経路用。新しいtimelineの分類結果とは区別する。 */
export type LegacySubtitleHistorySnapshot = {
  current: SubtitleBlock | null;
  past: SubtitleBlock[];
  future: SubtitleBlock[];
};

/** 同じtimelineを元時刻で分類した読み取り結果。現在も複数件・0件を許可する。 */
export type SubtitleHistorySnapshot = Readonly<{
  past: SubtitleTimeline;
  current: SubtitleTimeline;
  future: SubtitleTimeline;
}>;

/**
 * `SubtitleHistorySnapshot` を view 層で短く参照するための別名。
 */
export type SubtitleHistoryView = SubtitleHistorySnapshot;

/**
 * 表示用本文と、同じ世代のtimelineの所属言語配列における元入力位置。
 * sourceIndexは補助分類後に振り直さず、永続IDとして使わない。
 */
export type SubtitleDisplayItem = Readonly<{
  sourceIndex: number;
  text: string;
}>;

/**
 * セリフ・補助に共通の表示枠。各言語の表示要素は元入力順で保持する。
 * 両言語が空の枠は作らず、補助枠は片言語1要素と他言語の空配列で表す。
 */
export type SubtitleDisplayBlock = Readonly<{
  kind: 'dialogue' | 'auxiliary';
  startTime: number;
  endTime: number;
  primary: readonly SubtitleDisplayItem[];
  secondary: readonly SubtitleDisplayItem[];
}>;

/** 表示枠単位の過去・現在・未来。元字幕単位のhistoryとは区別する。 */
export type SubtitleDisplayHistory = Readonly<{
  past: readonly SubtitleDisplayBlock[];
  current: readonly SubtitleDisplayBlock[];
  future: readonly SubtitleDisplayBlock[];
}>;

/**
 * 表示結果を正常・不正時刻・利用不能に分けた読み取り値。
 * 不正時刻では枠構成を保持し、利用不能では失敗理由だけを持つ。
 * readonlyは実行時のコピー保護を保証しない。
 */
export type SubtitleDisplaySnapshot =
  | Readonly<{
      status: 'ready';
      blocks: readonly SubtitleDisplayBlock[];
      history: SubtitleDisplayHistory;
    }>
  | Readonly<{
      status: 'invalid-time';
      blocks: readonly SubtitleDisplayBlock[];
    }>
  | Readonly<{
      status: 'unavailable';
      reason: 'timeline-failed' | 'display-failed';
    }>;

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
 * 各 module は owner を持ったまま、この関数型だけを共有する。
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

