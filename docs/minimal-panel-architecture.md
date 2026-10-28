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

このプロジェクトのすべての `docs/` 文書では、次の用語を固定して使う。用語の定義はこの表を正本とし、他の文書では再定義しない。

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
| runtime state | 現在の処理・表示・操作に必要な状態をメモリ上に持つ一時状態 |
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
| language option | popup UI に表示する固定の候補言語 |
| effective secondary language | `secondaryLang` が未設定のときにブラウザ言語 fallback を適用した、content 側で解決に使う母国語 |
| browser language fallback | `secondaryLang` 未選択時に runtime で利用するブラウザ言語 |
| settings store | 設定の読込・保存・検証・正規化を行う `src/settings/settings-store.ts` |
| 設定未完了 | `primaryLang` が未設定、または有効な候補言語として正規化できない状態 |
| 正規化済み設定 | validation と normalization を通過し、popup または content 側で安全に利用できる設定値 |

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
- 実装順と作業手順の詳細
- 詳細テスト項目
- seek 後 recovery の細部アルゴリズム

### 正本への委譲

この文書は architecture の正本であり、責務境界、依存方向、データフロー、session lifecycle、cleanup owner を定義する。

次の詳細は、この文書で再定義せず担当文書へ委譲する。

| 内容 | 正本 |
| --- | --- |
| 保存設定、popup、候補言語、fallback、validation | `docs/settings-spec.md` |
| 実装順、ファイル単位の作業手順、検証タイミング | `docs/implementation-workflow.md` |
| Apple TV+ 固有の DOM、selector、video / `textTracks` の観測、native menu の実装判断 | `docs/apple-tv-dom-structure.md` |
| ブラウザで得た DOM 詳細ログ、時系列、未確認事項 | `docs/apple-tv-dom-observations.md` |
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
│     └─ 処理 session の開始停止、controller の最終 dispose、readiness 待機・retry、target 再評価と restart 判断を所有する
│
├─ subtitles/
│  ├─ subtitle-source.ts
│  │  └─ 字幕取得と track binding の統一窓口
│  ├─ subtitle-session.ts
│  │  └─ resolver・source・truth・history の接続と、そのruntime結果・監視・cleanupを所有する
│  ├─ text-track-resolver.ts
│  │  └─ TextTrack を正規化し、primary / secondary 採用判定を行う
│  ├─ native-menu-sync.ts
│  │  └─ Apple TV+ ネイティブ字幕メニュー listener の attach / detach を扱う
│  ├─ subtitle-block-builder.ts
│  │  └─ primary / secondary cue から `SubtitleBlock[]` を構築する
│  ├─ subtitle-block-candidates.ts
│  │  └─ builder 内部の補助。検証・重複除去済みの cue から対応候補を生成する
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
│  └─ panel-open-close-button.ts
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
│  ├─ language-options.ts
│  │  └─ 対応言語 code の一覧と候補判定を提供する
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

### `src/content/debug-subtitle-log.ts`

- 開発時だけ、lifecycle の字幕 snapshot 取得・更新購読を Console ログへ接続する
- source・video・DOM を直接読まず、truth 構築や UI 描画を行わない
- 購読と重複抑制用の要約文字列だけを所有し、全 snapshot は保持しない
- 起動の配線と dispose 保持は content coordinator の top-level bag が所有する
- 無効時は購読も snapshot 取得も行わない。運用・検証手順は workflow と testing-checklist を参照する

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

現在の処理 session と、その開始停止を制御する controller の owner とする。
controller と、現在の再生対象に属する処理 session の寿命は区別する。

責務は次の通りとする。

- 処理 session の開始停止と controller の最終 dispose
- subtitle readiness 待機
- readiness 待機中の retry / polling
- target 再評価要求の収束
- target の再解決・比較、restart 要否と理由の選択
- 旧処理の終了と新処理の開始の順序制御
- session owner module が返す `dispose()` の合成
- session 単位の runtime state の破棄

`playback-root.ts` が返した target と video を受け取り、同じ video に対する readiness 待機を維持する。  
readiness 待機中に video identity が変わった場合は、古い待機を dispose し、新しい video に対して待機を最初からやり直す。

検出元と readiness retry は共通の target 再評価経路へ接続する。
stop / dispose の契約は §12、restart の判断と理由対応は §13 を正本とする。

### `src/subtitles/subtitle-session.ts`

字幕接続と、その接続に対応する runtime の `SubtitleBlock[]`・history の owner とする。
source 更新時は snapshot を builder へ渡し、構築した truth から history を導出する。
通常の再生時刻更新と seek では、保持済み truth から history だけを再計算する。
診断 callback やログ出力レベルを、truth 構築の有効条件にしない。
入力条件違反では該当更新の block・history を空にし、予期しない例外は区別して記録・再送出する。
不正な再生時刻では history を空にし、有効な truth は保持して時刻正常化後に再導出する。
source・track 一覧・video イベントの監視は既存の dispose bag が所有する。
dispose 開始時に保持データを解放し、解除失敗時に残った旧イベントも無効化する。
構築・導出アルゴリズムは builder・history の純関数へ委譲し、DOM は扱わない。

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
- 同じ TextTrack の二重採用防止
- primary と同じ基本言語の fallback の採用防止

設定値としての学習言語・母国語の同一値禁止は `docs/settings-spec.md` に従う。

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

### `src/subtitles/subtitle-block-candidates.ts`

builder 内部の対応候補生成を担う純関数とする。
検証・完全重複除去済みの cue を受け取り、1対1・1対2・2対1の候補と点数を返す。
内部型 `IndexedCue` は時刻・本文・元の入力位置を持ち、cue・track の参照を含めない。
候補には重複除去後の先頭位置・件数と元の先頭入力位置を保持する。
候補の採用・cue の消費・block の生成・source 制御・DOM 操作は行わない。
builder からこの補助 module への一方向の依存とし、逆方向には依存しない。


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

### `src/controls/panel-open-close-button.ts`

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

store は現在の処理 session より長く存続できる操作側 runtime として扱い、
処理 session の start ごとに作り直さない。
保存値の読込・保存は settings-store に委譲し、Storage API は直接扱わない。
state の初期化・維持条件は §16 を参照する。

### `src/settings/settings-store.ts`

保存設定の読み書きだけを担当する。

- `primaryLang` の読込・保存
- `secondaryLang` の読込・保存
- 全作品共通の `extensionEnabled` の読込・保存
- 最低限の validation
- 担当する保存領域との入出力

popup、保存領域、未保存時の既定値、fallback、validation の詳細仕様は `docs/settings-spec.md` を正本とする。
runtime state、readiness、session restart は扱わない。

### `src/shared/types.ts`

module 境界で共有する型を定義する。

この文書で最低限固定する型は次の通りとする。

- `LanguageCode`
- `StoredSettings` / `ExtensionSettings`
- `ResolvedSubtitleTrack` / `SubtitleTrack`
- `ResolvedTrackPair`
- `SubtitleTrackRole`
- `SubtitleTrackCandidate`
- `SubtitleCueSnapshot`
- `SubtitleSourceSnapshot`
- `SubtitleSourceChange` / `SubtitleSourceListener`
- `SubtitleBlock`
- `SubtitleHistorySnapshot` / `SubtitleHistoryView`
- `PlaybackTarget` / `PlaybackTargetSnapshot` / `PlaybackTargetComparison`
- `PlaybackSessionState` / `SessionState`
- `WaitingState` / `RestartReason`
- `ExtensionUiState` / `UiState` / `UiStateListener` / `UiStateStore`
- `PlayerLayoutState`
- `DisposeFn` / `Disposable`

共通型の定義は §18 に置き、API の説明箇所では再定義せず参照する。

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
- `panel-open-close-button.ts` は panel 開閉ボタンの DOM と controls binding を所有する
- `ui-state.ts` は UI state とその購読機構を所有する

購読解除関数は登録元が保持し、登録元の寿命が終了するときに実行する。
処理 session に属する購読と、再開始を受け取る controller の公開購読は区別する。
OFF から ON に戻す操作経路を、字幕処理 session の stop で失わせない。

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
panel-open-close-button.ts
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

同一 video の再確認では、待機開始時刻と retry 回数を維持する。
新 video の待機では、待機開始時刻と retry 回数を初期化する。
target の変化・消失の判断は §13 の共通再評価経路を使い、
readiness retry に独立した restart 判断を持たせない。

---

## 11. `SubtitleBlock[]` と truth

`SubtitleBlock[]` は panel 表示の truth の正本である。

期待する役割は次の通りとする。

- primary / secondary の対応済み表示単位を持つ
- 時刻ベースで current block を決定できる
- panel 表示に必要な最小情報だけを持つ
- source 側の揺れを UI に直接漏らさない

共通型の定義は §18 の `SubtitleBlock` を参照する。

`SubtitleBlock` は、時刻範囲と primary / secondary の表示文字列を持つ。
識別子は共通型に含めない。
識別子を追加する場合は、用途と必要性を明確にし、共通型と本節を同時に更新する。

補足ルール:

- cue オブジェクトそのものは renderer に渡さない
- `TextTrack` 参照は renderer に渡さない
- 表示順と表示内容は block builder 側で確定する
- current / past / future は `SubtitleBlock[]` から導出する読み取り結果であり、別の truth を増やさない

---

## 12. playback session の start / stop / dispose

playback session は、現在の Apple TV+ 再生対象に対して拡張機能が動く1回分の実行単位である。

controller は、その処理 session の開始停止を制御する。
controller の stop は現在の処理 session を終了する操作であり、
controller 自体の最終 dispose とは区別する。

各 resource の生成・解除は担当 module が所有し、
lifecycle は現在の処理 session に属する disposer を集約する。

現在の処理 session に属するものは次とする。

- 現在の playback target
- 現在の `video`
- subtitle readiness 待機
- subtitle source
- track binding
- cue listener
- native menu binding
- panel host
- 処理 session に属する controls binding
- layout observer
- session timer
- session が所有する `MutationObserver` / `ResizeObserver`
- `player-layout.ts` が持つ layout state
- cleanup disposer

UI store と、OFF から ON に戻すための操作経路は、
字幕処理 session の寿命とは分けて扱う。
store の保持条件は §16、各購読の解除責任は §7 に従う。

### start の流れ

```txt
index.ts
  ↓
保存設定を読み、操作側 runtime の UI store を初期化・配線する
  ↓
操作 UI を接続する。OFF から ON に戻す経路は字幕処理の停止と分ける
  ↓
session-lifecycle.ts が開始条件と現在 target を評価する
  ↓
有効な target に対する処理 session を開始する
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

### controller の stop / dispose

| 項目 | stop | dispose |
|---|---|---|
| 目的 | 現在の処理 session を終了する | controller を最終終了する |
| 字幕接続・中継購読・readiness 待機 | 解放する | 解放する |
| truth・history・active target / video / track 参照 | 解放する | 解放する |
| controller の状態・字幕更新購読 | 維持する | 破棄する |
| 新しい開始・購読 | 受け付ける | 受け付けない |
| 最終通知 | 必要なクリア・停止通知を送る | 送らない |
| 保存された ON/OFF | 変更しない | 変更しない |

stop 後に再利用するのは controller だけとする。
終了した字幕接続・データ・古い DOM を再利用するために保持しない。
処理 session に属する購読は、その owner が終了時に解除する。

stop / dispose 後の getState は status:stopped、target:null、waiting:null とする。
getSubtitleSnapshot は接続なしを表す null とする。
外部の呼出元が既に取得して保持している参照まで解放できるとは保証しない。

### cleanup の共通原則

- 旧 callback を無効化し、active な保持先から資源を切り離してから cleanup を試す
- 個別 resource の解除は各 owner が行い、lifecycle は disposer を逆順に集約する
- 一部が失敗しても残りの解除・参照整理を継続し、失敗を記録する
- 解除試行と実際の解除成功を区別する
- 繰り返し呼出しで同じ cleanup を二重実行しない
- 古い停止処理・通知・cleanup が、新しい処理 session を上書き・解除しない
- layout の style、observer、timer、計算済み state は player-layout が解除する
- 再開時は現在 target を再解決し、古い target を再開の正本にしない
- panel だけを閉じる操作では controller の stop / dispose を呼ばない

---

## 13. session restart と cleanup

開始・再初期化理由は §18 の `RestartReason` で共有する。

DOM 上で観測した変化と、再初期化に使う理由コードは区別する。
検出元は target の再評価を要求するだけとし、
session-lifecycle が再解決・比較・restart 要否・理由選択・重複抑制・実行を所有する。
playback-root は discovery と snapshot 比較を提供し、開始停止は行わない。
content coordinator は入力と通知入口を配線し、判断の詳細を持たない。
readiness retry も lifecycle の共通再評価経路を使う。

### 再評価結果の扱い

| 状況 | 扱い |
|---|---|
| 同一 target | 再開始しない。待機中なら現在の待機を維持する |
| video identity の変更 | 旧処理を終了し、新 video で開始する |
| 同一 video で root・mount・layout target が変更 | 旧処理を終了して再接続する |
| target が解決できない | 旧処理・参照を解放し、対象なしでは開始しない |
| target を再発見 | ON・設定 ready・controller 未破棄なら開始する |
| 通常の cue 更新・native menu close | それ自体では全体 restart しない |

### 理由コードの選択

| 状況 | 理由コード |
|---|---|
| 初期起動時に対象あり | initial-start |
| 対象なしから対象を発見 | playback-target-appeared |
| 旧 target と比較でき、video identity が変更 | video-replaced |
| 同一 video で root・mount・layout target が変更 | spa-navigation |
| 明示的な再開始要求 | manual-restart |
| 設定変更で全体再接続が必要 | settings-changed |

- video と root の同時変更は video-replaced を優先する
- 同一 target の再確認だけで restart reason を更新しない
- 対象消失には新しい開始理由を無理に付けない
- A → null → B で旧参照を解放済みなら、B は playback-target-appeared とする
- 理由を揃えるために旧 DOM 参照を保持しない
- 型に存在する理由コードだけを根拠に、全体 restart を必須にしない

新しい理由コードを採用する場合は、検出元、既存コードとの対応、影響するテストを確認し、
`src/shared/types.ts` と §18 を同時に更新する。

`seek` は restart reason に含めない。
seek 自体を理由に、video、track binding、session を作り直さない。

再生時刻の更新や seek 後は、保持済みの `SubtitleBlock[]` と現在時刻から history を導出する。
source の更新や未取得 cue の読込みに伴う truth の再構築とは区別し、
seek 自体を理由に cue 本文を再取得したり、block を再構築したりしない。

restart 時は、新 session を開始する前に旧 session が所有する resource を一度だけ dispose する。

停止対象は次とする。

- primary / secondary の track binding
- cue listener
- native menu binding
- panel host
- layout observer
- 処理 session に属する controls binding
- session が所有する timer
- session が所有する `MutationObserver` / `ResizeObserver`
- session 内で保持した subtitle truth と history snapshot
- session 内で保持した target、video、track への参照
- 処理 session に属する UI state 購読

restart の流れは次の通りとする。

```txt
restart request 発生
  ↓
現在 target と開始条件を再評価し、restart 要否・理由を確定
  ↓
旧 callback を無効化し、旧接続・待機を保持先から切り離す
  ↓
各 owner の cleanup を試し、旧データ・参照を解放
  ↓
再入・OFF・dispose を確認し、必要なら現在 target を再解決
  ↓
最新の有効 target で readiness 待機または新しい処理を開始
```

restart request の収束は `session-lifecycle.ts` が所有する。  
複数 module が個別に restart を発火して stop / start を始めない。

処理中の再評価要求はまとめ、stop / start を入れ子にしない。
OFF・dispose 後は保留中の開始を実行しない。
旧 callback・停止処理・cleanup が新しい状態を変更しないよう世代を確認する。
cleanup の完了は全解除試行と管理上の切離しの完了を指し、
失敗した資源まで実際に消えたとは扱わない。

restart は controller 自体の dispose ではない。
保存された ON/OFF と、同じ視聴中に手動で変更した panel 開閉は維持する。
restart reason や video identity だけで、新しい視聴と判定しない。
新しい視聴の具体的な識別条件は未確定とし、確認後に本書と DOM 判断文書を整合させる。

---

## 14. panel 設計

panel は右側字幕表示専用の UI とし、v2 の中心体験を担う。

設計方針は次の通りとする。

- panel の DOM 土台は `panel-host.ts` が所有する
- 表示内容の描画は `panel-renderer.ts` が所有する
- panel の開閉状態は `ui-state.ts` が持つ
- panel の幅配分と layout state は `player-layout.ts` が持つ
- panel 内で source 取得や track 解決は行わない

### 表示の仕様

block の本文・時間範囲・並びは §17 の `subtitle-block-builder.ts`、
current / past / future の導出は同節の `subtitle-history.ts` を正本とする。
panel 側で block の並べ替えや current の再選択を行わない。

| 項目 | 仕様 |
|---|---|
| 言語の上下 | 学習言語を上、母国語を下に表示する |
| 本文 | block 内の本文と改行を維持して表示する |
| 片言語 block | 存在する側に本文を表示し、欠けている言語側も空行を1行確保する |
| 言語領域 | 片言語でも、もう片方の言語領域へ本文を移さない |
| 表示順 | history の past、current、future を元の block 順に表示する。current が null の場合も future を表示対象とする |
| current | 再生位置を代表する1 block として強調する |
| 非選択の block | current でないことや終了時刻を過ぎたことを理由に、表示対象から取り除かない |
| 表示範囲 | 表示対象として残ることと、スクロール領域内で常に見えることは区別する |
| 未取得の字幕 | truth にまだ存在しない字幕を補完して表示しない |
| 補助表示 | secondary unavailable などの補助情報を必要に応じて表示する |
| 非表示 | extension OFF または panel close 時は非表示にする |

### 自動スクロールの仕様

自動追従は、current を表示範囲に案内するための処理とする。
current の選択規則や block の順序を変更せず、全行を順番に強調するための処理は加えない。

| 状況 | 仕様 |
|---|---|
| 表示範囲内の進行 | current 全体が表示範囲に収まる間は、強調だけを進め、自動スクロールしない |
| 下端で収まらなくなる | 新しい current 全体が表示範囲に収まらなくなったら、その block の上端を表示範囲の上端へ合わせる |
| スクロールの動き | 初期版はアニメーションを付けず、位置を切り替える |
| 手動スクロール | ユーザーのスクロール操作で自動追従を停止する。current の計算・強調は継続する |
| 操作の判定 | 単なる scroll イベントだけで追従停止を判定しない。自動スクロール自身で追従停止しないよう区別する |
| 現在位置に戻る | 「現在位置に戻る」操作で current を上端へ表示し、自動追従を再開する。current がなければ先頭へ移動する |
| 追従中の seek | seek 先の current を上端へ表示する。current がなければ先頭へ移動する |
| 追従停止中の seek | 停止を維持する。強調を更新し、閲覧位置を勝手に移動しない |
| panel の再表示 | current を上端へ表示して自動追従を再開する。current がなければ先頭へ移動する |
| source 更新後・追従中 | 再計算された history に通常の追従規則を適用する。current がなくなった場合は先頭へ移動する |
| source 更新後・追従停止中 | 自動スクロールせず、閲覧位置を可能な範囲で維持する |
| 表示範囲より高い block | 上端を合わせるだけとし、収まらないことを理由に繰り返しスクロールしない |
| 末尾で上端へ揃えられない場合 | 最大スクロール位置まで移動する。上端合わせ用の余白を追加しない |

source 更新後の表示は、外部から渡された truth / history に従う。
panel 自身が source を購読したり、source や TextTrack を直接読んだりしない。
自動追従の状態は保存設定ではなく runtime の表示状態として扱い、Chrome Storage には保存しない。
追従用のイベントや購読を追加する際は owner と cleanup を明確にし、
session 終了・表示の破棄後に旧処理を残さない。

panel は truth の読み取り結果を表示するだけであり、source 制御の入口にしない。

---

## 15. ON/OFF toggle と panel 開閉ボタン

この2つは責務を明確に分離する。

### ON/OFF toggle

対象は **拡張全体の enabled / disabled** だけとする。

- OFF にすると、字幕処理・panel 表示・layout 適用と、それらに必要な監視を止める
- OFF から ON に戻すための操作経路は利用できるようにする
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

協調側は、ON 操作時に panelOpen を true、OFF 操作時に false とする。
ON の状態で新しい視聴を開始したときは panel を開く。
panel の手動開閉では extensionEnabled とその保存値を変更しない。
同じ視聴の技術的な再接続では panelOpen を維持する。
閉じた panel を開き直す操作経路は、panel 非表示中も利用できるようにする。

---

## 16. 保存設定と runtime state

保存設定と runtime state は明確に分ける。

### 保存設定

Chrome Storage に保存する。

- `primaryLang`
- `secondaryLang`
- `extensionEnabled`

これらは `settings-store.ts` が唯一扱う。

初期版では次を保存しない。

- panel open state

保存領域、未保存時の既定値、復元、fallback、validation、popup の選択操作は
`docs/settings-spec.md` を正本とする。

### runtime state

現在の処理・表示・操作に必要な状態をメモリ上に持つ。
操作側 runtime と、現在の処理 session に属する資源の寿命は区別する。

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

UI store は操作側 runtime が保持し、処理 session の start ごとに作り直さない。
extensionEnabled は保存値を適用し、未保存時は true とする。
ON 操作時と、ON の状態で新しい視聴を開始したときは panelOpen を true とする。
OFF 操作時は panelOpen を false とする。
視聴中の手動開閉と、同じ視聴の技術的再接続では §15 の規則を適用する。

処理 session の stop / restart は、保存された ON/OFF を変更しない。
UI store の購読は登録元の owner が解除し、最終終了後に旧購読を残さない。
store 自体に target・video・track・字幕データを保持させない。

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

- 複数 module で共有する型の定義は §18 に置く。
- 各 API 節には公開操作と、その module 固有の入力・出力境界を書く。
- 保存設定の詳細な型・取得結果・validation は `docs/settings-spec.md` を参照する。
- API は module 間の入力・出力・所有権・失敗条件を定義する。
- 設計例と確定した API は区別して記載する。
- 実装順と接続手順は `docs/implementation-workflow.md`、検証条件・期待動作・手順は `docs/testing-checklist.md` で扱う。

### `settings-store.ts`

保存設定の読込・保存・validation・normalization を提供する。

- 言語設定の loadSettings は、正規化済み設定と ready / incomplete / error の状態を返す。
- 言語設定の saveSettings は、保存成功、validation による拒否、書込失敗を結果として返す。
- 全作品共通の ON/OFF の読込・保存は、言語設定の操作と相互上書きしない境界で扱う。
- ON/OFF の保存領域・失敗時の扱い・取得結果型の詳細は settings-spec を参照する。
- ready の primaryLang は有効な言語とし、secondaryLang は未選択の null を許容する。
- 設定未完了の内部表現と、保存成功時のデータ形式を区別する。
- ブラウザ言語の取得や fallback による track 採用は担当しない。

設定 API と結果型の詳細は `docs/settings-spec.md` を正本とする。
共通の未完了表現は §18 の `StoredSettings` / `ExtensionSettings` を参照する。

### `playback-root.ts`

playback target の discovery と、target snapshot の比較を提供する。
共通型は §18 を参照する。

```ts
function resolvePlaybackTarget(doc?: Document): PlaybackTarget | null;

function comparePlaybackTargetSnapshots(
  previous: PlaybackTargetSnapshot,
  next: PlaybackTargetSnapshot,
): PlaybackTargetComparison;
```

readiness 待機や resource の登録・解除は担当しない。
target の同一性は DOM node 参照を含む snapshot で比較する。

### `ui-state.ts`

```ts
// 共通型は §18 を参照する。
function createUiStateStore(
  initialState?: Partial<ExtensionUiState>,
): UiStateStore;
```

### `text-track-resolver.ts`

`TextTrack` の正規化と、設定言語に対する primary / secondary の採用判定を行う。
共通型は §18 を参照する。

```ts
type TextTrackListLike = ArrayLike<TextTrack>;

type ResolveTrackPairArgs = {
  textTracks: TextTrackListLike;
  primaryLang: LanguageCode;
  secondaryLang: LanguageCode | null;
  fallbackSecondaryLang?: LanguageCode | null;
};

function normalizeLanguageCode(value: string | null | undefined): string;

function normalizeTextTracks(
  textTracks: TextTrackListLike,
): SubtitleTrackCandidate[];

function isSubtitleCandidate(candidate: SubtitleTrackCandidate): boolean;

function findLanguageCandidates(
  candidates: readonly SubtitleTrackCandidate[],
  lang: LanguageCode | null,
): SubtitleTrackCandidate[];

function findShowingTrack(
  candidates: readonly SubtitleTrackCandidate[],
): SubtitleTrackCandidate | null;

function resolveTrackPair(args: ResolveTrackPairArgs): ResolvedTrackPair;

function summarizeTrack(
  track: ResolvedSubtitleTrack | SubtitleTrackCandidate | null,
): string;
```

- language だけで採用せず、kind、label、mode を合わせて判定する。
- 表示中字幕は `mode === 'showing'` を基準とし、active cue の有無だけでは判定しない。
- 言語候補の優先順位は、mode、一致度、kind、元の位置の順とする。
- 一致候補がない役割は null を返し、同じ `TextTrack` を両方の役割に採用しない。
- `secondaryLang` が null のときだけ、引数の `fallbackSecondaryLang` を利用する。
- fallback が primary と同じ基本言語なら、secondary は採用しない。
- 学習言語と母国語の設定上の同一値禁止は `docs/settings-spec.md` に従う。
- ブラウザ言語の取得、readiness 待機、retry、listener 登録、mode 変更、panel 操作は担当しない。
- 正規化した mode は取得時点の値であり、再判定時は current video の track を再正規化する。

### `subtitle-source.ts`

readiness 通過後の current video に対して、採用済み track を bind する。
共通型は §18、解放処理に失敗した場合の動作は §19 を参照する。

```ts
type SubtitleSourceVideo = {
  readonly textTracks: ArrayLike<TextTrack>;
};

type SubtitleSourceOptions = {
  logger?: Logger;
};

// source 固有の要約型。定義元は subtitle-source.ts とする。
type SubtitleSourceSummary = {
  pair: ResolvedTrackPair;
  primaryCueCount: number;
  secondaryCueCount: number;
};

type SubtitleSource = {
  bind(pair: ResolvedTrackPair): void;
  unbind(): void;
  getSummary(): SubtitleSourceSummary;
  getSnapshot(): SubtitleSourceSnapshot;
  subscribe(listener: SubtitleSourceListener): DisposeFn;
  dispose(): void;
};

function createSubtitleSource(
  videoEl: SubtitleSourceVideo,
  options?: SubtitleSourceOptions,
): SubtitleSource;
```

#### binding と通知

- current video の `textTracks` に含まれる採用 track だけを bind する。
- 同じ track の組み合わせへの再 bind では、listener を二重登録しない。
- cuechange listener は source が所有し、bind 単位の DisposeBag で解除する。
- 再 bind では旧 binding の解除を試してから、新しい listener を登録する。
- 通知は bound / unbound / role 付き cuechange とし、cue 本文は通知に含めない。
- 採用情報と cue 件数だけが必要な購読者は `getSummary()` を使う。
- cue 本文と時刻が必要な購読者は、必要なときに `getSnapshot()` で cue 一覧を読む。
- readiness 待機、retry、track 選定、mode 変更、panel / UI 更新は担当しない。

#### snapshot と参照

- bind 入力の track 管理情報は、コピーして内部に保持する。
- snapshot の pair と track 管理情報は、コピーして外へ返す。
- cue 配列と各 cue の時刻・本文は、snapshot 取得時に新しく作る。
- cue の track 情報は、その snapshot 用にコピーした管理情報を参照する。
- 実際の `TextTrack` はコピーせず、listener 登録先と同じ参照を維持する。
- snapshot は管理情報と cue の写しであり、ブラウザの track 状態を凍結するものではない。

#### 要約取得

- `getSummary()` は、取得時点の採用 pair と primary / secondary の cue 件数を返す。
- pair と track 管理情報はコピーし、実際の `TextTrack` 参照だけを共有する。
- cue は `cues.length` だけを読み、各 cue の本文・開始時刻・終了時刻を読まない。cue 配列や cue ごとのオブジェクトを生成しない。
- 未採用、`cues === null`、空の一覧は0件とする。件数の読取失敗はログに記録して、その役割を0件とする。他方の役割は取得を続ける。
- 取得のたびに現在値を読み、要約・cue 本文・過去の取得結果を source 内へキャッシュしない。
- listener、timer、observer は追加せず、既存の binding / cleanup の寿命を変えない。
- unbind / dispose 後は pair を両方 null、cue 件数を両方0で返す。
- 接続状態の確認と診断には要約取得を使い、既存の `getSnapshot()` の本文取得と、取得結果の変更を内部状態へ伝えない仕様は変更しない。

#### 失敗と破棄

- 購読者の例外は記録し、ほかの購読者への通知を継続する。
- cue の読取失敗は記録し、その track の cue 配列を空にする。
- listener 登録失敗時は、登録済み分の解除を試して未 bind に戻す。
- 解除失敗は記録する。管理上の binding 解除と、実際の listener 解除成功は区別する。
- dispose は listener の解除を試して購読者を破棄し、unbound を通知しない。
- dispose 後は bind と新規購読を受け付けず、通知もしない。
- source は session 単位で生成し、session owner が dispose を保持・実行する。

### `subtitle-session.ts`

`createSubtitleSession(options)` は `dispose()`・`getSnapshot()`・`subscribe(listener)` を提供する。
取得結果は `{ blocks: SubtitleBlock[], history: SubtitleHistorySnapshot }` とし、
cue・track・video の参照を含めない。配列と block をコピーし、取得結果の変更を内部へ伝えない。
同じ取得結果内では history の各 block と blocks の対応する要素を共有する。
取得時に source の再読込みや再構築は行わず、最後の更新結果を返す。
dispose 後の取得結果は、空の blocks と current:null・past/future が空の history とする。
診断専用の `onObservation` は、このデータ取得境界とは分離する。

`subscribe(listener: () => void): DisposeFn` は、データ更新後に引数なしで通知する。
登録時の即時通知はせず、初期データは `getSnapshot()` で取得する。
成功した再構築・時刻更新と、失敗による保持結果のクリアを通知対象とする。
同じ結果になる更新も通知でき、購読だけでは snapshot コピーや source 再読込みを行わない。
解除は登録単位で冪等に行い、通知中に解除された登録は呼ばず、新しい登録は次の更新から対象とする。
通知中の再入で更新世代が変わった場合は、旧更新の後続通知を打ち切る。
購読者の例外は記録して後続通知を継続し、入力条件違反とは混同しない。
dispose 開始時に購読者を解放し、最終通知は行わない。dispose 後の新規購読は無効とする。


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

primary / secondary の cue 配列から `SubtitleBlock[]` を構築する純関数とする。
共通型は §18、truth の原則は §11 を参照する。

```ts
function buildSubtitleBlocks(
  primaryCues: readonly SubtitleCueSnapshot[],
  secondaryCues: readonly SubtitleCueSnapshot[],
): SubtitleBlock[];
```

#### 入力と責務境界

- 呼び出し側が `SubtitleSourceSnapshot` から取り出した両言語の cue 配列を渡す
- source 全体、source のインスタンス、video、現在の再生時刻は受け取らない
- `SubtitleCueSnapshot` は cue 1 件分の型として使う
- cue の `startTime`、`endTime`、`text` を読み、配列の引数で primary / secondary の役割を区別する
- cue の track 管理情報や実 `TextTrack` の状態は読まない
- 入力配列と各 cue を変更せず、新しい配列と block オブジェクトを返す
- 戻り値には cue や track の参照を含めず、現行の `SubtitleBlock` の時刻・本文だけを持たせる
- id / key、内部状態、キャッシュ、listener、timer、observer は追加しない
- renderer や panel の都合、DOM 操作、source の取得・購読・cleanup は持ち込まない

#### 候補生成の内部境界

`subtitle-block-candidates.ts` の `generateSubtitleCandidates(primary, secondary)` は、
開始時刻順で入力検証・完全重複除去・同時刻正規化済みの `readonly NormalizedSubtitleUnit[]` を受け取る。
以下の対応候補・結合条件・点数規則に従って新しい候補配列を返す。
入力の検証・完全重複除去・同時刻正規化は builder、系列全体での採用判断と block 出力も builder の責務とする。
内部型と候補配列は source・renderer との公開境界や新たな truth にしない。

builder の内部補助関数 `selectSubtitleCandidates(candidates)` は、
候補生成済みの `readonly SubtitleMatchCandidate[]` から採用候補を入力順に返す。
採用判断には以下の全体評価・同点規則を適用し、元の配列と候補を変更しない。
戻り値は新しい配列と候補オブジェクトとし、本文結合や block 出力は行わない。
この関数の export は内部処理の単体検証用であり、source・renderer からの利用境界にはしない。


#### 基本的な入出力例

以下は、有効な cue に対する基本的な入出力の例である。
入力条件と複数 cue の対応づけは、後述の規則に従う。

| 入力 | 戻り値 |
|---|---|
| primary / secondary とも空 | 空の `SubtitleBlock[]` |
| primary のみ1件、secondary は空 | primary の時刻範囲と本文を持ち、`secondaryText: null` の1 block |
| secondary のみ1件、primary は空 | secondary の時刻範囲と本文を持ち、`primaryText: null` の1 block |
| primary / secondary が各1件で、開始・終了時刻がそれぞれ完全に一致 | 共通の時刻範囲と両言語の本文を持つ1 block |

#### 対応づけと block 構築

primary は学習言語、secondary は母国語を表す。
重なり率60%、空白率10%、候補点数の評価方式は暫定採用とし、
実際の字幕による検証結果に応じて見直せるものとする。

##### 入力条件と検証

| 項目 | 仕様 |
|---|---|
| 入力 | primary / secondary の cue 配列を受け取る |
| 空配列 | どちらの言語も空配列を許可する |
| 時刻 | 各 cue は有限の時刻で `0 <= startTime < endTime` を満たす |
| 入力順 | 各配列は startTime の非減少順とする。同じ開始時刻を許可する |
| 本文 | 空文字列・空白だけの文字列を許可しない |
| 不正入力 | 時刻・順序・本文の条件違反は `RangeError` で拒否する |
| 補正 | 不正な cue の除外、黙った並べ替え、時刻の補正を行わない |
| 本文の保持 | 空白だけかどうかの検証と、出力本文の加工を区別する。有効な本文は trim しない |
| 入力の不変性 | 入力配列と各 cue を変更しない |

生 cue 全件の入力条件を検証したうえで、完全重複除去、同時刻正規化、対応候補の比較、block 出力の順に処理する。
正規化によって、不正な入力の除外や補正を行わない。
入力順は非同期処理の完了順ではなく、各言語の入力配列内の順序を指す。

##### 完全重複の除去

| 項目 | 仕様 |
|---|---|
| 除去する条件 | 同じ言語内で startTime・endTime・text がすべて一致する cue |
| 残すもの | 元の入力順で最初の1件 |
| 実施時点 | 同時刻正規化の前 |
| 順序 | 除去後も残った cue の入力順を維持する |
| 本文比較 | 空白・改行差を正規化して同一視しない |
| 除去しないもの | 異なる時刻の同一本文、異なる本文、異なる言語の同一本文 |

完全重複の判定は生 cue に対して行う。同時刻正規化後には重複除去を再実行しない。
結合後に同じ言葉が繰り返されても、それだけを理由に本文を削除しない。
候補の評価に使う件数は、後述の正規化単位の数とする。

##### 連続した同時刻 cue の正規化

| 項目 | 仕様 |
|---|---|
| 対象 | primary / secondary を別々に処理する |
| 条件 | 完全重複除去後の配列で連続し、startTime と endTime がそれぞれ完全一致する cue |
| 件数 | 条件が続く最大の連続区間を、件数上限なしで1単位にする。1件ならそのまま1単位とする |
| 本文 | 入力順に改行文字 `\n` で連結し、各 cue の空白・改行・タグを保持する |
| 時刻 | 区間内で共通の startTime / endTime をそのまま使う |
| 区切り | 開始または終了が異なる cue に達したら区切る。離れた同時刻 cue を集めず、並べ替えない |
| 精度 | 許容誤差、時刻の丸め・補正を導入しない |
| 元の位置 | 単位内の先頭 cue の元の inputIndex を保持する |
| 独立性 | 入力を変更せず、新しい内部データを作る。cue・track の参照や資源は保持しない |
| 他言語がない場合 | 対応相手の有無にかかわらず正規化する |

この処理後の内部表現を「正規化単位」と呼ぶ。内部型は `NormalizedSubtitleUnit` とし、
startTime・endTime・連結済み text・先頭の inputIndex を持つ。
公開の `SubtitleCueSnapshot` と `SubtitleBlock` は変更しない。

連続性は、完全重複除去後の配列を基準に判定する。
たとえば、除去によって同時刻の cue が隣接した場合も正規化の対象となる。

- A(10,12)、B(10,13)、C(10,12) は A → B → C のままとする。
- A(10,12)、B(10,12)、C(10,13) は AB → C とする。
- 同じ開始・終了時刻の cue が何件連続していても、同じ規則で1単位にする。

以降の対応候補、隣接、件数、消費、未対応出力は、
正規化単位を基準とし、生 cue の断片数を使わない。


##### 対応候補と結合条件

| 項目 | 仕様 |
|---|---|
| 対応の組み合わせ | 正規化単位で1対1・1対2・2対1 |
| 同言語の2単位 | 正規化後の配列で隣接する2単位だけを対象とする |
| 非重複の隣接2単位 | 空白率10%以下なら結合候補とする |
| 重なる隣接2単位 | 結合候補として比較する |
| 結合の扱い | 正規化後の2単位の結合は候補として比較し、強制しない。同時刻正規化とは区別する |
| 結合上限 | 同じ言語の3単位以上への連鎖結合は行わない。各単位に含まれる生 cue 数は制限しない |
| 未対応 | 対応に採用されなければ、primary / secondary とも正規化単位ごとに片言語 block として残す |
| 再利用 | 同じ正規化単位を複数の対応に使わない |
| 順序 | 両言語の正規化単位の入力順を維持し、対応を交差させない |

2単位を結合候補として評価するときの時間範囲は、
対象単位の最小開始時刻から最大終了時刻までとする。
この範囲には、2単位の間にある空白も含める。

##### 重なり率と空白率

primary 側の候補範囲を `[pStart, pEnd)`、
secondary 側の候補範囲を `[sStart, sEnd)` とする。
各候補範囲は1単位、または結合候補の2単位から求める。

```text
overlap = max(0, min(pEnd, sEnd) - max(pStart, sStart))
span = max(pEnd, sEnd) - min(pStart, sStart)
overlapRatio = overlap / span
```

`overlapRatio >= 0.60` の組み合わせを対応候補とする。
境界だけが接する場合は overlap が0なので、対応候補としない。

同じ言語の開始時刻順の隣接2単位を、
`[aStart, aEnd)`、`[bStart, bEnd)` とする。

```text
gap = max(0, bStart - aEnd)
span = max(aEnd, bEnd) - aStart
gapRatio = gap / span
```

重なっていない2単位では、`gapRatio <= 0.10` を結合候補条件とする。
空白が0の隣接2単位も含む。
重なる2単位は、前項の重なりを持つ隣接2単位の規則で扱う。

##### 候補点数と全体評価

```text
candidateScore = (overlapRatio - 0.60) * matchedUnitCount
```

| 組み合わせ | matchedUnitCount |
|---|---:|
| 1対1 | 2 |
| 1対2 | 3 |
| 2対1 | 3 |

matchedUnitCount は採用する正規化単位の総数とし、元の生 cue 数による重みは付けない。
同時刻の英語5 cueを1単位にしたものと日本語1単位の対応は、1対1・2単位として評価する。
同時刻正規化は確定した前処理であり、1対2・2対1の結合回数には数えない。
候補の primaryCount / secondaryCount は正規化単位数、offset は正規化後の配列位置とする。
隣接判定、採用列の交差・再利用防止、slice、消費済み管理、ループの前進には、この位置と単位数を使う。
元の inputIndex を正規化後の配列添字として使用しない。

再利用なし・順序維持を満たす対応の組み合わせの中から、
candidateScore の合計が最大になるものを選ぶ。

| 項目 | 仕様 |
|---|---|
| 評価範囲 | 各候補を局所的に即決せず、系列全体で評価する |
| 未対応単位 | 点数は0。未対応への減点は付けない |
| 候補条件 | 重なり率60%以上は候補になれる条件であり、採用を保証しない |
| 結合の優先度 | 1対1の優先は合計点が同じ場合の規則であり、高得点の結合を一律に排除しない |

##### 同点時の優先順位

系列全体の結果を、次の順で比較する。

| 優先順位 | 比較するもの | 選択 |
|---|---|---|
| 1 | 候補点数の合計 | 大きい方 |
| 2 | 1対2・2対1の結合回数 | 少ない方 |
| 3 | 対応づけされた正規化単位数 | 多い方 |
| 4 | 対応リスト | 下記の辞書順で小さい方 |

各対応を次の組で表し、対応を入力順に並べたリストを比較する。

```text
(
  primary の先頭入力位置,
  secondary の先頭入力位置,
  primary の正規化単位数,
  secondary の正規化単位数
)
```

先頭から比較し、最初に異なる数値が小さい方を選ぶ。
入力位置には元の入力配列の位置を使い、
完全重複除去・同時刻正規化後も、各単位の先頭 cue の元の入力位置を保持して比較する。
この位置は builder 内部の比較にだけ使用し、block に id / key として出力しない。

重なり率60%ちょうどの候補点数は0となる。

- 60%の1対1と未対応が同点なら、結合回数も同じなので対応単位数により1対1を選ぶ。
- 60%の1対2・2対1は、ほかに利点がなければ結合回数の少ない未対応を選ぶ。

##### block の本文・欠損・時間範囲

| 項目 | 仕様 |
|---|---|
| 本文の役割 | primaryText は学習言語、secondaryText は母国語 |
| 本文結合 | 単位内の本文を保持し、各言語の採用単位を入力順に改行文字 `\n` でつなぐ |
| 元の本文 | 各 cue の空白・改行を保持する |
| 欠損 | 存在しない言語側の本文を `null` とする |
| 空の block | primaryText / secondaryText が両方 `null` の block は生成しない |
| primary がある block の時刻 | primaryの採用単位の最小開始時刻と最大終了時刻 |
| secondary のみの block の時刻 | 未対応secondary単位の開始時刻と終了時刻 |
| 各言語の独立した時刻 | block に別々の時間範囲として保持しない |
| 戻り値 | 新しい配列と block オブジェクトを返す。cue・track の参照を含めない |

`primaryText` / `secondaryText` は対称な `string | null` とし、
欠けている言語の本文を `null` で表す。共通型の定義は §18 を参照する。

##### block の出力順

| 項目 | 仕様 |
|---|---|
| 基本順 | primaryの正規化単位の入力順を軸にする |
| primary を含む block | primaryの正規化単位の入力順を維持する |
| primary 2単位をまとめた block | 先頭primary単位の位置に置く |
| secondary のみの block | secondary の開始時刻に従い、primary を軸にした並びへ挿入する |
| 同じ開始時刻 | primary を含む block を先、secondary のみを後に置く |
| secondary のみの block 同士 | secondaryの正規化単位の入力順を維持する |
| 並べ替えに使わないもの | 終了時刻、二言語か片言語かという種類の優先順位 |

primary を含む block の開始時刻には primary 側の開始時刻を使う。
secondary のみの block は、開始時刻がそれより大きい
最初の primary block の直前に挿入する。
該当する primary block がなければ末尾に置く。

primary が空の場合は、secondaryの正規化単位の入力順で片言語 block を返す。
両言語が空の場合は、空の配列を返す。

##### 呼び出し側の例外処理

入力条件違反の `RangeError` は、再生経路への接続時に呼び出し側で処理し、
該当更新の block / history を空にする。再生自体は停止しない。
古い字幕を、新しい更新に対する有効な結果として残さない。

予期しない例外まで一括して握りつぶさない。
例外処理や source の制御を builder 自身には持ち込まない。

### `subtitle-history.ts`

`SubtitleBlock[]` と現在の再生時刻から、current / past / future を導出する純関数とする。
共通型は §18、block の時間範囲と出力順は前項の builder の仕様を参照する。

```ts
// 共通型は §18 を参照する。
function deriveSubtitleHistory(
  blocks: readonly SubtitleBlock[],
  currentTime: number,
): SubtitleHistorySnapshot;
```

#### 再生位置からの導出仕様

| 項目 | 仕様 |
|---|---|
| 入力 | builder が構築した表示順の block 配列と現在の再生時刻 |
| 時刻条件 | currentTime は有限の非負数。不正な値は `RangeError` で拒否する |
| current の意味 | panel 上で再生位置を代表する1 block。発話中であることは保証しない |
| 選択条件 | `startTime <= currentTime` を満たす block のうち、startTime が最も大きいもの |
| 同じ開始時刻 | 表示順で最初の block を current にする |
| 時刻の基準 | block の startTime を使う。primary があれば primary 側、なければ secondary 側の開始時刻は builder が設定する |
| 終了時刻 | endTime を current の切り替え条件に使わない |
| 全行の強調 | 全 block が必ず一度 current になることは要求しない |
| past | current より前の block を表示順で返す |
| future | current より後の block を表示順で返す |
| 先頭より前 | current は null、past は空配列、全 block が future |
| 空配列 | current は null、past / future は空配列 |
| 空白区間・末尾 | 次の開始時刻に到達するまで、開始時刻方式で最後に選ばれる current を維持する |
| seek | seek 先の時刻から同じ規則で再計算する。前回の結果や再生方向に依存しない |
| 入力の保持 | 入力配列・block を変更せず、並べ替えない |
| 戻り値の型 | 既存の SubtitleHistorySnapshot を使う。SubtitleHistoryView は既存の別名として維持する |
| 責務境界 | source・TextTrack・video・DOMを直接読まず、購読・timer・スクロールを持たない |

past / future は「終了済み / 未開始」ではなく、panel 上の位置関係を表す。
同じ開始時刻の2件目以降は、開始時刻を過ぎても future に含まれる場合がある。
current 以外の block を、非選択という理由で取り除かない。

割合から切替時刻を作る方式と、終了時刻を理由に以前の block へ戻る方式は採用しない。
強調やスクロールのDOM処理は history に持ち込まない。

#### 境界時刻の例

| block の開始時刻・表示順 | 再生時刻 | current |
|---|---|---|
| A:10秒、B:11秒、C:12秒 | 10秒未満 | null |
| A:10秒、B:11秒、C:12秒 | 10秒以上11秒未満 | A |
| A:10秒、B:11秒、C:12秒 | 11秒以上12秒未満 | B |
| A:10秒、B:11秒、C:12秒 | 12秒以降 | C |
| A:10秒、B:10秒、C:18秒 | 10秒以上18秒未満 | A。Bはfutureに残す |
| A:10秒、B:10秒、C:18秒 | 18秒以降 | C。A・Bはpastに残す |

### `panel-host.ts`

以下は API の設計例であり、関数名・引数・戻り値の詳細を確定するものではない。
実装時は、本書で定義した責務・表示仕様・解放方針と照合して具体化する。

```ts
type PanelHost = {
  element: HTMLElement;
  dispose(): void;
};

function mountPanelHost(mountEl: HTMLElement): PanelHost;
```

### `panel-renderer.ts`

以下は API の設計例であり、関数名・引数・戻り値の詳細を確定するものではない。
実装時は、本書で定義した責務・表示仕様・解放方針と照合して具体化する。

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

以下は API の設計例であり、関数名・引数・戻り値の詳細を確定するものではない。
実装時は、本書で定義した責務・表示仕様・解放方針と照合して具体化する。

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

### `panel-open-close-button.ts`

以下は API の設計例であり、関数名・引数・戻り値の詳細を確定するものではない。
実装時は、本書で定義した責務・表示仕様・解放方針と照合して具体化する。

```ts
type PanelOpenCloseButtonBinding = {
  dispose(): void;
};

function mountPanelOpenCloseButton(args: {
  rootEl: HTMLElement;
  state: ExtensionUiState;
  onOpenChange: (open: boolean) => void;
}): PanelOpenCloseButtonBinding;
```

### `player-layout.ts`

```ts
// API の設計例。PlayerLayoutState は §18 を参照する。
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

controller は readiness 待機・開始停止・状態購読・字幕データの取得と更新通知を提供する。
共通型は §18、解放処理に失敗した場合の動作は §19 を参照する。

`subtitle` は字幕接続に使う設定入力であり、省略時は字幕接続を生成せず readiness の状態管理だけを行う。
`onSubtitleObservation` は任意の診断用 callback であり、字幕データの取得・更新通知とは分けて扱う。
`ReadySettings` は `docs/settings-spec.md`、`SubtitleSessionObservation` は `src/subtitles/subtitle-session.ts` を参照する。

```ts
type SessionStateListener = (state: SessionState) => void;

type SessionSubtitleInput = {
  settings: ReadySettings;
  fallbackSecondaryLang?: LanguageCode | null;
};

type SessionLifecycleOptions = {
  doc?: Document;
  now?: () => number;
  retryDelayMs?: number;
  scheduleRetry?: (
    callback: () => void,
    delayMs: number,
  ) => DisposeFn;
  subtitle?: SessionSubtitleInput;
  onSubtitleObservation?: (
    observation: SubtitleSessionObservation | null,
  ) => void;
};

type SessionLifecycleController = {
  getState(): SessionState;
  getSubtitleSnapshot(): SubtitleSessionSnapshot | null;
  subscribeSubtitle(listener: () => void): DisposeFn;
  start(target: PlaybackTarget | null, reason?: RestartReason): void;
  stop(): void;
  dispose(): void;
  subscribe(listener: SessionStateListener): DisposeFn;
};

function createSessionLifecycle(
  options?: SessionLifecycleOptions,
): SessionLifecycleController;
```

上記の start は開始操作を示す。検出元からの再評価要求を受ける具体的な
公開操作・引数は、§13 の責務境界に従って実装提案時に具体化する。
検出元が target 比較・理由選択を行って start を繰り返す契約とはしない。

- readiness 待機と retry は lifecycle が所有する。
- 待機 bag は解除前に保持参照から切り離す。
- 待機 cleanup の失敗は記録し、停止・再開始・破棄の後処理を継続する。
- getState は state の外側と waiting 情報をコピーする。処理中の target と DOM 参照は共有するが、stop / dispose 後は target:null、waiting:null、status:stopped とする。
- getSubtitleSnapshot は現在の字幕接続の getSnapshot に委譲する。接続なし・破棄後は null とし、接続中の空 snapshot と区別する。
- lifecycle は字幕 truth や取得結果を保持・再コピーしない。データ境界は本節の subtitle-session API を参照する。
- subscribeSubtitle は即時通知せず、接続後の初回・接続の更新・旧接続のクリアを引数なしで通知する。状態購読と診断観測とは分離する。
- データ通知の購読者の例外は記録して後続を継続する。登録単位で冪等に解除し、通知中に解除した登録は呼ばず、新規登録は次の更新から扱う。
- 接続解除前に参照を切り離し、世代を更新する。中継購読の解除から字幕接続の破棄の順にすべて試し、失敗は記録する。
- 接続・データ通知の世代を確認し、旧 callback と、通知中の停止・再開始・新しい更新によって古くなった処理を継続しない。
- stop は旧接続の参照を切り離した後に必要なクリア・停止通知を送り、controller の公開購読を維持する。
- controller の dispose では状態・字幕データの購読者を解放し、最終通知を送らない。
- dispose 後は新しい開始と購読を受け付けない。
- 再開時は新しく解決した target を使い、終了した処理 session の target を保持して再利用しない。

§12〜§13 は session 全体の接続・restart・cleanup の責務と順序を定義する。
本節は、その制御に用いる controller の公開 API を定義する。

---

## 18. `src/shared/types.ts` の共通型

`src/shared/types.ts` では、module 境界で共有する最低限の型を定義する。
本節はその共通型を定義する場所とし、§17 では再定義せず参照する。

StoredSettings は言語設定の未完了を表現できる内部共通型である。
保存成功時の必須条件と、settings store が返す ReadySettings は
`docs/settings-spec.md` を参照する。

全作品共通の ON/OFF の保存値と、runtime の ExtensionUiState は区別する。
ON/OFF の取得結果型は settings-spec の未決事項を確定してから具体化し、
以下の言語設定型へ無条件に追加しない。

```ts
export type StoredSettings = {
  primaryLang: LanguageCode | null;
  secondaryLang: LanguageCode | null;
};

export type ExtensionSettings = StoredSettings;

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

export type PlaybackTarget = {
  rootEl: HTMLElement;
  videoEl: HTMLVideoElement;
  panelMountEl: HTMLElement;
  layoutTargetEl: HTMLElement;
  snapshot: PlaybackTargetSnapshot;
};

export type PlaybackTargetSnapshot = {
  rootEl: HTMLElement;
  videoEl: HTMLVideoElement;
  panelMountEl: HTMLElement;
  layoutTargetEl: HTMLElement;
};

export type PlaybackTargetComparison = {
  isSameTarget: boolean;
  hasRootChanged: boolean;
  hasVideoChanged: boolean;
  hasPanelMountTargetChanged: boolean;
  hasLayoutTargetChanged: boolean;
};

export type LanguageCode = string;

/** 正規化した時点の字幕 track 情報。実際の TextTrack 参照を含む。 */
export type ResolvedSubtitleTrack = {
  id: string;
  language: LanguageCode;
  label: string;
  kind: TextTrackKind | string;
  mode: TextTrackMode;
  track: TextTrack;
};

export type SubtitleTrack = ResolvedSubtitleTrack;

export type ResolvedTrackPair = {
  primary: ResolvedSubtitleTrack | null;
  secondary: ResolvedSubtitleTrack | null;
};

export type SubtitleTrackRole = 'primary' | 'secondary';

/** index は正規化時点の textTracks 内の位置であり、永続識別子ではない。 */
export type SubtitleTrackCandidate = ResolvedSubtitleTrack & {
  index: number;
};

/** cue 1 件分の一時表現。SubtitleBlock[] の構築前に利用する。 */
export type SubtitleCueSnapshot = {
  startTime: number;
  endTime: number;
  text: string;
  track: ResolvedSubtitleTrack | null;
};

/** source 全体の取得時点の状態。cue 単体の snapshot とは区別する。 */
export type SubtitleSourceSnapshot = {
  pair: ResolvedTrackPair;
  primaryCues: SubtitleCueSnapshot[];
  secondaryCues: SubtitleCueSnapshot[];
};

export type SubtitleSourceChange =
  | { type: 'bound' }
  | { type: 'unbound' }
  | { type: 'cuechange'; role: SubtitleTrackRole };

export type SubtitleSourceListener = (change: SubtitleSourceChange) => void;

/** 欠けている言語の本文は null。両側欠損の block は builder が生成しない。 */
export type SubtitleBlock = {
  startTime: number;
  endTime: number;
  primaryText: string | null;
  secondaryText: string | null;
};

export type SubtitleHistorySnapshot = {
  current: SubtitleBlock | null;
  past: SubtitleBlock[];
  future: SubtitleBlock[];
};

export type SubtitleHistoryView = SubtitleHistorySnapshot;

export type ExtensionUiState = {
  extensionEnabled: boolean;
  panelOpen: boolean;
};

export type UiState = ExtensionUiState;

export type UiStateListener = (state: ExtensionUiState) => void;

export type PlayerLayoutState = {
  active: boolean;
  availableWidth: number | null;
  playerWidth: number | null;
  panelWidth: number | null;
};

export type WaitingState = {
  startedAt: number;
  retryCount: number;
  targetVideo: HTMLVideoElement;
};

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
      target: null;
      waiting: null;
      reason: RestartReason | null;
    };

export type SessionState = PlaybackSessionState;

export type DisposeFn = () => void;

export type Disposable = {
  dispose: DisposeFn;
};

export type UiStateStore = {
  getState(): ExtensionUiState;
  setExtensionEnabled(enabled: boolean): void;
  setPanelOpen(open: boolean): void;
  subscribe(listener: UiStateListener): DisposeFn;
};
```

`PlayerLayoutState` は `player-layout.ts` の内部または layout module 境界でのみ利用する。  
`ui-state.ts` は `PlayerLayoutState` を保持・更新しない。

型は最小限に留め、DOM 観測ログ由来の一時情報や debug 専用情報を混ぜない。

---

## 19. `src/shared/dispose.ts` の cleanup helper

`src/shared/dispose.ts` は cleanup の共通基盤だけを提供する。
`DisposeFn` と `Disposable` の定義元は `src/shared/types.ts` とする。

責務は次の通りとする。

- disposer の登録
- reverse-order cleanup
- 二重 dispose 防止
- 複数 module の `dispose()` を1つに合成する helper
- cleanup 失敗時にも残りを試し、失敗を集約して報告する

#### cleanup の実行と失敗

- bag の dispose は、登録の逆順で各 cleanup を一度ずつ試す。
- 途中で例外が発生しても、残りの cleanup を続ける。
- 失敗があれば、全件の試行後に AggregateError を投げる。
- 2 回目以降の bag.dispose は何もしない。失敗した cleanup も自動再試行しない。
- add が返す個別 disposer も、成功・失敗にかかわらず一度だけ試す。
- 個別 disposer の直接実行時は、その cleanup の例外をそのまま呼び出し元へ返す。
- dispose 済み bag への add は、その場で cleanup を実行する。失敗時は例外をそのまま返す。
- composeDisposers が返す disposer も、bag と同じく登録の逆順で一度だけ実行し、失敗をまとめて報告する。

#### owner 側の処理

- bag の呼び出し側は、cleanup 失敗を記録し、必要な参照整理や停止処理を継続する。
- resource の実際の解除処理は各 owner に置き、共有基盤へ移さない。
- 「すべての解除を試したこと」と「すべての解除が成功したこと」を区別する。
- 解除に失敗した resource が消えたとは扱わず、失敗をログに残す。

公開 API は次の程度に留める。

```ts
export type DisposeEntry = Disposable | DisposeFn | null | undefined;

export type DisposeBag = Disposable & {
  add(entry: DisposeEntry): DisposeFn;
};

export const createDisposeBag = (): DisposeBag;

export const composeDisposers = (
  ...entries: DisposeEntry[]
): DisposeFn;
```

`createDisposeBag()` は module 内で cleanup 対象を登録し、登録の逆順で一度だけ cleanup する。
`composeDisposers()` は複数 module が返す cleanup を session lifecycle などの実行 owner が 1 つに合成するために使う。

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
