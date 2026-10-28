# Implementation Workflow

この文書は、Apple TV+ 向け二言語字幕 Chrome 拡張 v2 の実装順を定める作業用ドキュメントである。

完成後は、この文書だけで初期セットアップ、採用技術、実装順、ファイル単位の作業、コメント規約、検証順まで追える状態を目指す。  
用語、責務境界、設定仕様、DOM 前提、テスト観点は各担当ドキュメントを正本とし、この文書では実装の進め方と開発時の共通ルールを扱う。

この文書では、次だけを書く。

- 実装フェーズの順序
- 各フェーズの目的
- 各フェーズで触るファイル
- ファイル単位の作業内容
- フェーズごとの完了条件
- 各フェーズの検証タイミング
- 開発基盤と技術方針
- コードコメント方針
- 作業時の依存関係
- 実装時に共通設計前提を見直す条件

要件の詳細、設定仕様の完全版、Apple TV+ DOM 観測ログ、手動テスト項目の完全版は、この文書へ重複して書かない。必要な詳細は各担当ドキュメントを参照する。

## 参照関係

DOM の selector、実測値、時系列、未確認事項はこの文書へ重複記載しない。

- 要件・MVP 範囲: `docs/product-requirements.md`
- 設定仕様・保存境界: `docs/settings-spec.md`
- 実装判断: `docs/apple-tv-dom-structure.md`
- 詳細観測: `docs/apple-tv-dom-observations.md`
- module 境界・型・cleanup 所有権: `docs/minimal-panel-architecture.md`
- 詳細な回帰確認: `docs/testing-checklist.md`

## リポジトリと既存版の扱い

対象リポジトリ:

```text
/Users/masayama/dev/my_project/apple-tv-bilingual-v2
```

既存版の参照元リポジトリ:

```text
/Users/masayama/dev/my_project/apple-tv-bilingual
```

既存版は、Apple TV+ 固有の DOM 挙動、字幕 track、SPA 遷移、seek 後の不安定さ、cleanup の知見を得るための調査対象として参照する。

既存版の実装をそのままコピーする前提にはしない。既存版の複雑な分岐や暫定回避策は、v2 の責務境界、最小構成、cleanup 方針に照らして必要性を再判定してから採用する。

## 前提

実装は、次の前提に従って進める。

- `src/content/index.ts` は thin coordinator のまま保つ
- 実装順は基本的に source、truth、view helper、renderer、lifecycle の依存方向に従う
- panel 実装より先に `SubtitleBlock[]` の truth を作る
- cleanup は後回しにしない
- `src/ui/ui-state.ts` は early phase で small store として用意する
- Apple TV+ 固有処理は、DOM 調査結果がそろってから導入する
- ON/OFF toggle と panel 開閉ボタンは、責務差が分かる形で同じ流れの中に導入する
- 各フェーズでは対象ファイルを限定し、横断変更を増やしすぎない
- 既存版を参照しても、v2 に不要な複雑さは持ち込まない

## 技術方針

初期版では、実装と検証の追いやすさを優先し、依存を増やしすぎない最小構成を採用する。

### 初期版の採用技術

- TypeScript
- Chrome Extensions Manifest V3
- bundler は `esbuild`。最小構成と設定の読みやすさを優先する
- Vitest
- ESLint
- Prettier
- 小さな自前 dispose helper

### 初期版で前提にしないもの

- React
- Vue
- Zustand
- RxJS
- 大規模 state 管理ライブラリ
- UI ライブラリ

### 実装の基本方針

- panel を含む DOM 更新は、素の TypeScript を基本とする
- UI の描画は framework 前提にせず、`panel-host.ts` と `panel-renderer.ts` に責務を分ける
- runtime state は small store と plain object を基本とし、複雑なリアクティブ層を前提にしない
- listener、timer、observer、binding は owner を 1 つに限定し、cleanup 可能な形で登録する
- source は panel DOM を直接扱わず、renderer は source や `TextTrack` を直接読まない

## コードコメント方針

TypeScript に不慣れでも、各 module の役割、依存、session と cleanup の流れを追えるコメントを残す。

### ファイル先頭コメント

実装ファイルの先頭には、必要に応じて次を短く書く。

- ファイルの責務
- 主な依存先、または扱う state
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
 * 現在の処理 session と寿命を分け、開始停止のたびに作り直さない。
 */
```

### JSDoc

関数には、export の有無、同期・非同期、function 宣言・arrow function の別にかかわらず、JSDoc を付ける。
対象は、module 内部だけで使う関数、class の method、callback として渡す名前付き関数を含む。
export する型とクラスにも JSDoc を付ける。内部の型は、意味が名前から自明でない場合に付ける。

JSDoc は、読み手が本体を読まずに呼び方と結果を理解できるよう、関数の仕様を示す。
行コメントは実装上の「なぜ」を補い、JSDoc は関数の役割・入力・出力・失敗条件を説明する。

#### 関数の JSDoc に書くこと

- 本文: 何をする関数かを 1〜2 文で書く。呼び出される場面が限られるなら、その前提も書く
- `@param`: すべての引数に書く。意味、許容値、`null` / `undefined` の扱い、呼び出し側の前提を含める
- `@returns`: 戻り値がある関数には必ず書く。`Promise` を返す場合は、何が resolve されるかを書く
- `@throws`: 例外を投げる場合に書く。`Promise` が reject される場合は、reject 条件を本文か `@returns` に書く
- cleanup に関係する値を返す場合は、disposer や listener 解除関数を誰が保持し、誰が実行するかも書く

戻り値がない関数（`void` / `Promise<void>`）は、`@returns` を省略してよい。
ただし `Promise<void>` は、完了や失敗が何を意味するかを本文に書く。

#### 型を TypeScript に任せる部分

型は TypeScript が持つので、`@param {string} name` のような型表記は書かない。
`@param name 説明` の形にする。

#### 書き過ぎを避けること

引数名が型と同じ意味しか持たない場合も、`@param` は省略しない。
その場合は、短くてよいので、用途か単位を書く。
JSDoc に仕様書の文章を転載せず、実装を読めば分かることの言い換えを増やさない。
module 境界で判断が要る情報（失敗の扱い、所有権、呼び出し順）を優先する。

例:

```ts
/**
 * 複数の cleanup を 1 つの disposer に合成する。
 *
 * @param entries 合成する cleanup 関数または Disposable。null / undefined は無視する。
 * @returns 呼び出し側が保持・実行する disposer。登録の逆順に各 cleanup を一度だけ試し、
 *   途中で失敗しても残りを続ける。2 回目以降は何もしない。
 * @throws 返した disposer の実行時に cleanup が失敗した場合、全件の試行後に AggregateError。
 */
export const composeDisposers = (
  ...entries: DisposeEntry[]
): DisposeFn => {
  // ...
};

/**
 * 必須要素を取得する。
 *
 * @param root 検索を開始する DOM 範囲。
 * @param selector 検索する CSS selector。
 * @returns 見つかった要素。
 * @throws {Error} selector に一致する要素がなく、後続処理を継続できない場合。
 */
export const requireElement = <T extends Element>(
  root: ParentNode,
  selector: string,
): T => {
  // ...
};

/**
 * storage から指定キーの値を読み出す。
 *
 * runtime.lastError は callback 内で読まないと拾えないため、
 * 失敗は例外ではなく Promise の reject にそろえる。
 *
 * @param storageArea 読み出し先。chrome.storage.sync か test double を渡す。
 * @param keys 読み出すキー。null の場合はすべてを読み出す。
 * @returns 保存済みの値。キーが無い場合は含まれない。
 * @throws storage の同期例外と runtime.lastError は、Promise の reject として返る。
 */
function storageGet(
  storageArea: StorageAreaLike,
  keys: string[] | Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  // ...
}
```

### 行コメント

複雑な分岐、副作用、track 切替、再初期化、cleanup の直前には、短い日本語コメントを書く。

コメントは「何をしているか」より「なぜ必要か」を優先する。  
obvious な処理を行単位で説明するコメントは増やさない。

## 用語の扱い

用語は `docs/minimal-panel-architecture.md` の `## 2. 用語` を正本とする。この文書では同じ用語を、定義を重ねて書かずにそのまま使う。

実装中に新しい用語が必要になったときは、先に `minimal-panel-architecture.md` へ追加してから、この文書で使う。

## 依存関係

実装時の依存関係は次の順で考える。

1. TypeScript 基盤、共通型、dispose helper、設定保存
2. popup UI と設定反映
3. `ui/ui-state.ts`、`content/playback-root.ts`、`content/session-lifecycle.ts` の土台
4. `subtitles/text-track-resolver.ts`、`subtitles/subtitle-source.ts`、両者を接続する `subtitles/subtitle-session.ts`
5. `subtitles/subtitle-block-builder.ts`、`subtitles/subtitle-history.ts`
6. `panel/panel-host.ts`、`panel/panel-renderer.ts`
7. `controls/on-off-toggle.ts`、`controls/panel-open-close-button.ts`、`layout/player-layout.ts`
8. cleanup、再初期化、SPA 遷移対応
9. `subtitles/native-menu-sync.ts` など Apple TV+ 固有対応
10. 自動テスト、手動スモークテスト、不具合修正

補足:

- `panel-renderer.ts` は `SubtitleHistoryView` が固まる前に着手しない
- `player-layout.ts` は `panel-host.ts` と `ui-state.ts` の前提がないと組みにくいが、字幕 truth には依存しない
- `session-lifecycle.ts` は最初に土台を作るが、各フェーズで接続先を少しずつ増やす
- `native-menu-sync.ts` は最初から前提化しない。Apple TV+ 固有の不安定要因として後段で閉じ込める
- `subtitle-source.ts` は readiness 通過後の current video だけを受け取る
- seek は restart 契機にしない

## フェーズ一覧

| フェーズ | 目的 | 主な対象 |
| --- | --- | --- |
| Phase 0 | 実装準備と開発基盤決定 | `docs/`、既存版参照、build/test 設定 |
| Phase 1 | TypeScript 基盤、共通型、dispose helper、設定保存を固める | `shared/`、`settings/`、ビルド設定 |
| Phase 2 | popup UI と設定反映を通す | `popup/`、`settings/` |
| Phase 3 | runtime UI state と playback/session/readiness の土台を作る | `ui/`、`content/`、`shared/` |
| Phase 4 | readiness 通過後の字幕取得基盤と、再生経路への最小接続を作る | `subtitles/`、`content/`、関連テスト |
| Phase 5 | `SubtitleBlock[]` と history 導出を作る | `subtitles/` |
| Phase 6 | panel host と panel renderer を導入する | `panel/` |
| Phase 7 | ON/OFF toggle、開閉ボタン、7:3 layout を導入する | `controls/`、`layout/` |
| Phase 8 | restart / cleanup / SPA 遷移対応を固める | `content/`、`subtitles/`、`panel/`、`layout/`、`controls/` |
| Phase 9 | native menu 同期順序など Apple TV+ 固有対応を閉じ込める | `subtitles/native-menu-sync.ts`、resolver |
| Phase 10 | テスト、自動化、スモーク、不具合修正 | `tests/`、全体 |

## Phase 0: 実装準備

### 目的

- 用語、責務境界、設定方針、DOM 前提、テスト方針を担当ドキュメントで確認する
- 実装対象ファイルの初期配置を決める
- 既存版のどこを参照するかを限定する
- 開発基盤、typecheck、lint、test の導線を先に作る
- bundler を未決定のまま引きずらず、初期方針を確定する

### 触るファイル

- `docs/minimal-panel-architecture.md`
- `docs/settings-spec.md`
- `docs/apple-tv-dom-structure.md`
- `docs/apple-tv-dom-observations.md`
- `docs/testing-checklist.md`
- `package.json`
- `tsconfig.json`
- `manifest.json`
- `vitest.config.ts`
- `eslint.config.js`
- `.prettierrc.json`
- 必要なら bundler 設定ファイル
- 参照: 既存版の `content.js`
- 参照: 既存版の `cue-controller.js`
- 参照: 既存版の `modules/settings-store.js`
- 参照: 既存版の `modules/subtitle-block-resolver.js`
- 参照: 既存版の `modules/subtitle-history-store.js`
- 参照: 既存版の `modules/playback-session-cleanup.js`
- 参照: 既存版の `modules/playback-startup-coordinator.js`
- 参照: 既存版の `modules/cue-track-binder.js`
- 参照: 既存版の `modules/text-track-debug.js`
- 参照: 既存版の `docs/content-architecture.md`
- 参照: 既存版の `docs/issue-32-content-core-split.md`

### ファイル単位の作業内容

#### ドキュメント確認

- `docs/minimal-panel-architecture.md` で module 境界、owner、cleanup 所有権を確認する
- `docs/settings-spec.md` で `primaryLang` / `secondaryLang` と保存境界を確認する
- `docs/apple-tv-dom-structure.md` で selector と実装判断を確認する
- `docs/apple-tv-dom-observations.md` で詳細ログと時系列を確認する
- `docs/testing-checklist.md` で後続フェーズの手動確認観点を確認する

#### 開発基盤の初期決定

- bundler は `esbuild` に決定済み（Phase 0 完了時点）
- 判定は、entry の扱いやすさ、watch の軽さ、Manifest V3 との相性、設定の読みやすさを基準にする
- 未決定のまま Phase 1 へ進まない

#### `package.json`

- `dev`、`build`、`typecheck`、`lint`、`test` の script を定義する
- 実装開始時点から、最低限の検証コマンドが固定されている状態を作る

#### `tsconfig.json`

- TypeScript strictness の方針を決める
- import path、target、module、DOM lib を content script / popup 前提で整える

#### `manifest.json`

- Manifest V3 前提の最低限構成を置く
- content script、popup、permissions、matches の雛形を決める

#### `vitest.config.ts`

- unit test をすぐ追加できる最小設定を作る
- `shared/`、`settings/`、`subtitles/` の pure logic を先に test できる形にする

#### `eslint.config.js`

- TypeScript 向け lint 設定を置く
- obvious な style 議論ではなく、責務逸脱、未使用、危険な any、曖昧な import を早めに検出できる設定を優先する

#### `.prettierrc.json`

- フォーマット規約を固定する
- コメントや JSDoc を含めて diff が追いやすい状態を作る

### 完了条件

- 実装順に迷いがない
- どの機能をどのファイルへ置くかの初期判断ができている
- ドキュメント間の役割分担が崩れていない
- bundler が確定している
- `typecheck`、`lint`、`test` を実行する script が揃っている
- 開発基盤だけで空実行または最小実行が通る

### 検証タイミング

- Phase 0 の最後に次を実行する
  1. build
  2. typecheck
  3. lint
  4. test
- フェーズ追加や bundler 変更が必要になった時点で、Phase 0 の記述と基盤設定を見直す

## Phase 1: TypeScript 基盤、共通型、dispose helper、設定保存

### 目的

- 以降の実装で迷わない最小の基盤を先に固める
- 保存設定と runtime state の境界を、型と設定 store で先に固定する
- cleanup の共通口を早い段階で用意する

### 触るファイル

- `src/shared/types.ts`
- `src/shared/dispose.ts`
- `src/shared/dom.ts`
- `src/shared/log.ts`
- `src/settings/settings-store.ts`

### ファイル単位の作業内容

#### `src/shared/types.ts`

- 共通型の初期版を置く
- 少なくとも次を定義する
  - `ExtensionSettings`
  - `SubtitleTrack`
  - `SubtitleBlock`
  - `SubtitleHistoryView`
  - `ExtensionUiState`
  - `PlayerLayoutState`
  - `UiStateStore`
  - `PlaybackTarget`
  - `SessionState`
  - `WaitingState`
  - `RestartReason`
  - `PlaybackTargetSnapshot`
- まだ確定していない Apple TV+ 固有の生 DOM 型は持ち込みすぎない

#### `src/shared/dispose.ts`

- disposer 登録と一括 cleanup の小さな helper を作る
- session 単位の resource 所有を前提にした API に絞る
- 多機能化せず、`add()` と `dispose()` 相当の最小セットを優先する

#### `src/shared/dom.ts`

- 安全な query helper、mount helper、remove helper を置く
- Apple TV+ 固有 selector はここに書かない
- panel host や control DOM の土台に使える汎用関数だけに留める

#### `src/shared/log.ts`

- debug / observe 用ログの窓口を一本化する
- category や prefix を持てる最小実装にする
- readiness 待機、restart、cleanup の追跡に使えるようにする

#### `src/settings/settings-store.ts`

- 言語設定の読込・保存 API を実装し、保存領域は settings-spec に従う
- `primaryLang` 必須、`secondaryLang` 任意、同値禁止の前提を吸収する
- `secondaryLang` 未選択時の fallback 実装は settings store に寄せすぎず、設定値正規化の範囲に留める
- 全作品共通の ON/OFF の保存境界は settings-spec に従い、言語保存と相互上書きしない形にする
- panel open state と処理資源の runtime state は保存しない
- ON/OFF の操作 UI との接続は Phase 7 で扱う

### 完了条件

- typecheck が通る
- `settings-store.ts` 単体で保存・読込・正規化の API が定義されている
- `shared/types.ts` を起点に import が始められる
- `shared/dispose.ts` が session cleanup の土台として使える

### 検証タイミング

- 実装直後に typecheck
- 続けて lint
- `settings-store.ts` と `shared/` pure utility に unit test を追加
- popup 実装に入る前に 1 回まとめて test 実行

## Phase 2: popup UI と設定反映

### Phase 2-A: popup の build 組み込みと最小 UI 骨組み

#### 目的

- popup を action から開ける状態にする
- 学習言語と母国語の入力 UI の骨組みを最小構成で置く
- content 側に入る前に、popup 固有 UI を独立して動かせるようにする

#### 触るファイル

- `src/popup/index.ts`
- `src/popup/popup.html`
- `src/popup/popup.css`
- `package.json`（`dev` / `build` の esbuild に popup の entry を追加する）
- `manifest.json`（`action.default_popup` を追加する）

#### ファイル単位の作業内容

##### `src/popup/index.ts`

- popup の DOM 初期化を行う
- 学習言語と母国語の入力 UI を最小構成で結線する
- 言語候補一覧を select に描画する
- content 側の track 解決ロジックは持ち込まない
- 保存、初期読込、バリデーションはまだ持ち込まない

##### `src/popup/popup.html`

- MVP に必要な 2 項目だけを置く
- 学習言語必須、母国語任意が分かる構成にする
- 保存ボタンとステータス領域を置く
- 過剰な設定項目は増やさない

##### `src/popup/popup.css`

- 最小の可読性だけ整える
- 将来の見た目調整はこの段階で追わない

##### `package.json`

- popup entry を build / dev に組み込む
- popup の HTML / CSS を `dist/popup/` に出力する

##### `manifest.json`

- `action.default_popup` を登録する

#### 完了条件

- unpacked extension を再読み込みすると action から popup を開ける
- popup にタイトル、学習言語、母国語、保存ボタン、ステータス領域が表示される
- popup の build 成果物が `dist/` に含まれる
- content 側未実装でも popup の UI 骨組み単体は確認できる

#### 検証タイミング

- popup 骨組み実装直後に手動確認
- あわせて typecheck、lint、build

### Phase 2-B: popup の保存・読込・validation

#### 目的

- 学習言語と母国語の設定変更を popup から保存できるようにする
- popup 起動時の初期読込と保存後の再表示を安定させる
- content 側に入る前に、保存設定の入口を安定させる

#### 触るファイル

- `src/popup/index.ts`
- `src/settings/settings-store.ts`
- `src/settings/settings-store.test.ts`
- 必要なら `src/shared/types.ts`

#### ファイル単位の作業内容

##### `src/popup/index.ts`

- `primaryLang` と `secondaryLang` の入力 UI を保存処理へ結線する
- 保存前バリデーションを入れる
- `primaryLang === secondaryLang` を禁止する
- `secondaryLang` 未選択を許容する
- 起動時の初期読込と保存後のステータス表示を行う
- content 側の track 解決ロジックは持ち込まない

##### `src/settings/settings-store.ts`

- popup から使いやすい API に調整する
- 保存後の再読込や初期表示の流れを確認する

##### `src/settings/settings-store.test.ts`

- popup 保存経路に必要な validation と正規化の test を更新する

#### 完了条件

- popup から `primaryLang` と `secondaryLang` を保存できる
- 再度 popup を開くと前回設定が読める
- 同一言語の保存を防げる
- content 側未実装でも設定経路単体は完成している

#### 検証タイミング

- 保存実装直後に手動確認
- あわせて typecheck、lint
- `settings-store.ts` の test を更新
- content 側へ進む前に保存スキーマが stable かを確認する

## Phase 3: UI state、playback root、session lifecycle の土台

### 目的

- runtime UI state と session の所有境界を先に作る
- readiness 待機、retry、旧待機停止の owner を `session-lifecycle.ts` に固定する
- thin coordinator を維持したまま、起動入口から session 開始前までの骨格を作る
- `playback-root.ts` を root / video 解決専用に保つ

### Phase 3-A: UI state、playback root、PlaybackTarget snapshot

#### 目的

- runtime UI state の最小 store を固定する
- playback root と current video の解決を、session lifecycle から分離する
- `PlaybackTarget` snapshot と比較 API を先に用意し、video identity の変化を後続の lifecycle が検出できるようにする

#### 触るファイル

- `src/ui/ui-state.ts`
- `src/content/playback-root.ts`
- `src/shared/types.ts`
- `src/ui/ui-state.test.ts`
- `src/content/playback-root.test.ts`
- 必要なら `src/shared/log.ts`

#### ファイル単位の作業内容

##### `src/ui/ui-state.ts`

- small store を実装する
- 少なくとも次を持つ
  - `getState()`
  - `setExtensionEnabled(enabled)`
  - `setPanelOpen(open)`
  - `subscribe(listener)`
- 読み込まれた ON/OFF と表示開始条件を適用できる、runtime UI state の初期化境界を用意する
- store は Storage API を直接扱わず、保存値の読込・保存は settings-store に委譲する
- store と現在の処理 session の寿命を分け、処理 session の start ごとに ON/OFF を初期化しない
- 初期化・状態維持の契約は architecture §16、保存値と未保存時の既定値は settings-spec §11 に従う

##### `src/content/playback-root.ts`

- playback root と `HTMLVideoElement` の解決だけを担当する
- root / video / 注入候補 / layout 基準候補をまとめた `PlaybackTarget` snapshot を返せる形にする
- snapshot を比較し、video identity の変化を検出できる API を提供する
- 同じ playback root を維持したまま video が差し替わる可能性を前提にする
- readiness 待機、retry、polling、旧待機停止は持たない

##### `src/shared/types.ts`

- `PlaybackTarget`、`PlaybackTargetSnapshot`、UI state に必要な共有型を、3-A の実装に必要な最小範囲で確定する
- session lifecycle 固有の待機・cleanup の実装詳細は持ち込まない

##### `src/ui/ui-state.test.ts`

- 初期入力を反映でき、製品の起動・復元条件と store 単体の初期化を混同しないことを確認する
- 各 setter が state を更新することを確認する
- `subscribe()` が更新通知を受け取り、unsubscribe 後は通知されないことを確認する

##### `src/content/playback-root.test.ts`

- root / video を含む snapshot を構築できることを確認する
- 同一 video の snapshot は同一 target と判定できることを確認する
- root が同一でも video identity が変化した場合に、別 target と判定できることを確認する
- 解決ロジックの純粋部分を対象にし、readiness 待機や retry は扱わない

#### 完了条件

- `ui-state.ts` が保存設定と分離された small store として使える
- `PlaybackTarget` snapshot を構築できる
- video identity の変化を snapshot 比較で検出できる
- `playback-root.ts` に readiness 待機、retry、polling、旧待機停止が入っていない
- `ui-state.ts` と `playback-root.ts` の unit test が通る

#### 検証タイミング

- 3-A 実装後に typecheck、lint、unit test を実行する
- `ui-state.ts` の初期値、更新、subscribe / unsubscribe を確認する
- `playback-root.ts` の snapshot 構築と video identity 比較を確認する
- content script の起動や readiness 待機の手動確認は 3-B で行う

### Phase 3-B: session lifecycle と content coordinator

#### 目的

- readiness 待機、retry、旧待機停止、session dispose の owner を `session-lifecycle.ts` に固定する
- `content/index.ts` を settings 読込、target 解決、lifecycle 起動、top-level error handling だけに保つ
- video 差し替え時に旧待機と旧 listener を確実に停止できる session の骨格を作る

#### 触るファイル

- `src/content/session-lifecycle.ts`
- `src/content/index.ts`
- `src/shared/types.ts`
- `src/shared/dispose.ts`
- `src/content/session-lifecycle.test.ts`
- 必要なら `src/shared/log.ts`

#### ファイル単位の作業内容

##### `src/content/session-lifecycle.ts`

- 処理 session の開始停止と controller の最終 dispose の骨格を作る
- stop 後の再開始、dispose 後の開始・購読禁止、停止後の参照解放は architecture §12 に従う
- readiness 待機、retry、旧待機停止をここが所有する
- `video.textTracks.length === 0` を失敗ではなく waiting state として扱う
- 新しい `HTMLVideoElement` の直後は `textTracks.length === 0` になり得る前提で待機制御を入れる
- `textTracks` が段階的に増えることを前提に readiness 判定を持つ

```ts
const isSubtitleReady = (video: HTMLVideoElement): boolean =>
  video.textTracks.length > 0;
```

- 3-A で用意した playback target snapshot を比較し、video identity の変化を検出する
- readiness 待機中に video が差し替わった場合は、旧待機と旧 listener を dispose してから新 video を監視する
- 新 video では待機開始時刻と retry 回数を初期化し、同一 video の再確認では維持する
- `RestartReason` の型を導入し、再初期化理由を後続フェーズでも共有できるようにする
- session stop 時に登録済み disposer を一度だけ実行する土台を作る

##### `src/content/index.ts`

- settings 読込、target 再評価入口の配線、session lifecycle 起動、top-level error handling だけを担当する
- target 比較・restart 要否・理由選択は lifecycle へ委譲する
- polling、DOM observer の詳細、readiness retry の実装詳細を置かない
- 3-A の `PlaybackTarget` snapshot と 3-B の lifecycle を接続する薄い coordinator に留める

##### `src/shared/types.ts`

- `WaitingState`、`RestartReason`、session lifecycle の公開境界に必要な共有型を最小範囲で確定する
- source、renderer、panel の後続責務を先取りしない

##### `src/content/session-lifecycle.test.ts`

- `textTracks.length === 0` を waiting state として扱い、terminal failure にしないことを確認する
- ready な video で次の session 開始へ進めることを確認する
- readiness 待機中に video identity が変化した場合、旧待機と旧 listener を停止することを確認する
- stop / dispose を複数回呼んでも cleanup が一度だけ実行されることを確認する
- stop 後の公開購読維持と再開始、dispose 後の購読破棄・開始禁止を区別して確認する
- stop / dispose 後の target:null・waiting:null・字幕接続なしを確認する

#### 完了条件

- video が存在しても `textTracks.length === 0` の間は subtitle source を開始しない
- `textTracks.length === 0` を error / terminal failure にしない
- readiness 待機中に video が差し替わったら古い待機と listener を停止できる
- ready な新 video を検出したら次の session 開始へ進める
- `content/index.ts` に polling や DOM observer の詳細が入っていない
- `session-lifecycle.ts` と `content/index.ts` の責務境界が保たれている

#### 検証タイミング

- 3-B 実装後に typecheck、lint、unit test を実行する
- `session-lifecycle.ts` の readiness 判定、waiting state、target snapshot 比較、旧待機停止、dispose を確認する
- content script がクラッシュせず起動し、未 ready video を waiting state として扱えることを手動確認する
- video 差し替え時に旧待機と旧 listener が残らず、新 video の監視へ移ることを手動確認する

### 全体完了条件

- video が存在しても `textTracks.length === 0` の間は subtitle source を開始しない
- `textTracks.length === 0` を error / terminal failure にしない
- readiness 待機中に video が差し替わったら古い待機と listener を停止できる
- ready な新 video を検出したら次の session 開始へ進める
- `content/index.ts` に polling や DOM observer の詳細が入っていない

## Phase 4: subtitle source と text-track resolver

### 目的

- readiness 通過後の current video を前提に、字幕取得窓口を作る
- TextTrack の正規化・採用判定と source の接続を、UI から切り離す
- renderer なしで採用 track、cue 取得、停止時 cleanup を確認できるようにする

### 触るファイル

実装:

- `src/subtitles/text-track-resolver.ts`
- `src/subtitles/subtitle-source.ts`
- `src/subtitles/subtitle-session.ts`
- `src/content/session-lifecycle.ts`
- `src/content/index.ts`

テスト:

- `src/subtitles/text-track-resolver.test.ts`
- `src/subtitles/subtitle-source.test.ts`
- `src/subtitles/subtitle-source-snapshot.test.ts`
- `src/subtitles/subtitle-source-errors.test.ts`
- `src/subtitles/subtitle-source-test-helpers.ts`
- `src/subtitles/subtitle-session.test.ts`
- `src/content/session-lifecycle.test.ts`
- 必要な回帰確認として settings / shared のテスト

必要な場合だけ変更する共通基盤:

- `src/shared/types.ts`
- `src/shared/log.ts`
- `src/shared/dispose.ts`

責務・owner・公開 API は `docs/minimal-panel-architecture.md` を正本とする。
テスト項目と手動確認手順は `docs/testing-checklist.md` を参照する。

### ファイル単位の作業内容

#### `src/subtitles/text-track-resolver.ts`

- TextTrackList 相当の一覧を候補情報へ正規化する
- language、label、kind、mode を使って採用候補を判定する
- primary / secondary の採用と fallback を判定する
- 同じ TextTrack を両方の役割に採用しない
- 表示中字幕は mode === 'showing' を基準にする
- active cue の有無だけでは表示中字幕を判断しない
- browser language の取得、待機、listener 登録、mode 変更は行わない

#### `src/subtitles/subtitle-source.ts`

- current video に属する採用 track を bind する
- track binding と cue listener を所有する
- role 付き cuechange 通知と snapshot 取得を提供する
- bind 入力と snapshot の管理情報をコピーし、実 TextTrack の参照は共有する
- 解除に失敗した旧 binding からの通知を遮断する
- 通知途中に dispose された場合も、後続購読者への通知を止める
- readiness 待機、retry、track 選定、panel、UI state は扱わない

#### `src/subtitles/subtitle-session.ts`

- resolver と source の接続処理をまとめる
- source を生成し、購読してから bind する
- readiness 成立後も、textTracks の addtrack / removetrack に応じて resolver で採用 track を再選定する
- 未取得 track の cue 読込みを再生イベントと cuechange で再確認する
- 同じ採用 track の組み合わせなら、不要な再 bind を行わない
- 採用結果と cue 件数をログで観測する
- source、その購読、track 一覧と video の再生イベントの監視を所有する
- lifecycle が保持・実行する Disposable を返す
- 初期化途中の失敗でも、作成済み資源の cleanup を試す
- source の内部処理や cue listener の直接解除を重複実装しない
- native menu 操作後の自動同期は、この track 一覧の追加・削除への追従とは区別する

#### `src/content/session-lifecycle.ts`

- readiness 待機と retry の owner を維持する
- 字幕入力がある場合だけ、ready 到達後に字幕接続を生成する
- stop、再開始、dispose で旧字幕接続の cleanup を試す
- 解除失敗で残った旧 retry が、停止状態や新しい待機を変更しないようにする
- 字幕接続の詳細は subtitle-session に委譲する
- running を、両言語の採用や cue 取得成功と同一視しない

#### `src/content/index.ts`

- ready な保存設定を lifecycle へ渡す
- secondary 未選択時だけ navigator.language を fallback 候補として渡す
- settings の ready を、通常起動で自動 ON にする条件にしない
- observer 由来の同一 target 再評価では、不要な start を省く
- debug badge の同じ表示文字列は再設定しない
- top-level の購読、observer、debounce timer、badge、lifecycle を cleanup する

target 発見用 observer と debug badge は、既存の確認経路を維持するための暫定配置とする。
readiness 待機と retry の実装を index へ移さない。
この暫定配置を、thin coordinator の責務整理がすべて完了した状態とは扱わない。

### 実装と確認の順序

1. resolver と source の境界を固める
2. subtitle-session に接続処理をまとめる
3. lifecycle に字幕接続の生成・破棄を接続する
4. index から保存設定と fallback を渡す
5. 関連自動テストと build を通す
6. 正本文書と実装の配置・API・owner を照合する
7. entry 固有の回帰確認と Apple TV+ のブラウザ確認を行う
8. 開発用フラグの使用状態、結果と未確認事項を記録する。使用条件と無効化時期は、本書の「開発用・ブラウザ確認用フラグ」に従う

### テストファイルの分割

- source の基本動作、snapshot のコピー保護、エラー境界を別ファイルに分ける
- fake track、fixture、logger は source テスト専用 helper で共有する
- helper はテストや hook を登録しない
- lifecycle のテストは、readiness と字幕接続の生成・破棄の委譲に集中する
- 実際の resolver / source の接続は subtitle-session のテストで確認する
- 分割時は既存テストの移動先を確認し、件数だけで確認内容の維持を判断しない
- 必要な JSDoc や cleanup の説明を削って、行数を減らさない

### ブラウザ確認の起動と診断

正式な ON/OFF toggle を使わない起動と、session・字幕取得の診断には開発用フラグを使う。
各フラグの役割・使用条件・無効化時期は、本書の「開発用・ブラウザ確認用フラグ」を参照する。

### Phase 4 の接続範囲に含めないもの

- `SubtitleBlock[]` と history
- panel、layout、正式な ON/OFF UI
- native menu 操作後の自動同期
- popup 保存後の設定自動再読込

この一覧は Phase 4 の作業範囲であり、現在の実装状況を示すものではない。
後続 Phase の要件は取り消さず、実装順は本書の該当 Phase を参照する。
設定を変更した場合のブラウザ確認は、`docs/testing-checklist.md` の「手動スモーク前の準備」に従う。

### 未実装ファイルの扱い

後続 Phase の空ファイルは先置きしない。
空ファイルを削除しても、architecture にある責務と実装予定は維持する。
対応 Phase の着手時に必要なファイルを作成する。

### 完了条件

- source 自身は textTracks が 0 件の video を待機しない
- resolver は language だけで track を採用しない
- 表示中判定に showing を使い、active cue 単独では判断しない
- lifecycle が字幕接続の寿命を管理し、source が cue listener を管理する
- renderer なしで採用結果と cue 取得を確認できる
- 停止・再開始・破棄時に旧字幕接続の cleanup を試す
- 自動テスト成功、コード上の確認、ブラウザ確認を区別して記録する
- 未観測・未対応・失敗を残したまま、Phase 全体の完了を断定しない

### 検証タイミング

- module 実装・分割後に typecheck、lint、関連テスト
- entry 接続後に typecheck、lint、全テスト、build
- entry の起動条件、同一 target 再評価、pagehide cleanup を回帰確認する
- Apple TV+ で track 採用、bind、cue 取得、停止時解除を確認する
- 開発用フラグの使用状態を記録し、「開発用・ブラウザ確認用フラグ」で定める時期に無効化後の動作も確認する

module のテスト成功だけで、entry の分岐やブラウザ上の動作を確認済みと扱わない。

## Phase 5: `SubtitleBlock[]` と current / past / future 導出

### 目的

- panel 実装前に truth を完成させる
- source と renderer の間に、安定した字幕データ層を置く

### 触るファイル

- `src/subtitles/subtitle-block-builder.ts`
- `src/subtitles/subtitle-block-builder.test.ts`
- `src/subtitles/subtitle-block-candidates.ts`
- `src/subtitles/subtitle-block-candidates.test.ts`
- `src/subtitles/subtitle-history.ts`
- `src/shared/types.ts`
- `src/subtitles/subtitle-source.ts`
- `src/subtitles/subtitle-session.ts`
- `src/subtitles/subtitle-session.test.ts`
- `src/content/session-lifecycle.ts`
- `src/content/session-lifecycle.test.ts`
- `src/content/debug-subtitle-log.ts`
- `src/content/debug-subtitle-log.test.ts`
- `src/content/index.ts`
- `src/content/index.test.ts`
- 必要なら `src/shared/log.ts`

### ファイル単位の作業内容

#### `src/subtitles/subtitle-session.ts`

- source 更新を builder・history へ接続し、結果の保持・取得境界・解放を所有する
- 通常の時刻更新・seek は保持済み truth から history だけを再計算する
- 初回bind・source更新・track切替・入力違反後の復帰・cleanupを同テストで確認する
- 診断の取得回数と、truth 構築に必要な cue 取得・時刻読取りを区別して検証する
- データ取得境界と例外処理・cleanup の規則は architecture の session 仕様を参照する

#### 開発用の字幕データ観測

- `src/content/debug-subtitle-log.ts` は lifecycle の公開取得・購読 API だけを使い、block / history の要約を既存の subtitle logger の info で出力する
- `src/content/index.ts` は `DEBUG_SUBTITLE_SNAPSHOT_LOG` と配線だけを持ち、観測の dispose を top-level bag に登録する
- `DEBUG_SUBTITLE_SNAPSHOT_LOG` の使用条件・無効化時期・変更後の手順は、本書の「開発用・ブラウザ確認用フラグ」に従う
- 出力内容・観測手順は testing-checklist の「再生経路への接続の確認」を参照する
- 同テストで無効時の購読・取得抑制、要約の重複抑制、取得失敗後の復帰、解除後の残存 callback を確認する
- entry の同テストで接続と lifecycle より先の cleanup を確認する

#### `src/content/session-lifecycle.ts`

- 字幕接続のデータ取得と更新通知を、状態購読・診断観測と分離して中継する
- 初回接続・更新・旧接続のクリア、旧 callback の無効化、通知中の停止・再開始を同テストで確認する
- snapshot の取得範囲と解放時の動作は architecture の lifecycle API を参照する

#### `src/subtitles/subtitle-block-builder.ts`

- 生 cue 全件の入力検証、完全重複除去、同時刻正規化、対応づけ、block 出力の順に処理する
- 同時刻正規化と後続評価の規則は、architecture の builder API 境界を正本とする
- 生 cue の公開型は維持し、内部表現・変数名・コメント・同テストの意味を正規化単位へ合わせる
- UI 向けの見た目都合ではなく、truth を返すことに集中する
- block の時刻範囲と本文の欠損時ルールを整理する
- 現行の `SubtitleBlock` に id / key は追加しない
- 入力条件と対応づけの仕様は、minimal-panel-architecture の builder API 境界を正本とする

#### `src/subtitles/subtitle-block-candidates.ts`

- builder 内部の補助として、検証・完全重複除去・同時刻正規化済みの単位から対応候補と点数を生成する
- 候補の採用・単位の消費・block 出力・同時刻正規化は行わない
- 同テストで重なり率・空白率の境界、隣接条件、件数制限、元の入力位置、入力不変性を確認する
- 内部境界と候補条件は minimal-panel-architecture の builder 仕様を参照する

#### `src/subtitles/subtitle-history.ts`

- `SubtitleBlock[]` と current time から、現行の共通型 `SubtitleHistorySnapshot` を返す
- current / past / future の導出ロジックを pure に保つ
- `SubtitleHistoryView` は既存の別名として維持し、新しい型や別名は追加しない
- renderer が source に触れなくても済む境界を作る

### 完了条件

- `SubtitleBlock[]` を生成できる
- current / past / future を純関数ベースで導出できる
- panel 未実装でも history をログで確認できる
- truth 層が `TextTrack` 直読みなしで扱える

### 検証タイミング

- 実装直後に typecheck、lint
- `subtitle-block-builder.ts` と `subtitle-history.ts` の unit test を追加
- 同時刻正規化の境界・多数件・片言語・重複・順序・本文保持を同テストで確認する
- 単位ベースの候補点数・同点比較・消費を確認する
- ブラウザで観測した英語3断片を固定した回帰入力で、英語全文が同時刻の別blockへ分離せずcurrentへ渡ることを確認する
- 正規化条件外の同時刻blockと、時刻の異なる3単位以上の扱いは既存規則を維持する
- 時刻ずれ、secondary 欠損、track 切替前後の最低限ケースを test する
- panel 実装へ入る前に、ブラウザのログで block が組めているかを確認する

## Phase 6: panel host と panel renderer

### 目的

- truth を右側 panel へ表示する最小描画経路を作る
- DOM 所有と描画責務を分ける

### 触るファイル

- `src/panel/panel-host.ts`
- `src/panel/panel-renderer.ts`
- `src/content/panel-session.ts` と関連テスト
- `src/content/session-lifecycle.ts` と関連テスト
- `src/content/index.ts` と関連テスト
- `src/subtitles/subtitle-history.ts`
- `src/ui/ui-state.ts`
- `src/shared/dom.ts`
- 必要なら `src/shared/types.ts`

### ファイル単位の作業内容

#### `src/panel/panel-host.ts`

- panel host DOM の生成、mount、unmount を実装する
- panel DOM の owner をここに限定する
- renderer が差し込みやすい最小の DOM 構造を返す

#### `src/panel/panel-renderer.ts`

- `SubtitleHistoryView` を受けて current / past / future を描画する
- source や `TextTrack` は直接読まない
- 初期版では DOM 差分最適化よりも責務明確化を優先する
- 空状態や未取得状態の最小表示もここで扱う

#### `src/content/panel-session.ts`

- architecture の責務・API 境界に従い、host / renderer と字幕データ境界・既存 UI store を接続する
- 単体で初回取得・更新購読・表示切替・再入・失敗時 cleanup を検証してから、lifecycle へ組み込む
- snapshot・UI state を正本として複製保持せず、truth / history の再構築を重複実装しない

#### 接続側: `session-lifecycle.ts` / `index.ts`

- lifecycle が処理 session ごとに panel 接続を生成し、停止・再開始・最終 dispose 時に解放する
- readiness retry ごとに panel 接続を生成せず、旧購読・旧 DOM を次 session へ持ち越さない
- index は既存 UI store の受渡しなどの配線だけを行い、接続処理・cleanup 本体を持たない
- 単体検証と再生経路への接続検証を分け、後者で待機から字幕表示への更新と停止時解放を確認する
- mount 候補は DOM 正本文書と現在の実画面で確認し、selector の存在だけで採用確定としない

### 完了条件

- panel host が mount / unmount できる
- `SubtitleHistoryView` を panel に表示できる
- renderer が source を直接読んでいない
- session stop で panel DOM を確実に外せる

### 検証タイミング

- 実装直後に typecheck、lint
- renderer の pure な整形部があれば unit test を追加
- panel 接続の自動テストは testing-checklist の「panel 接続の自動テスト」に従う
- lifecycle 組込み後は初回表示・更新・停止・再接続の接続テストと全体回帰検証を行う
- Apple TV+ 実画面で panel が最小表示できることを確認する
- この時点では 7:3 layout 未導入でもよい

## Phase 7: ON/OFF toggle、開閉ボタン、layout 適用

### 目的

- 拡張全体の有効 / 無効と panel 表示状態を分けて UI に反映する
- 右側 panel を 7:3 layout の中で表示できるようにする

### 触るファイル

- `src/controls/on-off-toggle.ts`
- `src/controls/panel-open-close-button.ts`
- `src/layout/player-layout.ts`
- `src/ui/ui-state.ts`
- `src/ui/extension-enabled-controller.ts`
- `src/ui/extension-enabled-controller.test.ts`
- `src/settings/settings-store.ts`
- `src/settings/settings-store.test.ts`
- `src/content/index.ts`
- `src/panel/panel-host.ts`
- `src/content/playback-root.ts`
- `src/content/session-lifecycle.ts`
- 必要なら `src/shared/dom.ts`
- 必要なら `src/shared/types.ts`

### ファイル単位の作業内容

#### `src/controls/on-off-toggle.ts`

- 再生画面下部に ON/OFF toggle を描画する
- `extensionEnabled` の変更イベントを発火する
- panel 開閉の責務を持たないようにする

#### `src/controls/panel-open-close-button.ts`

- panel の開閉ボタンを描画する
- `panelOpen` の変更イベントを発火する
- extension 全体の ON/OFF には触れない

#### `src/layout/player-layout.ts`

- 既存 UI を含む再生画面領域を基準に available width を計測する
- 7:3 layout を計算し、panel 開閉時と resize 時に再適用する
- layout state を更新できる最小 API を作る
- 固定ピクセル押し込みではなく responsive 再計算を優先する

#### `src/ui/ui-state.ts`

- toggle / button / session の接続で必要な更新通知を調整する
- store の責務を超えて DOM を持たない
- 全作品共通の ON/OFF の復元と、保存しない panel 開閉を区別する

#### `src/ui/extension-enabled-controller.ts`

- architecture の責務・公開操作・寿命・cleanup に従って操作側 owner を実装する
- 初期読込、明示操作、保存の直列化、最新操作と通知を扱い、index.ts に本体を置かない
- DOM と lifecycle を直接扱わず、settings-store と UI store を接続する

#### `src/ui/extension-enabled-controller.test.ts`

- 初期読込と操作の競合、保存順序・失敗後の継続、古い結果の抑止、回復操作を確認する
- OFF・技術的 restart での維持と、最終 dispose 後の非干渉を区別する

#### `src/settings/settings-store.ts`

- settings-spec §14.5 の loadExtensionEnabled / saveExtensionEnabled と結果型を実装する
- 全作品共通の ON/OFF の読込・保存を実装する
- 言語保存と ON/OFF 保存で、互いの保存値を上書きしない境界を保つ
- panel 開閉状態や UI state 全体の snapshot は保存しない

#### `src/settings/settings-store.test.ts`

- ON/OFF の未保存と保存済み false を区別し、既定値と保存値の扱いを確認する
- 言語保存と ON/OFF 保存で、互いの保存値を変更しないことを確認する
- 読込失敗・型不正・保存失敗は、確定した settings-spec の期待値に従って確認する

#### `src/content/index.ts`

- 操作側 controller と UI store・ON/OFF UI を生成・接続し、controller の初期化と最終 dispose を配線する
- UI の明示選択・再保存を controller へ接続し、有効状態の変化による開始停止は lifecycle へ委譲する
- 保存・復元の詳細や開始停止の判断本体は、それぞれの担当 module へ委譲する
- 暫定の自動 ON から正式な復元経路へ移行し、保存済み OFF を開発用フラグで上書きしない

#### `src/content/session-lifecycle.ts`

- `extensionEnabled = false` のときに字幕処理・panel 表示・layout 適用と、それらに必要な監視を止める
- OFF から ON に戻す操作経路は維持する
- `panelOpen = false` のときに panel 表示と layout 適用を止める
- ON/OFF toggle と開閉ボタンの役割差を崩さない接続にする
- ON 操作時と新しい視聴開始時の panel 初期表示、技術的再接続時の維持は architecture に従う
- 保存された ON/OFF を、処理 session の停止・再接続で変更しない

### 完了条件

- ON/OFF toggle で拡張全体の有効 / 無効を切り替えられる
- ON/OFF が全作品共通で保存・復元され、未保存時の既定値に従う
- 言語保存と ON/OFF 保存で互いの値を上書きしない
- 開閉ボタンで panel 表示だけを切り替えられる
- panel 開閉を保存せず、OFF 後も ON に戻せる
- panel を開くと 7:3 layout が適用される
- resize 時に layout が再計算される
- UI state と layout state が分離されている

### 検証タイミング

- 実装直後に typecheck、lint
- `settings-store.ts`、`extension-enabled-controller.ts`、`ui-state.ts`、`player-layout.ts` の test を追加または更新する
- 保存値の復元と操作からの保存・開始停止について、接続テストを追加または更新する
- 関連する自動テストの成功後、Apple TV+ 実画面で次を手動確認する
  - ON/OFF toggle の有効 / 無効
  - panel 開閉
  - 7:3 layout
  - 横幅変化時の再計算
  - controls 表示時の崩れ有無
- ON/OFF の未保存時・保存済み値の復元、作品変更・ページ再読み込み・ブラウザ再起動後の維持は、`docs/testing-checklist.md` の「ON/OFF toggle の確認項目」に従って確認する
- panel 非表示中の操作経路と、技術的再接続時の開閉状態の維持は、同文書の「panel 開閉ボタンの確認項目」と「`ui-state.ts` small store の確認項目」に従って確認する
- 新しい視聴の識別条件が未確定の場合、その経路を確認完了として扱わない

## Phase 8: restart / cleanup / SPA 遷移対応

### 目的

- 処理 session の開始停止と controller の最終 dispose を、実運用レベルに固める
- restart request を `session-lifecycle.ts` に集約する
- リーク、二重 bind、古い DOM 残留、旧 video 参照残りを防ぐ

### 触るファイル

- `src/content/session-lifecycle.ts`
- `src/subtitles/subtitle-source.ts`
- `src/subtitles/native-menu-sync.ts`
- `src/panel/panel-host.ts`
- `src/layout/player-layout.ts`
- `src/controls/on-off-toggle.ts`
- `src/controls/panel-open-close-button.ts`
- `src/shared/dispose.ts`

### ファイル単位の作業内容

#### `src/content/session-lifecycle.ts`

- restart request をここに集約する
- 開始・再初期化理由は `docs/minimal-panel-architecture.md` §18 の `RestartReason` に従う
- video の disconnect・replacement、playback root の disconnect、SPA target change という契機と、理由コードの値を区別する

- restart の判断・理由対応・順序は architecture §13 に従って実装し、ここでは再定義しない
- DOM の検出元と readiness retry を共通再評価経路へ接続する
- 同一 target の重複通知、対象消失、直接の差し替え、再入、OFF、dispose を分けて確認する
- controller 自体の dispose と、旧処理 session の終了を混同しない
- 新しい視聴の識別条件が未確定の場合は、restart reason や video identity だけで代用しない
- seek は restart 契機にしない

#### 関連 module

- `subtitle-source.ts` で track binding と cue listener を解除する
- `native-menu-sync.ts` で native menu binding を解除する
- `panel-host.ts` で panel DOM を unmount する
- `player-layout.ts` で layout observer を解除する
- 各 controls module が、その寿命を終える binding を解除する。字幕処理の停止と、ON に戻す操作経路の終了は区別する
- `shared/dispose.ts` は disposer が二重実行されない前提を補助する

### 完了条件

- video replacement 後、旧 video に listener が残らない
- panel host が重複しない
- layout observer と native menu listener が重複しない
- 旧 session が新 session を dispose しない
- seek では restart されない

### 検証タイミング

- 実装直後に typecheck、lint、test
- その後に Apple TV+ 実画面で次を手動確認する
  - video replacement 後の再開
  - ON → OFF → ON
  - 同作品内のシーク
  - 別エピソード遷移
  - SPA 遷移後の再初期化
- 不具合時は current settings、current video、採用 track、session 状態、layout 状態をログで確認できるようにする

## Phase 9: native menu 同期順序など Apple TV+ 固有対応

### 目的

- Apple TV+ 固有の native subtitle UI と track 切替癖を、限定モジュールへ閉じ込める
- `change` 直後の不安定さに引きずられず、最終的な showing track を再解決する

### 触るファイル

- `src/subtitles/native-menu-sync.ts`
- `src/subtitles/text-track-resolver.ts`

### ファイル単位の作業内容

#### `src/subtitles/native-menu-sync.ts`

- native menu の select change を検出する
- `change` 直後の select value を真実源として採用しない
- 最初の `requestAnimationFrame` 後に current video の tracks を再解決する
- `TextTrack.mode === "showing"` を優先して採用 track を決める
- 必要時のみ短い fallback 再確認、または cuechange 後の再解決を行う
- menu close / session stop 時に listener を解除する
- session ごとに native menu binding を 1 つだけ持つ

#### `src/subtitles/text-track-resolver.ts`

- native menu 同期後の再解決 API を受け止める
- 一時的な旧値復帰より、実際に表示中の track を優先して判定する

### 完了条件

- 日本語 → 英語、英語 → 日本語の両方向で track 再解決できる
- select の一時的な旧値復帰に引きずられない
- native menu binding が session ごとに 1 つだけ存在する

### 検証タイミング

- DOM 調査ドキュメント更新後に着手する
- 実装直後に typecheck、lint、test
- Apple TV+ 実画面で native menu 操作、track 切替、再解決順を手動確認する

## Phase 10: テスト、自動化、スモーク、不具合修正

### 目的

- MVP として必要な品質ラインを満たす
- ブラウザでしか確認できない部分を、少数の固定手順で確認できるようにする

### 触るファイル

- `tests/` 配下
- `src/settings/settings-store.ts`
- `src/ui/ui-state.ts`
- `src/content/session-lifecycle.ts`
- `src/subtitles/text-track-resolver.ts`
- `src/subtitles/subtitle-block-builder.ts`
- `src/subtitles/subtitle-history.ts`
- `src/layout/player-layout.ts`
- `src/shared/` 配下
- 必要に応じて全実装ファイル

### ファイル単位の作業内容

- pure function と small integration の自動テストを増やす
- Apple TV+ 実画面依存の内容は `docs/testing-checklist.md` の手順でスモーク確認する
- 不具合修正は責務境界を崩さず、影響範囲をファイル単位で閉じる
- 修正ごとに cleanup 観点の回帰確認を入れる

### 完了条件

- build、typecheck、lint、test が安定して通る
- MVP に必要な手動スモークが通る
- 既知の不安定ポイントがログと再現手順つきで管理できる
- `src/content/index.ts` が thin coordinator のまま維持されている

### 検証タイミング

- 不具合修正のたびに対象 test を再実行する
- release 前に build、typecheck、lint、test、manual smoke を一式実施する

## 開発用・ブラウザ確認用フラグ

`src/content/index.ts` の次の4フラグを、Phase をまたぐ開発・ブラウザ確認に使う。
役割・使用条件・無効化時期は、フラグごとに扱う。

### 自動 ON：`DEBUG_AUTO_ENABLE_SUBTITLES`

- 正式な ON/OFF toggle と保存状態の復元経路へ移行するまでは、ブラウザ確認の暫定起動手段として維持する
- 言語設定が ready の場合だけ有効化する暫定経路と、製品仕様の「ON/OFF 未保存時は ON」を区別する
- panel を開くフラグではない
- 正式な ON/OFF toggle の実装・検証完了とは扱わない
- ブラウザ確認のたびに false へ戻す必要はない
- 保存状態の復元を接続するときは、保存済み OFF をこのフラグで上書きしない
- 正式な ON/OFF toggle の実装時に false に戻し、未保存時 ON・保存値復元・操作による開始停止を検証する

### 初回 panel 表示：`DEBUG_AUTO_OPEN_PANEL`

- Phase 6 の最小表示を観測するため、起動時に言語設定が ready かつ拡張が有効な場合だけ panel を開く
- このフラグ自体は拡張を ON にしない。自動 ON とは独立した入力とする
- 起動時に一度だけ適用し、target 再評価・同じ視聴の技術的な再接続では手動 close を上書きしない
- panel 開閉ボタン・新しい視聴の識別・ON/OFF の正式な復元経路の実装完了とは扱わない
- 正式な操作側 UI の起動経路へ移行するときは false に戻し、製品の開閉仕様を検証する
- 実画面の mount 採用・可視性と自動追従は別途確認し、entry 配線の自動テストだけで完了としない

### 診断表示：`DEBUG_SESSION_BADGE`

- リリースまでは true を維持し、session と字幕取得の診断表示に使う
- 自動 ON とは独立したフラグであり、診断表示だけで拡張を ON にしない
- リリース前に false にし、診断表示なしの動作を検証する

### 字幕データのログ：`DEBUG_SUBTITLE_SNAPSHOT_LOG`

- 字幕データをブラウザで確認する間は true にし、通常利用・配布前は false にする
- 有効な保存設定と extension enabled state が必要であり、このフラグだけで拡張を ON にしない
- 出力には字幕本文が含まれるため、共有時は必要部分だけに絞る
- 出力内容と観測手順は `docs/testing-checklist.md` の「再生経路への接続の確認」を参照する

4フラグとも storage に保存しない。
製品の起動・復元仕様は settings-spec §11 に従う。
開発用フラグによる起動は暫定経路であり、保存・復元や正式 UI の確認とは区別する。

フラグを変更した後は再 build し、拡張とページを再読み込みする。
具体的な手順は `docs/testing-checklist.md` の「実行前提 > 手動スモーク前の準備」を参照する。

## フェーズごとの検証ルール

各フェーズの終わりで、少なくとも次を実行する。

1. build
2. typecheck
3. lint
4. 追加した pure function / small integration の test
5. 必要な範囲だけ手動確認

運用上の目安:

- Phase 0〜5 は自動テスト比重を高くする
- Phase 6〜9 は手動確認が増えるが、先に自動テストを通してからブラウザ確認へ進む
- 手動確認でしか見えない Apple TV+ 依存挙動は、ログまたは health snapshot で状態確認しやすくする

## 作業時の注意

- `src/content/index.ts` に処理を寄せ始めたら、その時点で分割候補を先に検討する
- source と renderer の直結を作らない
- runtime state を `chrome.storage.sync` に逃がさない
- owner 不明の listener / observer / timer を作らない
- panel 実装前に truth の shape を安定させる
- cleanup 実装前に start 処理を広げすぎない
- Apple TV+ 固有 workaround は Phase 9 より前で増やしすぎない
- `textTracks.length === 0` を source 側の失敗として扱わない
- seek を restart 契機にしない
- native menu `change` 直後の値を、そのまま最終判定に使わない

## 共通設計前提を見直す条件

次のいずれかが起きた場合は、実装を進める前に共通設計前提の見直しが必要か判断する。

1. `SubtitleBlock` の shape を変えないと truth を表現できない
2. `ExtensionUiState` や `PlayerLayoutState` の責務境界が現実に合わない
3. `playback-root.ts` で想定していた注入先や基準領域が Apple TV+ 実画面で成立しない
4. `TextTrack` の実観測結果が、resolver 前提を大きく崩す
5. ON/OFF toggle と開閉ボタンの責務分離を維持できない要求が出た
6. cleanup 順序の前提が、実際の再初期化フローで破綻する
7. 7:3 layout の対象が、既存 UI を含む再生画面領域では成立しない
8. DOM 調査結果により、Apple TV+ 固有対応を後段に送る前提が崩れる
9. 自動テスト優先の方針では追いにくい構造変更が必要になる
10. `src/content/index.ts` が thin coordinator では保てない設計変更が必要になる
11. `textTracks.length === 0` を readiness 待機では吸収できない新パターンが見つかる
12. 同一 playback root 内の video replacement 検出条件が想定より不安定である
13. native menu 同期に `requestAnimationFrame` 1 回では足りない観測が増える

## 共通設計前提の変更が必要になったときの扱い

共通設計前提の変更が必要な場合は、いきなり実装で吸収しない。次の順で扱う。

1. 変更理由を明文化する
2. 影響範囲を、型、module 境界、cleanup、UI、テストに分けて整理する
3. 先に更新すべき正本を決める
4. 正本更新後に実装へ戻る

通常は次の順で更新する。

- 用語、責務境界、設計原則に関わる変更  
  → `docs/minimal-panel-architecture.md`
- 設定項目や保存ルールの変更  
  → `docs/settings-spec.md`
- Apple TV+ DOM 前提の変更  
  → `docs/apple-tv-dom-structure.md`
- 実測ログや時系列の追記  
  → `docs/apple-tv-dom-observations.md`
- テストレベルや検証対象の変更  
  → `docs/testing-checklist.md`
- 実装順や開発基盤の変更  
  → `docs/implementation-workflow.md`

## 実装開始時の読み順

毎回フレッシュに着手するときは、次の順で確認する。

1. `docs/minimal-panel-architecture.md`
2. `docs/settings-spec.md`
3. `docs/apple-tv-dom-structure.md`
4. `docs/apple-tv-dom-observations.md`
5. この `docs/implementation-workflow.md`
6. `docs/testing-checklist.md`

この順で読むことで、設計前提、設定境界、DOM 判断、実装順、検証順を短時間で再確認できる。
