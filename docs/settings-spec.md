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

設定仕様は次の方針に従う。

- 学習言語は必須
- 母国語は任意
- 母国語には学習言語と同じ値を選べない
- 母国語が未選択のときはブラウザ言語を fallback とする
- 保存設定と runtime state は混ぜない
- 保存先は `chrome.storage.sync` を基本とする
- 設定の読込・保存は `src/settings/settings-store.ts` に寄せる
- 実際の字幕 track 解決は content 側の `src/subtitles/text-track-resolver.ts` が担当する
- `settings-store.ts` と popup の担当者が、他文書を読まなくても基本仕様を実装できる状態を目指す

---

## 2. 対象範囲

この文書が扱うのは次の内容だけである。

- popup UI の要件
- 学習言語と母国語の選択仕様
- 言語候補一覧の扱い
- `primaryLang` と `secondaryLang` の保存形式
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

ただし、そのモジュールは UI 候補一覧を提供する責務に留める。  
Apple TV+ の生の track 情報や解決ロジックは持ち込まない。

---

## 7. 保存形式

### 7.1 保存キー

保存設定のキーは次の 2 つを正本とする。

| キー | 型 | 必須 | 意味 |
| --- | --- | --- | --- |
| `primaryLang` | `string` | 必須 | 学習言語 |
| `secondaryLang` | `string \| null` | 任意 | 母国語。未選択を許可する |

### 7.2 保存データ型

v2 では、母国語未選択を空文字ではなく `null` で表現する。

```ts
export type StoredSettings = {
  primaryLang: string;
  secondaryLang: string | null;
};
```

この方針により、次の区別が明確になる。

- `primaryLang` が未設定で不正
- `secondaryLang` が未選択で正常
- fallback による実行時補完
- 不正な空文字や型崩れ

### 7.3 保存例

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

### 7.4 保存対象の最小化

初期版で `chrome.storage.sync` に保存するのは `primaryLang` と `secondaryLang` だけとする。

次の値は初期版では保存しない。

- `extension enabled state`
- `panel open state`
- 現在採用中の track 情報
- 現在の `SubtitleBlock[]`
- 現在表示中の字幕 block
- panel 内の表示位置
- `UI state`（`extensionEnabled`、`panelOpen`）
- `layout state`
- listener / timer / observer / binding の登録状態

---

## 8. Chrome Storage 利用方針

### 8.1 保存先

保存設定の保存先は `chrome.storage.sync` を基本とする。

Chrome Storage は Chrome 拡張機能が使う設定保存領域である。  
ローカルファイルや `localStorage` を設定の正本として使わない。

### 8.2 非採用方針

初期版では、設定保存に次を使わない。

- `localStorage`
- ファイル保存
- content script 内のグローバル変数
- DOM 属性への埋め込み
- `chrome.storage.local` を正本とする保存

### 8.3 読込責務

Storage からの読込、型補正、旧形式値の吸収、保存前後の正規化は `src/settings/settings-store.ts` が引き受ける。

popup は storage API を直接細かく扱わず、`settings-store.ts` を経由して設定を読む。

### 8.4 書込責務

Storage への書込も `src/settings/settings-store.ts` に寄せる。

popup は保存要求を出す UI であり、永続化の詳細、migration、型補正、保存形式の正規化を持たない。

### 8.5 読み込み失敗時と旧形式値の扱い

`settings-store.ts` は、storage 値の内容だけでなく storage API の読み込み失敗にも耐える必要がある。

初期版では次の方針を採る。

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

`secondaryLang` が `null` の場合、content 側は実行時にブラウザ言語を fallback 値として扱う。

ここで使うブラウザ言語は、UI 設定の保存値ではなく runtime 解決結果である。  
そのため `chrome.storage.sync` の `secondaryLang` を fallback 値で上書き保存してはならない。

### 9.4 browser language fallback が候補外の場合

ブラウザ言語が UI 候補一覧にない、または content 側で解決に使えない場合がある。

この場合でも popup 側は保存設定を書き換えない。  
どの代替候補を採るか、または secondary 字幕を利用しないかは `src/subtitles/text-track-resolver.ts` の責務とし、本書では定義しない。

---

## 10. バリデーション

### 10.1 バリデーション対象

保存前と読込後の両方で、最低限次を検証する。

- `primaryLang` が文字列であること
- `primaryLang` が空文字でないこと
- `primaryLang` が候補一覧に含まれること
- `secondaryLang` が `null` または文字列であること
- `secondaryLang` が文字列の場合は空文字でないこと
- `secondaryLang` が文字列の場合は候補一覧に含まれること
- `secondaryLang` が文字列の場合は `primaryLang` と異なること

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

`settings-store.ts` から popup と content へ返す設定値は、常に validation と normalization を通過した shape でなければならない。

content 側へ渡す設定取得結果は、少なくとも次の状態を区別できる必要がある。

- `ready`: 正規化済み設定があり、content 側が track 解決へ進んでよい
- `incomplete`: `primaryLang` 未設定または不正であり、設定完了待ちにする
- `error`: storage 読込などが失敗しており、安全側に停止する

例:

```ts
export type ResolvedLanguageSettings = {
  primaryLang: string;
  secondaryLang: string | null;
  effectiveSecondaryLang: string | null;
};

export type SettingsLoadResult =
  | {
      status: "ready";
      settings: ResolvedLanguageSettings;
    }
  | {
      status: "incomplete";
    }
  | {
      status: "error";
      cause: "storage-read-failed";
    };
```

型名やエラー表現は実装で変更してよい。  
ただし `ready`、`incomplete`、`error` を区別できることは本仕様の要件とする。

---

## 11. 保存設定と runtime state の境界

### 11.1 保存設定

保存設定として扱うのは次だけである。

- `primaryLang`
- `secondaryLang`

これらは popup から編集でき、`chrome.storage.sync` に保存される。

### 11.2 runtime state

runtime state は再生中だけ使う一時状態であり、保存しない。

例:

- 現在の `extension enabled state`
- 現在の `panel open state`
- 現在の playback session
- 現在解決済みの primary / secondary track
- 現在の `SubtitleBlock[]`
- 現在表示中の current block
- listener / timer / observer / binding の登録状態

### 11.3 初期版の UI state 方針

初期版では、次の UI state を保存しない。

- ON/OFF 状態
- panel open state

起動時は毎回 OFF 開始とする。  
panel open state は保存しないため、起動時は毎回 closed で開始する。

前回 session の ON/OFF 状態や panel の open / close 状態を復元してはならない。

### 11.4 保存しない理由

runtime state は現在の再生対象、DOM、video、track、panel の存在に依存する一時状態である。

これらを保存すると、再起動後や別の再生対象で古い状態を復元してしまい、状態不整合や cleanup 漏れの原因になる。  
そのため Chrome Storage には、再生対象に依存しないユーザー設定だけを保存する。

### 11.5 architecture へ委ねる範囲

runtime state の詳細な保持先と更新責務は本書では定義しない。

本書で固定するのは、それらを保存設定として `chrome.storage.sync` に保存しないことだけである。  
詳細な owner、保持単位、cleanup、再初期化責務は architecture 文書の担当範囲とする。

---

## 12. 設定変更時の content 側への反映方針

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

この状態で content 側が行ってよいのは、設定未完了として待機することと、設定変更後の再読込を受け付けることだけとする。

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
- `chrome.storage.sync` の read / write
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

これは storage に保存される正本形式である。

### 14.2 実行時利用モデル

```ts
export type ResolvedLanguageSettings = {
  primaryLang: string;
  secondaryLang: string | null;
  effectiveSecondaryLang: string | null;
};
```

`effectiveSecondaryLang` は runtime でのみ使う派生値であり、保存設定そのものではない。  
この派生値を storage に書き戻してはならない。

### 14.3 設定取得結果モデル

```ts
export type SettingsLoadResult =
  | {
      status: "ready";
      settings: ResolvedLanguageSettings;
    }
  | {
      status: "incomplete";
    }
  | {
      status: "error";
      cause: "storage-read-failed";
    };
```

`settings-store.ts` は、content 側が未設定と読込失敗を区別できる結果を返す。

### 14.4 状態の分離

型レベルでも次の分離を崩さない。

- 保存設定: `StoredSettings`
- 実行時解決後の設定: `ResolvedLanguageSettings`
- 設定取得状態: `SettingsLoadResult`
- UI の一時状態: popup ローカル state または `ui-state.ts`

---

## 15. 初期版で意図的に扱わないもの

設定仕様を単純に保つため、初期版では次を扱わない。

- 言語ごとの優先順位リスト保存
- 複数候補による track fallback の保存
- 自動検出結果の保存
- 字幕表示 ON/OFF の永続化
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
| `src/popup/popup.ts` | popup の入力制御、保存要求、表示更新 |
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
- 保存形式として `primaryLang` / `secondaryLang` が定義されている
- 保存先が `chrome.storage.sync` であると明記されている
- `secondaryLang` 未選択時のブラウザ言語 fallback が明記されている
- 保存設定と runtime state の境界が明記されている
- ON/OFF 状態と panel open state を保存しないことが明記されている
- 起動ごとに extension が OFF、panel が closed で始まることが明記されている
- 旧形式値、破損値、Storage 読込失敗時の扱いが明記されている
- `primaryLang` 未設定時に content 側が playback session を開始しないことが明記されている
- popup と `settings-store.ts` の責務境界が明記されている
- content 側への反映方針が明記されている
- runtime state の詳細は architecture の担当範囲であると明記されている

---
