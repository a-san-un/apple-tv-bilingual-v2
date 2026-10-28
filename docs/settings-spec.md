# Settings Spec

この文書は、Apple TV+ 向け二言語字幕 Chrome 拡張 v2 における設定 UI と保存設定の仕様を定義する。

この文書が扱うのは、設定 UI、保存形式、fallback、バリデーション、設定反映、責務境界だけとする。  
字幕取得方式、track 採用ロジック、panel 描画詳細、DOM 調査、実装フェーズ、テスト詳細は本書の対象外とする。

---

## 1. 目的

v2 の設定 UI は、字幕表示に必要な最小の保存設定だけをユーザーに入力させるためのものとする。

初期版で popup から扱う設定は次の 2 項目だけとする。

- 学習言語
- 母国語

これらとは別に、再生画面の ON/OFF toggle で選んだ拡張全体の有効状態を、
全作品共通の保存設定として扱う。popup に ON/OFF 項目は追加しない。

設定仕様は次の方針に従う。

- 学習言語は必須
- 母国語は任意
- 母国語には学習言語と同じ値を選べない
- 母国語が未選択のときはブラウザ言語を fallback とする
- 保存設定と runtime state は混ぜない
- 言語設定の保存先は `chrome.storage.sync` を基本とする
- ON/OFF の保存・復元と panel 開閉の非保存は §11 に従う
- 設定の読込・保存は `src/settings/settings-store.ts` に寄せる
- 実際の字幕 track 解決は content 側の `src/subtitles/text-track-resolver.ts` が担当する
- `settings-store.ts` と popup の担当者が、他文書を読まなくても基本仕様を実装できる状態を目指す

---

## 2. 対象範囲

この文書が扱うのは次の内容だけである。

- popup UI の要件
- 学習言語と母国語の選択仕様
- 言語候補一覧の扱い
- `primaryLang`、`secondaryLang`、`extensionEnabled` の保存境界
- Chrome Storage の利用方針
- デフォルト値と fallback
- バリデーション
- 保存設定と runtime state の境界
- 設定変更時の content 側への反映方針
- popup と `settings-store.ts` の責務境界
- 読込失敗、破損値、旧形式値の扱い
- `primaryLang` 未設定時の再生画面側の振る舞い

次の内容は別文書で扱う。

- 字幕取得と track binding
- `SubtitleBlock[]` 構築
- `TextTrack` の採用判定ロジック
- panel の DOM 描画仕様
- Apple TV+ 固有の DOM selector
- session cleanup の詳細
- 実装手順
- テスト詳細

---

## 3. 用語

用語は `docs/minimal-panel-architecture.md` の「2. 用語」を正本とする。この文書では再定義しない。

---

## 4. popup UI 要件

### 4.1 基本方針

popup は初期版の設定 UI として使う。

popup で表示する設定項目は次の 2 つだけとする。

- 学習言語
- 母国語

初期版では、次の項目を popup に含めない。

- 拡張機能全体の ON/OFF
- panel の open / close 状態
- subtitle track の直接選択
- デバッグ設定
- 高度な同期設定
- レイアウト設定
- API 設定

### 4.2 UI 構成

popup UI の最小構成は次の通りとする。

1. タイトル領域
2. 学習言語選択 `select`
3. 母国語選択 `select`
4. 保存ボタン
5. 保存結果やバリデーションエラーを出すステータス領域

初期版では options page を前提にせず、popup だけで完結する構成を基本とする。

### 4.3 ラベル方針

ユーザー向けラベルは次の意味で固定する。

- 学習言語: 学習対象として表示する字幕言語
- 母国語: 補助表示として使う字幕言語

内部キー名は `primaryLang` / `secondaryLang` に統一するが、popup 上ではユーザー向けラベルを優先する。

### 4.4 初期表示

popup は起動時に `settings-store.ts` を通して保存設定を読む。

- `primaryLang` が有効なら、学習言語の初期表示に使う
- `secondaryLang` が有効なら、母国語の初期表示に使う
- `secondaryLang` が `null` なら、母国語は未選択として表示する
- browser language fallback の結果を、保存済みの母国語として表示してはならない
- `primaryLang` が未設定または不正なら、学習言語は未選択として表示する
- 読込に失敗した場合は、保存済み値が取得できないことをステータス領域に表示する

### 4.5 保存タイミング

popup では、ユーザーが値を変更しただけでは保存しない。

保存は明示的な保存操作で行う。  
変更途中の一時値は popup 内のローカル state としてのみ持つ。

popup の編集中値は保存前の一時値であり、content 側へ直接渡して反映してはならない。

---

## 5. 学習言語と母国語の選択仕様

### 5.1 学習言語

`primaryLang` は必須である。

学習言語が未選択の状態では保存できない。  
初回利用時も、最低限 `primaryLang` が決まるまでは設定未完了として扱う。

### 5.2 母国語

`secondaryLang` は任意である。

母国語が未選択でも保存できる。  
このとき保存値は未選択として保持し、実行時には content 側でブラウザ言語 fallback を適用する。

### 5.3 同一値禁止

`secondaryLang` には `primaryLang` と同じ値を選べない。

この制約は UI 上でも分かるようにし、保存前にも必ず検証する。  
同一値が入力された場合は保存を拒否し、popup 上で修正を促す。

### 5.4 fallback 適用の考え方

`secondaryLang` が未選択のとき、保存設定そのものを書き換えて fallback 値を保存してはならない。

fallback は実行時解決であり、保存設定としての `secondaryLang` は未選択のまま保持する。

---

## 6. 言語候補一覧の扱い

### 6.1 固定一覧

popup に表示する候補言語は、固定一覧ベースで扱う。

この一覧は Apple TV+ の実際の `TextTrack` 一覧そのものではない。  
UI に出す候補は、拡張が対応対象として定義した安定した一覧を使う。

### 6.2 候補一覧と track 解決の分離

popup は候補言語コードを保存するだけで、Apple TV+ 上の実際の track 採用判定は行わない。

実際にどの字幕 track を primary / secondary として採用するかは、content 側の `src/subtitles/text-track-resolver.ts` が担当する。  
popup は `TextTrack.language`、ラベル揺れ、地域差分、代替候補探索を知らなくてよい。

### 6.3 候補一覧の要件

候補一覧は次の要件を満たす。

- 順序が安定している
- popup と storage で使う code が一貫している
- 表示ラベルと保存値の対応が明確である
- 学習言語と母国語で同じ一覧を使える
- 未選択を表す option は母国語側にだけ持てる

### 6.4 候補一覧の配置責務

候補一覧の定義元は popup 本体ではなく、設定 UI から参照できる共通モジュールに置く。
初期実装では `src/settings/language-options.ts` を定義元とし、候補コード一覧の取得と候補コード判定を提供する。

`src/settings/settings-store.ts` は候補一覧を所有せず、この共通モジュールを利用して保存値の validation と正規化を行う。

ただし、そのモジュールは UI 候補一覧を提供する責務に留める。  
Apple TV+ の生の track 情報、track 解決ロジック、表示ラベル、secondary 専用の未選択 option は持ち込まない。

---

## 7. 保存形式

### 7.1 保存キー

保存設定のキーは次の 3 つを正本とする。

| キー | 型 | 必須 | 意味 |
| --- | --- | --- | --- |
| `primaryLang` | `string` | 必須 | 学習言語 |
| `secondaryLang` | `string \| null` | 任意 | 母国語。未選択を許可する |
| `extensionEnabled` | `boolean` | 未保存を許可 | 全作品共通の拡張 ON/OFF。未保存時は ON |

### 7.2 保存データ型

以下は、言語設定の保存成功時のデータ形式である。
母国語未選択は空文字ではなく `null` で表現する。

```ts
export type StoredSettings = {
  primaryLang: string;
  secondaryLang: string | null;
};
```

`extensionEnabled` の保存値は、これとは別に boolean として扱う。
キーの欠落は、値が false であることとは区別する。
言語設定と ON/OFF を、同じ保存要求や同じ取得結果型へまとめることは要求しない。

この方針により、次の区別が明確になる。

- `primaryLang` が未設定で不正
- `secondaryLang` が未選択で正常
- fallback による実行時補完
- 不正な空文字や型崩れ

### 7.3 保存例

言語設定の保存例を示す。ON/OFF の保存操作は言語保存と分離する。

母国語を明示指定した場合:

```json
{
  "primaryLang": "en",
  "secondaryLang": "ja"
}
```

母国語を未選択にした場合:

```json
{
  "primaryLang": "en",
  "secondaryLang": null
}
```

ON/OFF を明示的に保存する場合:

```json
{
  "extensionEnabled": false
}
```

この例は ON/OFF の保存操作の対象キーだけを示す。
言語設定を削除・置換する操作を意味しない。

### 7.4 保存対象の最小化

初期版の保存対象は `primaryLang`、`secondaryLang`、`extensionEnabled` とする。
言語保存は言語の2キーだけ、ON/OFF 保存は `extensionEnabled` だけを更新し、
互いの保存値を上書きしない。

次の値は初期版では保存しない。

- `panel open state`
- 現在採用中の track 情報
- 現在の `SubtitleBlock[]`
- 現在表示中の字幕 block
- panel 内の表示位置
- UI state 全体の snapshot
- `layout state`
- listener / timer / observer / binding の登録状態

---

## 8. Chrome Storage 利用方針

### 8.1 保存先

言語設定の保存先は `chrome.storage.sync` を基本とする。
ON/OFF の保存領域は `sync` / `local` の詳細判断を保留とする。
全作品共通の永続化は確定事項だが、端末間共有の有無は未確定である。

Chrome Storage は Chrome 拡張機能が使う設定保存領域である。  
ローカルファイルや `localStorage` を設定の正本として使わない。

### 8.2 非採用方針

初期版では、言語設定の保存に次を使わない。

- `localStorage`
- ファイル保存
- content script 内のグローバル変数
- DOM 属性への埋め込み
- `chrome.storage.local` を正本とする保存

### 8.3 読込責務

Storage からの読込、型補正、旧形式値の吸収、保存前後の正規化は `src/settings/settings-store.ts` が引き受ける。

popup と content 側は storage API の詳細を持たず、
`settings-store.ts` を経由して、それぞれが必要な保存設定を読む。

### 8.4 書込責務

Storage への書込も `src/settings/settings-store.ts` に寄せる。

popup は言語設定、再生画面の ON/OFF toggle は有効状態の変更を要求する。
いずれも永続化の詳細、migration、型補正、保存形式の正規化を持たない。
ON/OFF の保存要求と処理 session の開始停止との接続責務は architecture を参照する。

### 8.5 読み込み失敗時と旧形式値の扱い

`settings-store.ts` は、storage 値の内容だけでなく storage API の読み込み失敗にも耐える必要がある。

言語設定の読込では、初期版は次の方針を採る。
ON/OFF の未保存時の扱いと、読込・保存失敗時の未決事項は §11.3 を参照する。

- `chrome.storage.sync` の読み込み自体が失敗した場合、設定取得は失敗として扱う
- 読み込み失敗時、popup は保存済み設定を表示できない状態としてエラー表示する
- 読み込み失敗時、content 側は新しい playback session を開始せず、設定未取得として安全側に倒す
- 読み込み成功でも値が破損している場合は、本書のバリデーション規則に従って正規化する
- 旧形式値が残っている場合は、読込時に現行形式へ吸収する

旧形式値の吸収対象として、少なくとも次を許容する。

- `secondaryLang: ""` は `secondaryLang: null` に正規化する
- `secondaryLang` の欠落は `secondaryLang: null` に正規化する
- 未知キーは読み捨てる

`primaryLang` の旧形式変換は行わない。  
正当な候補一覧コードに正規化できない場合は、設定未完了として扱う。

---

## 9. デフォルト値と fallback

### 9.1 初期読込時の考え方

`primaryLang` は必須なので、未設定のままでは設定未完了である。

一方で `secondaryLang` は未選択を許可するため、未設定でも異常ではない。  
このとき実行時にはブラウザ言語を fallback 値として扱う。

### 9.2 `primaryLang` のデフォルト

初期版では、`primaryLang` に自動保存される暗黙の既定値は置かない。

理由は次の通りである。

- 学習言語はユーザー意図が最重要である
- ブラウザ言語や UI 言語から自動推定すると誤設定になりやすい
- 必須項目として明示的に選ばせる方が分かりやすい

popup の初期表示として、候補一覧の先頭を自動保存済み値のように扱ってはならない。  
未設定であれば、未設定として表示し、保存前に明示選択を求める。

### 9.3 `secondaryLang` の fallback

`secondaryLang` が `null` の場合、content 側は実行時にブラウザ言語を fallback 候補として扱う。

- `settings-store.ts` は保存設定を正規化し、未選択の `secondaryLang` は null のまま返す。
- content 側の接続処理がブラウザ言語を取得し、resolver へ fallback 候補として渡す。
- resolver は渡された値から secondary track の採用可否を判断する。ブラウザ言語そのものは取得しない。
- `secondaryLang` が明示設定されている場合、ブラウザ言語 fallback で置き換えない。
- fallback による同一言語の二重採用は行わない。具体的な採用条件と API は architecture を参照する。

fallback は runtime の解決にだけ使い、`chrome.storage.sync` の `secondaryLang` を上書きしない。

### 9.4 browser language fallback が候補外の場合

ブラウザ言語が UI 候補一覧にない、または content 側で解決に使えない場合がある。

この場合でも popup 側は保存設定を書き換えない。  
どの代替候補を採るか、または secondary 字幕を利用しないかは `src/subtitles/text-track-resolver.ts` の責務とし、本書では定義しない。

---

## 10. バリデーション

### 10.1 バリデーション対象

言語設定は、保存前と読込後の両方で、最低限次を検証する。

- `primaryLang` が文字列であること
- `primaryLang` が空文字でないこと
- `primaryLang` が候補一覧に含まれること
- `secondaryLang` が `null` または文字列であること
- `secondaryLang` が文字列の場合は空文字でないこと
- `secondaryLang` が文字列の場合は候補一覧に含まれること
- `secondaryLang` が文字列の場合は `primaryLang` と異なること

ON/OFF の保存要求・保存済み値は boolean として検証する。
キー欠落による未保存と、存在する値の型不正は区別する。
型不正時の fallback は未決事項とし、未保存時の既定 ON をそのまま適用すると決めない。

### 10.2 popup 側のバリデーション

popup では、ユーザー操作に対する即時フィードバックを返すための UI バリデーションを持つ。

例:

- 学習言語が未選択なら保存ボタンを無効化する
- 母国語が学習言語と同じなら保存ボタンを無効化する
- エラー理由をステータス領域に出す

popup 側のバリデーションは UX のための前段チェックであり、正本の検証は `settings-store.ts` 側でも必ず行う。

### 10.3 `settings-store.ts` 側のバリデーション

`src/settings/settings-store.ts` は、不正データが storage から読まれた場合にも耐える必要がある。

初期版では次の正規化方針を採る。

- `primaryLang` が不正なら設定未完了として扱う
- `secondaryLang` が不正なら `null` に補正する
- `secondaryLang === primaryLang` なら `secondaryLang` を `null` に補正する
- `secondaryLang: ""` は旧形式として `null` に補正する

この方針により、学習言語の破損は明示的に再設定が必要な異常として扱い、母国語の破損は fallback 可能な範囲として扱える。

### 10.4 content 側へ渡す正規化済み設定値

`settings-store.ts` は保存設定を validation / normalization し、設定状態とともに popup / content へ返す。

設定取得結果では、次の状態を区別する。

- `ready`: 有効な primaryLang があり、track 解決へ進んでよい
- `incomplete`: primaryLang が未設定または不正であり、設定完了待ちにする
- `error`: storage 読込が失敗しており、安全側に停止する

`ready` の設定は `primaryLang` と `secondaryLang` を持つ。
`secondaryLang: null` は正常な未選択状態であり、content 側の runtime fallback で扱う。

`ready` は、字幕 track が見つかったこと、二言語の取得が完了したこと、
または拡張を ON にすることを意味しない。

settings store はブラウザ言語を取得せず、fallback 適用後の値を戻り値へ必須項目として含めない。
fallback の受け渡しは §9.3、設定取得結果の型は §14 を参照する。

---

## 11. 保存設定と runtime state の境界

### 11.1 保存設定

保存設定として扱うのは次の3つとする。

- `primaryLang`: popup で選ぶ学習言語
- `secondaryLang`: popup で選ぶ母国語
- `extensionEnabled`: 再生画面の ON/OFF toggle で選ぶ、拡張全体の有効状態

ON/OFF は作品別・エピソード別に保存せず、全作品共通の1つの値を保持する。
保存領域の扱いは §8.1 を参照する。

### 11.2 runtime state

現在の処理・表示に必要な一時状態は、runtime で保持する。

- 保存設定を適用した現在の `extensionEnabled`
- 現在の `panelOpen`
- 現在の playback session
- 現在解決済みの primary / secondary track
- 現在の `SubtitleBlock[]`
- 現在表示中の current block
- listener / timer / observer / binding の登録状態

保存する ON/OFF の値と、runtime の UI state 全体は区別する。
`panelOpen`、字幕データ、DOM・video・track 参照、資源の登録状態は保存しない。

### 11.3 ON/OFF の保存・復元と panel の初期表示

- ON/OFF の保存キーがない場合は、ON を既定値とする。
- 保存済みの場合は最後に選んだ値を復元する。
- OFF にした後は、ユーザーが ON に変更するまで、どの作品でも OFF を維持する。
- ON にした後は、ユーザーが OFF に変更するまで、どの作品でも ON を維持する。
- 作品・エピソードの変更、処理 session の停止・再初期化では、保存された ON/OFF を変更しない。
- ページ再読み込み・ブラウザ再起動後も、保存された ON/OFF を復元する。
- ON にしたとき、および ON の状態で新しい視聴を開始したときは、panel を開く。
- ON のまま panel だけを開閉でき、その操作で ON/OFF の保存値を変更しない。
- panel の開閉状態は保存しない。
- 同じ視聴の技術的な再接続では、手動で変更した panel の開閉状態を維持する。

ON はユーザーの有効化意思を表す。
ON であっても、言語設定の完了や処理開始条件を満たしたことを意味しない。

未決事項:

- ON/OFF の読込失敗、型不正、保存失敗時の詳細動作は、実装前に確定する。
- 新しい視聴と技術的な再接続の具体的な識別条件は未確定とする。
  restart reason や video identity だけで新しい視聴と断定しない。

### 11.4 保存する意思と、保存しない処理状態

拡張を使うかどうかは、再生対象に依存しないユーザーの意思として保存する。

panel の一時的な開閉、字幕データ、DOM・video・track 参照、
listener / timer / observer / binding は現在の処理・表示に属するため保存しない。

ON/OFF を復元することと、古い処理資源を復元・保持することは別である。

### 11.5 architecture へ委ねる範囲

本書は、保存対象・未保存時の既定値・復元・panel 非保存を定義する。
runtime の owner、購読の寿命、stop / dispose、restart の責務と順序は
`docs/minimal-panel-architecture.md` を参照する。

---

## 12. 設定変更時の content 側への反映方針

§12.1〜§12.6 は、popup で保存した言語設定の反映を扱う。
ON/OFF の保存・復元は §11、操作と開始停止の接続は architecture を参照する。
言語設定の反映手順を、そのまま ON/OFF 操作の保存・反映順序として適用しない。

### 12.1 反映の原則

popup で保存した設定は、永続設定として `chrome.storage.sync` に書かれた後、現在の再生中 session へ反映される必要がある。

ただし popup は track 解決や字幕再構築を直接担当しない。  
popup は設定変更が保存されたという事実だけを伝える。

### 12.2 content 側の反映単位

content 側では、設定変更を受けたら必要に応じて次をやり直す。

- 正規化済み保存設定の再読込
- primary / secondary 言語の再確定
- subtitle source の再評価
- track 解決の再実行
- `SubtitleBlock[]` の再構築
- panel 表示内容の更新

どの粒度で再初期化するかは content の責務で決める。  
popup は content の内部更新手順を知らない。

### 12.3 反映トリガー

初期版では、設定保存後に content 側が変更を認識できることを必須とする。

反映方法の候補は次の 2 つである。

- `chrome.storage.onChanged` を購読して content 側が再読込する
- popup から明示メッセージを送り、content 側が再読込する

初期版では次の方針を採る。

1. 正本トリガーは `chrome.storage.sync` の保存完了
2. content 側は設定再読込の入口を 1 つに寄せる
3. popup からの通知は更新を早く伝える補助手段として許容する
4. content 側は最終的に storage 上の保存済み値を読み直して反映する
5. popup から未保存の一時値を直接渡して適用しない

### 12.4 保存タイミングと反映タイミングの関係

設定変更は次の順で処理する。

1. popup でユーザーが値を変更する
2. popup はローカル state だけを更新する
3. ユーザーが保存操作を行う
4. `settings-store.ts` が validation と normalization を行う
5. `settings-store.ts` が `chrome.storage.sync` へ保存する
6. 保存成功後にだけ content 側が保存済み設定を再読込して反映する

保存失敗時は content 側へ新設定を反映してはならない。

### 12.5 `primaryLang` 未設定時の再生画面側の振る舞い

`primaryLang` が未設定、破損、または候補一覧外で正規化できない場合、設定は未完了として扱う。

この状態では content 側は次を行ってはならない。

- primary subtitle の採用開始
- secondary subtitle の採用開始
- `SubtitleBlock[]` 構築の開始
- 設定完了前提の playback session 開始

この状態では字幕処理を開始せず、設定未完了として待機し、
設定変更後の再読込を受け付ける。
全作品共通の ON/OFF の保持・変更を、字幕処理の開始成功と混同しない。
設定未完了を理由に、保存された ON/OFF を書き換えない。

### 12.6 反映失敗時の扱い

content 側で設定再反映に失敗しても、保存設定そのものは保持される。

再反映失敗は runtime 側の問題として扱い、次回の再生開始や再初期化で回復可能にする。  
保存設定の正本と再生中 state を分ける理由の 1 つはここにある。

---

## 13. popup と `settings-store.ts` の責務境界

### 13.1 popup の責務

popup の責務は次に限定する。

- 設定 UI を表示する
- 候補一覧を表示する
- ユーザー入力を受ける
- 保存前の基本バリデーションを行う
- 保存操作を起動する
- 保存成功 / 失敗 / 入力エラーを表示する

popup は次を持たない。

- storage schema の正本定義
- 保存データの最終正規化
- fallback 決定の正本ロジック
- track 解決
- playback session の制御
- panel state の制御

### 13.2 `settings-store.ts` の責務

`src/settings/settings-store.ts` の責務は次の通りとする。

- 保存キーの正本管理
- 言語設定と ON/OFF の保存領域への read / write
- 言語保存と ON/OFF 保存で、互いのキーを上書きしない入出力境界
- 保存形式の正規化
- 旧形式値の吸収
- 読込時と保存時のバリデーション
- 不正値の補正
- 読込失敗の結果表現
- popup / content の双方が使える設定 API の提供
- 正規化済み設定値または設定状態の返却

### 13.3 API 設計の最小要件

`settings-store.ts` は少なくとも次の操作を提供できる形が望ましい。

- 現在の保存設定を読む
- 保存設定を書き込む
- 保存設定をバリデーションする
- 保存設定を正規化する
- 保存設定変更を購読できるようにする

popup はこの API を使い、storage の細部を知らずに済む構造にする。

---

## 14. 型モデル

### 14.1 保存設定モデル

```ts
export type StoredSettings = {
  primaryLang: string;
  secondaryLang: string | null;
};
```

これは言語設定の保存成功時の正本形式である。
ON/OFF の保存値は boolean とし、未保存を許容する。
その取得結果型・API は、未保存・読込失敗・型不正の扱いを確定してから具体化する。
この型へ `panelOpen` や runtime の資源状態を追加しない。

### 14.2 正規化済み設定と runtime fallback

settings store が ready として返す設定は、次の形とする。

```ts
export type ReadySettings = {
  primaryLang: string;
  secondaryLang: string | null;
};
```

- primaryLang は有効な設定言語とする。
- secondaryLang は有効な設定言語、または未選択を表す null とする。
- ブラウザ言語 fallback は、この設定を書き換えずに content 側で別途渡す。
- effective secondary language は runtime の概念として扱い、
  `effectiveSecondaryLang` という property を settings store の戻り値に必須としない。
- fallback の具体的な引数・採用判定は architecture の resolver API を参照する。
- fallback 候補も採用結果も storage へ書き戻さない。

### 14.3 設定取得結果モデル

以下は言語設定の取得結果モデルである。
言語設定の ready / incomplete と、ON/OFF の保存値の有無は別に扱う。

```ts
export type SettingsLoadResult =
  | {
      status: 'ready';
      settings: ReadySettings;
    }
  | {
      status: 'incomplete';
      settings: ExtensionSettings;
    }
  | {
      status: 'error';
      cause: 'storage-read-failed';
    };
```

`ExtensionSettings` は未完了状態を含む正規化済み設定の共通型であり、
`primaryLang: null` を許容する。定義元は `src/shared/types.ts` とする。

§14.1 は保存成功時のデータ形式を示す。
未完了を表現できる内部共通型と、保存可能な ready 設定の条件を混同しない。

`settings-store.ts` は、content 側が設定未完了と読込失敗を区別できる結果を返す。
`incomplete` の settings は入力状態の表示などに利用できるが、字幕処理の開始には使わない。

### 14.4 状態の分離

型と受け渡しの両方で、次の分離を崩さない。

- 言語設定の保存成功時のデータ形式: §14.1 の保存設定モデル
- 全作品共通の ON/OFF: boolean の保存値。未保存時の既定値は §11.3 に従う
- 未完了を含む内部共通型: `ExtensionSettings`
- track 解決へ進める正規化済み設定: `ReadySettings`
- 設定取得状態: `SettingsLoadResult`
- ブラウザ言語 fallback: content 側で取得して resolver へ渡す runtime の入力
- 採用済み primary / secondary track: resolver の runtime 採用結果
- UI の一時状態: popup ローカル state または `ui-state.ts`

---

## 15. 初期版で意図的に扱わないもの

設定仕様を単純に保つため、初期版では次を扱わない。

- 言語ごとの優先順位リスト保存
- 複数候補による track fallback の保存
- 自動検出結果の保存
- panel open state の永続化
- エピソード単位の上書き設定
- サイト別設定
- 高度な options page の再導入

---

## 16. 実装時の対応ファイル

この仕様に対応する主なファイルは次を想定する。

| ファイル | 責務 |
| --- | --- |
| `src/popup/popup.html` | 学習言語 / 母国語の入力 UI |
| `src/popup/index.ts` | popup の入力制御、保存要求、表示更新 |
| `src/settings/settings-store.ts` | 保存設定の読込・保存・検証・正規化 |
| `src/shared/types.ts` | `StoredSettings` などの共通型 |
| `src/subtitles/text-track-resolver.ts` | 保存設定を受けた実際の track 解決 |
| `src/content/index.ts` | 設定変更を受けた再反映の入口 |

本書はファイル構成の正本ではないが、責務の置き場所はこの粒度を前提とする。

---

## 17. 完了条件

`docs/settings-spec.md` が完了したとみなす条件は次の通りである。

- popup で扱う項目が `primaryLang` / `secondaryLang` の 2 つに限定されている
- 学習言語必須、母国語任意、同一値禁止が明記されている
- 候補言語一覧と track 解決の責務分離が明記されている
- 保存対象として `primaryLang` / `secondaryLang` / `extensionEnabled` が定義されている
- 言語設定の保存先と、ON/OFF の保存領域の確定・保留が区別されている
- `secondaryLang` 未選択時のブラウザ言語 fallback が明記されている
- 保存設定と runtime state の境界が明記されている
- ON/OFF は全作品共通で保存し、panel open state は保存しないことが明記されている
- ON/OFF 未保存時は ON、保存済みの場合は最後に選んだ値を復元することが明記されている
- ON 操作時と、ON の状態で新しい視聴を開始したときの panel 初期表示が明記されている
- 技術的な再接続で手動の panel 開閉を変更しないことが明記されている
- 言語保存と ON/OFF 保存が互いの保存値を上書きしないことが明記されている
- ON/OFF の失敗時動作と、新しい視聴の識別条件の未決事項が明示されている
- 旧形式値、破損値、Storage 読込失敗時の扱いが明記されている
- `primaryLang` 未設定時に content 側が playback session を開始しないことが明記されている
- popup と `settings-store.ts` の責務境界が明記されている
- content 側への反映方針が明記されている
- runtime state の詳細は architecture の担当範囲であると明記されている

---
