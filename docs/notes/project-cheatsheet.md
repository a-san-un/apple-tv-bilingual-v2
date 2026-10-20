# Apple TV+ Bilingual v2: TypeScript チートシート

このメモは、`apple-tv-bilingual-v2` のコードを読みながら JavaScript / TypeScript を学ぶための個人用チートシートです。

- 仕様の正本ではない
- 実装判断は `docs/` の正本文書を優先する
- 実際のコードとこのメモが異なる場合は、実コードと正本文書を優先する
- 現在は Phase 1 の shared 基盤を実装中であり、後続 module には雛形段階のものもある

---

## 1. 拡張が最終的にすること

Apple TV+ の再生画面で、主字幕と副字幕を右側 panel に表示する Chrome 拡張です。

最終的な大きな流れは次です。

```text
Apple TV+ の再生ページ
  ↓
content script が動く
  ↓
再生対象の video / player DOM を見つける
  ↓
字幕 track を解決する
  ↓
字幕 cue を SubtitleBlock[] に整形する
  ↓
panel に字幕を描画する
  ↓
動画切替・ページ遷移・OFF 時には cleanup する
```

重要な設計原則:

- `src/content/index.ts` は thin coordinator
- 字幕取得、字幕整形、panel 描画、layout、cleanup は module に分ける
- panel 表示の正本は `SubtitleBlock[]`
- DOM、listener、timer、observer を作った module が cleanup を所有する
- cleanup を先に考え、session 停止時に確実に資源を解放する

---

## 2. ファイル全体の地図

```text
src/
├─ content/
│  ├─ index.ts                  content 側の入口。各 module をつなぐ coordinator
│  ├─ playback-root.ts          Apple TV+ の再生対象を見つける
│  └─ session-lifecycle.ts      session の開始・再起動・停止を管理する
│
├─ shared/
│  ├─ types.ts                  module 間で共有する型
│  ├─ dispose.ts                cleanup をまとめて管理する helper
│  ├─ dispose.test.ts           dispose.ts の unit test
│  ├─ dom.ts                    汎用 DOM 操作 helper
│  └─ log.ts                    readiness / restart / cleanup 用のログ helper
│
├─ settings/
│  └─ settings-store.ts         Chrome Storage の設定を読む・保存する
│
├─ ui/
│  └─ ui-state.ts               ON/OFF と panel 開閉の runtime state
│
├─ subtitles/
│  ├─ text-track-resolver.ts    字幕 track を選ぶ
│  ├─ subtitle-source.ts        track から字幕 cue を読む
│  ├─ subtitle-block-builder.ts cue を SubtitleBlock[] に整形する
│  ├─ subtitle-history.ts       current / past / future を導出する
│  └─ native-menu-sync.ts       Apple TV+ 固有の native menu 同期
│
└─ panel/
   ├─ panel-host.ts             panel の DOM を mount / remove する
   └─ panel-renderer.ts         SubtitleBlock[] を panel に描画する
```

---

## 3. Chrome が実行するもの

Chrome が直接実行するのは、`manifest.json` の `content_scripts` で指定された JavaScript ファイルです。

現在の manifest は次の意味です。

```json
{
  "content_scripts": [
    {
      "matches": ["[https://tv.apple.com/*](https://tv.apple.com/*)"],
      "js": ["content-script.js"],
      "run_at": "document_idle"
    }
  ]
}
```

```text
[https://tv.apple.com/*](https://tv.apple.com/*) を開く
  ↓
ページの DOM 構築がある程度落ち着く document_idle の時点
  ↓
Chrome が content-script.js を実行する
```

ただし、開発者が直接書くのは `content-script.js` ではありません。

```text
開発用 TypeScript の入口:
src/content/index.ts

ビルド後に生成される JavaScript:
dist/content-script.js

manifest.json が指定する名前:
content-script.js
```

Chrome に拡張として読み込ませるのは `dist/` です。

```text
dist/
├─ manifest.json
└─ content-script.js
```

したがって、manifest が指定する `content-script.js` は、実際には `dist/content-script.js` です。

---

## 4. 実行までの流れ

```text
開発者が書く TypeScript
────────────────────────────────────────────
src/content/index.ts
  ├─ import ./session-lifecycle.ts
  ├─ import ./playback-root.ts
  ├─ import ../shared/dispose.ts
  ├─ import ../shared/dom.ts
  └─ import その他の必要な module
           │
           │ npm run typecheck
           ▼
TypeScript が型を確認する
  - import / export が一致しているか
  - null の可能性を見落としていないか
  - 関数の引数・戻り値が型に合うか
           │
           │ npm run build
           ▼
esbuild が index.ts を入口として import をたどる
  - 必要な .ts ファイルを収集する
  - TypeScript を実行用 JavaScript に変換する
  - 必要な module を bundle する
           │
           ▼
dist/content-script.js
           │
           │ build 中に manifest.json も dist/ へコピーされる
           ▼
dist/manifest.json
  └─ js: ["content-script.js"]
           │
           ▼
Chrome が dist/ を拡張として読み込む
           │
           ▼
[https://tv.apple.com/*](https://tv.apple.com/*) を開く
           │
           ▼
Chrome が dist/content-script.js を実行する
```

重要:

```text
TypeScript の .ts ファイルを Chrome が直接実行するわけではない。

esbuild が .ts を JavaScript に変換し、
必要な module を 1 つの content-script.js にまとめる。

Chrome が実行するのは、生成後の JavaScript である。
```

---

## 5. なぜ index.ts なのか

`index.ts` は「このフォルダの入口」を示す慣例的なファイル名です。

```text
src/content/
├─ index.ts
├─ playback-root.ts
└─ session-lifecycle.ts
```

このプロジェクトでは、`src/content/index.ts` を次の役割にします。

```text
content 機能の入口
  - settings を読む
  - playback session を開始する
  - session の dispose を保持する
  - restart が必要なら古い session を停止する
  - 各 module をつなぐ
```

これを thin coordinator と呼びます。

`content-script.ts` という名前でも技術的には問題ありません。

```text
src/content/
├─ content-script.ts
├─ playback-root.ts
└─ session-lifecycle.ts
```

ただし今の設計では、ソース側の入口を一般的な `index.ts` とし、Chrome に渡す生成物を役割名の `content-script.js` としています。

```text
開発用の入口: index.ts
Chrome 用の出力: content-script.js
```

---

## 6. bundle とは「必要なコードを合体させること」

bundle は、import でつながった複数ファイルを、ブラウザが実行しやすい形にまとめることです。

```text
開発時の複数ファイル:

src/content/index.ts
  ↓ import
src/content/session-lifecycle.ts
  ↓ import
src/shared/dispose.ts
  ↓ import type
src/shared/types.ts

build 後:

dist/content-script.js
  └─ 実行時に必要な JavaScript がまとめて入る
```

`import type` だけで使われる型は、通常は実行用 JavaScript に残りません。

```ts
import type { Disposable, DisposeFn } from './types';
```

これは TypeScript の型検査にだけ使うためです。

---

## 7. TypeScript と JavaScript

TypeScript は JavaScript に型情報を追加した言語です。

```ts
const title: string = 'Hello';
const count: number = 3;
```

`string` や `number` は、開発中に TypeScript が確認するための情報です。

ブラウザは TypeScript をそのまま実行しません。

```text
TypeScript を書く
  ↓
typecheck で型を確認する
  ↓
esbuild が JavaScript に変換して bundle する
  ↓
Chrome が JavaScript を実行する
```

このプロジェクトでの違い:

```text
npm run typecheck
  - TypeScript の型を確認する
  - JavaScript を出力しない

npm run build
  - esbuild が実行用 JavaScript を作る
  - dist/content-script.js を出力する
```

---

## 8. import と export

### export

ファイル外へ公開するために使います。

```ts
export const removeElement = (
  element: Element | null | undefined,
): void => {
  element?.remove();
};
```

この関数は、別の `.ts` ファイルから利用できます。

### import

別ファイルが公開した関数や値を受け取ります。

```ts
import { removeElement } from '../shared/dom';
```

これにより、現在のファイルで `removeElement(...)` を呼べます。

### import type

型だけを読み込むときに使います。

```ts
import type { Disposable, DisposeFn } from './types';
```

```text
import
  実行時にも必要な関数・値を読む

import type
  型検査時だけ必要な型を読む
```

例:

```ts
import { createDisposeBag } from '../shared/dispose';
import type { DisposeBag } from '../shared/dispose';
```

- `createDisposeBag()` は実際に呼ぶ関数なので通常の `import`
- `DisposeBag` は型として使うだけなので `import type`

---

## 9. types.ts は「共通の名詞」

`src/shared/types.ts` は、module 間で共有する型を置く場所です。

```text
types.ts は「データがどんな形か」を定義する
処理そのものは書かない
```

例:

```ts
export type SubtitleBlock = {
  startTime: number;
  endTime: number;
  primaryText: string;
  secondaryText: string | null;
};
```

これは「字幕を表示する一単位には何が含まれるか」という設計上の約束です。

```text
subtitle-block-builder.ts
  └─ SubtitleBlock[] を作る

subtitle-history.ts
  └─ SubtitleBlock[] から current / past / future を作る

panel-renderer.ts
  └─ SubtitleBlock や history を表示する
```

主な型:

```text
StoredSettings
  Chrome Storage に保存する言語設定

ExtensionUiState
  ON/OFF と panel 開閉の runtime state

ResolvedSubtitleTrack
  resolver が正規化した字幕 track

SubtitleCueSnapshot
  生 cue から取り出した最小情報

SubtitleBlock
  panel 表示の truth になる字幕単位

SubtitleHistorySnapshot
  panel が読む current / past / future

PlaybackTarget
  再生対象の DOM / video / mount 先

DisposeFn / Disposable
  cleanup の共通表現
```

### type と実行時

次のような型は、JavaScript 実行時には基本的に残りません。

```ts
export type LanguageCode = string;
```

これは、開発者と TypeScript に「ここには言語コードが入る」と伝える情報です。

---

## 10. dom.ts は「DOM 操作の共通道具箱」

DOM は、ブラウザ上の HTML 要素を JavaScript から操作する仕組みです。

```html
<div class="player"></div>
```

```ts
document.querySelector('.player');
```

`src/shared/dom.ts` は、Apple TV+ 固有 selector を置かない、汎用 DOM helper です。

```text
dom.ts が担当すること
  - 要素を探す
  - 必須要素を取得する
  - 要素を差し込む
  - 子要素を空にする
  - 要素を外す

dom.ts が担当しないこと
  - Apple TV+ 固有 selector の管理
  - 字幕データの解釈
  - panel の表示ルール
  - session 全体の開始・停止
```

### queryElement

要素を探し、無ければ `null` を返します。

```ts
const video = queryElement<HTMLVideoElement>(document, 'video');

if (!video) {
  return;
}
```

「要素が無いことも正常なケース」に使います。

### requireElement

要素を探し、無ければ `Error` を投げます。

```ts
const panelRoot = requireElement<HTMLElement>(
  document,
  '[data-extension-panel-root]',
);
```

「この要素が無いなら、その後の処理は成立しない」場合に使います。

```text
queryElement
  無くてもよい。呼び出し側で null を分岐する

requireElement
  必須。無ければ早く失敗させる
```

### mountElement

作った要素を親要素へ追加します。

```ts
const panel = document.createElement('aside');

mountElement(playerRoot, panel);
```

先頭へ置きたい場合:

```ts
mountElement(controlsRoot, button, { prepend: true });
```

DOM 上の順序は、見た目だけでなくキーボード操作時の Tab 順にも影響します。

### clearChildren

子要素をすべて消します。

```ts
clearChildren(panelBody);
```

renderer が再描画前に古い表示を外したいときに使います。

### removeElement

要素があれば外し、`null` や `undefined` なら何もしません。

```ts
removeElement(panelRoot);
```

session 終了時に panel host が作った DOM を撤去する用途です。

---

## 11. dom.ts が使われる順番

`dom.ts` 自体が勝手に動くことはありません。

必要な module が import して、その関数を呼んだときにだけ動きます。

```text
src/content/index.ts
  │
  └─ session-lifecycle.ts
       │
       ├─ playback-root.ts
       │    ├─ queryElement(...)
       │    └─ requireElement(...)
       │
       ├─ panel-host.ts
       │    ├─ mountElement(...)
       │    └─ removeElement(...)
       │
       └─ panel-renderer.ts
            └─ clearChildren(...)
```

時系列では次のようになります。

```text
1. Chrome が content-script.js を Apple TV+ ページで実行する
2. index.ts が session-lifecycle を開始する
3. session-lifecycle が playback-root に再生対象探索を依頼する
4. playback-root が dom.ts で DOM を探す
5. session-lifecycle が panel-host に panel 作成を依頼する
6. panel-host が dom.ts の mountElement で panel を追加する
7. panel-renderer が必要なら clearChildren して字幕表示を更新する
8. session 停止時に panel-host が removeElement で自分の panel を消す
```

責務の区別:

```text
dom.ts
  DOM をどう安全に触るかの共通部品

panel-host.ts
  どの panel DOM を作って、どこへ置くかの owner

panel-renderer.ts
  字幕をどう表示するかの owner
```

---

## 12. dispose.ts は「cleanup の共通道具箱」

ブラウザには、後で停止・解除・削除しなければならないものがあります。

```text
- event listener
- timer
- MutationObserver
- TextTrack listener
- subscription
- DOM に追加した panel
```

これらを放置すると、動画切替後や SPA 遷移後も古い処理が動き続けます。

```text
開始する
  ↓
listener / timer / observer / DOM を作る
  ↓
cleanup 関数を集める
  ↓
session を止める
  ↓
cleanup を実行する
```

### DisposeFn

```ts
export type DisposeFn = () => void;
```

呼ぶと後片付けをする関数です。

```ts
const disposeTimer: DisposeFn = () => {
  clearTimeout(timerId);
};
```

### Disposable

```ts
export type Disposable = {
  dispose: DisposeFn;
};
```

cleanup を `dispose()` として公開する object です。

```ts
const observerResource: Disposable = {
  dispose: () => observer.disconnect(),
};
```

### createDisposeBag

複数の cleanup をまとめます。

```ts
const bag = createDisposeBag();

bag.add(() => {
  window.removeEventListener('resize', onResize);
});

bag.add(() => {
  panel.remove();
});

// session 終了時
bag.dispose();
```

### なぜ逆順で cleanup するか

通常、後から作った resource ほど、先に作った resource に依存しやすいためです。

```text
作成順:
1. panel host を作る
2. panel renderer を作る
3. renderer の listener を作る

停止順:
3. renderer の listener を止める
2. renderer を止める
1. panel host を外す
```

`DisposeBag` は、最後に追加した cleanup から実行します。

### なぜ二重 dispose を防ぐか

SPA 遷移、設定変更、手動 OFF、video 差し替えなどで、同じ cleanup が複数経路から呼ばれる可能性があります。

```text
session.stop()
  └─ bag.dispose()

設定変更
  └─ restart()
      └─ 古い session の bag.dispose()
```

同じ listener を何度も外したり、同じ DOM を複数 owner が触ったりしないよう、cleanup を 1 回だけにします。

---

## 13. session と owner

このプロジェクトでは「作ったものを誰が消すか」を明確にします。

この責務を owner と呼びます。

```text
panel-host.ts
  作る: panel DOM
  消す: panel DOM

subtitle-source.ts
  作る: TextTrack listener
  外す: TextTrack listener

session-lifecycle.ts
  作る: playback session
  止める: session 全体の cleanup
```

悪い例:

```text
panel-host.ts が作った DOM を、
content/index.ts が直接 querySelector して消す
```

良い例:

```text
panel-host.ts が dispose 関数を返す
  ↓
session-lifecycle.ts が DisposeBag に登録する
  ↓
session 終了時に bag.dispose() が呼ばれる
  ↓
panel-host.ts 自身の cleanup が panel DOM を消す
```

---

## 14. state の種類

このプロジェクトには、用途が異なる state があります。

```text
保存設定
  - Chrome Storage に保存する
  - 例: primaryLang, secondaryLang
  - 担当: settings-store.ts

runtime UI state
  - ページを開いている間だけ使う
  - 例: extensionEnabled, panelOpen
  - 担当: ui-state.ts

字幕 truth
  - panel 表示の正本
  - 例: SubtitleBlock[]
  - 担当: subtitle-block-builder.ts

session state
  - 再生対象や readiness 待機を表す
  - 例: idle / waiting / running / stopped
  - 担当: session-lifecycle.ts
```

重要:

```text
保存設定と runtime UI state は別物
raw cue と panel 表示の truth も別物
```

---

## 15. null と undefined

TypeScript では「値がない」を複数の形で表せます。

```ts
const a: string | null = null;
const b: string | undefined = undefined;
```

このプロジェクトでは API ごとに意味を決めて使います。

```text
null
  明示的に「存在しない」「未選択」を表すことが多い
  例: secondaryLang: null

undefined
  引数が渡されなかった、optional な値が無いことを表すことが多い
  例: options.prepend が未指定
```

`DisposeEntry` は、optional な cleanup をそのまま渡せるようにしています。

```ts
export type DisposeEntry = Disposable | DisposeFn | null | undefined;
```

これにより、呼び出し側は毎回 if 文を書かずに済みます。

```ts
bag.add(optionalListenerCleanup);
```

---

## 16. optional chaining

`?.` は「左側が null / undefined なら何もしない」です。

```ts
element?.remove();
```

これはほぼ次と同じです。

```ts
if (element) {
  element.remove();
}
```

`removeElement` はこの性質を使っています。

```ts
export const removeElement = (
  element: Element | null | undefined,
): void => {
  element?.remove();
};
```

呼び出し側は安全に書けます。

```ts
removeElement(panelRoot);
```

---

## 17. generics の最小理解

`<T>` は「呼び出し側が指定できる型の穴」です。

```ts
const queryElement = <T extends Element>(
  root: ParentNode,
  selector: string,
): T | null => root.querySelector<T>(selector);
```

使う側:

```ts
const video = queryElement<HTMLVideoElement>(document, 'video');
```

このとき TypeScript は `video` を次の型として扱います。

```ts
HTMLVideoElement | null
```

そのため、`video.play()` や `video.textTracks` のような video 用 API を型安全に使えます。

---

## 18. JSDoc と行コメント

### JSDoc

JSDoc は、export API の公開契約です。

```ts
/**
 * 必須要素を取得する。
 *
 * @param root 検索を開始する DOM 範囲。
 * @param selector 検索する CSS selector。
 * @returns 見つかった要素。
 * @throws {Error} selector に一致する要素がなく、後続処理を継続できない場合。
 */
export const requireElement = <T extends Element>(
  root: ParentNode,
  selector: string,
): T => {
  // ...
};
```

読み手が知りたいこと:

```text
- この API は何をするか
- 何を渡すか
- 何が返るか
- 失敗時に何が起きるか
- cleanup を返すなら、誰が保持・実行するか
```

### 行コメント

行コメントは、実装上「なぜ必要なのか」を書きます。

```ts
// 後から登録した resource ほど内側の依存を持ちやすいため、逆順で cleanup する。
while (disposers.length > 0) {
  disposers.pop()?.();
}
```

避けたいコメント:

```ts
// disposer を取り出す
const disposer = disposers.pop();
```

コードを読めば分かる説明は、原則不要です。

---

## 19. テスト

`src/shared/dispose.test.ts` は `src/shared/dispose.ts` の unit test です。

```text
dispose.ts        実装
dispose.test.ts   dispose.ts が期待通り動くか確認するテスト
```

現在確認したいこと:

```text
- cleanup が登録の逆順で動く
- bag の dispose を 2 回呼んでも cleanup は 1 回だけ
- 個別 disposer と bag の両方から呼んでも 1 回だけ
- dispose 後に追加された cleanup は即時に実行される
- Disposable object も登録できる
- 複数 cleanup を合成できる
```

テスト実行:

```zsh
npm run test
```

特定ファイルだけ確認する場合:

```zsh
npx vitest run src/shared/dispose.test.ts
```

---

## 20. よく使うコマンド

```zsh
# 型が合っているか確認する
npm run typecheck

# コード品質ルールを確認する
npm run lint

# unit test を実行する
npm run test

# Chrome 用の bundle を作る
npm run build

# 開発中に bundle を監視更新する
npm run dev

# 空白エラーなどを確認する
git diff --check

# 変更中ファイルを確認する
git status -sb

# 変更内容を確認する
git diff
```

目的:

```text
typecheck
  型違い、import / export の不整合を見つける

lint
  未使用コード、危険な書き方、import の乱れなどを見つける

test
  関数や small store が期待どおり動くか確認する

build
  Chrome が読む dist/content-script.js を作る
```

---

## 21. esbuild の設定はどこにあるか

このプロジェクトでは、esbuild の設定は専用ファイルではなく `package.json` の `scripts` に直接書いてある。

```json
{
  "scripts": {
    "dev": "esbuild src/content/index.ts --bundle --format=esm --platform=browser --target=chrome120 --outfile=dist/content-script.js --watch",
    "build": "npm run clean && esbuild src/content/index.ts --bundle --format=esm --platform=browser --target=chrome120 --outfile=dist/content-script.js && cp manifest.json dist/manifest.json",
    "clean": "rm -rf dist"
  }
}
```

今は `esbuild.config.js` や `esbuild.config.mjs` は無い。

### dev と build の違い

```text
dev
  開発用
  - src/content/index.ts を入口に bundle する
  - ファイル変更を watch する
  - 保存のたびに dist/content-script.js を更新する

build
  配布・確認用
  - 先に dist/ を消す
  - src/content/index.ts を入口に bundle する
  - dist/content-script.js を出力する
  - manifest.json を dist/ にコピーする
```

### 各オプションの意味

```text
esbuild src/content/index.ts
  TypeScript 側の入口ファイル

--bundle
  import をたどって必要な module をまとめる

--format=esm
  ES module 形式で出力する

--platform=browser
  Node.js ではなくブラウザ向けに bundle する

--target=chrome120
  Chrome 120 で動く JavaScript を対象にする

--outfile=dist/content-script.js
  出力先ファイル名

--watch
  変更監視モード
```

### なぜ設定ファイルを分けていないか

今は entry が実質 1 本で、設定も短いため、`package.json` に直接書くほうが読みやすい。

```text
今:
  package.json の scripts だけ見れば build 導線が分かる

将来:
  popup など entry が増え、
  build 設定が長くなったら専用設定ファイルを検討する
```

### 将来分けるとしたら

たとえば次のような状況になったら、`esbuild.config.mjs` へ分ける価値がある。

- content script と popup の両方を build する
- entry が複数になる
- build と dev で条件分岐が増える
- 画像や HTML のコピー処理が増える
- `package.json` の scripts が長くなりすぎる

---

## 22. 実装を読む順番

新しい機能を読むときは、次の順序がおすすめです。

```text
1. types.ts
   データの形を確認する

2. 実装 module
   入力を受け、何を返し、何を作るか確認する

3. import 元
   その module を誰が呼ぶか確認する

4. dispose / cleanup
   何を停止・解放し、誰が owner か確認する

5. test
   期待する振る舞いを確認する
```

例: `panel-host.ts` を読むとき

```text
1. 引数・戻り値の型を types.ts で確認する
2. panel-host.ts 本体を読む
3. session-lifecycle.ts がどう呼ぶか確認する
4. panel DOM をどこで remove するか確認する
5. test があれば期待動作を確認する
```

---

## 23. 困ったときの質問テンプレート

新しい関数や module を読んだときは、次を確認する。

```text
- この関数・module は誰が呼ぶか
- 入力は何か
- 出力は何か
- state を変えるか
- DOM を作るか
- listener / timer / observer を作るか
- cleanup は誰が owner か
- session restart 時に何が起こるか
```

---

## 24. 最重要の一文

```text
データの形は types.ts。
cleanup の共通ルールは dispose.ts。
DOM を安全に触る共通部品は dom.ts。
実際の機能判断と owner は、それぞれの feature module に置く。
```
