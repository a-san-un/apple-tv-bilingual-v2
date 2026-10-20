# V2 Design Baseline

この文書は、Apple TV+ 向け二言語字幕 Chrome 拡張 v2 を新規設計・実装するための共通設計ベースラインである。

PRD、アーキテクチャ、設定 UI、Apple TV+ DOM 調査、実装手順、テスト観点の各スレッドは、この文書を共通前提として参照する。

この文書の目的は、各スレッド間で次の内容がぶれないようにすることである。

- プロジェクトの目的
- 用語
- 最小構成の設計原則
- モジュールの役割
- データの流れ
- session と cleanup の考え方
- 設定と runtime state の境界
- レイアウト方針
- コメント方針
- テスト自動化方針

この文書は、各領域の詳細仕様を確定する正本ではない。

複数の文書や module に横断して影響する採用済みルールだけを、この文書に集約する。  
各スレッドで検討中の詳細仕様や、一部 module に閉じる実装詳細は、それぞれの担当文書で扱う。

詳細は次の文書で扱う。

| 文書 | 担当範囲 |
| --- | --- |
| `docs/product-requirements.md` | プロダクト要件、対象ユーザー、ユースケース、最小実用版の完了条件 |
| `docs/minimal-panel-architecture.md` | モジュール構成、責務境界、依存方向、設計詳細 |
| `docs/settings-spec.md` | popup UI、設定値、Chrome Storage、fallback、バリデーション |
| `docs/apple-tv-dom-structure.md` | Apple TV+ 再生画面の DOM 観測、video、`textTracks`、注入先 |
| `docs/implementation-workflow.md` | 実装フェーズ、対象ファイル、完了条件、検証タイミング |
| `docs/testing-checklist.md` | 自動テスト、手動スモークテスト、回帰確認 |

---

## 1. プロジェクトの目的

Apple TV+ の再生画面で使う二言語字幕 Chrome 拡張を TypeScript で作る。

最初は、右側字幕 panel を中核 UI とする最小構成から始める。

主な目的は次の通りである。

- 学習言語と母国語の字幕を見やすく表示する
- 字幕取得から表示までの経路を明確にする
- 再生対象の切替やページ遷移でも安全に再初期化できるようにする
- listener、timer、observer、track binding、DOM の解放漏れを防ぐ
- 既存 UI を含む再生画面領域と字幕 panel のレイアウトを一貫して制御できるようにする
- 将来の機能追加でもスパゲティ化しない構造にする

---

## 2. リポジトリ

v2 の対象リポジトリ:

```txt
/Users/masayama/dev/my_project/apple-tv-bilingual-v2
```

既存版の参照元リポジトリ:

```txt
/Users/masayama/dev/my_project/apple-tv-bilingual
```

既存版は調査対象・知見の参照元として使う。

既存版の実装をそのままコピーする前提ではない。
責務分離、依存関係、Apple TV+ 固有の挙動、既知の不安定要因を抽出し、v2 ではより単純な構成へ再設計する。

---

## 3. 最小実用版

最小実用版は、MVP（Minimum Viable Product）のことを指す。

ここでいう最小実用版は、利用目的を満たし、Apple TV+ 実画面で価値を確認できる最小セットである。

最初の最小実用版には、少なくとも次を含める。

- 学習言語を選択できる
- 母国語を任意で選択できる
- 学習言語と母国語に同じ値を選べない
- 母国語が未選択の場合、ブラウザ言語を fallback として使う
- Apple TV+ 再生画面と video を見つけられる
- primary 字幕を取得できる
- secondary 字幕を取得できる場合は合わせて扱える
- `SubtitleBlock[]` を作れる
- current / past / future を右側字幕 panel へ表示できる
- 再生画面下部に ON/OFF toggle を表示できる
- ON/OFF toggle で拡張機能全体の有効 / 無効を切り替えられる
- 字幕 panel には、panel 自体を開閉するための開閉ボタンを持てる
- 字幕 panel を開いたとき、既存 UI を含む再生画面領域と字幕 panel を 7:3 の比率で分割できる
- この比率は、既存 UI を含む利用可能な横幅に対して responsive に計算する
- 停止、再初期化、再生対象切替時に resource cleanup できる

最初の最小実用版では、次を必須にしない。

- 学習補助 overlay
- 単語辞書 popup
- 統計 UI
- 外部 API 連携
- 大規模な state 管理ライブラリ
- UI ライブラリ
- 過度な見た目調整
- Apple TV+ 固有の複雑な補助機能

---

## 4. 用語

| 用語 | 意味 |
| --- | --- |
| primaryLang | 学習言語の設定値 |
| secondaryLang | 母国語の設定値 |
| primary subtitle | 学習言語として表示する字幕 |
| secondary subtitle | 母国語として表示する字幕 |
| subtitle track | `TextTrack` を正規化した字幕 track 情報 |
| subtitle source | 字幕取得と track binding をまとめる窓口 |
| truth | UI の正本となる内部データ |
| SubtitleBlock | 時刻、primary 字幕、secondary 字幕を持つ字幕表示単位 |
| SubtitleBlock[] | 字幕 truth の正本となる block 配列 |
| current / past / future | 現在、過去、未来として panel に表示する字幕区分 |
| panel | 右側字幕 panel |
| panel host | panel を mount するために拡張が所有する DOM 要素 |
| ON/OFF toggle | 再生画面下部に置く、拡張機能全体の ON/OFF 制御 |
| extension enabled state | ON/OFF toggle により切り替わる拡張機能全体の有効状態 |
| 開閉ボタン | 右側字幕 panel を開閉する UI。ON/OFF toggle とは別物 |
| panel open state | panel が開いているかどうかの一時的な UI 状態 |
| 7:3 layout | 字幕 panel を開いたときに、既存 UI を含む再生画面領域 70%、字幕 panel 30% に分けるレイアウト方針 |
| available width | Apple TV+ の既存 UI を含む再生画面領域と字幕 panel の再配置に使う利用可能な横幅 |
| 既存 UI を含む再生画面領域 | video、本来の再生コントロール、scrim、関連する player 内 UI を含めて拡張が 70% 側として扱う領域 |
| playback session | 現在の再生対象に対して拡張機能が動く1回分の実行単位 |
| runtime state | 再生中だけメモリ上に持つ一時状態 |
| 保存設定 | 再起動後も利用する設定値 |
| cleanup | listener、timer、observer、binding、DOM、state を解放する処理 |
| owner | resource を登録・解放する責任を唯一持つ module |
| small store | 最小限の get / set / subscribe を持つ軽量な state 管理オブジェクト |

---

## 5. 設定方針

popup で基本的に設定する項目は次の2つとする。

| 項目 | キー | ルール |
| --- | --- | --- |
| 学習言語 | `primaryLang` | 必須 |
| 母国語 | `secondaryLang` | 任意。`primaryLang` と同じ値を選べない |

設定値は Chrome Storage に保存する。

Chrome Storage は、Chrome 拡張機能が使う設定保存領域である。
ローカルファイルへの保存や `localStorage` への保存ではない。

初期方針は次の通りとする。

- `primaryLang` と `secondaryLang` は `chrome.storage.sync` に保存する
- UI の候補言語は固定一覧ベースで扱う
- 実際に採用する字幕 track は content 側で解決する
- 設定の読込・保存は `src/settings/settings-store.ts` に寄せる
- runtime state は Chrome Storage に保存しない
- 初期版では `extension enabled state` は保存しない
- 初期版では現在の `panel open state` は保存しない
- 初期版の起動時は毎回 OFF 開始とする

---

## 6. 保存設定と runtime state

保存設定と runtime state は混ぜない。

### 保存設定

保存設定は、拡張機能やタブを再起動した後も使う値である。

例:

- `primaryLang`
- `secondaryLang`

保存先:

```txt
chrome.storage.sync
```

初期版では次は保存しない。

- `extension enabled state`
- 現在の `panel open state`

### runtime state

runtime state は、現在の再生中だけ必要な一時状態である。

例:

- 現在の `HTMLVideoElement`
- 現在採用されている primary / secondary track
- 現在の `SubtitleBlock[]`
- 現在表示中の current block
- panel の一時的な open / close 状態
- listener、timer、observer、track binding の参照
- 現在の playback session
- 現在の 7:3 layout 計算結果
- 拡張全体の ON/OFF 状態

runtime state は session の停止時に解放する。
Chrome Storage には保存しない。

### ON/OFF toggle と開閉ボタンの状態

拡張機能には、少なくとも次の 2 種類の状態がある。

- `extension enabled state`
  - ON/OFF toggle により切り替わる、拡張機能全体の有効 / 無効状態
- `panel open state`
  - 開閉ボタンにより切り替わる、右側字幕 panel の表示状態

この 2 つは別の状態として扱う。

たとえば、拡張機能全体が OFF の間は panel を表示しない、または拡張由来の監視・描画を停止する。
一方で、panel の開閉状態は UI 上の状態であり、拡張機能全体の有効 / 無効そのものとは分けて扱う。

初期版では次の方針を採用する。

- 起動時は毎回 `extension enabled state = false` で始める
- 起動時は毎回 `panel open state = false` で始める
- 現在の ON/OFF 状態は保存しない
- 現在の panel 開閉状態は保存しない

---

## 7. 設計原則

### 7.1 thin coordinator

`src/content/index.ts` は thin coordinator とする。

ここに残してよい責務は次だけとする。

- settings 読込
- playback root 解決
- playback session の開始・停止
- module の接続
- top-level error handling

字幕判定、track 採用、truth 構築、panel 描画、cleanup の実装本体は持たない。

### 7.2 truth first

UI は `TextTrack`、cue、source を直接読まない。

字幕表示は必ず次の順で行う。

```txt
subtitle source
  ↓
track resolver
  ↓
subtitle block builder
  ↓
SubtitleBlock[]
  ↓
subtitle history
  ↓
panel renderer
```

この順序により、字幕取得と UI 表示を分離する。

### 7.3 owner を一意にする

listener、timer、observer、binding、DOM は owner を1つに限定する。

例:

- track listener は `subtitle-source.ts` が所有する
- panel host DOM は `panel-host.ts` が所有する
- ON/OFF toggle の DOM は `controls/on-off-toggle.ts` が所有する
- panel 開閉ボタンの DOM は `controls/panel-toggle-button.ts` が所有する
- 7:3 layout の計算・適用は `layout/player-layout.ts` が所有する
- runtime UI state は `ui/ui-state.ts` が所有する
- session 全体の停止は `session-lifecycle.ts` が所有する
- disposer の共通処理は `shared/dispose.ts` が提供する

同じ対象を複数 module から登録・解放しない。

### 7.4 cleanup を先に定義する

開始処理を作る前に、停止時に何を解放するかを決める。

最低限の cleanup 対象:

- `TextTrack` listener
- `video` listener
- `MutationObserver`
- `ResizeObserver`
- `setTimeout`
- `setInterval`
- track binding
- panel host DOM
- ON/OFF toggle DOM
- panel 開閉ボタン DOM
- session 内で保持した subtitle truth
- history state
- runtime state
- layout 計算に使った一時参照
- ui-state の購読解除

### 7.5 レイアウト対象を明確にする

字幕 panel を開いたときの 7:3 layout は、video 単体ではなく、Apple TV+ の既存 UI を含む再生画面領域全体を対象として適用する。

つまり、70% 側は次を含む前提で扱う。

- video
- Apple TV+ 標準の再生コントロール
- scrim
- player 内の既存 UI
- 再生画面に属する関連要素

固定ピクセル幅で押し込むのではなく、既存 UI を含む利用可能な横幅に対して responsive に再計算する。

### 7.6 UI state と layout state を分ける

字幕の truth、UI state、layout state は別物として扱う。

- 字幕 truth は `SubtitleBlock[]`
- UI state は `ExtensionUiState`
- layout state は `PlayerLayoutState`

これにより、字幕データの更新、開閉状態の更新、横幅再計算を独立して扱えるようにする。

### 7.7 UI state は small store で扱う

`ui-state.ts` は、単なる型定義ファイルではなく、最小限の state store を提供する。

初期版で必要な API は次の程度に留める。

- `getState()`
- `setExtensionEnabled(enabled)`
- `setPanelOpen(open)`
- `subscribe(listener)`

大規模 state 管理ライブラリは使わず、session 単位で生成・破棄できる軽量な small store とする。

---

## 8. playback session

playback session は、現在の Apple TV+ 再生対象に対して拡張機能が動く1回分の実行単位である。

たとえば、あるエピソードの再生開始時に session A を作る。
別エピソードや別作品へ移動した場合は、session A を停止・解放してから session B を作る。

playback session は、少なくとも次を所有する。

- 現在の video
- subtitle source
- track binding
- listener
- observer
- timer
- panel host
- ON/OFF toggle
- panel 開閉ボタン
- runtime UI state store
- layout state
- cleanup API

停止時の基本順序は次の通りとする。

1. interval / timeout を停止する
2. observer を切断する
3. track / video listener を解除する
4. subtitle source を unbind する
5. panel host を unmount する
6. ON/OFF toggle を unmount する
7. panel 開閉ボタンを unmount する
8. runtime UI state の購読を解除する
9. layout state を clear する
10. runtime state を clear する

OFF 時の基本方針は次の通りとする。

- 拡張由来の監視・描画・字幕処理を停止する
- panel は非表示または unmount する
- 必要であれば次回 ON 時に session を再初期化する

---

## 9. 想定する構成

```txt
src/
├─ content/
│  ├─ index.ts
│  │  └─ 起動入口と module の配線を行う thin coordinator
│  ├─ playback-root.ts
│  │  └─ Apple TV+ 再生画面 root、video、panel 注入先、7:3 layout の基準領域を解決する
│  └─ session-lifecycle.ts
│     └─ playback session の start / stop / dispose を管理する
│
├─ subtitles/
│  ├─ subtitle-source.ts
│  │  └─ 字幕取得、track binding、bind / unbind の統一窓口
│  ├─ text-track-resolver.ts
│  │  └─ TextTrack を正規化し、primary / secondary の採用候補を決める
│  ├─ native-menu-sync.ts
│  │  └─ Apple TV+ ネイティブ字幕メニューとの同期を担当する
│  ├─ subtitle-block-builder.ts
│  │  └─ cue / track 情報から `SubtitleBlock[]` を構築する
│  └─ subtitle-history.ts
│     └─ truth から current / past / future を導出する
│
├─ panel/
│  ├─ panel-host.ts
│  │  └─ panel host DOM の生成、mount、unmount を担当する
│  └─ panel-renderer.ts
│     └─ subtitle history を受け取り panel を描画・更新する
│
├─ controls/
│  ├─ on-off-toggle.ts
│  │  └─ 再生画面下部の ON/OFF toggle を描画し、拡張機能全体の enabled state を切り替える
│  └─ panel-toggle-button.ts
│     └─ 字幕 panel の開閉ボタンを描画し、panel open state を切り替える
│
├─ layout/
│  └─ player-layout.ts
│     └─ 既存 UI を含む再生画面領域と字幕 panel に対して 7:3 layout を計算・適用する
│
├─ ui/
│  └─ ui-state.ts
│     └─ 拡張全体の ON/OFF と panel の開閉を含む runtime UI state を、small store として保持・通知する
│
├─ settings/
│  └─ settings-store.ts
│     └─ Chrome Storage を使った設定の読込・保存を担当する
│
└─ shared/
   ├─ types.ts
   │  └─ 共通型を定義する
   ├─ dispose.ts
   │  └─ disposer 登録と一括 cleanup を提供する
   ├─ dom.ts
   │  └─ DOM query、生成、安全な mount / remove を提供する
   └─ log.ts
      └─ debug / observe 用ログの窓口を提供する
```

---

## 10. モジュール境界

### `src/content/index.ts`

担当:

- 起動入口
- settings 読込
- playback root 解決
- session 開始・停止
- module 接続
- top-level error handling

担当しないこと:

- cue 判定本体
- track 採用条件
- panel DOM の直接描画
- listener / observer の個別管理
- レイアウト計算本体
- UI state 管理本体

### `src/content/playback-root.ts`

担当:

- Apple TV+ 再生画面 root の解決
- video 要素の解決
- panel 注入先候補の解決
- ON/OFF toggle の注入先候補の解決
- panel 開閉ボタンの注入先候補の解決
- 7:3 layout の計算基準となる、既存 UI を含む再生画面領域の基準要素を解決する

### `src/content/session-lifecycle.ts`

担当:

- playback session の start / stop / dispose
- session に属する resource の所有
- cleanup 順序の保証
- `extension enabled state` に応じた停止 / 再開の切替
- `PlayerLayoutState` の初期化と破棄の統制
- `ui-state.ts` の store 生成と破棄の統制

### `src/subtitles/subtitle-source.ts`

担当:

- primary / secondary 字幕取得の統一窓口
- track listener の bind / unbind
- cue 情報を block builder へ渡せる形にする

担当しないこと:

- panel 描画
- Chrome Storage 保存
- panel DOM 操作
- ON/OFF toggle の UI 制御
- 7:3 layout の計算
- UI state store の管理

### `src/subtitles/text-track-resolver.ts`

担当:

- `TextTrackList` の正規化
- language、label、kind の差異吸収
- primary / secondary track の採用候補判定

### `src/subtitles/native-menu-sync.ts`

担当:

- Apple TV+ ネイティブ字幕メニューとの同期
- native subtitle UI に由来する Apple TV+ 固有の補助制御

### `src/subtitles/subtitle-block-builder.ts`

担当:

- cue / track 情報から `SubtitleBlock[]` を構築する
- primary / secondary 字幕を時刻単位で対応づける
- UI の都合ではなく字幕 truth を返す

### `src/subtitles/subtitle-history.ts`

担当:

- `SubtitleBlock[]` から current / past / future を導出する
- panel renderer に渡す view を整形する

### `src/panel/panel-host.ts`

担当:

- panel host DOM の生成
- mount / unmount
- session ごとの panel DOM 所有
- panel renderer と layout 適用先を接続しやすい DOM 構造を提供する

担当しないこと:

- subtitle truth の構築
- `TextTrack` の直接参照
- settings の保存
- ON/OFF toggle の状態保存
- 7:3 layout の計算本体
- runtime UI state の正本管理

### `src/panel/panel-renderer.ts`

担当:

- subtitle history を受け取る
- current / past / future を panel DOM に描画する
- 描画差分を吸収する

担当しないこと:

- track の直接参照
- settings の保存
- observer の所有
- 拡張全体の ON/OFF 制御
- 7:3 layout の計算基準決定

### `src/controls/on-off-toggle.ts`

担当:

- 再生画面下部の ON/OFF toggle を描画する
- ON/OFF toggle の UI 更新を担当する
- 拡張機能全体の enabled state の切替イベントを発火する

担当しないこと:

- subtitle truth の構築
- panel の本文描画
- `TextTrack` の直接参照
- cleanup 全体の管理
- panel open state の決定

補足:

- ON/OFF toggle は、右側字幕 panel の開閉ボタンとは別物として扱う
- ON/OFF toggle は拡張機能全体の有効 / 無効を切り替える
- 開閉ボタンは panel の表示状態だけを切り替える

### `src/controls/panel-toggle-button.ts`

担当:

- 字幕 panel の開閉ボタンを描画する
- 開閉ボタンの UI 更新を担当する
- `panel open state` の切替イベントを発火する

担当しないこと:

- subtitle truth の構築
- 拡張全体の ON/OFF 切替
- `TextTrack` の直接参照
- 7:3 layout の幅計算本体

### `src/layout/player-layout.ts`

担当:

- 既存 UI を含む再生画面領域を基準に利用可能な横幅を計測する
- 7:3 layout の幅を計算する
- panel 開閉時と resize 時に layout を再適用する
- `PlayerLayoutState` を更新する
- debug / observe 用に layout 情報を取り出せるようにする

担当しないこと:

- subtitle truth の保持
- panel 本文の描画
- settings の保存
- primary / secondary track の解決

### `src/ui/ui-state.ts`

担当:

- 拡張全体の `extension enabled state` と `panel open state` を保持する
- runtime UI state の取得と更新を提供する
- small store として `getState()`, `setExtensionEnabled()`, `setPanelOpen()`, `subscribe()` を提供する
- UI state 変更を他 module に通知する

担当しないこと:

- Chrome Storage への保存
- subtitle truth の保持
- 7:3 layout の計算
- panel 本文の描画

### `src/settings/settings-store.ts`

担当:

- `chrome.storage.sync` からの設定読込
- `chrome.storage.sync` への設定保存
- 設定値の正規化

補足:

- 初期版では `extension enabled state` を保存しない
- 初期版では現在の `panel open state` を保存しない

### `src/shared/types.ts`

担当:

- `SubtitleTrack`
- `SubtitleBlock`
- `SubtitleHistoryView`
- `ExtensionUiState`
- `PlayerLayoutState`
- `PlaybackRoot`
- `SessionState`
- `UiStateStore`

などの共通型定義。

### `src/shared/dispose.ts`

担当:

- disposer の登録
- 一括 cleanup
- cleanup 処理の共通化

### `src/shared/dom.ts`

担当:

- DOM query helper
- element 生成 helper
- 安全な append / remove helper

### `src/shared/log.ts`

担当:

- debug / observe 用ログの統一
- prefix、category、enabled flag の管理

---

## 11. 基本データモデル

### `SubtitleTrack`

```ts
type SubtitleTrack = {
  id: string;
  language: string;
  label: string;
  kind: 'subtitles' | 'captions' | 'forced' | 'unknown';
  rawTrack: TextTrack;
};
```

### `SubtitleBlock`

```ts
type SubtitleBlock = {
  id: string;
  startTime: number;
  endTime: number;
  primaryText: string;
  secondaryText: string;
};
```

### `SubtitleHistoryView`

```ts
type SubtitleHistoryView = {
  current: SubtitleBlock | null;
  previous: SubtitleBlock[];
  next: SubtitleBlock[];
};
```

### `ExtensionUiState`

```ts
type ExtensionUiState = {
  extensionEnabled: boolean;
  panelOpen: boolean;
};
```

### `PlayerLayoutState`

```ts
type PlayerLayoutState = {
  availableWidth: number;
  playerWidth: number;
  panelWidth: number;
  ratio: {
    player: number;
    panel: number;
  };
  includesNativeUi: boolean;
};
```

### `UiStateStore`

```ts
type UiStateStore = {
  getState(): Readonly<ExtensionUiState>;
  setExtensionEnabled(enabled: boolean): void;
  setPanelOpen(open: boolean): void;
  subscribe(listener: (state: Readonly<ExtensionUiState>) => void): () => void;
};
```

### `ExtensionSettings`

```ts
type ExtensionSettings = {
  primaryLang: string;
  secondaryLang: string | null;
};
```

### `SessionState`

```ts
type SessionState = {
  video: HTMLVideoElement | null;
  primaryTrack: SubtitleTrack | null;
  secondaryTrack: SubtitleTrack | null;
  blocks: SubtitleBlock[];
  startedAt: number | null;
  ui: ExtensionUiState;
  layout: PlayerLayoutState | null;
};
```

これらの型は初期案である。
実装開始時に、実際の `TextTrack` と cue の観測結果、Apple TV+ DOM 構造、layout 計測結果に合わせて最小限の見直しを行う。

---

## 12. Apple TV+ DOM の扱い

Apple TV+ の DOM 構造、selector、video、`textTracks`、再生コントロール、native subtitle UI、panel 注入先は変化する可能性がある。

そのため、この文書では Apple TV+ 固有の selector を正本として固定しない。

次の内容は `docs/apple-tv-dom-structure.md` で観測・管理する。

- 再生画面 root
- player root
- video 要素
- `TextTrackList` の利用可能時点
- controls の表示・非表示による構造変化
- native subtitle UI
- panel host の注入先候補
- ON/OFF toggle の注入先候補
- panel 開閉ボタンの注入先候補
- 7:3 layout を適用するときの、既存 UI を含む再生画面領域の基準要素
- controls、scrim、playlist など既存 UI を含めても 7:3 layout を維持できるか
- 再生画面の横幅変化に対して panel 幅を responsive に再計算できるか
- SPA 遷移時の DOM 差し替え
- 実機で確認した selector と安定性

この文書では、Apple TV+ 固有要素を `playback-root.ts`、`native-menu-sync.ts`、必要な observer に閉じ込める方針だけを定める。

---

## 13. コメント方針

実装ファイルは、TypeScript に不慣れでも役割と流れを追いやすいようにコメントを書く。

### ファイル先頭コメント

各実装ファイルの先頭に、次を短く書く。

- ファイルの責務
- 主な依存先または扱う状態
- 担当しないこと
- session と cleanup の関係がある場合はその前提

例:

```ts
/**
 * ui-state.ts
 *
 * 拡張全体の ON/OFF と字幕 panel の開閉を含む
 * runtime UI state を small store として保持・通知する。
 * 字幕 truth や layout 計算そのものは担当しない。
 * playback session 単位で生成・破棄される前提で使う。
 */
```

### JSDoc

export する関数、型、クラスには JSDoc を付ける。

JSDoc には必要に応じて次を書く。

- 何をするか
- 引数
- 戻り値
- 前提条件
- cleanup の責務
- 失敗時の扱い

### 行コメント

複雑な分岐、副作用、track 切替、再初期化、cleanup の直前には短い行コメントを書く。

コメントは「何をしているか」より「なぜ必要か」を優先する。

obvious な処理を行単位で説明するコメントは増やさない。

コメントは日本語で書く。

---

## 14. テスト方針

可能な限り自動化し、手動確認は Apple TV+ 実画面依存の最小項目に絞る。

### 自動テストの層

1. Type check
   - 型崩れ、import / export の不整合を検出する

2. Lint
   - 未使用コード、危険な書き方、品質上の問題を検出する

3. Unit test
   - DOM や Apple TV+ 実画面に依存しない pure function を検証する

4. Small integration test
   - settings、track resolver、subtitle block builder、layout 計算、UI state 更新などの接続を検証する

5. Manual smoke test
   - Apple TV+ 実画面、`video.textTracks`、SPA 遷移、native subtitle UI、レイアウトなどの実機依存部分だけを確認する

### 優先的に自動テストする対象

- `src/settings/settings-store.ts`
- `src/subtitles/text-track-resolver.ts`
- `src/subtitles/subtitle-block-builder.ts`
- `src/subtitles/subtitle-history.ts`
- `src/layout/player-layout.ts`
- `src/ui/ui-state.ts`
- `src/shared/` 配下の pure utility

### 手動確認を簡単にする方針

- typecheck、lint、test を先に通す
- 手動確認は少数の固定手順にする
- 現在の設定、採用 track、current subtitle、session 状態、layout 状態、UI state を debug log または health snapshot で確認しやすくする
- 不具合時は再現操作、設定、track 情報、console log、画面状態を残せるようにする

特に ON/OFF toggle と開閉ボタンについては、役割の混同を防ぐ。

- ON/OFF toggle は拡張機能全体の有効 / 無効を切り替える
- 開閉ボタンは panel の表示状態のみを切り替える

また、7:3 layout については次を確認対象に含める。

- 既存 UI を含む再生画面領域と panel が 7:3 になるか
- 横幅変化時に panel 幅が responsive に再計算されるか
- controls 表示時にもレイアウトが破綻しないか

詳細なテストケースは `docs/testing-checklist.md` で管理する。

---

## 15. 技術方針

採用するもの:

- TypeScript
- Manifest V3
- esbuild または Vite
- Vitest
- ESLint
- Prettier
- 小さな自前 dispose helper

初期版で前提にしないもの:

- React
- Vue
- Zustand
- RxJS
- 大規模 state 管理ライブラリ
- UI ライブラリ

初期版の DOM 更新は素の TypeScript で行う。

---

## 16. 今後の拡張原則

新しい機能を足す場合でも、source、truth、renderer、session lifecycle の責務境界を崩さないことを優先する。

拡張時の基本順序は次の通りとする。

1. source を増やす
2. truth を調整する
3. view helper を調整する
4. renderer を追加または更新する
5. UI state / layout state への影響を確認する
6. lifecycle と cleanup を確認する
7. 自動テストと手動スモークテストを追加する

UI を増やす前に、truth と lifecycle の一貫性を維持する。
