# Testing Checklist

この文書は、Apple TV+ 向け二言語字幕 Chrome 拡張 v2 のテスト観点を整理するためのチェックリストである。

ここでは、テスト方針、自動テストの構成、実行前提、手動スモークテスト、回帰確認、観測情報の残し方だけを扱う。

要件本文、設計本文、DOM 観測本文、実装手順本文は他文書で管理し、この文書には重複して詳述しない。

## テスト方針

- 可能な限り自動化し、Apple TV+ 実画面依存の項目だけを手動スモークテストに残す。
- まず typecheck、lint、unit test を常時実行できる状態にする。
- pure function に寄せられる処理は unit test で確認する。
- `settings-store.ts`、`text-track-resolver.ts`、`subtitle-block-builder.ts`、`subtitle-history.ts`、`player-layout.ts`、`shared/` 配下の pure utility、`ui-state.ts` は優先的に自動テスト対象にする。
- `settings` と `resolver`、`block builder`、`subtitle history`、`ui-state` の接続は small integration test で確認する。
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
- `subtitle-block-builder.ts` と `SubtitleBlock[]` 構築
- block builder / history / renderer 間のデータの受け渡し
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

6. 保存設定と再生対象を確認し、今回の接続範囲に対応する項目を実施する。設定を変更した場合は、保存後にページを再読み込みする。

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

## `SubtitleBlock[]` と panel 表示の確認項目

対象ファイル:
- `src/subtitles/subtitle-block-builder.ts`
- `src/subtitles/subtitle-block-candidates.ts`
- `src/subtitles/subtitle-history.ts`
- `src/panel/panel-renderer.ts`
- 再生経路への接続を担当する呼び出し側

仕様の参照先:
- builder の公開 API・入力条件・対応づけ・出力規則は、`minimal-panel-architecture.md` §17 の `subtitle-block-builder.ts` を正本とする。
- history の導出仕様と境界例は、同節の `subtitle-history.ts` を正本とする。
- panel の表示・自動追従は、同文書の §14 を正本とする。
- 共通型は同文書の §18 を参照し、両言語の本文型と `null` による欠損表現が一致することを確認する。

以下は確認計画であり、項目の記載だけで実装・テスト実施済みと扱わない。
仕様の数式・閾値は正本を参照し、ここでは確認する入力と期待動作を整理する。

### builder の基本動作と責務境界

- primary / secondary とも空なら、空の配列を返すこと。
- primary のみ1件なら、その時刻・本文と `secondaryText: null` を持つ1 block を返すこと。
- secondary のみ1件なら、その時刻・本文と `primaryText: null` を持つ1 block を返すこと。
- 同じ開始・終了時刻の primary / secondary が各1件なら、二言語を持つ1 block を返すこと。
- 片言語1件と同時刻範囲の二言語各1件では、時刻と本文を丸め・trim・補完せずに返すこと。
- 入力配列と各 cue を変更しないこと。
- 呼び出しごとに新しい配列と block オブジェクトを返し、前の戻り値の変更が次の結果へ影響しないこと。
- cue の track 管理情報や実 `TextTrack` の状態を読まないこと。
- 戻り値に cue・track の参照や id / key を含めないこと。

### builder の入力検証・対応づけ・出力

| 分類 | 確認する内容 |
|---|---|
| 入力条件 | 同時刻を含む開始時刻順を受け付け、順序違反・非有限・負時刻・終了≦開始・空本文・空白だけの本文を RangeError で拒否する |
| 入力保持 | 入力を変更せず、有効本文の空白・改行を保持し、黙った補正・並べ替えを行わない |
| 完全重複 | 同言語・同開始・同終了・同本文だけを除去し、最初の1件と残りの入力順を維持する |
| 重複ではない字幕 | 異なる時刻・本文・言語の字幕と、結合後の反復語を残す |
| 同時刻正規化 | 重複除去後の連続・同開始・同終了を1件・2件・3件・多数件で確認し、件数上限なしで処理する |
| 正規化の除外 | 非連続、開始だけ一致、終了だけ一致、微小な時刻差を結合しない。並べ替え・丸めをしない |
| 正規化の独立性 | primaryのみ・secondaryのみ・両側で確認し、他言語の候補なしでも単位を保持する |
| 正規化の順序 | 完全重複除去後の連続性で判定し、先頭の元入力位置を保つ。連結後の重複除去をしない |
| 単位ベースの評価 | 生cue数で重み付けせず、正規化後の件数で採点・同点判定する。正規化は対応結合回数に含めない |
| 単位の消費 | 正規化後のoffsetと件数で前進し、再利用・欠落を防ぐ。元inputIndexを配列添字として扱わない |
| 対応候補 | 正規化単位の1対1・1対2・2対1、時刻ずれ、部分的な重なりを確認する |
| 重なり率の境界 | 60%未満・ちょうど・超過、境界だけの接触を確認する |
| 隣接2単位 | 空白率10%未満・ちょうど・超過、空白0、時間の重なりを確認する |
| 結合範囲 | 最小開始〜最大終了を使う。先の単位が後の単位より遅く終わる場合も確認する |
| 結合制限 | 正規化後の非隣接・3単位以上の連鎖結合・強制結合を行わない。同時刻正規化とは区別する |
| 全体評価 | 局所的な最高点と系列全体の最高点が異なる例を用意し、再利用なし・順序維持で合計最大を選ぶ |
| 同点 | 合計点、対応結合回数、対応単位数、対応リストの辞書順の各比較段階を確認する |
| 閾値ちょうどの採否 | 60%の1対1は未対応との同点で選び、60%の結合はほかに利点がなければ未対応を選ぶ |
| 未対応 | 減点せず、両言語とも正規化済み単位ごとに片言語 block として残す |
| 本文結合 | 単位内・採用単位間の入力順と、元の空白・改行・タグを保持する |
| 欠損 | ない側を null とし、両方 null の block は生成しない |
| 出力時刻 | primary があれば primary 側、なければ secondary 側。結合時は最大終了を使う |
| 出力順 | primary の入力順を軸に secondary のみを開始時刻で挿入し、同時刻では primary を含む block を先にする |
| 片言語・空入力 | primary のみ複数、secondary のみ複数、両言語空を確認する |

builderとhistoryの接続では、ブラウザで観測した同一開始・終了の英語3断片と
日本語1cueを回帰入力とし、英語全文と日本語が1blockになり、
currentから末尾の英語断片が分離しないことを確認する。

正規化条件外の同時刻blockが残る場合は、既存のhistory選択規則を維持する。

### history の自動テスト

| 分類 | 確認する内容 |
|---|---|
| current 選択 | 開始済みの最新開始時刻を選び、開始時刻ちょうどで切り替わる |
| 同時刻 | 表示順で最初を選び、後続の同時刻 block も future に残す |
| 終了時刻 | 終了による切替や以前の block への復帰を行わない |
| 空白区間・末尾 | 次の開始まで、最後に選ばれる current を維持する |
| 先頭・空配列 | 先頭より前は current:null・past空・全行future。空配列は current:null・past/future空 |
| 分割 | past/current/future を元の block 順で構成し、非選択を理由に欠落・重複させない |
| seek | 前進・後退・直接seekでも、同じ時刻とblockから同じ結果を返す |
| 不正時刻 | NaN・Infinity・負の currentTime を RangeError で拒否する |
| 不変性と責務 | 入力を変更・並べ替えせず、source・TextTrack・video・DOMを直接読まない |

### 再生経路への接続の確認

| 分類 | 確認する内容 |
|---|---|
| 想定した入力条件違反 | 呼び出し側で処理し、該当更新の block/history を空にして、古い字幕を現在の結果として残さない |
| 再生への影響 | 入力条件違反で動画再生自体を停止しない |
| 予期しない例外 | 一括して握りつぶさない |
| 責務境界 | 例外処理・source制御を builder / history に持ち込まない |
| lifecycle のデータ境界 | 接続なしの null と接続中の空 snapshot を区別し、取得時だけ字幕接続へ委譲する |
| lifecycle の更新中継 | 初回接続・更新・クリアを状態購読と分離して通知し、通知だけでは snapshot を取得しない |
| 中継の寿命 | 購読解除失敗後の cleanup 継続、旧 callback の無効化、通知中の停止・再開始・破棄を自動テストする |

builder の基本ケースだけでなく、対応づけ・欠損・出力順・入力条件違反をそれぞれ確認する。
builder、history、再生経路への接続、panel の確認結果は区別して記録する。
panel 実装前のブラウザ確認は、workflow Phase 5 に従って block / history をログで観測し、
以下の panel 表示の手動確認とは分けて記録する。

#### panel 実装前のログ観測手順

1. `src/content/index.ts` の `DEBUG_SUBTITLE_SNAPSHOT_LOG` を true にする。有効な保存設定と extension enabled が必要で、ログフラグ自体は拡張を ON にしない。
2. 「手動スモーク前の準備」に従って build・拡張再読み込み・ページ再読み込みを行う。
3. Apple TV+ 再生画面の DevTools Console で Info を表示し、`subtitle snapshot` で絞り込む。logger の最低レベルは info 以下にする。
4. `summary` は取得時点の JSON 文字列。connected、blockCount、firstBlock / lastBlock、current、pastCount / futureCount、previous / next を確認する。各 block は時刻と両言語の本文・null を含む。
5. 通常再生・前後seek・字幕track切替・再生対象切替を観測する。接続なしは connected:false、接続中の空結果は connected:true・blockCount:0 として区別する。
6. 通常利用・配布前はログフラグを false にして再 build する。字幕本文が Console に含まれるため、共有時は必要部分だけに絞る。保存・外部送信機能は追加しない。

同じ要約は重複出力しない。全字幕配列は出さず、要約対象外の block のみの変化はログに現れない。
有効中は更新ごとに snapshot のコピー取得が発生するが、フラグ無効時は購読も取得もしない。
取得・出力処理の失敗は記録し、次の更新で再試行する。ログ確認は panel の描画・スクロール確認の代わりにはしない。

### panel 表示・自動追従の手動確認

拡張を ON にして panel を開き、次を確認する。
必要な片言語・長大 block・同時刻などを実データで再現できない場合は、未確認として記録する。

| 分類 | 確認する内容 |
|---|---|
| 言語領域 | 学習言語が上、母国語が下。欠けた側も空行1行を確保し、本文を別の言語領域へ移さない |
| 本文と順序 | 改行を保持し、history の表示順を変えない |
| 強調と保持 | current が切り替わっても他の行を消さず、終了後の行も表示対象として残す |
| 同時刻 | 先頭だけを current にし、後続も表示する。全行が順に強調されることは要求しない |
| current なし | future を表示する。未取得字幕を補完しない |
| 表示範囲内 | current 全体が収まる間は、強調だけを進めてスクロールしない |
| 下端の移動 | 新しい current 全体が収まらなくなったら、その block を上端へ移す |
| 動き | アニメーションを付けず、自動スクロール自身で追従停止しない |
| 手動操作 | スクロールで追従停止。current の計算・強調は続け、閲覧位置を勝手に移動しない |
| 現在位置に戻る | current を上端へ表示して追従再開。current なしなら先頭へ |
| seek | 追従中はseek先のcurrentを上端へ。停止中は追従停止を維持。追従中でcurrentなしなら先頭へ |
| 再表示 | panel を開き直すと current を上端へ表示して追従再開。current なしなら先頭へ |
| source 更新 | 追従中は通常規則、currentがなくなれば先頭へ。停止中は閲覧位置を可能な範囲で維持する |
| 長大 block | 表示範囲より高くても上端合わせを繰り返さない |
| 末尾 | 最大スクロール位置までとし、上端合わせ用の余白を追加しない |
| 非表示 | extension OFF・panel close 時は非表示になる |
| cleanup | session終了・表示破棄後に旧イベント・購読・スクロール処理が残らない。cleanupの確認項目と合わせて検証する |

期待結果:
- renderer は source や TextTrack を直接読まず、渡された truth / history に従う。
- 自動追従を理由に current の選択規則を変更しない。
- 表示対象の欠落・重複がなく、手動閲覧と自動追従を区別できる。
- 追従状態を Chrome Storage に保存しないことは、コード・自動テストで確認する。

実施タイミング:
- builder / history の各実装単位の直後に対象の自動テストを追加・実行する。
- 再生経路への接続後、panel 実装前に block / history をブラウザのログで確認する。
- panel renderer・自動追従の実装後に、手動確認を行う。
- cue 対応づけ・history・追従ロジック変更時に、関係する回帰確認を行う。

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
- 保存失敗でも今回の選択を維持し、「未保存」「再保存」へ切り替わること。
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
- [ ] seek 後は、保持済み truth と現在時刻から current / past / future が更新される。
- [ ] seek 後に cuechange が発生した場合も、新しい cue の内容が反映される。
- [ ] seek 後に panel host、layout observer、native menu listener が再生成されない。
- [ ] seek 後に二重 listener による重複描画が発生しない。

期待結果:
- seek は restart reason ではない。
- seek により session、panel host、layout observer、native menu listener を再生成しない。
- seek 自体を理由に cue 本文の再取得や block の再構築を行わず、保持済み truth から history を現在位置へ更新する。
- source の更新や未取得 cue の読込みによる truth の再構築は、時刻だけの更新とは分けて確認する。
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
- `SubtitleBlock[]` の current / past / future 導出が壊れていない。
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
- subtitle block builder 変更時
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
- `SubtitleBlock[]` 件数:
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
- cue から `SubtitleBlock[]` を作る処理
- `SubtitleBlock[]` から current / past / future を作る処理
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
