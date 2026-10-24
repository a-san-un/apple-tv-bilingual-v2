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

### 初期版の採用候補

- TypeScript
- Chrome Extensions Manifest V3
- bundler は `esbuild`（Phase 0 で確定。最小構成と設定の読みやすさを優先した）
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

### bundler 未決定時の扱い

bundler が未決定の場合は、Phase 0 で次の判断基準に基づいて決定する。

- content script / popup / options 相当の複数 entry を無理なく扱えるか
- TypeScript の build 導線が単純か
- watch 実行が軽いか
- Manifest V3 構成で余計な抽象化を増やさないか
- TypeScript に不慣れでも設定の読み替えがしやすいか

初期判断の目安:

- 最小構成と設定の読みやすさを優先するなら `esbuild`
- 開発体験、entry 管理、将来の拡張余地を少し広めに取りたいなら `Vite`

bundler 決定後は、少なくとも次を実装に合わせて更新する。

- `package.json`
- `tsconfig.json`
- `manifest.json`
- build script 名
- watch script 名
- output directory 名
- 必要なら `docs/implementation-workflow.md` 内の Phase 0 記述

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
 * playback session 単位で生成・破棄される前提で使う。
 */
```

### JSDoc

関数には、export の有無、同期・非同期、function 宣言・arrow function の別にかかわらず、JSDoc を付ける。
対象は、module 内部だけで使う関数、class の method、callback として渡す名前付き関数を含む。
export する型とクラスにも JSDoc を付ける。内部の型は、意味が名前から自明でない場合に付ける。

JSDoc は、読み手が本体を読まずに呼び方と結果を理解するための契約を示す。
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
 * @param disposeFns 合成する cleanup。undefined は無視する。
 * @returns すべての cleanup を登録の逆順で 1 回だけ実行する disposer。
 */
export function combineDisposers(
  ...disposeFns: Array<DisposeFn | undefined>
): DisposeFn {
  // ...
}

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

- `chrome.storage.sync` の読込・保存 API を実装する
- `primaryLang` 必須、`secondaryLang` 任意、同値禁止の前提を吸収する
- `secondaryLang` 未選択時の fallback 実装は settings store に寄せすぎず、設定値正規化の範囲に留める
- `extension enabled state` と `panel open state` は保存対象に含めない

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
- 初期値は `extensionEnabled = false`、`panelOpen = false` とする
- 保存設定を持ち込まず、runtime UI state だけを扱う

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

- 初期値が `extensionEnabled = false`、`panelOpen = false` であることを確認する
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

- session の start / stop / dispose の骨格を作る
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
- `RestartReason` の型を導入し、再初期化理由を後続フェーズでも共有できるようにする
- session stop 時に登録済み disposer を一度だけ実行する土台を作る

##### `src/content/index.ts`

- settings 読込、playback root 解決、session lifecycle 起動、top-level error handling だけを担当する
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
- 採用結果と cue 件数をログで観測する
- lifecycle が保持・実行する Disposable を返す
- 初期化途中の失敗でも、作成済み資源の cleanup を試す
- source の内部処理や listener の直接解除を重複実装しない

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
7. entry 固有の回帰確認と Apple TV+ 実機確認を行う
8. 検証用フラグを戻し、結果と未確認事項を記録する

### テストファイルの分割

- source の基本動作、snapshot のコピー保護、エラー境界を別ファイルに分ける
- fake track、fixture、logger は source テスト専用 helper で共有する
- helper はテストや hook を登録しない
- lifecycle のテストは、readiness と字幕接続の生成・破棄の委譲に集中する
- 実際の resolver / source の接続は subtitle-session のテストで確認する
- 分割時は既存テストの移動先を確認し、件数だけで確認内容の維持を判断しない
- 必要な JSDoc や cleanup の説明を削って、行数を減らさない

### 実機確認用フラグ

正式な ON/OFF UI の接続前は、
index の DEBUG_PHASE4_SUBTITLES を開発用の起動手段として使う。

- 既定値は false とし、通常起動は OFF / closed を維持する
- true はローカルの実機確認時にだけ使う
- true でも保存設定が ready でなければ字幕接続を開始しない
- フラグを storage に保存しない
- 正式な ON/OFF toggle の実装・検証完了とは扱わない
- 実機確認後は false に戻し、再 build と通常起動の確認を行う

build、拡張再読み込み、ページ再読み込みの具体的手順は、
testing-checklist の Phase 4 を参照する。

### 今回の最小接続に含めないもの

- SubtitleBlock[] と history
- panel、layout、正式な ON/OFF UI
- native menu 操作後の自動同期
- readiness 成立後の track 追加に対する自動再解決
- popup 保存後の設定自動再読込

対象外の機能は未対応として記録し、仕様上の要件を取り消さない。
設定を変えた実機確認では、保存後にページを再読み込みしてから観測する。

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
- 自動テスト成功、コード上の確認、実機確認を区別して記録する
- 未観測・未対応・失敗を残したまま、Phase 全体の完了を断定しない

### 検証タイミング

- module 実装・分割後に typecheck、lint、関連テスト
- entry 接続後に typecheck、lint、全テスト、build
- entry の起動条件、同一 target 再評価、pagehide cleanup を回帰確認する
- Apple TV+ で track 採用、bind、cue 取得、停止時解除を確認する
- 検証用フラグを false に戻した状態も確認する

module テストの成功だけで、entry の分岐や実機動作を確認済みと扱わない。
実行結果と未確認事項は testing-checklist に記録する。

## Phase 5: `SubtitleBlock[]` と current / past / future 導出

### 目的

- panel 実装前に truth を完成させる
- source と renderer の間に、安定した字幕データ層を置く

### 触るファイル

- `src/subtitles/subtitle-block-builder.ts`
- `src/subtitles/subtitle-history.ts`
- `src/shared/types.ts`
- `src/subtitles/subtitle-source.ts`
- 必要なら `src/shared/log.ts`

### ファイル単位の作業内容

#### `src/subtitles/subtitle-block-builder.ts`

- cue / track 情報から `SubtitleBlock[]` を構築する
- primary / secondary を時刻単位で対応づける
- UI 向けの見た目都合ではなく、truth を返すことに集中する
- block の id、time range、text の欠損時ルールをここで整理する

#### `src/subtitles/subtitle-history.ts`

- `SubtitleBlock[]` と current time から `SubtitleHistoryView` を返す
- current / previous / next の切り出しロジックを pure に保つ
- renderer が source に触れなくても済む境界を作る

### 完了条件

- `SubtitleBlock[]` を生成できる
- current / past / future を純関数ベースで導出できる
- panel 未実装でも history をログで確認できる
- truth 層が `TextTrack` 直読みなしで扱える

### 検証タイミング

- 実装直後に typecheck、lint
- `subtitle-block-builder.ts` と `subtitle-history.ts` の unit test を追加
- 時刻ずれ、secondary 欠損、track 切替前後の最低限ケースを test する
- panel 実装へ入る前に、実機で block が組めているかをログで確認する

## Phase 6: panel host と panel renderer

### 目的

- truth を右側 panel へ表示する最小描画経路を作る
- DOM 所有と描画責務を分ける

### 触るファイル

- `src/panel/panel-host.ts`
- `src/panel/panel-renderer.ts`
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

### 完了条件

- panel host が mount / unmount できる
- `SubtitleHistoryView` を panel に表示できる
- renderer が source を直接読んでいない
- session stop で panel DOM を確実に外せる

### 検証タイミング

- 実装直後に typecheck、lint
- renderer の pure な整形部があれば unit test を追加
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

#### `src/content/session-lifecycle.ts`

- `extensionEnabled = false` のときに監視・描画・字幕処理を止める
- `panelOpen = false` のときに panel 表示と layout 適用を止める
- ON/OFF toggle と開閉ボタンの役割差を崩さない接続にする

### 完了条件

- ON/OFF toggle で拡張全体の有効 / 無効を切り替えられる
- 開閉ボタンで panel 表示だけを切り替えられる
- panel を開くと 7:3 layout が適用される
- resize 時に layout が再計算される
- UI state と layout state が分離されている

### 検証タイミング

- 実装直後に typecheck、lint
- `ui-state.ts` と `player-layout.ts` の test を追加または更新
- Apple TV+ 実画面で次だけ手動確認する
  - ON/OFF toggle の有効 / 無効
  - panel 開閉
  - 7:3 layout
  - 横幅変化時の再計算
  - controls 表示時の崩れ有無

## Phase 8: restart / cleanup / SPA 遷移対応

### 目的

- session 単位の start / stop / dispose を実運用レベルに固める
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
- 次の `RestartReason` を扱う

```ts
export type RestartReason =
  | 'video-disconnected'
  | 'video-replaced'
  | 'playback-root-disconnected'
  | 'spa-target-changed';
```

- restart 手順を固定する

1. restart request を `session-lifecycle.ts` に集約する
2. 旧 session が持つ disposer を一度だけ実行する
3. track binding、cue listener、native menu binding、panel host、layout observer、controls binding、timer、observer を解除する
4. 古い target / video / track 参照を破棄する
5. 新しい root / video を解決する
6. 新 video の `textTracks.length > 0` を待つ
7. 新 session を開始する

- video replacement 時は、旧 session をdisposeしてから新 video の readiness を待つ
- seek は restart 契機にしない

#### 関連 module

- `subtitle-source.ts` で track binding と cue listener を解除する
- `native-menu-sync.ts` で native menu binding を解除する
- `panel-host.ts` で panel DOM を unmount する
- `player-layout.ts` で layout observer を解除する
- `on-off-toggle.ts` と `panel-open-close-button.ts` で controls binding を解除する
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
- 実機依存部分を最小の固定手順で回せるようにする

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

## フェーズごとの検証ルール

各フェーズの終わりで、少なくとも次を実行する。

1. build
2. typecheck
3. lint
4. 追加した pure function / small integration の test
5. 必要な範囲だけ手動確認

運用上の目安:

- Phase 0〜5 は自動テスト比重を高くする
- Phase 6〜9 は手動確認が増えるが、先に自動テストを通してから実機確認へ進む
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
