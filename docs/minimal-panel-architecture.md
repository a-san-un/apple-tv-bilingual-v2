# Minimal Panel Architecture

この文書は、Apple TV+ 向け二言語字幕 Chrome 拡張 v2 の最小構成アーキテクチャを定義する。

本書は `docs/minimal-panel-architecture.md` 単体で読めることを前提とし、次の内容だけを扱う。

- モジュール構成
- 各ファイルの責務
- 依存方向
- データフロー
- `SubtitleBlock[]` を中心にした truth の扱い
- playback session の開始・停止・cleanup
- session restart と cleanup
- 右側字幕 panel の設計
- ON/OFF toggle と panel 開閉ボタンの責務分離
- 保存設定と runtime state の境界
- module 間の API 境界
- `src/shared/types.ts` の共通型
- `src/shared/dispose.ts` の cleanup helper
- `content/index.ts` を thin coordinator に保つための禁止事項
- 今後の機能追加で守る拡張原則

この文書では、要件そのもの、popup の詳細仕様、Apple TV+ DOM の観測ログ、selector 一覧、track 数、native menu の切替時系列、詳細なテスト項目は扱わない。

---

## 1. 目的

Apple TV+ の再生画面で使う二言語字幕 Chrome 拡張 v2 を、TypeScript で最小構成から作る。

最初の中心 UI は右側字幕 panel とし、字幕取得から表示までの責務を段階的に分離する。  
再生対象の切替、SPA 遷移、停止、再初期化のたびに安全に cleanup できる構成を優先する。

architecture は、責務境界、依存方向、データフロー、playback session lifecycle、cleanup owner の唯一の正本とする。

---

## 2. 用語

この文書では、次の用語を固定して使う。

| 用語 | 意味 |
| --- | --- |
| `primaryLang` | 学習言語の設定値 |
| `secondaryLang` | 母国語の設定値 |
| primary subtitle | 学習言語として表示する字幕 |
| secondary subtitle | 母国語として表示する字幕 |
| subtitle track | `TextTrack` を正規化した字幕 track 情報 |
| subtitle source | 字幕取得と track binding をまとめる窓口 |
| truth | UI の正本となる内部データ |
| `SubtitleBlock` | 時刻、primary 字幕、secondary 字幕を持つ字幕表示単位 |
| `SubtitleBlock[]` | 字幕 truth の正本となる block 配列 |
| current / past / future | 現在、過去、未来として panel に表示する字幕区分 |
| panel | 右側字幕 panel |
| panel host | panel を mount するために拡張が所有する DOM 要素 |
| ON/OFF toggle | 再生画面下部に置く、拡張機能全体の ON/OFF 制御 |
| extension enabled state | ON/OFF toggle により切り替わる拡張機能全体の有効状態 |
| panel open state | panel 開閉ボタン（以下、開閉ボタン）により切り替わる、panel の表示状態。ON/OFF toggle とは別物 |
| UI state | `extensionEnabled` と `panelOpen` を持つ runtime 上の UI 意思 |
| layout state | panel 表示に必要な幅、適用済み style、layout observer / timer を管理する runtime 上の幾何状態 |
| 7:3 layout | panel を開いたときに、既存 UI を含む再生画面領域 70%、panel 30% に分ける方針 |
| playback session | 現在の Apple TV+ 再生対象に対して拡張機能が動く1回分の実行単位 |
| runtime state | 現在の再生中だけメモリ上に持つ一時状態 |
| 保存設定 | 再起動後も利用する設定値 |
| owner | resource を生成、登録、解放する責任を唯一持つ module |
| cleanup | listener、timer、observer、binding、DOM、state、参照を解放する処理 |
| small store | 最小限の `getState()` / `setState 系` / `subscribe()` を持つ軽量 state 管理 |
| subtitle readiness | 字幕処理を開始してよいかを判定する状態 |
| restart reason | session を再初期化する理由 |
| discovery module | resource を所有せず、対象を見つけて返すだけの module |
| view helper | truth から renderer 向けの読み取り結果を導出する純粋な helper |
| available width | 既存 UI を含む再生画面領域と panel の再配置に使う利用可能な横幅 |
| waiting state | `textTracks` の準備待ちとして `session-lifecycle.ts` が一時的に持つ状態 |

---

## 3. この文書の範囲

この文書が扱うのは次の内容だけとする。

- module 構成
- module ごとの責務境界
- truth の流れ
- session と cleanup
- session restart と readiness 待機
- panel / toggle / panel 開閉ボタン / layout / state の関係
- module 間 API の境界
- thin coordinator を壊さないためのルール
- 新規 module と新機能の配置原則

次の内容は扱わない。

- popup UI の詳細仕様
- 保存設定の細かな validation 文言
- Apple TV+ DOM の selector 一覧や観測ログ
- track 数の詳細ログ
- native menu の切替時系列
- 実装フェーズ順の詳細
- 詳細テスト項目
- seek 後 recovery の細部アルゴリズム

### 正本への委譲

この文書は architecture の正本であり、責務境界、依存方向、データフロー、session lifecycle、cleanup owner を定義する。

次の詳細は、この文書で再定義せず担当文書へ委譲する。

| 内容 | 正本 |
| --- | --- |
| 保存設定、popup、候補言語、fallback、validation | `docs/settings-spec.md` |
| 実装フェーズ、ファイル単位の作業順、検証タイミング | `docs/implementation-workflow.md` |
| Apple TV+ 固有の DOM、selector、video / `textTracks` の観測、native menu の実装判断 | `docs/apple-tv-dom-structure.md` |
| 実機で得た DOM 詳細ログ、時系列、未確認事項 | `docs/apple-tv-dom-observations.md` |
| テスト観点、自動テスト、手動確認、回帰確認 | `docs/testing-checklist.md` |
| プロダクト要件、対象ユーザー、機能範囲、MVP 完了条件 | `docs/product-requirements.md` |

新しい実装判断では、まずこの文書で module の置き場、依存方向、owner、cleanup を決める。  
DOM 固有の根拠が必要な場合だけ `docs/apple-tv-dom-structure.md` を参照し、実装順や検証手順は `docs/implementation-workflow.md` と `docs/testing-checklist.md` で決める。

---

## 4. 設計原則

v2 の設計原則は次の通りとする。

- `src/content/index.ts` は起動入口と配線だけを担う thin coordinator とする
- 字幕取得、track 解決、truth 構築、panel 描画、session cleanup は分離する
- truth は `SubtitleBlock[]` を中心に扱う
- renderer は source を直接読まない
- source は panel DOM を直接扱わない
- listener / timer / observer / binding / DOM の owner は1つに限定する
- cleanup を先に設計し、各 owner が自分で生成・登録した resource を解放する
- Apple TV+ 固有の処理は専用 module に閉じ込める
- `playback-root.ts` は discovery module とし、session resource を所有しない
- `session-lifecycle.ts` は session 全体の開始・停止・dispose と restart を所有する
- ON/OFF toggle は拡張全体の有効 / 無効だけを扱う
- panel 開閉ボタンは panel open state だけを扱う
- `ui-state.ts` は small store とする
- 保存設定と runtime state は混ぜない
- subtitle truth、UI state、layout state は別物として扱う
- `ui-state.ts` は `extensionEnabled` と `panelOpen` だけを扱い、寸法、style、observer、layout timer を持たない
- `player-layout.ts` は `PlayerLayoutState`、layout style、layout observer、layout timer だけを扱い、字幕 truth と ON/OFF 操作の意味づけを持たない
- ON/OFF toggle は `extensionEnabled` の更新だけを要求する
- panel 開閉ボタンは `panelOpen` の更新だけを要求する
- 既存版の複雑な分岐や暫定回避策は、そのまま持ち込まない

---

## 5. 構成図

```txt
src/
├─ content/
│  ├─ index.ts
│  │  └─ 起動入口。settings 読込、target 解決要求、session 開始停止、module 配線だけを行う
│  ├─ playback-root.ts
│  │  └─ Apple TV+ 再生対象の discovery。root、video、panel mount target、layout target を解決する
│  └─ session-lifecycle.ts
│     └─ playback session の start / stop / dispose、subtitle readiness 待機、retry、restart request 集約を所有する
│
├─ subtitles/
│  ├─ subtitle-source.ts
│  │  └─ 字幕取得と track binding の統一窓口
│  ├─ text-track-resolver.ts
│  │  └─ TextTrack を正規化し、primary / secondary 採用判定を行う
│  ├─ native-menu-sync.ts
│  │  └─ Apple TV+ ネイティブ字幕メニュー listener の attach / detach を扱う
│  ├─ subtitle-block-builder.ts
│  │  └─ primary / secondary cue から `SubtitleBlock[]` を構築する
│  └─ subtitle-history.ts
│     └─ `SubtitleBlock[]` から current / past / future を導出する view helper
│
├─ panel/
│  ├─ panel-host.ts
│  │  └─ panel host DOM の生成、mount、unmount を担当する
│  └─ panel-renderer.ts
│     └─ subtitle history と UI state を受けて panel を描画する
│
├─ controls/
│  ├─ on-off-toggle.ts
│  │  └─ 拡張全体の enabled state を切り替える下部 toggle を扱う
│  └─ panel-toggle-button.ts
│     └─ panel open state を切り替える開閉ボタンを扱う
│
├─ layout/
│  └─ player-layout.ts
│     └─ 再生画面領域と panel の 7:3 layout、layout state、observer、timer の適用・解除を担当する
│
├─ ui/
│  └─ ui-state.ts
│     └─ extension enabled / panel open を持つ small store
│
├─ settings/
│  └─ settings-store.ts
│     └─ `primaryLang` / `secondaryLang` の読込・保存を行う
│
└─ shared/
   ├─ types.ts
   │  └─ 複数 module で共有する最小限の型を定義する
   ├─ dispose.ts
   │  └─ disposer の合成、逆順 cleanup、二重 dispose 防止を提供する
   ├─ dom.ts
   │  └─ Apple TV+ 固有ではない DOM utility を提供する
   └─ log.ts
      └─ ログ出力を提供する
```

---

## 6. 各ファイルの責務

### `src/content/index.ts`

責務は次に限定する。

- 初期起動
- 保存設定の読込
- playback target 解決の開始
- playback session の開始・停止の委譲
- module の接続
- top-level error handling

ここでは字幕判定、cue 対応付け、panel DOM 更新、readiness 待機、retry / polling、restart request の収束を実装しない。

### `src/content/playback-root.ts`

Apple TV+ 固有の再生対象を解決する discovery module とする。

責務は次に限定する。

- playback root の解決
- 現在の `HTMLVideoElement` の解決
- panel mount target の解決
- layout 基準領域の解決

次の責務は持たせない。

- `textTracks` readiness の待機
- retry / polling
- restart request の収束
- 旧 session の stop / dispose
- video replacement 後の再初期化判断

この module は session resource を所有しない。  
Apple TV+ 固有 selector の採用判断そのものは `docs/apple-tv-dom-structure.md` を正本とし、この文書では責務境界だけを固定する。

### `src/content/session-lifecycle.ts`

playback session の唯一の owner とする。

責務は次の通りとする。

- playback session の start / stop / dispose
- subtitle readiness 待機
- readiness 待機中の retry / polling
- restart request の収束
- old session dispose と new session start の順序制御
- session owner module が返す `dispose()` の合成
- restart reason ごとの再初期化判断
- session 単位の runtime state の破棄

`playback-root.ts` が返した target と video を受け取り、同じ video に対する readiness 待機を維持する。  
readiness 待機中に video identity が変わった場合は、古い待機を dispose し、新しい video に対して待機を最初からやり直す。

### `src/subtitles/subtitle-source.ts`

字幕取得の統一窓口とする。

- `video.textTracks` への接続
- 採用 track との bind / unbind
- primary / secondary の track binding 所有
- cue listener の attach / detach
- source snapshot の提供

subtitle binding を所有するが、panel DOM は触らない。

### `src/subtitles/text-track-resolver.ts`

字幕 track の正規化と採用判定を担当する。

- `TextTrack` の正規化
- `primaryLang` / `secondaryLang` に基づく候補選定
- primary / secondary の採用判定
- fallback 判定
- 同一言語禁止の吸収

readiness 待機や retry は持たない。  
DOM や panel も触らず、ロジック境界に留める。

### `src/subtitles/native-menu-sync.ts`

Apple TV+ ネイティブ字幕メニューとの同期を隔離する。

- native menu listener の attach / detach
- session 中に必要な menu binding の提供
- module 自身が登録した listener の cleanup

native menu listener の owner はこの module だけとする。

### `src/subtitles/subtitle-block-builder.ts`

truth の正本を構築する。

- primary cue 群と secondary cue 群から `SubtitleBlock[]` を構築する
- block の時刻範囲と表示文字列を確定する
- UI に必要な最小単位へ正規化する

この module の出力が panel 表示に対する唯一の truth である。

### `src/subtitles/subtitle-history.ts`

truth から表示用データを導出する view helper とする。

- current block の決定
- past / future の導出
- panel 表示用の history snapshot 作成

truth 自体は変更せず、読み取り専用の導出に徹する。

### `src/panel/panel-host.ts`

panel DOM の土台だけを所有する。

- host 要素の生成
- mount
- unmount
- 参照破棄

panel host の mount / unmount の owner はこの module だけとする。

### `src/panel/panel-renderer.ts`

panel の描画だけを扱う。

- subtitle history の描画
- panel open state に応じた表示切替
- empty / unavailable 状態の表示
- 必要最小限の DOM 更新

renderer は source、raw cue、`TextTrack` を直接読まない。  
Apple TV+ 固有 selector や session cleanup 本体も持たない。

### `src/controls/on-off-toggle.ts`

拡張全体の ON/OFF 制御専用とする。

- toggle の mount / unmount
- enabled state の表示反映
- controls binding の attach / detach
- ユーザー操作時に `extensionEnabled` の更新を要求する

panel open state を直接変更しない。  
session の stop / restart、panel の mount / unmount、layout の reset も直接実装しない。

### `src/controls/panel-toggle-button.ts`

panel 開閉制御専用とする。

- 開閉ボタンの mount / unmount
- controls binding の attach / detach
- panel open state の表示反映
- ユーザー操作時に `panelOpen` の更新を要求する

extension enabled state を直接変更しない。  
layout の計算、style 適用、observer / timer の管理も直接実装しない。

### `src/layout/player-layout.ts`

7:3 layout の唯一の owner とする。

- 利用可能横幅の計算
- 70% / 30% 配分の算出
- panel open 時の layout 適用
- close / stop 時の layout 復元
- `PlayerLayoutState` の保持
- layout observer の attach / detach
- layout timer の attach / detach
- layout style の適用・解除

字幕内容、字幕 truth、source、ON/OFF toggle の意味づけには依存しない。  
`panelOpen` は layout 適用の入力として受け取るが、`panelOpen` 自体を更新しない。

### `src/ui/ui-state.ts`

small store として次を提供する。

- `getState()`
- `setExtensionEnabled(enabled)`
- `setPanelOpen(open)`
- `subscribe(listener)`

state は最小限に留める。

```ts
type ExtensionUiState = {
  extensionEnabled: boolean;
  panelOpen: boolean;
};
```

`ui-state.ts` は字幕 truth、寸法、style、layout observer、layout timer、track、video を持たない。

### `src/settings/settings-store.ts`

保存設定の読み書きだけを担当する。

- `primaryLang` の読込・保存
- `secondaryLang` の読込・保存
- 最低限の validation
- `chrome.storage.sync` との入出力

popup、候補言語、fallback、validation の詳細仕様は `docs/settings-spec.md` を正本とする。  
runtime state、readiness、session restart は扱わない。

### `src/shared/types.ts`

module 境界で共有する型を定義する。

この文書で最低限固定する型は次の通りとする。

- `StoredSettings`
- `ResolvedSubtitleTrack`
- `ResolvedTrackPair`
- `SubtitleCueSnapshot`
- `SubtitleBlock`
- `SubtitleHistorySnapshot`
- `PlaybackTarget`
- `PlaybackSessionState`
- `ExtensionUiState`
- `PlayerLayoutState`
- `RestartReason`
- `DisposeFn`
- `Disposable`

### `src/shared/dispose.ts`

cleanup helper をまとめる。

- disposer 登録
- reverse-order dispose
- 二重 dispose 防止
- no-op 安全化
- 複数 module の `dispose()` を1つへ合成する helper の提供

個別 resource の解放処理は各 module 側に置き、ここは compose 用の基盤だけを提供する。

---

## 7. owner の原則

resource owner は必ず1つに限定する。

- listener / timer / observer / track binding / extension DOM は owner を1つに限定する
- `session-lifecycle.ts` は session 全体の停止を所有する
- 個別 module は自分が生成・登録した resource の `dispose()` を返す
- `playback-root.ts` は discovery module であり、session resource を所有しない
- `subtitle-source.ts` は subtitle binding を所有するが、panel DOM は触らない
- `panel-host.ts` は panel host の mount / unmount を所有する
- `native-menu-sync.ts` は native menu listener の attach / detach を所有する
- `player-layout.ts` は layout state、layout style、observer、layout timer の適用・解除を所有する
- `on-off-toggle.ts` は ON/OFF toggle の DOM と controls binding を所有する
- `panel-toggle-button.ts` は panel 開閉ボタンの DOM と controls binding を所有する
- `ui-state.ts` は UI state とその購読機構を所有する

`session-lifecycle.ts` は個別 resource を直接解除しない。  
各 module が返した `dispose()` を合成して、session 単位で一度だけ呼ぶ。

---

## 8. 依存方向

依存方向は一方向に限定する。

```txt
content/index.ts
  ↓
content/playback-root.ts
content/session-lifecycle.ts
  ↓
settings-store.ts
ui-state.ts
subtitle-source.ts
text-track-resolver.ts
native-menu-sync.ts
subtitle-block-builder.ts
subtitle-history.ts
panel-host.ts
panel-renderer.ts
on-off-toggle.ts
panel-toggle-button.ts
player-layout.ts
shared/*
```

依存ルールは次の通りとする。

- `panel-renderer.ts` は `subtitle-source.ts` に依存しない
- `subtitle-source.ts` は `panel-host.ts` や `panel-renderer.ts` に依存しない
- `subtitle-block-builder.ts` は DOM を触らない
- `subtitle-history.ts` は truth を変更しない
- `player-layout.ts` は字幕データを知らない
- `ui-state.ts` は Chrome Storage、video、track、layout style を触らない
- `settings-store.ts` は session 内 DOM を触らない
- `playback-root.ts` は discovery 結果を返すだけで、readiness 待機や restart を持たない
- `session-lifecycle.ts` は session owner として各 module の `dispose()` を束ねる

---

## 9. データフロー

v2 では `SubtitleBlock[]` を UI の正本とする。  
raw cue、`TextTrack`、DOM 表示状態は truth ではない。

データフローは次の一本に固定する。

```txt
settings-store
  ↓
text-track-resolver
  ↓
subtitle-source
  ↓
subtitle-block-builder
  ↓
SubtitleBlock[]
  ↓
subtitle-history
  ↓
panel-renderer
```

実行順は次の通りとする。

1. `settings-store.ts` が `primaryLang` / `secondaryLang` を返す
2. `playback-root.ts` が現在の playback target を返す
3. `session-lifecycle.ts` が対象 video の subtitle readiness を待機する
4. readiness 成立後、`text-track-resolver.ts` が `video.textTracks` から primary / secondary 候補を決める
5. `subtitle-source.ts` が採用 track に bind する
6. `subtitle-source.ts` が cue snapshot を出す
7. `subtitle-block-builder.ts` が `SubtitleBlock[]` を構築する
8. `subtitle-history.ts` が current / past / future を導出する
9. `panel-renderer.ts` が panel を更新する

renderer が source を直接読まず、source が panel DOM を直接触らない構成を固定する。

---

## 10. 字幕 readiness

新しい video が見つかった直後は `video.textTracks.length === 0` であり得る。  
その後に段階的に track が増えるため、video 発見だけで subtitle session を開始しない。

最小の字幕 readiness 判定は次で固定する。

```ts
const isSubtitleReady = (video: HTMLVideoElement): boolean =>
  video.textTracks.length > 0;
```

`textTracks.length === 0` は session 失敗ではない。  
`session-lifecycle.ts` は待機状態を維持し、同じ video を再確認する。

readiness 待機中に video identity が変わった場合は、古い待機を dispose し、新しい video に対して readiness 待機を最初からやり直す。

この readiness 待機の責務は `playback-root.ts` ではなく `session-lifecycle.ts` が持つ。

---

## 11. `SubtitleBlock[]` と truth

`SubtitleBlock[]` は panel 表示の truth の正本である。

期待する役割は次の通りとする。

- primary / secondary の対応済み表示単位を持つ
- 時刻ベースで current block を決定できる
- panel 表示に必要な最小情報だけを持つ
- source 側の揺れを UI に直接漏らさない

型の方向性は次のようにする。

```ts
type SubtitleBlock = {
  id: string;
  startTime: number;
  endTime: number;
  primaryText: string;
  secondaryText: string | null;
};
```

補足ルール:

- cue オブジェクトそのものは renderer に渡さない
- `TextTrack` 参照は renderer に渡さない
- 表示順と表示内容は block builder 側で確定する
- current / past / future は `SubtitleBlock[]` から導出する読み取り結果であり、別の truth を増やさない

---

## 12. playback session の start / stop / dispose

playback session は、現在の Apple TV+ 再生対象に対して拡張機能が動く1回分の実行単位である。

session は少なくとも次を所有する。

- 現在の playback target
- 現在の `video`
- subtitle readiness 待機
- subtitle source
- track binding
- cue listener
- native menu binding
- panel host
- controls binding
- layout observer
- session timer
- session が所有する `MutationObserver` / `ResizeObserver`
- `ui-state.ts` の small store
- `player-layout.ts` が持つ layout state
- cleanup disposer

### start の流れ

```txt
index.ts
  ↓
playback-root.ts で playback target を解決
  ↓
session-lifecycle.ts が session を生成
  ↓
ui-state.ts を作成
  ↓
on-off-toggle.ts / panel-toggle-button.ts を mount
  ↓
panel-host.ts を mount
  ↓
player-layout.ts を初期化
  ↓
session-lifecycle.ts が subtitle readiness を待機
  ↓
text-track-resolver.ts で track 候補を解決
  ↓
subtitle-source.ts を bind
  ↓
native-menu-sync.ts を attach
  ↓
subtitle-block-builder.ts で SubtitleBlock[] を構築
  ↓
subtitle-history.ts で current / past / future を導出
  ↓
panel-renderer.ts を初回描画
```

### stop の原則

停止時は `session-lifecycle.ts` が各 owner module の `dispose()` を逆順で集約する。  
個別 resource の解放処理は module 側に閉じ込め、`session-lifecycle.ts` はそれらを合成して呼ぶだけにする。

### dispose の原則

- 同じ resource を複数 module が解放しない
- `dispose()` は複数回呼ばれても安全である
- stop 済み session に update を流さない
- playback 対象切替時は「旧 session dispose → 新 session start」の順序を崩さない
- session が停止したら、session 内の subtitle truth、history snapshot、target / video / track 参照、UI state 購読を解放する
- layout の style、observer、timer、計算済み state は `player-layout.ts` が解除する

---

## 13. session restart と cleanup

session 再初期化の理由は、少なくとも次を型として固定する。

```ts
export type RestartReason =
  | 'video-disconnected'
  | 'video-replaced'
  | 'playback-root-disconnected'
  | 'spa-target-changed';
```

`seek` は restart reason に含めない。  
seek 後は同じ video、同じ track binding、同じ session を維持し、`cuechange` による字幕更新の再開を待つ。

restart 時は、新 session を開始する前に旧 session が所有する resource を一度だけ dispose する。

停止対象は次とする。

- primary / secondary の track binding
- cue listener
- native menu binding
- panel host
- layout observer
- controls binding
- session が所有する timer
- session が所有する `MutationObserver` / `ResizeObserver`
- session 内で保持した subtitle truth と history snapshot
- session 内で保持した target、video、track への参照
- `ui-state.ts` の購読

restart の流れは次の通りとする。

```txt
restart request 発生
  ↓
RestartReason を確定
  ↓
session-lifecycle.ts が旧 session の dispose 合成関数を一度だけ呼ぶ
  ↓
旧 session の参照を破棄
  ↓
playback-root.ts で現在 target を再解決
  ↓
新 session を start
```

restart request の収束は `session-lifecycle.ts` が所有する。  
複数 module が個別に restart を発火して stop / start を始めない。

---

## 14. panel 設計

panel は右側字幕表示専用の UI とし、v2 の中心体験を担う。

設計方針は次の通りとする。

- panel の DOM 土台は `panel-host.ts` が所有する
- 表示内容の描画は `panel-renderer.ts` が所有する
- panel の開閉状態は `ui-state.ts` が持つ
- panel の幅配分と layout state は `player-layout.ts` が持つ
- panel 内で source 取得や track 解決は行わない

panel が扱う表示内容は少なくとも次を想定する。

- current
- past
- future
- secondary unavailable などの補助表示
- extension OFF 時または panel close 時の非表示状態

panel は truth の読み取り結果を表示するだけであり、source 制御の入口にしない。

---

## 15. ON/OFF toggle と panel 開閉ボタン

この2つは責務を明確に分離する。

### ON/OFF toggle

対象は **拡張全体の enabled / disabled** だけとする。

- OFF にすると、拡張由来の監視・字幕処理・panel 表示・layout 適用を止める
- ON にすると、必要なら session 内処理を再始動する
- panel open state の意味づけは持たない
- `extensionEnabled` の更新を要求するだけであり、session 停止処理を直接実装しない

### panel 開閉ボタン

対象は **panel open state** だけとする。

- panel を開く
- panel を閉じる
- 7:3 layout の適用 / 解除の入力となる
- extension enabled state は切り替えない
- `panelOpen` の更新を要求するだけであり、layout 計算や style 適用を直接実装しない

### 分離ルール

- ON/OFF toggle から `setPanelOpen()` を直接呼ばない
- panel 開閉ボタンから `setExtensionEnabled()` を直接呼ばない
- 両者の協調は `session-lifecycle.ts` または `ui-state.ts` の購読側で扱う
- OFF 中に panel を非表示にする場合も、それは session 側の反応として扱う
- `ui-state.ts` が UI 意思を保持し、`player-layout.ts` が画面幾何を適用する

---

## 16. 保存設定と runtime state

保存設定と runtime state は明確に分ける。

### 保存設定

Chrome Storage に保存する。

- `primaryLang`
- `secondaryLang`

これらは `settings-store.ts` が唯一扱う。

初期版では次を保存しない。

- extension enabled state
- panel open state

保存設定の候補、fallback、validation、popup での選択操作は `docs/settings-spec.md` を正本とする。

### runtime state

現在の再生中だけメモリ上に持つ。

- 現在の playback target
- 現在の `video`
- 現在採用されている primary / secondary track
- 現在の `SubtitleBlock[]`
- current / past / future の計算結果
- panel open state
- extension enabled state
- readiness 待機状態
- listener / timer / observer / binding の参照
- layout 計算結果
- 現在の playback session 参照

初期版は毎回、次の state で始める。

- `extensionEnabled = false`
- `panelOpen = false`

### UI state と layout state

runtime state のうち、字幕 truth、UI state、layout state は同じ store や同じ責務に混ぜない。

| 区分 | 正本 | 保持するもの | 持たないもの |
| --- | --- | --- | --- |
| subtitle truth | `SubtitleBlock[]` | primary / secondary 字幕、時刻範囲、表示単位 | panel DOM、layout style、toggle state |
| UI state | `ui-state.ts` | `extensionEnabled`、`panelOpen` | 幅、座標、style、observer、timer、字幕 block |
| layout state | `player-layout.ts` | `PlayerLayoutState`、計算済み寸法、適用済み style、layout observer / timer | `extensionEnabled` の意味、`panelOpen` の更新、字幕 truth |

`panelOpen` は layout を適用するための入力である。  
ただし、layout の計算・style 適用・observer 管理・timer 管理は `player-layout.ts` だけが行う。

`extensionEnabled` は session を有効化または停止するための入力である。  
ただし、ON/OFF toggle 自身は session の stop / restart、panel の mount / unmount、layout の reset を直接実装しない。

---

## 17. module 間の API 境界

初期版の API は必要以上に抽象化しない。  
ただし、DOM・track・truth・UI state・layout state・cleanup の境界は崩さない。

### `settings-store.ts`

```ts
type StoredSettings = {
  primaryLang: string;
  secondaryLang: string;
};

async function loadSettings(): Promise<StoredSettings>;
async function saveSettings(next: StoredSettings): Promise<void>;
```

### `playback-root.ts`

```ts
type PlaybackTarget = {
  rootEl: HTMLElement;
  videoEl: HTMLVideoElement;
  panelMountEl: HTMLElement;
  layoutTargetEl: HTMLElement;
};

function resolvePlaybackTarget(): PlaybackTarget | null;
```

### `ui-state.ts`

```ts
type ExtensionUiState = {
  extensionEnabled: boolean;
  panelOpen: boolean;
};

type UiStateListener = (state: ExtensionUiState) => void;

function createUiStateStore(initialState?: Partial<ExtensionUiState>): {
  getState(): ExtensionUiState;
  setExtensionEnabled(enabled: boolean): void;
  setPanelOpen(open: boolean): void;
  subscribe(listener: UiStateListener): () => void;
};
```

### `text-track-resolver.ts`

```ts
type ResolvedSubtitleTrack = {
  id: string;
  lang: string;
  label: string;
  kind: string;
  track: TextTrack;
};

type ResolvedTrackPair = {
  primary: ResolvedSubtitleTrack | null;
  secondary: ResolvedSubtitleTrack | null;
};

function resolveSubtitleTracks(args: {
  textTracks: TextTrackList;
  primaryLang: string;
  secondaryLang: string;
}): ResolvedTrackPair;
```

### `subtitle-source.ts`

```ts
type SubtitleCueSnapshot = {
  primaryCues: TextTrackCue[];
  secondaryCues: TextTrackCue[];
};

type SubtitleSource = {
  bind(pair: ResolvedTrackPair): void;
  unbind(): void;
  getSnapshot(): SubtitleCueSnapshot;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};

function createSubtitleSource(videoEl: HTMLVideoElement): SubtitleSource;
```

### `native-menu-sync.ts`

```ts
type NativeMenuSync = {
  dispose(): void;
};

function attachNativeMenuSync(args: {
  rootEl: HTMLElement;
  onMenuChanged: () => void;
}): NativeMenuSync;
```

### `subtitle-block-builder.ts`

```ts
function buildSubtitleBlocks(snapshot: SubtitleCueSnapshot): SubtitleBlock[];
```

### `subtitle-history.ts`

```ts
type SubtitleHistorySnapshot = {
  current: SubtitleBlock | null;
  past: SubtitleBlock[];
  future: SubtitleBlock[];
};

function deriveSubtitleHistory(
  blocks: SubtitleBlock[],
  currentTime: number
): SubtitleHistorySnapshot;
```

### `panel-host.ts`

```ts
type PanelHost = {
  element: HTMLElement;
  dispose(): void;
};

function mountPanelHost(mountEl: HTMLElement): PanelHost;
```

### `panel-renderer.ts`

```ts
type PanelRenderer = {
  render(args: {
    history: SubtitleHistorySnapshot;
    panelOpen: boolean;
    extensionEnabled: boolean;
  }): void;
  dispose(): void;
};

function createPanelRenderer(hostEl: HTMLElement): PanelRenderer;
```

### `on-off-toggle.ts`

```ts
type OnOffToggleBinding = {
  dispose(): void;
};

function mountOnOffToggle(args: {
  rootEl: HTMLElement;
  state: ExtensionUiState;
  onToggle: (enabled: boolean) => void;
}): OnOffToggleBinding;
```

### `panel-toggle-button.ts`

```ts
type PanelToggleButtonBinding = {
  dispose(): void;
};

function mountPanelToggleButton(args: {
  rootEl: HTMLElement;
  state: ExtensionUiState;
  onToggle: (open: boolean) => void;
}): PanelToggleButtonBinding;
```

### `player-layout.ts`

```ts
type PlayerLayoutState = {
  isApplied: boolean;
  availableWidth: number | null;
  playerWidth: number | null;
  panelWidth: number | null;
};

type PlayerLayoutController = {
  apply(open: boolean): void;
  reset(): void;
  getState(): PlayerLayoutState;
  dispose(): void;
};

function createPlayerLayout(args: {
  layoutTargetEl: HTMLElement;
  panelHostEl: HTMLElement;
}): PlayerLayoutController;
```

### `session-lifecycle.ts`

```ts
type StartPlaybackSessionArgs = {
  target: PlaybackTarget;
  settings: StoredSettings;
};

type PlaybackSession = {
  stop(reason?: RestartReason | 'manual-stop'): void;
  dispose(): void;
};

function startPlaybackSession(args: StartPlaybackSessionArgs): PlaybackSession;
```

---

## 18. `src/shared/types.ts` の共通型

`src/shared/types.ts` では、module 境界で共有する最低限の型を定義する。

```ts
export type StoredSettings = {
  primaryLang: string;
  secondaryLang: string;
};

export type RestartReason =
  | 'video-disconnected'
  | 'video-replaced'
  | 'playback-root-disconnected'
  | 'spa-target-changed';

export type PlaybackTarget = {
  rootEl: HTMLElement;
  videoEl: HTMLVideoElement;
  panelMountEl: HTMLElement;
  layoutTargetEl: HTMLElement;
};

export type ResolvedSubtitleTrack = {
  id: string;
  lang: string;
  label: string;
  kind: string;
  track: TextTrack;
};

export type ResolvedTrackPair = {
  primary: ResolvedSubtitleTrack | null;
  secondary: ResolvedSubtitleTrack | null;
};

export type SubtitleCueSnapshot = {
  primaryCues: TextTrackCue[];
  secondaryCues: TextTrackCue[];
};

export type SubtitleBlock = {
  id: string;
  startTime: number;
  endTime: number;
  primaryText: string;
  secondaryText: string | null;
};

export type SubtitleHistorySnapshot = {
  current: SubtitleBlock | null;
  past: SubtitleBlock[];
  future: SubtitleBlock[];
};

export type ExtensionUiState = {
  extensionEnabled: boolean;
  panelOpen: boolean;
};

export type PlayerLayoutState = {
  isApplied: boolean;
  availableWidth: number | null;
  playerWidth: number | null;
  panelWidth: number | null;
};

export type PlaybackSessionState = {
  target: PlaybackTarget | null;
  video: HTMLVideoElement | null;
  restartReason: RestartReason | null;
  subtitleReady: boolean;
};
```

`PlayerLayoutState` は `player-layout.ts` の内部または layout module 境界でのみ利用する。  
`ui-state.ts` は `PlayerLayoutState` を保持・更新しない。

型は最小限に留め、DOM 観測ログ由来の一時情報や debug 専用情報を混ぜない。

---

## 19. `src/shared/dispose.ts` の cleanup helper

`src/shared/dispose.ts` は cleanup の共通基盤だけを提供する。

責務は次の通りとする。

- `DisposeFn` の型定義
- disposer の登録
- reverse-order cleanup
- 二重 dispose 防止
- 複数 module の `dispose()` を1つに合成する helper

想定 API は次の程度に留める。

```ts
export type DisposeFn = () => void;

export type Disposable = {
  dispose(): void;
};

export function createDisposer(): {
  add(dispose: DisposeFn): DisposeFn;
  dispose(): void;
};

export function combineDisposers(
  ...disposeFns: Array<DisposeFn | undefined>
): DisposeFn;
```

個別 module は、自分が登録した listener、timer、observer、binding、DOM を解放する `dispose()` を返す。  
`session-lifecycle.ts` はそれらを合成して session の終了時に一度だけ呼ぶ。

---

## 20. `content/index.ts` を thin coordinator に保つ禁止事項

`src/content/index.ts` には、次を書かない。

### 禁止事項

- `TextTrack` の採用ロジック
- cue の対応付けロジック
- `SubtitleBlock[]` の構築ロジック
- current / past / future の導出ロジック
- panel 内部 DOM の生成・差分更新
- ON/OFF toggle の内部描画実装
- panel 開閉ボタンの内部描画実装
- 7:3 layout の計算式本体
- Apple TV+ 固有 selector の散在
- listener / observer / timer の個別解除ロジック
- cleanup 手順の詳細本体
- readiness 待機、retry / polling、restart request の収束
- recovery 専用の多段 retry 分岐
- 一時回避のための flag ベース分岐の集積
- source / renderer / layout をまたぐ共有 mutable state の直持ち

### index.ts に残してよいもの

- 起動シーケンス
- settings 読込
- playback target 解決要求
- session 開始
- session 停止
- top-level error logging
- 再初期化の入口判断を `session-lifecycle.ts` へ委譲する処理

要するに `index.ts` は **判断の入口** は持ってよいが、**実装本体** は持たない。

---

## 21. 今後の拡張原則

新機能を追加しても、source、truth、renderer、session lifecycle の境界を崩さない。

### 境界を守る

新しい機能は、既存の責務へ直接入り込ませず、まず次のどこに属するかを判断する。

| 追加したい責務 | 配置先の原則 |
| --- | --- |
| Apple TV+ からの取得、外部入力、track / cue の観測 | source 層、または Apple TV+ 固有 module |
| 字幕や入力データの正規化、対応付け、表示単位の確定 | truth 層 |
| current / past / future、検索結果、並び順など truth からの読み取り結果 | view helper 層 |
| truth または view helper の結果を DOM に表示する処理 | renderer 層 |
| 開閉、選択、表示モードなどの一時的 UI 意思 | `ui-state.ts` |
| 幅、配置、style、resize 追従などの画面幾何 | `player-layout.ts` または layout module |
| listener、timer、observer、binding、extension DOM の開始・停止 | session lifecycle と各 owner module |
| 保存設定 | `settings-store.ts` と `docs/settings-spec.md` |

新しい UI を追加する前に、その UI が読む truth、必要な view helper、開始条件、停止条件、owner、dispose 対象を決める。  
renderer が source を直接読むこと、source が panel DOM を更新すること、UI component が observer や timer を無所有で作ることは禁止する。

### 影響確認の順序

新機能の設計・実装では、次の順序で影響範囲を確認する。

1. **source**: 入力はどこから得るか、Apple TV+ 固有の依存をどこに閉じ込めるか
2. **truth**: UI の正本を何にするか、既存の `SubtitleBlock[]` を拡張するか、別の truth を作る必要があるか
3. **view helper**: current / past / future のような読み取り専用の導出が必要か
4. **renderer**: truth または view helper の出力だけで描画できるか
5. **UI / layout state**: UI の意思と画面幾何を別々に扱えているか
6. **lifecycle / cleanup**: start 条件、stop 条件、owner、`dispose()` の呼び出し元が一意か
7. **test**: source、truth、renderer、session restart、cleanup のどこを検証するか

この順序を飛ばして UI から実装を始めない。  
truth と lifecycle の一貫性を確認する前に、panel、controls、overlay、補助 UI を増やさない。

### 新規ファイルの配置判断

新しい実装ファイルを追加する場合は、次の基準で配置する。

| 役割 | 配置先 |
| --- | --- |
| Apple TV+ 再生 DOM の発見・解決 | `src/content/` |
| session の開始、停止、再初期化、cleanup 合成 | `src/content/` |
| 字幕取得、track 解決、cue 監視、truth 構築 | `src/subtitles/` |
| panel host と panel 描画 | `src/panel/` |
| ON/OFF toggle、panel 開閉、将来の再生画面 control | `src/controls/` |
| 再生画面と panel の幾何、幅、style、resize 追従 | `src/layout/` |
| runtime UI の意思決定状態 | `src/ui/` |
| Chrome Storage に保存する設定 | `src/settings/` |
| 複数層で使う型、dispose、DOM helper、logger | `src/shared/` |

配置先が複数候補に見える場合は、DOM を直接所有するか、truth を構築するか、表示するか、session resource を開始・停止するかで分ける。  
1つの module が複数の問いに答える必要がある場合は、責務が混ざっているため分割を検討する。
