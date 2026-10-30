# Minimal Panel Architecture

この文書は、Apple TV+ 向け二言語字幕 Chrome 拡張 v2 の最小構成アーキテクチャを定義する。

本書は `docs/minimal-panel-architecture.md` 単体で読めることを前提とし、次の内容だけを扱う。

- モジュール構成
- 各ファイルの責務
- 依存方向
- データフロー
- `SubtitleTimeline` を中心にした 元の字幕データ の扱い
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
| 元の字幕データ | 各言語の本文・開始時刻・終了時刻を独立して保持する正本。表示上の結合で変更しない |
| 学習言語枠 | 開始・終了時刻が両方完全一致する学習言語字幕を、元の順序で収めた枠 |
| 結合候補 | 同じ1件の母国語字幕が正の時間だけ重なる、連続した複数の学習言語枠 |
| 表示ブロック | セリフ字幕を学習言語が上・母国語が下になるよう収めた表示単位。元の字幕データから導出する |
| 補助字幕 | 本文全体が完全な`〝…〟`の囲みで構成される元字幕を、セリフとは別の枠に表示するもの。複数囲みも元字幕1件で1枠とする。詳細は§14.2 |
| ブロックの現在状態 | ブロックの最早開始以上・最遅終了未満の再生位置。元字幕単位の有効状態とは区別する |
| `TimedSubtitleText` | 1言語の元の開始・終了時刻と本文を持つ字幕単位 |
| `SubtitleTimeline` | primary / secondary の字幕単位を別配列に保持する元の字幕データの正本 |
| `SubtitleHistorySnapshot` | 元字幕単位の過去・現在・未来を持つ既存の読み取り結果。表示ブロックの状態とは別 |
| past / current / future | 終了済み・表示期間内・未開始の字幕区分。各区分は言語別配列を持つ |
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
| view helper | 元の字幕データ から renderer 向けの読み取り結果を導出する純粋な helper |
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
- 元の字幕データ の流れ
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
- 字幕取得、track 解決、元の字幕データ 構築、panel 描画、session cleanup は分離する
- 元の字幕データ は `SubtitleTimeline` を中心に扱う
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
- 元の字幕データ、UI state、layout state は別物として扱う
- `ui-state.ts` は `extensionEnabled` と `panelOpen` だけを扱い、寸法、style、observer、layout timer を持たない
- `player-layout.ts` は `PlayerLayoutState`、layout style、layout observer、layout timer だけを扱い、元の字幕データ と ON/OFF 操作の意味づけを持たない
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
│  ├─ session-lifecycle.ts
│  │  └─ 処理 session の開始停止、controller の最終 dispose、readiness 待機・retry、target 再評価と restart 判断を所有する
│  └─ panel-session.ts
│     └─ 字幕データ境界・UI store と panel を接続し、接続に属する購読と cleanup 合成を所有する
│
├─ subtitles/
│  ├─ subtitle-source.ts
│  │  └─ 字幕取得と track binding の統一窓口
│  ├─ subtitle-session.ts
│  │  └─ resolver・source・元の字幕データ・history の接続と、そのruntime結果・監視・cleanupを所有する
│  ├─ text-track-resolver.ts
│  │  └─ TextTrack を正規化し、primary / secondary 採用判定を行う
│  ├─ native-menu-sync.ts
│  │  └─ Apple TV+ ネイティブ字幕メニュー listener の attach / detach を扱う
│  ├─ subtitle-timeline.ts
│  │  └─ sourceの言語別cueを検証し、元時刻・本文を保持する元の字幕データを構築する
│  ├─ subtitle-text-parts.ts〈新規実装予定〉
│  │  └─ 表示本文の準備・セリフと補助の分類・変換失敗の有無を返す
│  ├─ subtitle-display-blocks.ts〈新規実装予定〉
│  │  └─ 同じ世代の元字幕と準備結果から表示枠を構築する
│  └─ subtitle-history.ts
│     └─ 元字幕の分類と表示枠の分類を別の関数で導出する
│
├─ panel/
│  ├─ panel-host.ts
│  │  └─ panel host DOM の生成、mount、unmount を担当する
│  ├─ panel-renderer.ts
│  │  └─ display と UI state を受け、枠DOM・本文・並び・強調を更新する
│  └─ panel-follow.ts〈新規実装予定〉
│     └─ 閲覧位置の維持・操作listener・自動追従・解除を所有する
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
│  ├─ ui-state.ts
│  │  └─ extension enabled / panel open を持つ small store
│  └─ extension-enabled-controller.ts
│     └─ ON/OFF の復元・操作・保存順序・通知状態を所有する（Phase 7で実装）
│
├─ settings/
│  ├─ language-options.ts
│  │  └─ 対応言語 code の一覧と候補判定を提供する
│  └─ settings-store.ts
│     └─ 言語設定と全作品共通の ON/OFF の読込・保存を行う
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

表示処理の追加配置はsubtitle-text-parts.ts（本文準備・囲み分類）、subtitle-display-blocks.ts（枠構築）、panel-follow.ts（位置維持・追従）とする。これらは配置を確定した新規実装予定のmoduleであり、実装済みファイルと混同しない。入出力は§17に従う。

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
- source・video・DOM を直接読まず、元の字幕データ 構築や UI 描画を行わない
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

### `src/content/panel-session.ts`

lifecycleが生成・終了を所有するpanel接続を組み立てる。字幕取得・更新購読と既存UI storeの読取・購読を入力として受け取り、host・renderer・followを接続する。
字幕通知とUI通知を区別し、同じ描画入力についてfollowの描画前処理、renderer更新、更新の有効性確認、followの描画後処理の順で委譲する。元字幕historyやtimelineをpanelで再導出せず、displayだけを描画へ渡す。接続なしのnullを正常な空や失敗と混同せず、旧historyへの表示fallbackを残さない。
panel closeで字幕接続・UI storeを破棄しない。取得・描画・後処理中の再入と停止を遮断し、古い処理で新しいDOM対応を無効化しない。初期化・cleanupの両失敗を保持し、更新通知内の失敗は記録して後続更新を処理する。自動retryは追加しない。
接続を無効化してからUI購読・字幕購読・follow・renderer・hostの順で解除を試す。一部の解除失敗後も残りを試し、反復disposeで再試行しない。
UI意思の変更、target探索、readiness、restart判断、字幕構築、スクロールのアルゴリズム、layoutは持たない。DOM所有は各panel moduleへ委譲する。具体的な入出力は§17を参照する。

### `src/subtitles/subtitle-session.ts`

元字幕timeline・元字幕history・準備結果・表示枠構成・表示状態と更新世代のownerとする。本文準備・枠構築・分類は専用関数へ委譲し、結果を同じ更新として公開する。更新・失敗復帰・コピー保護は§14.10、公開操作は§17に従う。
source・track一覧・videoイベントの監視は既存dispose基盤で所有する。panelへ独立したvideo listenerや字幕取得経路を追加しない。dispose開始時に旧callbackと通知を無効化し、保持データ・購読者・各資源を解放する。DOM描画・スクロール・診断を有効条件とする処理は持たない。

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

### `src/subtitles/subtitle-timeline.ts`

primary / secondaryのcue配列を検証し、言語別の `SubtitleTimeline` を構築する純関数とする。
元の時刻・本文・言語内の入力順を保持し、cue・track・video・DOMの参照を元の字幕データへ持ち込まない。
対訳候補・採点・消費・ペアブロックを作らず、本文の意味による切り分けや時刻の調整もしない。

### `src/subtitles/subtitle-history.ts`

`deriveSubtitleHistory(timeline, currentTime)` は元字幕単位を、`deriveSubtitleDisplayHistory(blocks, currentTime)` は表示枠を、それぞれpast / current / futureへ分類する純関数とする。
元字幕の分類と表示枠の分類を混同せず、それぞれ全区分で同じ構成単位を使う。currentだけ別の入力から作ったり、履歴だけ対訳ペアを作ったりしない。
入力を変更・並べ替えず、購読・timer・DOM・スクロールを持たない。

### `src/panel/panel-host.ts`

panel DOM の土台だけを所有する。

- host 要素の生成
- mount
- unmount
- 参照破棄

panel host の mount / unmount の owner はこの module だけとする。

### `src/panel/panel-renderer.ts`

- displayとUI意思を受け、準備済み本文をtextContentで描画する。本文変換・fallback・枠構築・時刻判定を重複しない。
- 同じ世代の枠DOMを再利用し、言語内順序・改行・空白・片言語の空間を維持する。
- スクロール領域・枠DOM・「現在位置へ」ボタンDOMを所有する。DOM対応をfollowへ貸し出すが、listener・スクロールはfollowへ委譲する。
- 接続なし・正常な空・利用不能を内部で区別し、古い枠を残さない。画面は字幕一覧を空にし、案内文・再試行ボタンを追加しない。不正時刻の表示は§14.10に従う。
- source・video・TextTrack・Apple TV+ selectorを直接持たず、自身のDOMと参照を解除する。具体的な公開定義は§17を参照する。

### `src/panel/panel-follow.ts`〈新規実装予定〉

案内対象選択・閲覧位置の記録と復元・即時スクロール・ユーザー操作検知・手動停止と明示再開を所有する。現在借りているDOM対応、listenerと予約処理を同じownerが解放する。本文変換・元字幕分類・枠構築を行わず、source・videoを直接読まない。§14.10・§14.12の規則と§17の定義に従う。新規実装予定のmoduleを実装済みとして扱わない。

### `src/subtitles/subtitle-text-parts.ts`〈新規実装予定〉

既存subtitle-textの変換を再利用し、字幕ごとの原文fallbackと完全囲みの判定でセリフ/補助へ分類する。元言語・入力位置を保持し、枠構築・現在判定・購読・panel DOMを持たない。

### `src/subtitles/subtitle-display-blocks.ts`〈新規実装予定〉

同じ世代のtimelineと準備結果から、セリフの学習言語枠・候補・競合・母国語配置・補助枠・固定順を導出する。本文変換と時刻更新を重複せず、listener・timer・observer・DOMを持たない。

### `src/panel/subtitle-text.ts`

- `toSubtitlePlainText(text, parse?)` は文字列だけを受け取り、表示用のプレーンテキストを返す。字幕取得・対応づけ・current 選択はしない。
- 標準経路は一時 VTTCue の getCueAsHTML() で一度解析し、作業用 fragment の rt を除いて textContent を読む。画面には fragment を挿入しない。
- ruby の親文字、元の空白・改行・句読点を保持し、読み仮名・傍点・装飾は表示へ持ち込まない。解析後の文字列を再解釈しない。
- source / 元の字幕データの元本文を変更しない。表示側は返された文字列をtextContentで描画し、HTMLとして挿入しない。
- parse は専用の未接続 fragment を返す差替え境界。戻り値を他と共有しない。helper は参照・キャッシュ・購読を保持しない。
- API 不在・解析・DOM 操作の失敗は例外で返す。fallback とログは接続時に呼出元が判断する。空結果は空のまま返す。

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

字幕内容、元の字幕データ、source、ON/OFF toggle の意味づけには依存しない。
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

`ui-state.ts` は元の字幕データ、寸法、style、layout observer、layout timer、track、video を持たない。

store は現在の処理 session より長く存続できる操作側 runtime として扱い、
処理 session の start ごとに作り直さない。
保存値の読込・保存は settings-store に委譲し、Storage API は直接扱わない。
state の初期化・維持条件は §16 を参照する。

### `src/ui/extension-enabled-controller.ts`

操作側 runtime の ON/OFF 復元・明示操作・保存順序・通知状態の唯一の owner とする。生成関数は createExtensionEnabledController とし、Phase 7 で実装する計画である。

- settings-store の専用 API に読込・保存を委譲し、Storage API を直接扱わない。
- 現在の ON/OFF は ui-state を正本とし、別の有効状態を重複保持しない。保存要求には操作時点の boolean だけを記録する。
- 初期化状態、通知状態、最新操作番号、保存要求の列、保存処理中か、dispose 済みかを保持する。これらは保存しない。
- 初期読込中の明示操作を優先し、遅れた読込結果で選択値・通知を戻さない。
- OFF→ON の明示操作では panel を開き、ON→OFF では閉じる。再保存や同じ ON の再要求で手動 close を解除しない。
- 復元は保存値の適用までとし、新しい視聴の panel 初期表示は開始側の規則に従う。単なる復元で毎回開き直さない。
- 保存を直列化し、古い結果は最新状態・通知に反映しない。一件の失敗で後続保存を止めない。
- 保存中もトグル操作を受け付ける。回復操作の重複要求は抑止する。
- DOM・video・track・元の字幕データ・layout を持たず、lifecycle を直接呼ばない。UI state の有効状態を受け取る接続側が、開始停止を lifecycle へ委譲する。

#### 寿命と cleanup

- OFF、panel close、技術的 restart では維持する。トグル DOM の再生成では古い UI の購読だけを解除する。
- content の top-level owner が controller の dispose を保持し、操作側 runtime の最終終了時に実行する。
- dispose 後は新しい操作・購読を受け付けず、遅れた読込・保存結果で state 更新・通知を行わない。
- 未開始の保存要求は破棄する。開始済み書込みは結果を受け止めるが UI へ反映せず、取り消せたとは扱わない。
- 購読者と不要な参照を解放し、繰り返し dispose しても安全にする。終了前の未完了保存の永続化は保証しない。

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
- `TimedSubtitleText` / `SubtitleTimeline`
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
- `panel-session.ts` は panel 接続の購読と follow / renderer / host の cleanup 合成を所有し、lifecycle が接続の disposer を保持する
- `panel-host.ts` は panel host の mount / unmount を所有する
- `panel-renderer.ts` はスクロール領域・枠・「現在位置へ」ボタンのDOMを所有し、followへ貸し出す
- `panel-follow.ts` は操作listener・予約処理・借用DOM参照を所有して解放する。借用DOM自体は除去せず、外部購読の解除後、renderer / hostの破棄前にdisposeする
- `native-menu-sync.ts` は native menu listener の attach / detach を所有する
- `player-layout.ts` は layout state、layout style、observer、layout timer の適用・解除を所有する
- `on-off-toggle.ts` は ON/OFF toggle の DOM と controls binding を所有する
- `panel-open-close-button.ts` は panel 開閉ボタンの DOM と controls binding を所有する
- `ui-state.ts` は UI state とその購読機構を所有する
- `extension-enabled-controller.ts` は操作側の初期読込・保存要求列・通知状態とその購読機構を所有する

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
subtitle-timeline.ts
subtitle-history.ts
subtitle-text-parts.ts
subtitle-display-blocks.ts
panel-host.ts
panel-renderer.ts
panel-follow.ts
on-off-toggle.ts
panel-open-close-button.ts
player-layout.ts
shared/*
```

操作側は content/index → extension-enabled-controller → settings-store / ui-state の一方向とする。ON/OFF UI は配線された操作 callback と表示入力を使い、controller は DOM や lifecycle に依存しない。

依存ルールは次の通りとする。

- `session-lifecycle.ts` → `panel-session.ts` → host / renderer / follow / shared を panel 接続の依存方向とする。panel-session は渡された取得・購読境界と UI store を使い、lifecycle 本体へ逆依存しない
- `subtitle-text-parts.ts` は既存の `src/panel/subtitle-text.ts` の本文変換helperを再利用する。この依存は本文変換だけに限定し、panelの描画・host・followへ依存しない。helperは入力文字列から表示用文字列を作り、画面のpanel DOMを操作しない
- `panel-renderer.ts` は `subtitle-source.ts` に依存しない
- `subtitle-source.ts` は `panel-host.ts` や `panel-renderer.ts` に依存しない
- `subtitle-timeline.ts` は DOM を触らない
- `subtitle-history.ts` は 元の字幕データ を変更しない
- `player-layout.ts` は字幕データを知らない
- `ui-state.ts` は Chrome Storage、video、track、layout style を触らない
- `settings-store.ts` は session 内 DOM を触らない
- `playback-root.ts` は discovery 結果を返すだけで、readiness 待機や restart を持たない
- `session-lifecycle.ts` は session owner として各 module の `dispose()` を束ねる

---

## 9. データフロー

`SubtitleTimeline`に、各言語の元の本文・開始時刻・終了時刻を保持する。表示ブロックと補助字幕は同じ元データから導出し、別の字幕本文の正本を作らない。

```text
設定とtrack解決          settings-store / text-track-resolver
  ↓
言語別cue取得            subtitle-source
  ↓
入力検証・元字幕コピー  subtitle-timeline → SubtitleTimeline
  ↓
表示用本文の準備        標準WebVTT解析・ruby注釈の除去
  ↓
囲み判定による分類      元字幕ごとにセリフ側 / 補助側へ分類
  ├─ セリフ側
  │    ↓
  │  セリフブロック構築    学習言語枠 → 結合候補 → 競合処理 → 母国語の配置
  │    │
  └─ 補助側             元字幕1件につき独立した1つの補助枠
       │                セリフブロックとは結合しない
       └─ セリフ枠・補助枠を合流
            ↓ 再生時刻
表示状態と一覧順の導出  両種の枠の過去・現在・未来と全体強調、区分内の固定順
  ↓
表示接続と描画          lifecycle / panel-session → panel-renderer
```

これは製品の表示仕様に必要な処理の流れであり、未実装moduleのファイル名を確定する図ではない。各処理の責務は§14、具体的な公開型・関数配置の未確定事項は同節末尾を参照する。
source更新では元データと派生結果を再構築する。時刻だけの更新では構築済みブロックの状態だけを再計算する。取得だけでは再構築せず、同じ世代の結果を公開する。
§17・§18の字幕単位historyは既存の取得境界として区別し、表示ブロックの現在状態へ読み替えない。rendererはsource・videoを読まず、sourceはpanel DOMを操作しない。
意味による対訳判定、別経路の現在字幕store、再生履歴を蓄積して作るブロックは導入しない。

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

## 11. `SubtitleTimeline` と元の字幕データ

`SubtitleTimeline` はprimary / secondaryの `TimedSubtitleText[]` を別々に保持する元の字幕データの正本である。
各単位は元cueの開始時刻・終了時刻・本文を保持する。対応関係の推測や言語間のペア化はしない。
同時に有効な複数件と、時刻の異なる同じ本文を保持する。元時刻・本文・言語内の順序を変えない。
完全重複の除去・同時刻の本文結合も自動では行わず、入力の各要素を1単位として保持する。
型の正本は§18、入力検証・分類の正本は§17とする。
以下のcurrentは元字幕単位の時刻分類であり、§14の表示ブロック全体の強調とは区別する。

- 元のcue・track・video・DOMの参照、永続ID、表示用stateを含めない。
- past / current / futureは同じ元字幕データの読み取り結果であり、別の元の字幕データではない。
- 同じ入力要素は必ず1つの区分だけへ入る。同じ値の別入力要素は別件として保持する。
- currentは複数件または0件でよい。代表1件を選ばず、終了後の字幕をcurrentに残さない。
- 元字幕単位のpast/current/futureと、表示ブロックの状態を区別する。panelの表示単位と全体強調は§14に従う。
- 各言語内は入力順を維持し、rendererで並べ替え・対訳推測・本文移動をしない。
- 表示用本文変換は元の字幕データを変更せず、描画境界で行う。

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
subtitle-timeline.ts で SubtitleTimeline を構築
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
| 元の字幕データ・history・active target / video / track 参照 | 解放する | 解放する |
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

再生時刻の更新や seek 後は、保持済みの `SubtitleTimeline` と現在時刻から history を導出する。
source の更新や未取得 cue の読込みに伴う 元の字幕データ の再構築とは区別し、
seek自体を理由にcue本文を再取得したり、timelineを再構築したりしない。

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
- session 内で保持した 元の字幕データ と history snapshot
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

## 14. 字幕の構成とpanel表示

本節は製品の表示仕様を定義する。型・関数・受け渡し方法を具体化する際の確認事項は14.10へ集約する。§17・§18に記載した既存の字幕単位APIが、この表示仕様の実装完了を意味するわけではない。

### 14.1 入力と出力

入力は、学習言語・母国語それぞれの元の字幕データと再生時刻である。元字幕の時刻・本文・言語内順序を変更しない。入力検証は§17のsubtitle-timelineに従う。
出力は、セリフの表示ブロック、そのブロックの過去・現在・未来と全体強調、セリフから分離した補助字幕とする。表示ブロックは元データからの導出結果であり、意味上の対訳ペアではない。

### 14.2 表示用本文と補助字幕

- 標準WebVTT解析とruby注釈除去で表示用本文を準備する。タグ付き原文は元データに保持する。
- 全言語・両言語役割に同じ判定を適用する。正常に変換できた本文が、入れ子のない完全な`〝…〟`の囲み1組以上と、その前後・組間の空白や改行だけで構成される場合、元字幕全体を補助字幕へ分類する。囲み記号・空白・改行・順序を保持する。
- 複数囲みも分割せず、元字幕1件につき独立した1つの補助枠にする。元字幕の開始・終了時刻を使い、文字位置から時刻を推測しない。
- 囲みの外に空白・改行以外の文字がある部分囲みは適用しない。閉じ忘れ・不完全な囲み・入れ子も修復や部分抽出をせず、本文全体をセリフ側に残す。
- 本文変換に失敗した字幕は、元本文全体をセリフ側に残し、囲み判定を行わない。他の字幕の変換・後続更新は継続する。fallbackもHTMLとして挿入せずtextContentで表示する。
- `vertical`・`line`・`position`などの配置情報や、縦書きだけを分類条件にしない。`︱`の文字置換や意味による画面内文字の分類も行わない。
- 補助字幕はセリフブロックの構成、言語間の結合・配置比較、セリフブロックの開始・終了に使わず、元データから削除しない。補助字幕同士の言語間ペア化もしない。

| 変換後の入力例 | 分類 |
|---|---|
| `〝コ︱チ〟` | 元字幕全体を補助へ |
| `〝人物紹介〟 〝地名〟` | 全体を1つの補助枠へ |
| `こんにちは 〝コ︱チ〟` | 全体をセリフ側へ |
| `〝コ︱チ`、`〝外側〝内側〟〟` | 全体をセリフ側へ |

### 14.3 学習言語枠

開始・終了時刻が両方完全一致する学習言語字幕を、元の入力順で1つの枠に入れる。2断片・3断片・多数件という件数だけでは分割しない。
これは表示上の集約であり、元データの本文結合や重複除去ではない。時刻の異なる枠の結合は14.4で処理する。

### 14.4 母国語字幕による結合と競合処理

1. 補助字幕を分離した後のセリフ字幕を使う。
2. 同じ1件の母国語字幕が、入力順で連続する複数の学習言語枠すべてと正の時間だけ重なる場合、その枠の集合を結合候補とする。終了と開始が接するだけでは重なりとしない。重なる学習言語枠全体が入力順で非連続の場合は、その母国語による結合候補を作らず、14.5の配置へ回す。
3. 候補は、根拠となる母国語字幕の開始時刻が早い順に処理する。開始時刻が同じ場合は、その母国語字幕の元の入力順を優先する。
4. 競合しない候補を確定し、根拠となった母国語字幕を同じブロックへ入れる。確定済みの学習言語枠を含む競合候補は採用しない。
5. 別の母国語字幕を介して、確定ブロックをさらに拡張しない。同じ字幕を複数のブロックへ配置しない。
6. 時間幅・学習言語枠数・表示文字量だけを理由に、候補を分割または不採用にしない。極端に長くても同じ重なり条件と競合処理に従う。元字幕を切断・複製せず、意味による対訳判定・再分割・採点も行わない。

候補の採用順序は入力データだけで決め、再生方向・再生済みかどうか・イベント到着順に依存させない。

### 14.5 結合に使わなかった母国語字幕

結合の根拠として配置されていない母国語字幕は、結合確定後の学習言語枠へ次の順で1回だけ配置する。

1. 学習言語が実際に存在する区間との重なり時間が最大の枠。
2. 同点なら、枠内の学習言語の最早開始時刻が早い枠。
3. それも同じなら、枠内で最初の学習言語の元入力位置が早い枠。

比較区間は枠内の学習言語の区間の和集合とし、内部の空白は含めず、重複時間は二重計上しない。結合確定時点で比較区間・学習言語の最早開始・元入力位置を固定する。根拠となった母国語も後から配置した母国語も、この比較基準を変更しない。
重なる学習言語枠がなければ母国語だけのブロックとして残す。本文を捨てたり、対応を合わせるために時刻を切ったりしない。元入力位置は同じ世代内だけで使い、永続IDにしない。
母国語の配置による範囲の延長は表示・強調に反映するが、次の配置比較や学習言語枠の再結合には使わない。1つの学習言語枠へ複数の母国語が配置される場合も、各言語内の元入力順を保持する。

### 14.6 ブロックの時間範囲と全体強調

ブロック開始は含まれるセリフ字幕の開始の最小値、ブロック終了は終了の最大値とする。補助字幕は含めず、空ブロックは生成しない。

| 状態 | 条件 | 表示 |
|---|---|---|
| 未来 | `currentTime < block.startTime` | 通常表示 |
| 現在 | `block.startTime <= currentTime && currentTime < block.endTime` | 学習言語・母国語を含む枠全体を強調 |
| 過去 | `block.endTime <= currentTime` | 通常表示で保持 |

強調は個別字幕の有効状態で切り替えない。内部の空白、母国語の切替、学習言語の先行終了があっても、ブロックの範囲内なら全体強調を継続する。元字幕の時刻は変更せず、判定時に丸めない。

各ブロックは学習言語を上、母国語を下に表示し、各言語の元の入力順・改行・空白を維持する。片言語だけでも、存在しない側の空間を残す。存在しない字幕を補完したり、本文を他言語側へ移したりしない。
過去・現在・未来を通じて同じ枠の構成を保持する。構成は取得済み字幕から作り、再生履歴を蓄積して作らない。同じ入力と時刻なら前後seekでも同じ結果にする。
時間範囲が重なる場合も各ブロックを独立に判定し、現在条件を満たすすべてのブロックを同じ扱いで全体強調する。代表1件には絞らない。補助枠は元字幕自身の開始以上・終了未満で全体強調し、片言語の空間も維持する。セリフ枠と補助枠は同じ一覧に保持する。配置比較に使う学習言語の区間と、両言語を含むセリフブロックの強調範囲は区別する。一覧順は14.11、自動追従は14.12に従う。

### 14.7 具体例：同時刻の英語2件と日本語3件

| 言語 | 開始〜終了（秒、表示上の概数） | 本文 |
|---|---|---|
| 学習言語 | 48.098〜51.934 | - Hey, kiddos! |
| 学習言語 | 48.098〜51.934 | - Oh, my gosh, a puppy. |
| 母国語 | 48.131〜49.131 | 子供たち！ |
| 母国語 | 49.341〜50.717 | あれは… |
| 母国語 | 50.842〜52.010 | 子犬さん！ |

5件を1ブロックに収め、`48.09800833333331`秒以上、`52.01037777777778`秒未満で全体を強調する。各日本語の切替間と英語終了後も、枠の強調を途切れさせない。

### 14.8 具体例：結合候補の競合

入力を学習言語A:[10,12)、B:[12,14)、C:[14,16)、母国語①:[10,14)、②:[12,16)とする。

| 処理 | 結果 |
|---|---|
| 母国語①の候補 | 開始が早いためA・Bの結合を確定し、①を配置する |
| 母国語②の候補 | Bが結合済みなのでB・Cの結合は行わない |
| 母国語②の配置 | A・B側とC側の重なりが各2秒。同点では開始の早いA・B側へ入れる |
| 最終結果 | A・B・①・②のブロック:[10,16)、Cのブロック:[14,16) |

```text
学習言語  A:[10,12) → B:[12,14) → C:[14,16)
母国語    ①:[10,14)   ②:[12,16)
                     ↓
枠1 [ A + B + ① + ② ]   枠2 [ C ]
      [10,16)                  [14,16)
```

入力字幕の重複配置はないが、ブロックの時間範囲は重なる。この違いを区別し、重なりを消すために元時刻を補正しない。14秒以上16秒未満では両ブロック全体を強調し、16秒ちょうどで両方の強調を外す。元字幕単位では14秒以上16秒未満の現在はCと②であり、A・B・①を現在へ戻すわけではない。

### 14.9 処理境界・公開・cleanup

| 処理 | 責務 |
|---|---|
| subtitle-source / subtitle-timeline | trackからの取得、入力検証、言語別の元字幕コピー。囲みを理由に入力を捨てない |
| 表示用本文の準備 | 標準解析・ruby注釈除去。作業用DOM断片は呼出し内に閉じ込める |
| 囲み分類 | 元字幕ごとにセリフ側または補助側へ分類し、元字幕の言語・入力位置・本文・元時刻との対応を保持する。部分分割しない |
| ブロック構築 | セリフ部分から学習言語枠、候補、競合処理、母国語配置、開始・終了を導出する |
| 状態導出 | 構築済みブロックと有限の非負再生時刻から状態・全体強調を求める |
| subtitle-session | 同じ元データ世代の派生結果を所有し、完了後にまとめて公開・通知する |
| lifecycle / panel-session | 開始停止、取得・通知の中継、既存UI stateとの接続。導出アルゴリズムを重複しない |
| panel-renderer / panel-host | 渡された結果のtextContent描画と、所有DOMの生成・除去。source・video・時刻を直接読まない |

source更新時に元データと構成を再導出する。時刻更新では既存ブロックの状態だけを求め、snapshot取得時にsource再走査・再計算を行わない。
表示断片の入力位置は同じ世代内だけで有効とし、永続IDとして使わない。取得結果の変更を内部へ伝えず、元データと別世代の表示を混在させない。
元データ構築失敗は元データと派生結果をクリアする。表示導出失敗は有効な元データを保持し、古い表示結果を残さない。不正時刻では構成を保持して現在状態・強調をクリアし、正常化後に再判定する。予期しない例外を分類規則の変更で隠さない。
純粋な導出処理はlistener・timer・observerを追加しない。session終了時は派生結果を解放し、旧世代・旧購読からの再公開を遮断する。
panel closeと拡張OFFの違い、資源の唯一の所有者、stopとdisposeの違いは§7・§12・§15・§19に従う。

### 14.10 表示データとmodule間の受け渡し

元字幕の正本はSubtitleTimelineとし、表示用本文・セリフ枠・補助枠・表示状態はそこから導出する。元字幕単位historyを表示枠の意味へ読み替えず、panel用の表示経路はdisplayに一本化する。

#### 表示データの基本構成

セリフと補助は共通の表示枠で表し、各言語の本文は表示要素の配列として保持する。表示要素は表示用本文と元字幕の言語別入力位置を持つ。元時刻・タグ付き原文は同じ世代のtimelineに保持する。入力位置は補助分類後に振り直さず、永続IDにしない。
両言語とも空の枠は作らない。補助枠は片言語の表示要素1件と他言語の空配列からなり、複数囲みも1要素とする。readonlyの指定と実行時のコピー保護を区別する。具体的な型の定義は§18を参照する。

#### 配置と入出力

| 対象 | 役割・入出力 |
|---|---|
| subtitle-text.ts | 既存のWebVTT解析・ruby注釈除去を再利用する |
| subtitle-text-parts.ts〈新規実装予定〉 | timelineから、言語別の表示用本文・元入力位置・セリフ/補助の準備結果を作る。字幕ごとの変換失敗は原文をセリフ側へ残す |
| subtitle-display-blocks.ts〈新規実装予定〉 | 同じ世代のtimelineと準備結果から、結合・競合・母国語配置・補助枠生成・固定順の全枠配列を導出する |
| subtitle-history.ts | 元字幕分類とは別の関数で、構築済み枠と有限非負時刻から表示枠の3区分を導出する |
| subtitle-session.ts | 元データ・準備結果・枠構成・分類を所有し、同じ世代で公開・通知・解放する |
| panel-renderer.ts | 渡されたdisplayをtextContentで描画し、同じ世代の枠DOMを再利用する。本文変換・結合・時刻判定・スクロールを持たない |
| panel-follow.ts〈新規実装予定〉 | 案内対象の選択、位置維持・即時スクロール、操作listener、追従状態・予約処理を所有する |
| panel-session.ts | 取得・購読、描画前後のfollow呼出し、再入遮断とcleanupを接続する |

新規実装予定のファイルを実装済みとみなさない。具体的な関数・描画結果・followの定義は§17に従う。

#### snapshotと更新

snapshotはgeneration・updateReason・timeline・history・displayをまとめて返す。generationは元データ・枠構成の世代で、時刻だけの更新では変えない。通知中の再入を止める内部更新番号とは分ける。
updateReasonはsource・time・seekで更新のきっかけを表す。seeked処理中に元データを再構築しても、そのseekに対する最終公開理由はseekとし、再構築はgenerationの変化で表す。不要な二重構築・二重通知を追加しない。
source更新は次のtimeline・準備結果・枠構成を作り、再生時刻を1回取得して両historyを導出してから一括公開する。時刻更新・seekでは保持済み構成を分類する。取得ではsource再走査・再構築・時刻取得をせず、最後の公開結果をコピーする。
getSnapshotと引数なしのsubscribeを維持する。同じ取得結果内ではblocksとdisplay.historyの対応枠のコピーを共有できるが、内部や別取得結果と配列・枠・表示要素を共有しない。新旧世代を混ぜず、再入・停止後の旧結果を公開しない。

| 状態 | 公開・復帰の扱い |
|---|---|
| 正常な空 | displayはreadyで全枠・各区分とも空 |
| 元字幕構築失敗 | timelineと元字幕historyをクリアし、displayはunavailable / timeline-failed。有効な元データ構築で復帰 |
| 表示導出失敗 | 有効なtimelineと元字幕historyは維持し、displayはunavailable / display-failed。古い表示を捨て、表示再導出成功で復帰 |
| 不正時刻 | 有効なtimelineと枠構成は保持し、元字幕historyは空。displayはinvalid-timeとして固定順で通常表示し、現在強調・自動追従を止める。正常化後に再分類 |
| 接続なし | lifecycleがsnapshot全体のnullを返す。正常な空や失敗と区別する |

失敗後に空配列を時刻分類できたことだけでreadyへ戻さない。本文変換1件の原文fallbackを表示導出全体の失敗と同一視しない。予期しない例外は区別して記録・必要な再送出を行う。

#### 描画・位置維持・寿命

枠とDOMの対応は、panel-sessionの寿命・generation・display.blocks内の位置で識別する。取得ごとのオブジェクト参照一致や区分内の位置を使わず、永続IDは追加しない。別snapshot間の参照一致には依存しない。
描画前にfollowが閲覧位置を記録し、rendererがDOM・並び・強調を更新した後、有効な更新かを確認してfollowが位置維持または案内を行う。同じ世代の手動閲覧は枠とその表示位置を基準に維持する。世代変更時の手動閲覧は直前のscrollTopを可能な範囲で維持し、旧入力位置から別世代の字幕を推測しない。
字幕通知とUI通知を別の入口にし、UI更新でsnapshotに残るseek理由を再処理しない。追従の案内規則は§14.12に従う。ボタンDOMはrenderer、クリックlistenerと再開動作はfollowが所有する。非表示中は計測・移動せず、手動停止の意思を維持する。
lifecycleの接続切替は旧panelを破棄して作り直す既存経路で区切り、専用の切替通知API・公開session IDを増やさない。旧更新を無効化してから、外部購読、follow、renderer、hostの順で解除を試す。旧callbackや予約処理で新接続を操作しない。

#### 字幕を表示できないときの画面

接続なし・正常な空・利用不能は内部で区別するが、画面では字幕一覧を空にし、案内文を表示しない。元字幕構築・表示導出の失敗時も古い字幕枠を残さず、失敗の詳細は診断ログで扱う。
不正時刻では有効な字幕枠を通常表示し、現在強調・自動追従だけを止める。追加の案内文は出さない。
再試行ボタンは追加しない。「現在位置へ」は追従再開用とし、字幕取得の再試行には使わない。有効な更新結果が公開されたら、その結果に従って字幕表示へ戻す。

#### 初期化直後のsnapshot

createSubtitleSessionは呼出元へsessionを返す前に初回処理を行う。生成直後のgetSnapshotは、その時点で公開済みの初回処理結果のコピーを返し、必ず空を返す特別扱いは設けない。取得時にsource再走査・再構築・時刻取得を行わない。
最初の公開結果はgenerationを1、updateReasonをsourceとする。世代1は取得成功を意味せず、空や失敗も初回の処理結果として表す。panel初回描画のtriggerであるinitialとは役割を分ける。initializing・loadingなどの初期化専用状態は追加しない。snapshot全体のnullはlifecycleの接続なしに限定する。

| 初回処理の結果 | 生成直後に取得する結果 |
|---|---|
| 元字幕・表示枠の構築成功 | 構築済みtimeline・元字幕history・readyのdisplay |
| 正常な空入力 | 空timeline・空history・readyの空display |
| 元字幕構築失敗 | 空timeline・空history・unavailable / timeline-failed |
| 表示導出だけ失敗 | 有効なtimeline・元字幕historyを保持し、unavailable / display-failed |
| 時刻だけ不正 | 有効なtimeline・枠構成を保持し、元字幕historyは空、displayはinvalid-time |

字幕の読込みがまだ完了していないこと、正常に空を取得したこと、取得・構築に失敗したことを、根拠なく同じ正常な空へ読み替えない。複数の異常が重なった場合は、以下の優先順に従う。
listener登録などでsessionの初期化そのものを完了できない場合は、生成済み資源のcleanupを試して例外を返し、sessionを返さない。この場合は生成直後のgetSnapshotを呼ぶ対象自体がない。初期化とcleanupの両方が失敗した場合は両原因を保持する。sessionを生成できたうえで字幕データの構築失敗をunavailableとして返す場合とは区別する。

#### dispose後の直接取得

dispose開始時点から、字幕sessionへの直接のgetSnapshotは通常のErrorをthrowする。メッセージは `Subtitle session has been disposed` とし、専用の例外クラスは追加しない。正常な空snapshot・null・終了専用状態を返さず、終了後用のgeneration・updateReason・displayを生成しない。
終了フラグを立て、旧更新・通知を無効化して保持字幕・派生結果を解放してから各資源のcleanupを試す。cleanupが失敗しても終了扱いを戻さず、以後の直接取得は同じErrorで拒否する。反復disposeは何もせず、最終snapshot通知・再取得・再接続・再利用を行わない。資源解除の成功とsessionを利用できるかは区別し、解除失敗は呼出元へ報告する。
呼出元は旧sessionを取得対象から外してからdisposeする。lifecycleの接続なしを表すgetSubtitleSnapshotのnullは維持し、終了した字幕sessionへの直接取得とは混同しない。これらは別のAPI境界であり、字幕sessionのgetSnapshotの戻り値型をnull許容へ広げない。

#### 複合異常の優先順と復帰

元字幕、表示枠、再生時刻の順に判断し、公開するdisplayの状態を1つに決める。

| 条件 | display | 保持・クリア |
|---|---|---|
| 元字幕構築失敗。時刻も不正の場合を含む | unavailable / timeline-failed | 元字幕・元字幕history・表示の派生結果をクリア |
| 元字幕は有効だが表示導出失敗。時刻も不正の場合を含む | unavailable / display-failed | 元字幕を保持。元字幕historyは時刻が正常なら分類結果、不正なら空。古い表示枠は捨てる |
| 元字幕・表示枠は有効だが時刻不正 | invalid-time | 元字幕・表示枠を保持し、元字幕historyは空。強調・追従は止める |
| すべて正常 | ready | 元字幕・表示枠・両方の分類結果を公開 |

元字幕構築失敗は元字幕の再構築成功、表示導出失敗は表示枠の再構築成功を確認してから次の状態を判断する。時刻だけ正常化しても構築失敗をreadyへ戻さない。不正時刻だけの場合は、正常化後に保持済み構成を再分類する。元字幕historyは表示導出の成功とは独立に、有効な元字幕と時刻から求める。
dispose開始後の直接取得は状態分類より先にErrorで拒否する。予期しないプログラム上の例外を、この優先順で正常な空や入力違反へ読み替えず、区別して記録・必要な再送出を行う。

#### 本文変換失敗の警告

本文準備は、原文fallbackした字幕が1件でもあればconversionFailedをtrueにして返す。字幕ごとの処理は続け、警告はこの準備関数やrendererでは出さない。
subtitle-sessionが警告済みかを示すbooleanを所有し、そのsessionで最初のconversionFailedだけを通常の警告ログとして記録する。文言は `Subtitle text conversion failed; using original text` とし、字幕本文は含めない。source更新・世代変更・成功後の再失敗で警告済みをリセットしない。新しいsessionでは再び最初の1回だけ警告できる。
警告済みでも各字幕・後続更新の本文変換を試す。警告状態はsession終了時に解放し、失敗一覧・件数・時間制限・再試行管理は追加しない。これは原文表示を続けられる失敗の診断であり、display-failedや画面上の案内とは分ける。

旧builder・legacy型・不要import・旧方式専用テストは参照先と残すべき検証を確認する。削除は対象を示して承認後の別作業とする。

### 14.11 一覧順と区分ラベル

セリフ枠と補助枠を、上から過去・現在・未来の順で同じ一覧に表示する。区分ラベルやセリフ・補助の種別ラベルは表示せず、現在の枠を全体強調する。
各区分内は、枠の開始時刻が早い順、次に終了時刻が早い順、同一開始終了ならセリフ枠・補助枠の順とする。それも同じなら、学習言語側を持つ枠を先にし、その側の最初の元入力位置順とする。学習言語側を持たない枠同士は母国語側の最初の元入力位置順とする。異なる言語の入力位置を単純な数値大小で比較しない。
この並べ替えは枠内の言語別入力順を変更しない。区分順が優先されるため、一覧全体が開始時刻順に固定されるわけではない。

### 14.12 自動追従

| 状況 | 案内対象 |
|---|---|
| 現在のセリフ枠がある | 一覧で最初の現在セリフ枠 |
| 現在のセリフ枠がなく、現在の補助枠がある | 一覧で最初の現在補助枠 |
| 現在の枠がなく、過去枠がある | 最も直近に終了した過去枠。終了が同じなら一覧順 |
| 現在・過去枠がなく、未来枠がある | 一覧で最初の未来枠 |
| 表示枠がない | 移動しない |

案内対象を1つ選ぶことと、現在の全枠を強調することは別とする。

- 通常の時刻更新では、自動追従中に案内対象が切り替わったときに位置合わせを判断する。対象の先頭が表示領域内なら移動せず、外なら先頭が見える位置へ必要最小限移動する。同じ対象のまま、先頭が見えないことだけを理由に位置合わせを繰り返さない。
- 初期表示、自動追従中のseek後、「現在位置へ」による再開時は、同じ案内対象でも改めて位置合わせを行い、可能な範囲で対象の先頭をpanel上端へ寄せる。実際のスクロール可能範囲に収め、末尾合わせの余白を追加しない。範囲の制限で先頭を完全に表示できなくても、その理由だけで再試行し続けない。
- 長い枠全体を画面内へ収めようとせず、同じ対象へ時刻更新のたびに繰り返し移動しない。
- ユーザーのスクロール操作で追従を止め、手動閲覧位置を維持する。再描画や区分移動で位置を飛ばさず、自動スクロールをユーザー操作と誤認しない。
- panel内の「現在位置へ」で案内と自動追従を再開する。時間経過で勝手に再開しない。手動停止中のseekや再描画を再開操作として扱わない。
- 追従状態はruntimeだけで保持し、保存設定にしない。listener・予約処理・DOM参照は唯一のownerが解放し、停止後の旧処理を遮断する。

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
- ON/OFF 明示操作に伴う UI state の協調は `extension-enabled-controller.ts` が扱い、有効状態から処理開始停止への接続は lifecycle 側へ委譲する
- OFF 中に panel を非表示にする場合も、それは session 側の反応として扱う
- `ui-state.ts` が UI 意思を保持し、`player-layout.ts` が画面幾何を適用する

extension-enabled-controller は、OFF→ON の明示操作時に panelOpen を true、ON→OFF 時に false とする。再保存では変更しない。
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
- 現在の `SubtitleTimeline`
- current / past / future の計算結果
- panel open state
- extension enabled state
- readiness 待機状態
- listener / timer / observer / binding の参照
- layout 計算結果
- 現在の playback session 参照

UI store は操作側 runtime が保持し、処理 session の start ごとに作り直さない。
extensionEnabled は保存値を適用し、未保存時は true とする。
OFF→ON の明示操作時と、ON の状態で新しい視聴を開始したときは panelOpen を true とする。再保存や同じ ON の再要求では手動 close を解除しない。
OFF 操作時は panelOpen を false とする。
視聴中の手動開閉と、同じ視聴の技術的再接続では §15 の規則を適用する。

処理 session の stop / restart は、保存された ON/OFF を変更しない。
UI store の購読は登録元の owner が解除し、最終終了後に旧購読を残さない。
store 自体に target・video・track・字幕データを保持させない。

### UI state と layout state

runtime state のうち、元の字幕データ、UI state、layout state は同じ store や同じ責務に混ぜない。

| 区分 | 正本 | 保持するもの | 持たないもの |
| --- | --- | --- | --- |
| 元の字幕データ | `SubtitleTimeline` | 言語別の元時刻・本文 | panel DOM、layout style、toggle state |
| UI state | `ui-state.ts` | `extensionEnabled`、`panelOpen` | 幅、座標、style、observer、timer、字幕単位 |
| layout state | `player-layout.ts` | `PlayerLayoutState`、計算済み寸法、適用済み style、layout observer / timer | `extensionEnabled` の意味、`panelOpen` の更新、元の字幕データ |

`panelOpen` は layout を適用するための入力である。  
ただし、layout の計算・style 適用・observer 管理・timer 管理は `player-layout.ts` だけが行う。

`extensionEnabled` は session を有効化または停止するための入力である。  
ただし、ON/OFF toggle 自身は session の stop / restart、panel の mount / unmount、layout の reset を直接実装しない。

---

## 17. module 間の API 境界

元字幕単位のSubtitleHistorySnapshotと表示枠単位の読み取り結果は別の意味を持つ。sessionは両方を同じ世代で公開し、rendererはdisplayだけを受け取る。方針は§14.10、具体的な入出力は本節、共通型は§18に定義する。文書の記載だけで実装完了と扱わず、実装時は利用先・テストを同じ変更でそろえる。

初期版の API は必要以上に抽象化しない。
ただし、DOM・track・元の字幕データ・UI state・layout state・cleanup の境界は崩さない。

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

### `extension-enabled-controller.ts`

生成関数は createExtensionEnabledController とする。公開操作の仕様は次とし、詳細な引数・戻り値型は実装提案時に具体化する。

| 操作 | 仕様 |
| --- | --- |
| initialize() | 初期読込と復元を一度だけ行う。重複呼出しで再読込しない |
| setEnabled(enabled) | トグルと「OFFを保存」の明示選択を即時適用し保存する |
| retrySave() | 現在値の保存だけを再試行し、UI state は変更しない |
| getState() | 通知状態・保存処理中かを取得する。有効状態を再定義しない |
| subscribe(listener) | 操作側の表示状態の変更を通知し、解除関数を返す |
| dispose() | 操作側 runtime を最終終了する |

責務・非同期結果・終了後の扱いは §6 の同 module 節、表示文言と Storage API の型は settings-spec §11.3・§14.5 を参照する。

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

createSubtitleSession(options)はdispose・getSnapshot・subscribeを提供する。既存の元字幕単位historyを維持し、snapshotは次の構成とする。SubtitleUpdateReasonとSubtitleDisplaySnapshotの定義は§18を参照する。

```ts
type SubtitleSessionSnapshot = Readonly<{
  generation: number;
  updateReason: SubtitleUpdateReason;
  timeline: SubtitleTimeline;
  history: SubtitleHistorySnapshot;
  display: SubtitleDisplaySnapshot;
}>;
```

更新・失敗状態・復帰・seek理由の優先と初期化直後の取得結果は§14.10に従う。sessionを返す前に初回結果を公開し、最初のgenerationは1、updateReasonはsourceとする。dispose開始後の直接getSnapshotは通常のError（`Subtitle session has been disposed`）をthrowする。cleanup失敗後も拒否を維持し、終了用snapshotやnullを返さない。
取得では保持済み結果をコピーし、配列・元字幕要素・表示枠・言語別表示要素を内部と切り離す。同じ取得内ではtimelineと元字幕history、blocksとdisplay.historyの対応コピーを共有する。取得による再走査・変換・再計算・時刻取得はしない。
subscribe(listener: () => void): DisposeFnは即時通知せず、更新後に引数なしで通知する。初期値はgetSnapshotで取得する。

- 解除は登録単位で冪等とする。
- 通知中でも登録・解除はできる。通知中に解除された登録は、その通知の残りで呼ばない。
- 通知中に追加された登録は、次の更新から通知対象にする。
- 再構築・時刻更新・失敗によるクリアを通知し、同一結果の更新も通知できる。
- 通知中の再入で新しい更新が起きたら、旧通知の後続を打ち切る。停止後も旧通知を継続しない。
- 再入判定は内部更新番号で行い、時刻更新では変わらない公開generationを代用しない。
- 購読者の例外は記録して後続へ進む。予期しない導出例外は入力違反と区別する。
- disposeでは最終通知せず、新規購読を無効化する。

### 表示導出の入出力

以下を実装する公開関数とし、準備結果の型はsubtitle-text-parts.tsに置く。新規関数の定義を実装完了と扱わない。

```ts
type PreparedSubtitleItem = Readonly<{
  kind: 'dialogue' | 'auxiliary';
  sourceIndex: number;
  text: string;
}>;
type PreparedSubtitleItems = Readonly<{
  primary: readonly PreparedSubtitleItem[];
  secondary: readonly PreparedSubtitleItem[];
  conversionFailed: boolean;
}>;
declare function prepareSubtitleDisplayItems(
  timeline: SubtitleTimeline,
  convert?: (text: string) => string,
): PreparedSubtitleItems;
declare function buildSubtitleDisplayBlocks(
  timeline: SubtitleTimeline,
  prepared: PreparedSubtitleItems,
): readonly SubtitleDisplayBlock[];
declare function deriveSubtitleDisplayHistory(
  blocks: readonly SubtitleDisplayBlock[],
  currentTime: number,
): SubtitleDisplayHistory;
```

prepareは省略時に既存toSubtitlePlainTextを利用する。変換失敗は字幕ごとの原文fallbackで処理し、元入力位置・言語別要素数を維持する。buildは同じ世代の入力だけを受け、元入力位置・要素数等の前提違反をRangeErrorで拒否する。別世代の同形データを関数だけで完全検出できるとは扱わず、sessionが組合せを所有する。deriveは有限非負時刻を受け、違反は空入力でもRangeErrorとし、元字幕分類の関数とは別名にする。

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

### `subtitle-timeline.ts`

```ts
function buildSubtitleTimeline(
  primaryCues: readonly SubtitleCueSnapshot[],
  secondaryCues: readonly SubtitleCueSnapshot[],
): SubtitleTimeline;
```

- sourceのインスタンス・video・現在時刻ではなく、言語別cue配列を受け取る純関数とする。
- 両言語とも空配列を許可し、存在しない言語は空配列で表す。
- 全入力は有限の時刻、`0 <= startTime < endTime`、空白だけではない本文、言語ごとの開始時刻の非減少順を満たす。同じ開始時刻を許可する。
- 条件違反はRangeErrorで拒否し、黙った除外・並べ替え・時刻補正を行わない。
- startTime・endTime・textだけをコピーする。元の本文・改行・空白・タグと各言語内の順序を保持する。
- 元cueやtrackの参照・管理情報を出力に含めず、入力を変更・保持しない。
- 各入力要素を1単位として保持し、重複除去・同時刻結合・訳文分割・意味分類・ペア化・採点を行わない。
- 縦書きであることだけを理由に本文を除外しない。
- 購読・timer・observer・キャッシュ・DOMは扱わず、失敗時の公開結果のクリアはsessionが所有する。

### `subtitle-history.ts`

```ts
function deriveSubtitleHistory(
  timeline: SubtitleTimeline,
  currentTime: number,
): SubtitleHistorySnapshot;
```

保持済みの同じtimelineを、各言語で独立に次の3区分へ分類する純関数とする。

| 区分 | 条件 |
|---|---|
| past | `endTime <= currentTime` |
| current | `startTime <= currentTime && currentTime < endTime` |
| future | `currentTime < startTime` |

- currentTimeは有限の非負数とし、違反は空入力でもRangeErrorで拒否する。
- 各入力要素を必ず1区分に1回だけ入れる。各区分は言語別配列で、言語内の入力順を維持する。
- 同時刻・重なりのある全件を保持し、currentを1件へ絞らない。各字幕自身の終了時刻でpastへ移す。
- 空白区間のcurrentは空配列。先頭より前は全件future、末尾の終了後は全件pastとする。
- 同じtimelineと時刻なら、前回の結果や再生方向に依存せず同じ分類を返す。
- 新しい区分配列を返すが、内部では読み取り専用の元の字幕データ要素を共有できる。要素・入力配列を変更せず、並べ替え・本文結合をしない。
- source・TextTrack・video・DOMを直接読まず、購読・timer・スクロール・独立した現在字幕storeを持たない。

#### 境界時刻の例

同じ言語にA:[10,20)、B:[12,13)がある場合:

| 再生時刻 | past | current | future |
|---|---|---|---|
| 9 | 空 | 空 | A、B |
| 12 | 空 | A、B | 空 |
| 13 | B | A | 空 |
| 20 | A、B | 空 | 空 |

表示は区分順であり、全入力を開始時刻だけで一本に並べた順とは区別する。
期間が重なる字幕は別の区分へ移る時点も異なる。rendererがこの区分を補正しない。

### `panel-session.ts`

`createPanelSession(options)` は次の入力を受け取り、`Disposable` を返す。

- `mountEl`: 呼出元が解決した配置先
- `uiState`: 既存 UI store の getState / subscribe だけの境界
- `getSubtitleSnapshot`: 現在の字幕 snapshot または null を返す、this に依存しない関数
- `subscribeSubtitle`: 更新 callback を登録し、接続側が実行する解除関数を返す関数

購読登録に失敗した場合、通知元は途中の登録を残さない。
先に購読を登録してから最新値を取得し、初回描画を行う。
公開操作は dispose だけとし、表示更新や restart の公開 API を重複して設けない。
同一 host ID の有効な接続を重複作成しない。
責務・エラー処理・解除順は §6 の panel-session を参照する。

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

### `panel-renderer.ts`・`panel-follow.ts`の入出力

以下をrendererとfollowの公開定義とする。表示用の共通型は§18を参照し、DOMを含む型はpanel側に置く。実装時は接続側とテストも同じ定義へそろえる。

```ts
type PanelRenderInput = Readonly<{
  generation: number | null;
  display: SubtitleDisplaySnapshot | null;
  panelOpen: boolean;
  extensionEnabled: boolean;
}>;
type PanelRenderResult = Readonly<{
  scrollEl: HTMLElement;
  resumeButton: HTMLButtonElement;
  blockElements: readonly HTMLElement[];
}>;
type PanelRenderer = Disposable & {
  render(input: PanelRenderInput): PanelRenderResult | null;
};
declare function createPanelRenderer(hostEl: HTMLElement): PanelRenderer;

type PanelUpdateTrigger = SubtitleUpdateReason | 'initial' | 'ui';
type PanelFollowInput = Readonly<{
  presentation: PanelRenderInput;
  rendered: PanelRenderResult;
  trigger: PanelUpdateTrigger;
}>;
type PanelFollow = Disposable & {
  beforeRender(): void;
  afterRender(input: PanelFollowInput | null): void;
};
declare function createPanelFollow(): PanelFollow;
```

接続なしはgenerationとdisplayを両方nullにし、描画結果のblockElementsは空とする。ready・invalid-timeではdisplay.blocksと同じ配列位置のDOMを返す。区分による画面上の順序と、この対応配列を混同しない。unavailable・正常な空も対応配列は空。dispose後のrenderはnull、DOM失敗は例外とし、非表示中も結果は返せるがfollowは計測・移動しない。
初回triggerはinitial、字幕通知はupdateReason、UI通知はuiとする。UI通知でsnapshotに残るseek理由を再実行しない。rendererが返すDOMは借用で、followは除去しない。beforeRenderで旧位置を記録し、afterRenderで現在結果を使って復元・案内する。描画失敗時のafterRender(null)は、同じ更新がまだ有効な場合だけ呼び、旧対応・予約処理を無効化する。再入後の古い後処理で新しい対応を消さない。
followは最新の有効な描画情報だけを保持し、同じボタンへのlistener重複登録を防ぐ。本文選択・単なるクリックとスクロール操作を区別し、自動移動のscrollを手動と誤認しない。実機の可視性・寸法・入力判定は別に検証する。

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

`subtitle` は字幕接続に使う設定入力であり、省略時は字幕接続を生成しない。
`panel` は既存 UI store の読取・購読境界を受け取る任意入力であり、省略時は panel 接続を生成しない。
両方を省略した場合は readiness の状態管理だけを行う。
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
  panel?: { uiState: Pick<UiStateStore, 'getState' | 'subscribe'> };
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

- 有効 target の開始時に panel 接続を生成し、同一 target の readiness retry と waiting から running への移行では維持する。UI store の意思は書き換えない。
- 停止・再開始・最終 dispose では panel 接続を保持先から切り離して解放する。初期化中の停止・cleanup 中の再開始で古くなった開始停止要求は継続しない。
- panel 初期化・解除の失敗は記録し、字幕処理・待機の開始停止を妨げない。readiness retry を panel 初期化の retry として使わない。
- 待機中の再解決で target が消失した場合は旧 panel・待機を解放する。同一 video でも mount を含む target snapshot が変われば旧接続を持ち越さない。新しい視聴の識別とは区別する。
- readiness 待機と retry は lifecycle が所有する。
- 待機 bag は解除前に保持参照から切り離す。
- 待機 cleanup の失敗は記録し、停止・再開始・破棄の後処理を継続する。
- getState は state の外側と waiting 情報をコピーする。処理中の target と DOM 参照は共有するが、stop / dispose 後は target:null、waiting:null、status:stopped とする。
- getSubtitleSnapshot は現在の字幕接続の getSnapshot に委譲する。接続なし・破棄後は null とし、接続中の空 snapshot と区別する。
- lifecycle は元の字幕データ や取得結果を保持・再コピーしない。データ境界は本節の subtitle-session API を参照する。
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
ON/OFF の取得結果型は settings-spec §14.5 を正本とし、定義元を settings-store とする。
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

/** cue 1 件分の一時表現。SubtitleTimeline の構築前に利用する。 */
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

/** 1言語の元時刻・本文を持つ値。cue・track・DOM参照を含めない。 */
export type TimedSubtitleText = Readonly<{
  startTime: number;
  endTime: number;
  text: string;
}>;

/** 言語別の字幕単位を保持する元の字幕データの正本。空の言語は空配列。 */
export type SubtitleTimeline = Readonly<{
  primary: readonly TimedSubtitleText[];
  secondary: readonly TimedSubtitleText[];
}>;

/** 同じ元字幕データを時刻で分類した読み取り結果。currentも複数件・0件を許可する。 */
export type SubtitleHistorySnapshot = Readonly<{
  past: SubtitleTimeline;
  current: SubtitleTimeline;
  future: SubtitleTimeline;
}>;

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

### 表示用共通型の定義

基本構成とsnapshotの状態分離は§14.10に従い、以下を表示用共通型とする。文書への定義はコードへの反映・型検証を意味しない。原文・元時刻はtimelineに保持し、表示要素にはDOMや永続IDを含めない。

```ts
export type SubtitleDisplayItem = Readonly<{
  sourceIndex: number;
  text: string;
}>;
export type SubtitleDisplayBlock = Readonly<{
  kind: 'dialogue' | 'auxiliary';
  startTime: number;
  endTime: number;
  primary: readonly SubtitleDisplayItem[];
  secondary: readonly SubtitleDisplayItem[];
}>;
export type SubtitleDisplayHistory = Readonly<{
  past: readonly SubtitleDisplayBlock[];
  current: readonly SubtitleDisplayBlock[];
  future: readonly SubtitleDisplayBlock[];
}>;
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
```

sourceIndexは所属言語配列の元入力位置を表す。時刻・添字・空枠禁止・補助枠1要素の条件は構築処理とテストで確認し、readonlyだけを実行時コピー保護とみなさない。
SubtitleSessionSnapshotと次の更新理由型の定義元はsubtitle-session.tsとし、shared/types.tsへ無条件に集約しない。

```ts
type SubtitleUpdateReason = 'source' | 'time' | 'seek';
```

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
- 字幕の時刻分類ロジック
- `SubtitleTimeline` の構築ロジック
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

新機能を追加しても、source、元の字幕データ、renderer、session lifecycle の境界を崩さない。

### 境界を守る

新しい機能は、既存の責務へ直接入り込ませず、まず次のどこに属するかを判断する。

| 追加したい責務 | 配置先の原則 |
| --- | --- |
| Apple TV+ からの取得、外部入力、track / cue の観測 | source 層、または Apple TV+ 固有 module |
| 字幕や入力データの正規化、対応付け、表示単位の確定 | 元字幕の構築層 |
| current / past / future、検索結果、並び順など 元の字幕データ からの読み取り結果 | view helper 層 |
| 元の字幕データ または view helper の結果を DOM に表示する処理 | renderer 層 |
| 開閉、選択、表示モードなどの一時的 UI 意思 | `ui-state.ts` |
| 幅、配置、style、resize 追従などの画面幾何 | `player-layout.ts` または layout module |
| listener、timer、observer、binding、extension DOM の開始・停止 | session lifecycle と各 owner module |
| 保存設定 | `settings-store.ts` と `docs/settings-spec.md` |

新しい UI を追加する前に、その UI が読む元の字幕データ、必要な view helper、開始条件、停止条件、owner、dispose 対象を決める。
renderer が source を直接読むこと、source が panel DOM を更新すること、UI component が observer や timer を無所有で作ることは禁止する。

### 影響確認の順序

新機能の設計・実装では、次の順序で影響範囲を確認する。

1. **source**: 入力はどこから得るか、Apple TV+ 固有の依存をどこに閉じ込めるか
2. **元の字幕データ**: 唯一の `SubtitleTimeline` から導出できるか、共通型・責務の変更が必要か
3. **view helper**: current / past / future のような読み取り専用の導出が必要か
4. **renderer**: 元の字幕データ または view helper の出力だけで描画できるか
5. **UI / layout state**: UI の意思と画面幾何を別々に扱えているか
6. **lifecycle / cleanup**: start 条件、stop 条件、owner、`dispose()` の呼び出し元が一意か
7. **test**: source、元の字幕データ、renderer、session restart、cleanup のどこを検証するか

この順序を飛ばして UI から実装を始めない。  
元の字幕データ と lifecycle の一貫性を確認する前に、panel、controls、overlay、補助 UI を増やさない。

### 新規ファイルの配置判断

新しい実装ファイルを追加する場合は、次の基準で配置する。

| 役割 | 配置先 |
| --- | --- |
| Apple TV+ 再生 DOM の発見・解決 | `src/content/` |
| session の開始、停止、再初期化、cleanup 合成 | `src/content/` |
| 字幕取得、track 解決、cue 監視、元の字幕データ 構築 | `src/subtitles/` |
| panel host と panel 描画 | `src/panel/` |
| ON/OFF toggle、panel 開閉、将来の再生画面 control | `src/controls/` |
| 再生画面と panel の幾何、幅、style、resize 追従 | `src/layout/` |
| runtime UI の意思決定状態 | `src/ui/` |
| Chrome Storage に保存する設定 | `src/settings/` |
| 複数層で使う型、dispose、DOM helper、logger | `src/shared/` |

配置先が複数候補に見える場合は、DOM を直接所有するか、元の字幕データを構築するか、表示するか、session resource を開始・停止するかで分ける。
1つの module が複数の問いに答える必要がある場合は、責務が混ざっているため分割を検討する。
