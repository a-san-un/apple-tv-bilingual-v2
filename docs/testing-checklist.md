# Testing Checklist

この文書は、Apple TV+ 向け二言語字幕 Chrome 拡張 v2 のテスト観点を整理するためのチェックリストである。

ここでは、テスト方針、自動テストの構成、実行前提、手動スモークテスト、回帰確認、観測情報の残し方だけを扱う。

要件本文、設計本文、DOM 観測本文、実装手順本文は他文書で管理し、この文書には重複して詳述しない。

## テスト方針

- 可能な限り自動化し、Apple TV+ 実画面依存の項目だけを手動スモークテストに残す。
- まず typecheck、lint、unit test を常時実行できる状態にする。
- pure function に寄せられる処理は unit test で確認する。
- `settings-store.ts`、`text-track-resolver.ts`、`subtitle-timeline.ts`、`subtitle-history.ts`、`player-layout.ts`、`shared/` 配下の pure utility、`ui-state.ts` は優先的に自動テスト対象にする。
- `settings` と `resolver`、`timeline構築`、`subtitle history`、`ui-state` の接続は small integration test で確認する。
- Apple TV+ 実画面、`video.textTracks`、SPA 遷移、native subtitle UI、実 DOM 注入、実レイアウトだけを手動スモークテストに残す。
- 手動確認は少数の固定手順にし、設定反映、字幕表示、シーク後復帰、SPA 遷移、cleanup を重点確認する。
- debug log または health snapshot を用意し、現在の設定、採用 track、current subtitle、session 状態、layout 状態、UI state を短時間で確認できるようにする。
- 機能の追加・変更に合わせてテストを追加し、最後にまとめて追加する運用にしない。
- テストの実施順と作業単位は `docs/implementation-workflow.md` を参照する。

## 自動テストの構成

### Type check

目的:
- 型崩れ、import / export の不整合、型名変更漏れを検出する。

対象:
- `src/shared/types.ts`
- `src/content/`
- `src/subtitles/`
- `src/panel/`
- `src/controls/`
- `src/layout/`
- `src/ui/`
- `src/settings/`

実施タイミング:
- 新規ファイル追加時
- 型定義変更時
- public API 変更時
- PR 作成前

実行コマンド:

```bash
npm run typecheck
```

### Lint

目的:
- 未使用コード、危険な分岐、命名ゆれ、import の乱れ、cleanup 漏れの温床になりやすい書き方を検出する。

対象:
- `src/**`
- `tests/**`

実施タイミング:
- 実装単位ごとの作業完了時
- PR 作成前

実行コマンド:

```bash
npm run lint
```

### Unit test

目的:
- DOM や Apple TV+ 実画面に依存しない pure function と small store の正しさを確認する。

優先対象:
- `src/settings/settings-store.ts`
- `src/subtitles/text-track-resolver.ts`
- `src/subtitles/subtitle-block-builder.ts`
- `src/subtitles/subtitle-history.ts`
- `src/layout/player-layout.ts`
- `src/ui/ui-state.ts`
- `src/shared/` 配下の pure utility

実施タイミング:
- 対象 module の初回実装直後
- 分岐追加時
- バグ修正時
- 回帰確認時

実行コマンド:

```bash
npm run test
```

### Small integration test

目的:
- module 間の入力・出力の受け渡しと、接続単位の生成・破棄が最小構成で成立するかを確認する。

優先対象:
- settings store の取得結果から resolver への設定値の受け渡し
- resolver の採用結果から source への track の受け渡し
- subtitle-session による resolver / source の接続と cleanup
- session lifecycle による readiness 通過後の字幕接続の生成と、停止・再開始・破棄時の cleanup
- `subtitle-timeline.ts` と `SubtitleTimeline` 構築
- timeline構築 / history / renderer 間のデータの受け渡し
- `subtitle-history.ts` と current / past / future 導出
- controls / renderer と `ui-state.ts` の購読通知
- 必要最小限の layout 計算入力と UI state 反映

実施タイミング:
- 2 つ以上の module を接続した時点
- session 配線前に pure 層の整合を確認したい時
- バグ修正で責務境界をまたぐ変更を入れた時

実行コマンド:

```bash
npm run test
```

### Manual smoke test

目的:
- Apple TV+ 実画面依存のふるまいを短い固定手順で確認する。

対象:
- `video.textTracks`
- native subtitle UI との関係
- 実 DOM 注入
- panel の見た目
- ON/OFF toggle の見た目
- panel 開閉ボタンの見た目
- SPA 遷移
- video 差し替え
- ブラウザ上での解放確認

実施タイミング:
- typecheck、lint、test が通った後
- DOM selector を変えた後
- `session-lifecycle.ts`、`playback-root.ts`、`subtitle-source.ts`、`panel-host.ts`、controls、layout の変更後
- リリース前

## 実行前提

- 確認する機能と接続範囲を明確にする。字幕取得だけの確認に panel の表示結果を合否条件として加えない。
- 自動テスト、ブラウザ確認、未観測、対象外を区別する。自動テストの成功だけでブラウザ確認済みとは扱わない。
- 必要な条件を再現できなかった項目は、成功ではなく未観測として扱う。
- `primaryLang` と `secondaryLang` の候補値を明確にしてから実施する。
- Apple TV+ の再生ページで video が再生可能な状態にしておく。
- ネイティブ字幕 UI で、少なくとも primary 候補と secondary 候補が存在するコンテンツを使う。
- 手動スモークテストは、原則として typecheck、lint、test がすべて成功してから開始する。
- 不具合調査時は、debug log または health snapshot で設定、採用 track、current subtitle、session 状態、layout 状態、UI state を観測できる状態を用意する。
- 通常起動は、ON/OFF 未保存・保存 ON・保存 OFF を分けて確認する。期待値は settings-spec §11 に従い、panel 開閉状態そのものは保存しない。
- 開発用の自動 ON を使うブラウザ確認は、通常起動の確認と分ける。フラグの役割・使用条件・無効化時期は `implementation-workflow.md` の「開発用・ブラウザ確認用フラグ」に従う。
- 開発用フラグを使った場合は、その名前・値と確認範囲を実施結果に記録する。自動 ON での確認を、未保存時の既定 ON、保存値の復元、正式な ON/OFF toggle の確認済みとして扱わない。
- 診断表示を有効にした確認と、無効にした確認を区別して記録する。
- 保存設定と runtime state を混同しない前提で確認する。

### 手動スモーク前の準備

1. 対象リポジトリで、次の自動検証を実行し、すべて成功したことを確認する。

   ```zsh
   npm run check && npm run lint && npm test
   ```

2. ブラウザ確認に使うコードと開発用フラグの値を確認する。フラグの運用は `implementation-workflow.md` の「開発用・ブラウザ確認用フラグ」に従う。

3. 次の build を実行し、成功したことを確認する。

   ```zsh
   npm run build
   ```

   現行の build は `clean` を呼び、生成物の `dist` を削除して再生成する。
   ソースファイルの削除とは区別し、実行前に対象と実行許可を確認する。
   削除を伴う操作の許可がない場合は、実行せず確認を求める。

4. Chrome の拡張機能管理画面で、対象の v2 拡張を再読み込みする。初回登録時は、このリポジトリの `dist` を読み込み先にする。

5. Apple TV+ の対象ページを再読み込みする。build と拡張再読み込みだけで、開いているページの content script まで更新されたとは扱わない。

6. 保存設定と再生対象を確認し、検証対象の接続範囲に対応する項目を実施する。設定を変更した場合は、保存後にページを再読み込みする。

実施結果には、使用したフラグの値、自動検証・build の結果、
拡張とページの再読み込みの実施有無、未確認事項を記録する。

## popup 設定の確認項目

対象ファイル:
- `src/settings/settings-store.ts`
- popup 側の設定 UI 実装ファイル

自動テストで確認する項目:
- `primaryLang` が必須であること。
- `secondaryLang` が任意であること。
- `primaryLang` と `secondaryLang` に同じ値を保存できないこと。
- `secondaryLang` 未選択時に `null` として扱えること。
- 読み込み時に不正値を正規化できること。
- 保存設定と runtime state が混ざらないこと。
- popup の言語保存が extensionEnabled を変更しないこと。
- ON/OFF の保存が primaryLang / secondaryLang を変更しないこと。
- panelOpen と UI state 全体の snapshot を保存しないこと。

手動スモークで確認する項目:
1. popup を開く。
2. `primaryLang` を設定する。
3. `secondaryLang` を未選択にする。
4. 保存後に再度 popup を開く。
5. `primaryLang` が保持され、`secondaryLang` は未選択として扱われることを確認する。
6. 次に `secondaryLang` を `primaryLang` と異なる値で設定する。
7. 保存後に再度 popup を開き、両方の値が保持されていることを確認する。
8. `primaryLang` と同じ値を `secondaryLang` に設定しようとしたとき、UI または保存処理で弾かれることを確認する。

期待結果:
- popup の保存操作が更新するのは primaryLang と secondaryLang だけである。
- 全作品共通の extensionEnabled は別の保存操作で扱い、popup の保存で上書きしない。
- panel open state は保存されない。
- 再読込後は言語設定と保存された ON/OFF を復元し、未保存時の ON/OFF は既定値に従う。

実施タイミング:
- settings 実装直後
- popup UI 実装直後
- settings の schema や fallback を変更した時

## primary / secondary 字幕の確認項目

対象ファイル:
- `src/subtitles/text-track-resolver.ts`
- `src/subtitles/subtitle-source.ts`
- `src/subtitles/native-menu-sync.ts`

自動テストで確認する項目:
- TextTrackList 相当の ArrayLike と配列を候補一覧へ正規化できること。
- language、label、kind、mode を使って候補判定し、language だけで採用しないこと。
- metadata / chapters や forced label の候補を除外できること。
- 表示中 track を mode === 'showing' で判定し、hidden track の active cue を誤採用しないこと。
- 言語の一致度と候補の優先順位が期待どおりであること。
- primary / secondary に別言語の track を解決でき、同じ TextTrack を両役割に採用しないこと。
- secondaryLang 未選択時だけ fallback を利用し、primary と同じ基本言語の fallback を採用しないこと。
- 候補なしの場合に null を返し、安全に扱えること。
- current video に含まれない track を source が bind しないこと。
- textTracks が 0 件でも source 自身は待機・retry・timer 登録をしないこと。
- cuechange を role 付きで通知し、snapshot で両役割の cue を取得できること。
- bind 入力や snapshot の管理情報を書き換えても、source 内部へ影響しないこと。
- コピー後も実際の TextTrack 参照は維持され、通知と cleanup が機能すること。
- 購読者の例外、listener 登録失敗、cue 読取失敗を安全に扱えること。

設定としての同一言語の保存拒否と読込補正は「popup 設定の確認項目」、
listener 解除失敗時の確認は「cleanup、二重 listener、二重描画、DOM 残留の確認項目」を参照する。

字幕取得単体の手動確認:
- readiness 通過後の current video から、設定に対応する track を取得・採用できること。
- resolver の採用結果と、source が実際に bind した track を区別して確認できること。
- bind 直後の snapshot と、再生中の role 付き cuechange 通知を確認できること。
- primary / secondary の cue 件数を、それぞれ確認できること。
- secondary 未選択時は、browser language と fallback の採用結果を確認できること。
- 採用候補がない場合と、採用済み track の cue が空の場合を区別できること。

期待結果:
- panel や renderer がなくても、採用結果・bind・cue 取得をログまたは snapshot で確認できる。
- readiness 通過や session の running 表示だけで、track 採用・bind・cue 取得の成功を判定しない。
- cue 件数が 0 の場合は、track の mode、cue 読込状態、読取失敗の有無を確認し、取得成功と即断しない。

手動スモークで確認する項目:
1. primary / secondary に別言語を設定する。
2. Apple TV+ 再生画面で拡張を ON にする。
3. 数秒再生し、primary と secondary が想定どおり採用されることを確認する。
4. native subtitle UI 側で字幕言語を切り替える。
5. 拡張側が追従または再解決し、表示が破綻しないことを確認する。
6. secondary を未選択にした設定でも再生し、fallback の扱いが破綻しないことを確認する。

期待結果:
- primary は学習言語として安定して表示される。
- secondary は設定値または fallback に従って解決される。
- track 切替後に古い track にぶら下がり続けない。
- 字幕候補が不足する場合も例外終了せず、安全に劣化動作する。

実施タイミング:
- resolver 実装直後
- source 実装直後
- native subtitle UI 連携追加時
- track 解決ロジック変更時

## 言語別timelineとpanel表示の確認項目

対象はsubtitle-timeline、subtitle-history、subtitle-session、panel-session、rendererとその接続先とする。
型・構築・分類・描画・cleanupの正本はarchitecture §6・§11・§14・§17・§18を参照する。
以下は確認条件・期待動作であり、記載だけで実装・実施済みとは扱わない。

### timeline構築の基本動作と責務境界

- 両言語空・片言語・両言語を受け付け、元時刻・本文・言語内の順序を保持する。
- 全入力を検証し、順序違反・非有限・負時刻・終了≦開始・空白だけの本文をRangeErrorで拒否する。
- 入力や実trackを変更せず、時刻・本文だけの値をコピーする。cue・track・video・DOM参照を含めない。
- 同時刻複数件・同じ本文の別入力要素も保持し、対訳ペア・採点・消費・重複除去・本文結合・意味による分割を行わない。
- 縦書きだけを理由に字幕を除外せず、表示用本文変換と時刻分類を分離する。

### 元字幕単位のhistoryの自動テスト

この表は既存の元字幕単位の分類を検証する。表示ブロック全体の強調条件とは別の契約である。

| 分類 | 確認する内容 |
|---|---|
| 完全な分割 | 各入力要素がpast/current/futureのちょうど1区分へ入り、欠落・二重登録がない |
| 開始境界 | startTimeちょうどでfutureからcurrentへ入る |
| 終了境界 | endTimeちょうどでcurrentからpastへ移る |
| 同時刻・重なり | currentの全件を保持する。先頭1件だけ選ばず、長い字幕の途中に短い字幕が重なる例も確認する |
| 空白区間・末尾 | currentを空にし、終了済みの字幕を現在として維持しない |
| 入力順 | 各区分の言語内順序を維持し、言語間のペアを推測しない |
| seek | 前進・後退・直接seekで、同じ元字幕データと時刻なら同じ分類になる |
| 不正時刻 | 空入力でもNaN・Infinity・負時刻を拒否する |
| 不変性と責務 | 入力を変更せず、source・TextTrack・video・DOMや過去の呼出し状態へ依存しない |

### 再生経路への接続の確認

- source更新では同じ入力からtimelineとhistoryを構築し、完了後に公開・通知する。
- 時刻だけの更新では保持済み元の字幕データから分類し、現在字幕のためのsource再走査・再bind・全体restartを追加しない。
- 元の字幕データ構築失敗ではtimelineと全区分をクリアし、不正な再生時刻では有効なtimelineを保持して全区分を空にする。
- 接続なしのnullと、接続中の空snapshotを区別する。取得だけで再構築・時刻更新を行わない。
- 取得結果の変更が内部へ伝わらず、通知中の解除・再入・停止・再開始で古い結果が新接続を上書きしない。
- disposeで元の字幕データ・history・購読者と既存資源を解放し、残存callbackを無効化する。解除試行と成功を区別する。

#### panel実装前のログ観測手順

1. 開発用ログフラグと保存設定・有効状態を確認し、手動スモーク前の準備に従いbuild・拡張・ページの再読み込みを行う。
2. 公開snapshotの接続状態、言語別timeline件数、各区分の言語別件数・対象時刻・本文を確認する。デバッガで取得する場合は、同じ呼出しの入力・結果を1つのオブジェクトとしてコピーする。
3. source更新と時刻だけの更新、空区分と未取得、接続なしを区別する。要約ログだけでは全配列の一致を証明しない。
4. 通常利用・配布前は本文を含む診断を無効にする。ログ確認を描画・追従・全資源解除の実機確認の代わりにしない。

### 表示ブロックと補助字幕の検証

製品の期待動作はarchitecture §14、実装順はworkflow Phase 6を正本とする。型・関数・受け渡し方法は具体化後に対応するテストへ反映し、未採用APIを推測しない。以下は確認入力・期待結果であり、実施結果ではない。

| 検証対象 | 入力と期待結果 |
|---|---|
| 元字幕の不変性 | タグ付き原文・開始終了・言語内入力順を保持し、分類・結合・配置で変更・削除しない |
| 同時刻の枠 | 開始終了が完全一致する学習言語1件・2件・3件・多数件を保持し、原文結合・重複除去・切捨てをしない |
| 1枠と複数母国語 | architecture §14.7の学習言語2件・母国語3件を、欠落・重複配置なく同じ1枠へ収め、各言語内の元入力順を保持する。時間境界の強調とは別に枠の構成と本文を確認する |
| 長い候補・逆方向 | 同じ母国語が多数の連続枠と重なる候補を長さ・枠数・文字量だけで抑制しない。長い学習言語1枠へ複数母国語を配置する例も検証する |
| 候補の競合 | 母国語開始・元入力順で採用し、端点接触を重なりとせず、確定済み枠を再結合しない |
| 非連続の重なり | 1件の母国語と重なる学習言語枠全体が入力順で非連続なら結合せず、通常の最大重なり・同点規則で配置し、欠落・二重配置を防ぐ |
| 競合の具体例 | §14.8のA・B・①・②:[10,16)とC:[14,16)を得る。14秒以上16秒未満は両方を全体強調し、16秒で両方を外す。元字幕currentはC・②のまま |
| 比較区間 | 学習言語の存在区間の和集合を使い、空白を除き、重複時間を二重計上しない |
| 配置の同点 | 重なり時間、学習言語の最早開始、最初の学習言語の元入力位置の優先順を段階別に検証する |
| 配置済み母国語 | 根拠・後置の母国語で表示範囲が延びても、配置比較区間・同点基準を変えず、再結合しない |
| 重なりなし | 母国語を捨てず、母国語だけの枠へ1回だけ残す |
| 全体強調の境界 | §14.7の48.09800833333331以上52.01037777777778未満で同じ枠全体を強調する |
| 内部の空白・片側先行 | 現在有効な元字幕がない内部区間も全体強調する。英語[10,14)と母国語[3,13)の枠は[3,14)で強調する |
| 単一・複数囲み | `〝コ︱チ〟`と`〝人物紹介〟 〝地名〟`をそれぞれ元字幕1件で1つの補助枠へ分類し、囲み・空白・改行・元時刻を保持する |
| 部分・不完全・入れ子 | `こんにちは 〝コ︱チ〟`、閉じ忘れ、入れ子は修復・部分分割せず全体をセリフ側へ残す |
| 全言語・配置非依存 | 両言語役割で同じ囲み判定を行う。vertical・line・positionだけで結果を変えず、囲みなしを縦書きだけで分けない |
| 変換失敗 | 当該字幕の元本文全体をセリフ側へ残し、囲み判定をせずtextContentで表示する。他の字幕と後続更新は継続する |
| 補助枠 | 元字幕1件で独立1枠。言語間ペア化・セリフ結合・セリフ範囲への混入なし。元時刻で3区分へ分類し現在は全体強調、過去未来も保持する |
| 片言語・本文 | ない側の空間を残し、学習言語を上・母国語を下に置く。言語内の元順序・空白・改行を保持する |
| 一覧順 | 過去・現在・未来の順、区分内は開始・終了・セリフ/補助・元入力の固定順。区分・種別ラベルを出さない。異なる言語の入力位置を数値だけで比較しない |
| 更新・世代・失敗 | source更新で構成導出、時刻更新で分類だけを更新する。取得で再走査せず、コピー変更を内部へ伝えず、元データと表示を同一世代で公開する。元データ失敗・表示失敗・不正時刻を区別する |
| 解放 | 停止・再接続後の旧通知・DOM・スクロール処理を遮断する。解除試行と成功を区別する |

### 自動追従の検証

- 現在セリフ1件・複数件、セリフなしで現在補助のみ、現在なしで過去あり、過去なしで未来のみ、全枠なしの入力で§14.12の案内対象を確認する。複数現在の強調は全件に維持する。
- 直近過去は終了時刻で選び、同一終了では一覧順を使う。通常の時刻更新による案内対象の切替時は、対象先頭が見えていれば移動せず、外なら必要最小限移動する。同じ対象のまま時刻更新を繰り返しても、先頭が見えないことだけを理由に位置合わせを再試行しない。
- 初期表示、自動追従中のseek後、「現在位置へ」による再開では、同じ対象でも位置合わせを行い、スクロール可能範囲内で先頭を上端へ寄せる。長い枠で反復移動せず、末尾余白を追加しない。範囲の制限で先頭を完全に表示できない入力でも、後続の時刻更新で再試行し続けない。
- 手動スクロールで停止し、再描画・区分移動・時間経過・停止中のseekで勝手に再開しない。「現在位置へ」で案内と追従を再開する。
- 自動スクロールを手動操作と誤認せず、手動閲覧位置を保持する。状態を保存せず、停止・再接続で旧listener・予約処理・DOM参照から更新しない。

手動確認では拡張とページを再読み込みする。構築・分類・描画・実パーサー・自動追従・全資源解除の確認範囲を分け、再現できない条件は未観測とする。要約ログだけで全字幕・全状態の一致を証明したと扱わない。

### 表示データと受け渡しの検証

architecture §17・§18の確定した定義をテストへ反映する。文書の確定と製品関数の実装・テスト成功は区別する。

- 原文・元時刻・言語別入力順、分類前のsourceIndexを保持し、表示要素を欠落・重複させない。
- source更新ではgenerationを進め、時刻だけでは維持する。通知中の再入遮断は別の内部番号で検証する。
- seeked内で読込み完了・再構築が起きても最終公開理由はseekとなり、不要な二重構築・通知を行わない。
- 取得だけではsource・video時刻を読まず、本文変換・構築・分類を再実行しない。取得結果の配列・枠・表示要素を書き換えても内部へ伝わらない。
- 同じ取得結果内のblocksとdisplay.historyは対応するコピーを共有し、別取得結果や内部とは共有しない。
- timeline失敗・display失敗・不正時刻を区別し、失敗後の空配列の時刻分類だけでreadyへ戻さない。元字幕失敗＋不正時刻はtimeline-failed、表示失敗＋不正時刻はdisplay-failed、有効な表示枠＋不正時刻はinvalid-timeとなること。表示失敗時も有効な元字幕を保持し、元字幕historyは時刻不正なら空、正常なら分類結果を保持すること。時刻正常化だけで構築失敗がreadyへ戻らないこと。
- dispose開始後の直接getSnapshotが通常のError（`Subtitle session has been disposed`）をthrowし、正常な空・null・終了専用snapshotを返さないこと。cleanup中の再入取得とcleanup失敗後も同じ拒否を維持すること。
- 反復disposeが解除を再試行せず、最終通知・取得による再計算・再接続を起こさないこと。停止後の旧callbackで字幕を再公開しないこと。
- 呼出元が旧sessionを取得対象から外してからdisposeし、lifecycleの接続なしのgetSubtitleSnapshotはnullのままであること。終了済み字幕sessionへの直接取得とは別に検証すること。
- createSubtitleSessionが返る前に初回結果が公開され、直後のgetSnapshotはそのコピーを返すこと。字幕が構築済みでも空の仮結果を強制しないこと。
- 最初の公開generationは1、updateReasonはsourceであり、正常な空・失敗も世代1として表すこと。panelのinitial triggerと混同せず、initializing・loading状態やsession snapshotのnullを追加しないこと。
- 初回の構築成功・正常な空・timeline失敗・displayだけの失敗・時刻だけ不正について、architecture §14.10の初回結果表と照合すること。初回取得によるsource再走査・再構築・時刻取得がないことも確認すること。
- listener登録などの初期化失敗ではcleanupを試して例外を返し、sessionを返さないこと。cleanupも失敗した場合は両原因を保持し、データ構築失敗のunavailableとは区別すること。
- 同世代の枠DOMを区分移動でも再利用し、対応はblocks内位置で維持する。世代変更・panel再生成で旧対応を破棄する。
- 字幕通知とUI通知を区別し、UIだけの更新でseek位置合わせを再実行しない。手動閲覧の位置維持、世代変更後のscrollTop維持を検証する。
- 描画中の再入後に旧afterRenderを実行せず、描画失敗時の旧対応無効化が新しい対応を消さない。
- followのlistener・予約処理・借用DOM参照を解除し、外部購読・follow・renderer・hostの順と停止後callbackの遮断を確認する。

### panel 接続の自動テスト

責務・入力・解除順は architecture §6・§17 の panel-session を参照する。
この節は接続 module 単体の観点であり、lifecycle 組込み・実画面の検証とは区別する。

- 初回取得・字幕更新・UI更新で、同じsnapshotのgenerationとdisplayおよびUI意思をrendererへ渡すこと。元字幕historyへの表示fallbackを残さないこと
- 接続なしのnull、readyの空、invalid-time、unavailableを内部で区別し、入力を変更・補完しないこと
- 接続なし・正常な空・利用不能では字幕一覧を空にし、案内文・再試行ボタンを表示しないこと。失敗時に古い字幕枠を残さないこと
- invalid-timeでは有効な字幕枠を通常表示し、現在強調・自動追従を止め、追加の案内文を表示しないこと
- 有効な更新結果で字幕表示が戻り、「現在位置へ」を字幕取得の再試行として使わないこと
- panel close で字幕接続や外部 UI store を破棄しないこと
- renderer 生成、購読登録、初回取得・描画の失敗で、生成・登録済み資源の cleanup を試すこと
- 初期化と cleanup が両方失敗した場合、両原因を保持すること
- 更新通知中の取得・描画失敗を記録し、通知元へ例外を漏らさず、後続更新を処理できること
- 購読解除・follow解除・renderer除去・host除去の個別失敗後も残りを試し、失敗を報告すること
- 解除順・回数と、実際の DOM 状態を別々に確認し、親ごとの除去を子自身の除去成功と混同しないこと
- dispose 後の旧通知で取得・描画せず、反復 dispose で解除を再試行しないこと
- 取得中の再入更新・dispose が、古い結果の描画を起こさないこと
- 購読登録中の同期通知後も、初回取得が最新値を反映すること
- cleanup 中の旧通知・反復 dispose が再取得・二重解除を起こさないこと
- 旧 host 除去後の再入生成で、旧 cleanup が新接続を破棄しないこと。同一 ID の重複許可とは区別すること

callback 内は観測にとどめ、正常終了・期待値・呼出回数は例外捕捉境界の外側で検証する。
解除に失敗した資源を解除成功と扱わず、GC による回収や実機の全資源解除まで証明したとしない。

### lifecycle と panel の接続テスト

- panel 入力の省略時は従来の readiness / 字幕処理の契約を維持すること
- 有効 target の待機開始時に host を生成し、同じ対象の retry と running 移行で重複生成しないこと
- 字幕初回通知・更新を描画し、panel close で字幕接続を停止しないこと
- stop / dispose で旧購読・DOM・target 参照を解放し、旧 UI 通知と字幕通知で再更新しないこと
- restart で旧 host を破棄し、既存 UI store の開閉意思を維持すること
- 待機中の mount 差替え・target 消失で旧 panel と待機を残さないこと
- panel 初期化失敗でも字幕処理を妨げず、panel 解除失敗でも待機・字幕接続の停止を継続すること
- 公開状態が stopped のまま開始中でも stop が有効であり、古い開始処理が panel・字幕接続を復活させないこと
- panel cleanup 中の再開始を古い stop の後続処理が上書きせず、新接続を解除しないこと

entry の配線・pagehide からの解除到達と実画面確認は、上記接続テストだけで完了としない。

### 元字幕単位の独立時刻・3区分の回帰入力

以下は元データ保持・字幕単位の分類の固定入力であり、補助字幕をセリフブロックへ混ぜる表示仕様ではない。

- `pasted_text_1793248904.txt`の対象英語3件・日本語2件について、raw本文・時刻・言語内の順序を固定する。
- 1分39秒: current.primaryはashes、current.secondaryは長い訳文と `〝コ︱チ〟`。opportunityはpast、gloryはfutureに入る。
- 1分41.6秒: gloryと長い日本語訳がcurrentに残り、先の英語2件と `〝コ︱チ〟` はpastへ入る。
- 日本語訳の終了時刻102.6862111111111秒ちょうどでは、その訳文と対象英語3件・短い日本語はpastに入り、対象5件のcurrent/futureは空となる。
- 同一開始・終了時刻の英語3断片も、全件が同じ区分に入り、入力順・本文を保持することを別ケースで確認する。
- `independent-subtitle-view.test.ts`内の仮説検証は、製品関数・全入力・Chrome描画の検証と区別する。製品へ移行するときは同じ固定値で製品の構築・分類関数を直接検証し、試作処理を重複して残さない。

### 字幕本文の表示用変換の回帰ケース

- 固定ケースは `src/panel/subtitle-text-regression-cases.ts`。2026-10-28 の実 cue 観測から、日本語6件・英語6件の raw / expectedPlain / expectedRtCount を保持する。
- ruby の読み仮名と傍点を除外し、親文字・改行を保持する。c / i の装飾は本文へ混ぜず、音符・句読点・効果音表記・半角および全角空白を保持する。
- タグのない本文は変更しない。生 cue と元の字幕データの本文保持テストとは分ける。
- helper は `src/panel/subtitle-text.ts`、テストは `src/panel/subtitle-text.test.ts`。手作り fragment で rt 除外・空白と記号の保持・二重解釈防止・失敗伝播を検証する。これは WebVTT パーサー自体の検証ではない。
- 同じ12ケースを標準 VTTCue の assertion に登録する。API 不在環境では明示的に skip し、成功件数と分ける。jsdom では API 不在を確認済み。モックの成功を実パーサーの成功と扱わない。
- 本文準備の接続テストでhelperを観測済み結果へ差し替え、実例12件の準備結果を確認する。rendererはその準備済み本文の言語領域・入力保持・textContent描画を検証し、本文変換を再実行しない。実パーサーの成功とは扱わない。
- 変換失敗時は準備側の当該本文だけのraw fallback・囲み判定省略・他言語と後続更新の継続を確認する。空の変換結果も表示要素と空間を保持し、rendererでは再変換しない。準備結果のconversionFailedは1件以上の原文fallbackでtrue、失敗なしでfalseとなること。
- 警告はsessionごとに最初の1回だけとし、文言は `Subtitle text conversion failed; using original text`、字幕本文は含めないこと。renderer・準備関数では警告を出さないこと。
- 同じsessionで複数件・複数世代の失敗、成功後の再失敗があっても警告は増えず、新しいsessionでは最初の1回を出せること。警告後も変換は継続し、失敗一覧・件数・時間制限・再試行管理を追加しないこと。
- 実helperのAPI不在から本文準備の原文fallback、rendererの安全な文字列表示までを接続して確認する。実装のChrome確認とConsole上の先行観測は区別する。
- 実機での変換観測と限界は `docs/apple-tv-dom-observations.md` の「Phase 6: 実 cue の表示用変換の観測」を参照する。

### panel表示と操作の手動確認

拡張をONにしてpanelを開き、architecture §14の確定仕様と照合する。公開型が字幕単位のままの実装を、ブロック表示の成功とは扱わない。

| 対象 | 確認内容 |
|---|---|
| ブロックの保持 | 同じ元データでは未来・現在・過去で枠の構成を変えず、終了した枠も保持する |
| 全体強調 | 学習言語と母国語を含む枠全体を、最早開始以上・最遅終了未満で強調する |
| 補助字幕 | 単一・複数の完全囲みが元字幕1件で独立1枠となり、セリフと同じ一覧で元時刻による強調・過去未来保持を行う。セリフの構成・結合・強調範囲へ混ぜず、元データから削除しない |
| 本文 | 学習言語を上、母国語を下へ表示し、各言語の順序・改行・空白を保持する |
| 空・片言語 | 存在しない字幕を補完・他言語へ移動せず、ない側の空間を残す |
| seekと更新 | 同じ入力と時刻なら同じ枠と状態へ戻り、旧世代を再表示しない |
| 操作と解放 | closeとOFFを区別し、停止後の旧通知・DOM・スクロール処理を遮断する |

自動追従はarchitecture §14.12と「自動追従の検証」に従い、案内優先順・現在なし・手動停止・「現在位置へ」での再開を実画面で確認する。位置維持、操作区別、反復移動防止、末尾余白なし、非保存も確認する。
rendererがsource・video・TextTrackを直接読まないことはコードと自動テストでも検証する。ログ確認を実パーサー・自動追従・全資源解除の成功の代わりにしない。

## ON/OFF toggle の確認項目

対象ファイル:
- `src/controls/on-off-toggle.ts`
- `src/ui/ui-state.ts`
- `src/ui/extension-enabled-controller.ts`
- `src/settings/settings-store.ts`
- `src/content/session-lifecycle.ts`

自動テストで確認する項目:
- ON/OFF 操作で `extensionEnabled` が更新されること。
- 同じ値を連続設定しても不要な通知増殖がないこと。
- OFF 時に panel 表示用状態と拡張有効状態を混同しないこと。
- 未保存と保存 false を区別し、保存 false を既定 ON で上書きしないこと。
- 作品別・エピソード別の ON/OFF 保存を作らないこと。
- ON 操作時に panel を開き、panel の手動開閉では ON/OFF 保存を行わないこと。

手動スモークで確認する項目:
1. ON/OFF 未保存の条件を用意し、設定 ready の再生画面で ON・panel open になることを確認する。
2. OFF に切り替え、字幕処理・panel 表示・layout 適用と、それらに必要な監視が停止することを確認する。
3. OFF から ON に戻す操作経路が残ることを確認する。
4. 別作品・別話へ移動し、ページ再読み込み後も OFF が復元されることを確認する。
5. ON に切り替え、panel が開き、二重初期化なしで処理が始まることを確認する。
6. 別作品・別話へ移動し、ページ再読み込み後も ON が復元されることを確認する。
7. ブラウザ再起動後も、最後に保存した ON/OFF が復元されることを確認する。

期待結果:
- ON/OFF toggle は拡張機能全体の有効 / 無効だけを切り替える。
- panel の開閉状態とは別に動作する。
- OFF 後に終了した字幕処理 session の listener・DOM を残さず、ON に戻す操作経路と区別する。

保存失敗・回復 UI の確認（settings-spec §11.3）:
- 未保存の読込では既定 ON を適用し、書込みを行わないこと。
- 読込失敗・型不正では自動開始・自動上書きをせず、保存済み OFF と区別すること。
- トグル操作を即時反映して保存結果を確認し、保存後の get や一致確認を行わないこと。
- 読込失敗では「設定読込失敗」「OFFを保存」、型不正では「設定値不正」「OFFを保存」を表示すること。
- エラー中も通常のトグルで ON にでき、「OFFを保存」では ON にせず OFF を明示保存できること。
- 保存失敗でも現在の選択を維持し、「未保存」「再保存」へ切り替わること。
- 再保存は現在値の書込みだけを行い、処理の再起動・panel の開き直しを行わないこと。
- 保存成功時は理由表示・回復ボタンが取り除かれ、通常時に再保存ボタンがないこと。
- 連続操作の保存が直列化され、古い結果で最新の状態・通知を上書きしないこと。
- 自動の多段 retry・別領域への二重保存・専用の再読込操作を追加しないこと。
- 実機では通知・回復操作がトグル右隣の同じ行にあり、下段・他領域・詳細ポップオーバーへ表示されないこと。
- OFF・panel 非表示中も操作でき、ブラウザ幅変更時に折り返し・高さ変更・既存 controls への重なりがないこと。幅不足の扱いが未確定なら確認完了にしないこと。

操作側 owner・API の自動確認:
- initialize の重複で初期読込を増やさず、読込中の明示操作を古い結果で上書きしないこと。
- API が未保存由来・保存済み true/false・読込失敗・型不正を区別し、領域取得例外も結果として返すこと。
- 一件の保存失敗後も後続要求を処理し、古い成功・失敗で最新の通知を変えないこと。
- 保存中の回復操作は重複要求を増やさず、トグル操作は受け付けること。
- OFF・panel close・技術的 restart で操作側 controller を破棄せず、DOM 再生成で旧 UI の購読を解除すること。
- dispose 後に新規操作・購読を受け付けず、遅れた読込・保存完了で UI state 更新・通知を行わないこと。
- 最終終了では未開始の保存要求を破棄し、開始済みの書込みは結果を受け止めるが取消成功とは扱わないこと。
- 再保存と同じ ON の再要求で、手動 close を解除しないこと。

実施タイミング:
- ON/OFF toggle 実装直後
- session-lifecycle と接続した直後
- cleanup 修正時

## panel 開閉ボタンの確認項目

対象ファイル:
- `src/controls/panel-open-close-button.ts`
- `src/ui/ui-state.ts`
- `src/layout/player-layout.ts`

自動テストで確認する項目:
- 開閉操作で `panelOpen` が更新されること。
- `extensionEnabled` と `panelOpen` を独立に扱えること。
- subscribe 経由で UI へ変更通知できること。

手動スモークで確認する項目:
1. 拡張を ON にする。
2. panel が開いていることを確認し、開閉ボタンで閉じる。
3. 閉じた状態でも開く操作ができることを確認し、再び開く。
4. 右側 panel が表示され、再生画面領域との分割が適用されることを確認する。
5. 再度ボタンを押して panel を閉じる。
6. panel が消え、レイアウトが元に戻ることを確認する。
7. 複数回連続で開閉して、DOM 重複や表示崩れがないことを確認する。

期待結果:
- 開閉ボタンは panel の表示状態だけを切り替える。
- 拡張全体の ON/OFF 状態は変化しない。
- panel を閉じても字幕処理 session を stop / dispose しない。
- panel 開閉の保存要求を出さない。
- 同じ視聴の技術的再接続では手動 close を維持する。
- 連続操作でも二重描画やレイアウト破綻が起きない。

実施タイミング:
- panel-open-close-button 実装直後
- layout 接続直後
- panel host / renderer 修正時

## `ui-state.ts` small store の確認項目

対象ファイル:
- `src/ui/ui-state.ts`

unit test で確認する項目:
- `getState()` が初期状態を返すこと。
- 初期入力を反映でき、未保存時の既定値と保存済み値の復元を接続テストで区別できること。
- `setExtensionEnabled()` が state を更新すること。
- `setPanelOpen()` が state を更新すること。
- `subscribe()` で購読できること。
- unsubscribe 後に通知されないこと。
- listener が複数いても全員に同じ state が渡ること。
- state 更新順が予測可能であること。
- store 自身が Storage API を扱わず、処理 session の start ごとに ON/OFF を初期化しないこと。
- 購読解除を登録元が所有し、操作側 runtime の終了後に旧購読を残さないこと。

small integration test で確認する項目:
- ON/OFF toggle と接続したときに `extensionEnabled` が反映されること。
- panel 開閉ボタンと接続したときに `panelOpen` が反映されること。
- layout や renderer が subscribe 経由で更新できること。
- ON 操作時と新しい視聴開始時の panel 初期表示を、技術的再接続時の状態維持と区別すること。
- 新しい視聴の識別条件が未確認の場合は、その経路の確認を完了扱いにしないこと。

実施タイミング:
- `ui-state.ts` 実装直後
- toggle / panel button との接続直後
- state 項目追加時

## `textTracks` readiness の確認項目

対象ファイル:
- `src/content/playback-root.ts`
- `src/content/session-lifecycle.ts`
- `src/subtitles/subtitle-session.ts`
- `src/subtitles/subtitle-source.ts`

自動テストで確認する項目:
- textTracks が 0 件の間は waiting とし、字幕接続を生成しないこと。
- readiness 通過後に、対象 video に対する字幕接続を生成すること。
- waiting 中の video 差し替えで、旧待機を停止し、新 video を対象にすること。
- 同一 video の再確認では startedAt を維持し、retryCount を継続すること。
- 新 video では startedAt と retryCount を初期化すること。
- DOM 通知と retry が同じ変化を検出しても、有効な待機・接続を二重生成しないこと。
- stop / dispose 後に、旧 retry が字幕接続を生成しないこと。
- 再開始後に旧 retry が実行されても、新しい待機や字幕接続へ干渉しないこと。
- source 自身は readiness 待機・retry を行わないこと。

手動スモークで確認する項目:
- [ ] video を検出しても `video.textTracks.length === 0` の間、subtitle source が開始されない。
- [ ] `video.textTracks.length === 0` でも拡張が error または terminal failure 表示にならない。
- [ ] waiting 中に再確認され、`video.textTracks.length > 0` になった後に session が開始される。
- [ ] track が一部だけの途中状態でも、source、listener、panel host が重複しない。
- [ ] ready 到達後に primary / secondary track を解決できる。
- [ ] waiting 中に拡張を OFF にした場合、字幕処理の待機に属する retry、timer、observer が停止する。
- [ ] panel または debug UI が `dialog.playback-view` 配下に mount され、再生画面内で見える。
- [ ] 作品切替または新しい video への切替後に、古い UI、listener、waiting 状態が残らない。
- [ ] 再生終了または戻る操作後に、panel または debug UI が通常ページへ残らない。
- [ ] Apple TV+ native 字幕メニュー操作の前後で session が停止状態に固定されず、必要に応じて waiting から自然に復帰できる。
- [ ] Console に extension 起因の error が出ない。

期待結果:
- `textTracks.length === 0` は失敗ではなく waiting state として扱われる。
- subtitle source の開始条件は `video.textTracks.length > 0` である。
- readiness 待機中に session resource や extension DOM が重複しない。
- OFF 後に waiting の再試行が継続しない。
- 再生画面向け UI は playback dialog 配下で前面表示される。
- 作品切替、再生終了、native 字幕メニュー操作の後も古い session 状態を引きずらない。

実施タイミング:
- `playback-root.ts` または `session-lifecycle.ts` の readiness 判定を実装・変更した時
- `subtitle-source.ts` の開始条件を変更した時
- video replacement または SPA 遷移の不具合を修正した時

## 再生、一時停止、字幕切替の確認項目

対象ファイル:
- `src/subtitles/subtitle-source.ts`
- `src/subtitles/subtitle-session.ts`
- `src/subtitles/subtitle-history.ts`
- `src/content/session-lifecycle.ts`

手動スモークで確認する項目:
1. 再生開始直後に current 字幕が追従することを確認する。
2. 一時停止し、current 表示が不自然に進まないことを確認する。
3. 再生を再開し、更新が再開することを確認する。
4. 再生中に native subtitle UI または設定変更で字幕切替を行う。
5. 切替後に古い履歴や古い track のイベントが残らず、新しい状態へ追従することを確認する。

期待結果:
- 再生、一時停止、再開後も current / past / future が破綻しない。
- 字幕切替後に track 再解決または再接続が正しく行われる。
- 旧状態の listener が残って二重更新しない。

実施タイミング:
- subtitle source 実装後
- history / renderer 接続後
- track 切替関連の修正時

## seek の確認項目

対象ファイル:
- `src/subtitles/subtitle-source.ts`
- `src/subtitles/subtitle-session.ts`
- `src/subtitles/subtitle-history.ts`
- `src/panel/panel-renderer.ts`
- `src/content/session-lifecycle.ts`

手動スモークで確認する項目:
- [ ] seek 前後で playback session identity が変わらない。
- [ ] seek 前後で primary / secondary track binding が重複しない。
- [ ] seek 後に panel の current / past / future が更新される。
- [ ] seek 後は、保持済み 元の字幕データ と現在時刻から current / past / future が更新される。
- [ ] seek 後に cuechange が発生した場合も、新しい cue の内容が反映される。
- [ ] seek 後に panel host、layout observer、native menu listener が再生成されない。
- [ ] seek 後に二重 listener による重複描画が発生しない。

期待結果:
- seek は restart reason ではない。
- seek により session、panel host、layout observer、native menu listener を再生成しない。
- seek 自体を理由に cue本文の再取得やtimelineの再構築を行わず、保持済み 元の字幕データ から history を現在位置へ更新する。
- source の更新や未取得 cue の読込みによる 元の字幕データ の再構築は、時刻だけの更新とは分けて確認する。
- seek 後に同じ cue が重複して描画されない。

実施タイミング:
- seek 復帰処理を実装・変更した時
- subtitle history、panel renderer、cuechange 処理を変更した時
- seek 後の字幕同期不具合を修正した時

## native subtitle menu 同期の確認項目

対象ファイル:
- `src/subtitles/native-menu-sync.ts`
- `src/subtitles/text-track-resolver.ts`
- `src/subtitles/subtitle-source.ts`
- `src/content/session-lifecycle.ts`

手動スモークで確認する項目:
- [ ] 日本語から英語への切替で primary / secondary track が期待どおり再解決される。
- [ ] 英語から日本語への切替で primary / secondary track が期待どおり再解決される。
- [ ] `change` 直後の select value だけで track を確定しない。
- [ ] 最初の `requestAnimationFrame` 後に `TextTrack.mode === "showing"` を再確認する。
- [ ] select 表示が一時的に旧値へ戻っても、showing track を誤判定しない。
- [ ] hidden track の active cue を表示中字幕として誤採用しない。
- [ ] `activeCueCount` 単独で表示中字幕を決めない。
- [ ] menu close 後に native menu listener が残らない。
- [ ] session restart 後、native menu listener が 1 つだけ存在する。

期待結果:
- 表示中字幕の優先判定は `TextTrack.mode === "showing"` に基づく。
- select の一時的な表示値や hidden track の active cue は、表示中字幕の確定根拠にしない。
- menu 操作後は、適切なタイミングで track 状態を再確認して primary / secondary を再解決する。
- menu close、OFF、session restart、video replacement 後に旧 native menu listener が残らない。

実施タイミング:
- `native-menu-sync.ts` を実装・変更した時
- track resolver の採用条件を変更した時
- native subtitle UI 切替の同期不具合を修正した時
- session restart と native menu binding の接続を変更した時

## video replacement と session restart の確認項目

対象ファイル:
- `src/content/playback-root.ts`
- `src/content/session-lifecycle.ts`
- `src/subtitles/subtitle-source.ts`
- `src/subtitles/native-menu-sync.ts`
- `src/panel/panel-host.ts`
- `src/layout/player-layout.ts`

手動スモークで確認する項目:
- [ ] 旧 video の disconnect または新 video への replacement を検出できる。
- [ ] 旧 target と比較可能な video identity 変更では video-replaced を確認する。A → null → B で旧参照を解放済みなら、B は playback-target-appeared として確認する。
- [ ] 旧 video の disconnect は観測事実として記録し、再初期化理由コードとは区別する。理由コードは architecture の `RestartReason` に従う。
- [ ] restart 前に旧 session の track binding が解除される。
- [ ] restart 前に旧 session の cue listener が解除される。
- [ ] restart 前に native menu binding が解除される。
- [ ] restart 前に panel host が unmount される。
- [ ] restart 前に旧処理 session に属する layout observer と controls binding が解除される。
- [ ] restart 前に session timer、`MutationObserver`、`ResizeObserver` が解除される。
- [ ] 新 session 開始後、panel host が 1 つだけ存在する。
- [ ] 新 session 開始後、同じ cue が二重描画されない。
- [ ] 旧 session の cleanup が新 session の listener または panel を解除しない。
- [ ] readiness 待機中にさらに video が差し替わっても、最後に検出した video だけで session が開始される。

期待結果:
- 同じ playback root でも video identity が変われば旧処理 session を終了する。controller 自体は dispose せず、有効条件を満たす新 target で再開する。
- video を識別する文字列が同じでも、別 node であれば同一 session とみなさない。
- restart は旧処理の解除試行と参照切離しを終え、再入・OFF・dispose を確認してから、新 video の readiness 待機へ移る。解除失敗を実際の解除成功とは扱わない。
- cleanup は旧 session の resource だけを対象とし、新 session の resource に影響しない。
- 最終的に有効な video に対する session、panel host、listener、observer だけが 1 組存在する。

実施タイミング:
- video replacement 検出を実装・変更した時
- restart reason、session identity、cleanup 順序を変更した時
- `panel-host.ts`、`native-menu-sync.ts`、`player-layout.ts` の lifecycle を変更した時
- SPA 遷移または再初期化の不具合を修正した時

## SPA、playback root、再初期化の確認項目

対象ファイル:
- `src/content/playback-root.ts`
- `src/content/session-lifecycle.ts`
- `src/subtitles/subtitle-source.ts`
- `src/panel/panel-host.ts`
- `src/controls/on-off-toggle.ts`
- `src/controls/panel-open-close-button.ts`

手動スモークで確認する項目:
- [ ] playback root disconnect 時に再評価要求が送られ、lifecycle が対象消失・差し替え・開始条件を判断する。
- [ ] SPA target change 時に旧 session の cleanup が一度だけ実行される。
- [ ] target change 後に新しい root / video を再解決できる。
- [ ] root が維持され video だけ差し替わる場合にも再初期化できる。
- [ ] root が差し替わる場合にも古い extension DOM が残らない。
- [ ] restart 中に ON/OFF toggle 操作をしても resource が二重登録されない。

期待結果:
- root 差し替えと video 差し替えを別の再初期化契機として扱える。
- restart request が重複しても、旧 session の cleanup は一度だけ実行される。
- 新しい root または video に対して session を再構築できる。
- restart 中の ON/OFF 操作でも、source、listener、observer、panel host、controls が重複しない。
- 同一 target の再評価だけでは旧処理を終了しない。
- 対象消失時は旧 target を解放し、対象なしでは開始しない。
- root・mount・layout target のみの変更も、video 変更と区別して判定する。
- OFF・dispose 後は保留中の開始要求を実行しない。
- 技術的 restart は保存 ON/OFF と手動の panel 開閉を変更しない。

実施タイミング:
- `playback-root.ts` または `session-lifecycle.ts` の変更時
- SPA 遷移、playback root、video replacement に関する不具合修正時
- controls と session lifecycle の接続を変更した時

## cleanup、二重 listener、二重描画、DOM 残留の確認項目

対象ファイル:
- `src/content/session-lifecycle.ts`
- `src/shared/dispose.ts`
- `src/panel/panel-host.ts`
- `src/subtitles/subtitle-source.ts`
- `src/subtitles/subtitle-session.ts`
- `src/controls/on-off-toggle.ts`
- `src/controls/panel-open-close-button.ts`

自動テストで確認する項目:
- bag が登録の逆順で cleanup を実行すること。
- bag と個別 disposer の両方から呼んでも、同じ登録の cleanup を二重実行しないこと。
- dispose 済み bag への追加は、その場で cleanup すること。
- cleanup が途中で失敗しても残りを試し、全件の試行後に AggregateError で失敗を報告すること。
- 失敗後に bag.dispose を再度呼んでも、同じ cleanup を再実行しないこと。
- 個別 disposer の直接実行で失敗した場合も、bag 側では二重実行せず残りを処理すること。
- composeDisposers も登録の逆順に一度だけ実行し、失敗を報告する仕様を満たすこと。
- source が同じ pair に二重 bind せず、再 bind 時に旧 listener の解除を先に試すこと。
- source の一方の listener 解除が失敗しても、他方の解除を試し、失敗をログに残すこと。
- listener 登録失敗後の cleanup も失敗した場合、source の bind から例外を漏らさないこと。
- source の dispose 後は購読者へ通知しないこと。
- listener の解除に失敗した旧 binding から、再 bind 後の購読者へ通知しないこと。
- 通知途中に dispose された場合、後続購読者へ通知しないこと。
- subtitle-session の初期化途中で失敗した場合も、作成済み資源の cleanup を試すこと。
- lifecycle の停止・再開始・直接 dispose で、保持する旧字幕接続の cleanup を一度だけ試すこと。
- 待機 retry の解除が失敗しても、lifecycle の停止・再開始・直接 dispose の後処理が進むこと。
- unbind / unmount / unsubscribe が二重呼び出しに耐えること。
- stop / dispose 後の getState が status:stopped、target:null、waiting:null であること。
- stop / dispose 後の getSubtitleSnapshot が null であること。
- stop 後は controller の公開購読を維持し、新 target の start と更新を受け取れること。
- dispose は状態・字幕データの購読を破棄し、最終通知・新しい開始・新規購読を行わないこと。
- 処理 session に属する中継購読・UI state 購読は、各 owner が終了時に解除すること。
- 通知中の再開始を古い stop の後続処理が上書きせず、旧 cleanup が新接続を解除しないこと。
- stop / dispose / restart が、保存された ON/OFF を変更しないこと。
- badge の DOM 不在と旧 target 参照の非保持を、別々に確認すること。

失敗ケースの test double では、「すべての解除を試したこと」と
「すべての解除に成功したこと」を区別する。
解除関数自体が失敗した resource が、実際に消えたとは判定しない。

購読者・cleanup の例外を実装が捕捉する経路では、callback 内の assertion 失敗も捕捉され得る。
callback 内では取得結果などを観測し、期待値・正常終了・呼出回数は捕捉境界の外側で検証する。
意図して例外を発生させるケースは、その期待ログと通常の観測を区別する。

手動スモークで確認する項目:
1. ON → OFF → ON を複数回繰り返す。
2. panel 開閉を複数回繰り返す。
3. エピソード遷移を複数回行う。
4. シークと字幕切替を組み合わせて操作する。
5. DevTools で panel host、toggle、button の DOM が重複していないことを確認する。
6. console log や health snapshot で listener 数、active session、採用 track を確認する。
7. OFF 後に字幕更新ログや UI 更新ログが流れ続けないことを確認する。

期待結果:
- 処理 session に属する listener、timer、observer、track binding、DOM、データ・参照が解放される。操作側 runtime と controller の公開購読の寿命は architecture §12・§16 に従う。
- 同じ UI が二重に mount されない。
- current subtitle の更新が二重発火しない。
- session 停止後に旧 resource が動き続けない。

実施タイミング:
- cleanup API を入れた直後
- lifecycle 変更時
- 回帰確認時
- リリース前

## 回帰確認項目

各変更単位では、変更した機能と影響を受ける接続先について、関連する自動テストとブラウザ確認を行う。

接続を変更したときや Phase の区切りでは、個別の確認に加えて、
`docs/implementation-workflow.md` の「フェーズごとの検証ルール」と該当 Phase の完了条件に従い、全体を確認する。
リリース前には「手動スモークテスト最小セット」全体を確認する。

確認範囲を絞ることを理由に、必須の検証や Phase の完了条件を省略しない。

回帰確認項目:
- popup 設定の保存と再読込が壊れていない。
- ON/OFF 未保存時は ON、保存済みなら最後に選んだ値を復元する。
- 作品・エピソード変更や技術的再接続で保存 ON/OFF を変更せず、panel 開閉を永続保存しない。
- 設定が incomplete / error の場合、字幕接続を開始しない。
- 同一 target の再評価だけで、不要な session 再開始や字幕接続の再生成が起きない。
- debug UI 自身の DOM 更新で、再評価と再開始を繰り返さない。
- 起動途中の失敗や pagehide で、登録済みの購読、observer、timer、debug UI、lifecycle の cleanup を試す。
- ON/OFF toggle が panel 開閉と混同されていない。
- panel 開閉ボタンが拡張全体の状態を変えない。
- primary / secondary の採用が壊れていない。
- `SubtitleTimeline` の current / past / future 導出が壊れていない。
- 再生、一時停止後に字幕表示が復帰する。
- `textTracks.length === 0` を waiting state として扱い、ready 到達後にだけ subtitle source を開始する。
- readiness 待機中に OFF へ切り替えた場合、字幕処理の待機に属する retry、timer、observer が停止する。
- seek は restart reason ではなく、session identity、track binding、panel host、layout observer、native menu listener を維持する。
- seek 後に current / past / future が現在位置へ復帰し、重複描画が発生しない。
- native subtitle menu の切替では、`TextTrack.mode === "showing"` を優先して primary / secondary track を再解決する。
- native menu の `change` 直後の select value、hidden track の active cue、`activeCueCount` 単独で表示中字幕を確定しない。
- video replacement 時に旧 session の cleanup が一度だけ行われ、新 video の session だけが開始される。
- readiness 待機中に video が連続して差し替わった場合、最後の video だけで session が開始される。
- SPA target change、playback root disconnect、video replacement の各契機で、old session の resource が二重解放、残留、新 session への誤干渉を起こさない。
- restart 中の ON/OFF toggle 操作で、listener、observer、timer、panel host、controls が二重登録されない。
- SPA 遷移後に再初期化できる。
- OFF 後や遷移後に DOM 残留、二重 listener、二重描画が起きない。
- 7:3 layout が再計算され、既存 UI を含む再生画面領域との分割が破綻しない。

実施タイミング:
- track resolver 変更時
- subtitle timeline構築 変更時
- history 変更時
- session-lifecycle 変更時
- panel / controls / layout 変更時

## 不具合報告時に残すべき観測情報

基本情報は、以下の報告テンプレートにまとめる。
DOM 残留がある場合は、Elements の状態も残す。

あるとよい追加情報:
- video 差し替え前後の識別情報
- track 切替前後の識別情報
- native subtitle UI の操作内容
- ON/OFF toggle と panel 開閉ボタンの操作順
- 一時停止中か再生中か
- シーク量
- 再現率

報告テンプレート:

```md
- 発生日時:
- ブランチ名:
- コミット ID:
- 対象コンテンツ:
- 再現手順:
- 実行した操作順:
- 発生タイミング:
- 期待結果:
- 実際の結果:
- `primaryLang`:
- `secondaryLang`:
- `extensionEnabled`:
- `panelOpen`:
- primary track:
- secondary track:
- current subtitle:
- 言語別timeline件数:
- current の有無:
- past / future 件数:
- active session:
- restart reason:
- readiness:
- `textTracks.length`:
- layout:
- console log:
- スクリーンショット:
- DOM 残留時の Elements の状態:
- 補足:
```

## 自動テストと手動スモークテストの境界

自動テストに寄せる対象:
- 設定値の正規化
- バリデーション
- track 正規化
- track 採用判定
- cue から `SubtitleTimeline` を作る処理
- `SubtitleTimeline` から current / past / future を作る処理
- `ui-state.ts` の small store
- `player-layout.ts` の幅計算、比率計算、状態導出など、実 DOM 計測に依存しない pure logic
- shared utility
- 小さな接続テスト

手動スモークに残す対象:
- Apple TV+ 実 DOM の selector 妥当性
- 実 `video.textTracks` の取得タイミング
- native subtitle UI との関係
- panel host の配置位置
- ON/OFF toggle の配置位置
- panel 開閉ボタンの配置位置
- controls の表示・非表示変化を含むブラウザ上の DOM 計測と、7:3 layout の表示
- SPA 遷移
- video 差し替え
- ブラウザ上で解放処理が成功したか

判断基準:
- Apple TV+ 実画面がなくても再現できるものは、まず自動テストに寄せる。
- DOM 構造、実再生状態、ネイティブ UI、レイアウト見た目に依存するものだけを手動に残す。
- 手動項目を増やす前に、pure function 化または small integration 化できないかを先に検討する。



## 手動スモークテスト最小セット

実施タイミング:
- 確認対象の機能を接続した後
- 関連機能を変更した後の回帰確認時
- リリース前

部分的な接続確認では、対象機能に対応する手順を実施する。
最小セット全体の成功は、すべての手順を実施した場合にだけ判定する。

手順 1:
- popup で `primaryLang` と `secondaryLang` を設定する。
- 再読込して言語設定が保持され、ON/OFF は未保存時の既定値または保存済み値に従うことを確認する。
- 期待結果: 言語保存で ON/OFF を上書きせず、panel 開閉状態は復元しない。

手順 2:
- Apple TV+ 再生画面で ON 状態を確認する。保存 OFF の場合は toggle で ON にする。
- `textTracks.length === 0` の待機があっても error にならず、ready 到達後に session が開始されることを確認する。
- 期待結果: readiness 待機中に resource は重複せず、ready 後に primary / secondary が解決される。

手順 3:
- ON 操作時または新しい視聴開始時に panel が開くことを確認する。
- primary / secondary 字幕が表示され、current / past / future が更新されることを確認する。
- 期待結果: panel host は 1 つだけ存在し、二重描画がない。

手順 4:
- panel を閉じる。
- 再度開く。
- 期待結果: レイアウトが破綻せず、DOM が重複しない。

手順 5:
- 10 秒から 30 秒程度シークする。
- 期待結果: session identity は維持され、シーク後に current 字幕と panel 表示が現在位置へ復帰する。

手順 6:
- native subtitle UI で字幕を切り替え、「native subtitle menu 同期の確認項目」に従って確認する。
- 期待結果: select の値だけで確定せず、適切なタイミングで track 状態を再確認し、採用 track と表示が新しい状態へ追従する。
- popup でも言語設定を変更・保存し、保存済み設定が再生中の字幕処理へ反映されることを別に確認する。
- 期待結果: `docs/settings-spec.md` §12 に従い、保存成功後に保存済み設定を再読込して track と表示を更新する。保存失敗時は新設定を反映しない。

手順 7:
- 別エピソードまたは次話へ遷移する。
- 期待結果: 旧処理 session が cleanup され、ON/OFF を変更せず新対象で正常に開始される。ON の新しい視聴では panel が開く。
- 新しい視聴の識別条件を確認できなかった場合、panel 初期表示の経路は未確認として残す。

手順 8:
- root 維持のまま video が差し替わるケースを確認する。
- 期待結果: architecture の理由選択に従い、最後の有効 video だけで開始する。同じ視聴の技術的再接続では手動の panel 開閉を維持する。

手順 9:
- OFF に切り替える。
- 期待結果: 字幕処理・panel 表示・layout 適用と、それらに属する監視・待機が停止する。ON に戻す操作経路は残り、終了した処理 session の DOM 残留・二重 listener がない。
- 別作品への移動とページ再読み込み後も OFF を復元することを確認する。

## 設計変更を要する発見

テスト追加または不具合調査で、担当ドキュメント間に矛盾や責務境界の不足を見つけた場合は、次を記録する。

- 再現条件
- 影響する機能と対象ファイル
- 現在の期待結果と実際の結果
- 変更候補
- 更新すべき担当ドキュメント

この文書には設計本文を重複記載せず、変更対象の担当ドキュメントで仕様を更新する。
