# Apple TV+ Bilingual Subtitles v2

Apple TV+ の再生画面で使う、二言語字幕 Chrome 拡張の v2 プロジェクトです。

v2 では、右側字幕 panel を中核 UI とした最小構成を前提に、TypeScript で新規設計・実装します。  
既存版の知見は参照しますが、複雑な分岐や暫定回避策をそのまま持ち込まず、責務分離・thin coordinator・cleanup-first を優先します。

## 現在の状態

現在は、Phase 0（開発基盤の整備）が完了し、Phase 1 に進む段階です。

- 正本文書 7 本を整備済み
- `src/` 配下には実装用の空ファイルを配置済み
- 開発基盤（esbuild、TypeScript、ESLint、Prettier、Vitest）と、検証用 npm scripts を用意済み

## 目的

このプロジェクトの目的は、Apple TV+ 実画面で継続利用できる最小価値を、追いやすい構成で成立させることです。

初期版では、少なくとも次を成立対象とします。

- 学習言語と母国語を設定できる
- Apple TV+ の字幕 track を解決できる
- `SubtitleBlock[]` を字幕 truth として構築できる
- 右側字幕 panel に current / past / future を表示できる
- 再生対象切替、SPA 遷移、再初期化時に cleanup できる
- ON/OFF toggle と panel 開閉ボタンを別責務で扱える

## 設計方針

- `src/content/index.ts` は thin coordinator とする
- source、truth、renderer、session lifecycle の責務を分離する
- `SubtitleBlock[]` を UI の truth とする
- source は panel DOM を直接扱わない
- renderer は source や `TextTrack` を直接読まない
- listener、timer、observer、binding、DOM の owner は 1 つに限定する
- cleanup を後回しにしない
- 保存設定と runtime state を混ぜない

## ドキュメント

設計と実装判断は、次の正本文書を参照してください。

- `docs/product-requirements.md`  
  プロダクト要件、MVP、対象外、完了条件
- `docs/minimal-panel-architecture.md`  
  モジュール構成、責務境界、session / cleanup、panel 設計
- `docs/settings-spec.md`  
  `primaryLang` / `secondaryLang`、保存設定、validation、fallback
- `docs/apple-tv-dom-structure.md`  
  Apple TV+ DOM に関する実装判断
- `docs/apple-tv-dom-observations.md`  
  Apple TV+ DOM の詳細観測ログ
- `docs/implementation-workflow.md`  
  実装順、技術方針、コメント方針、フェーズ進行
- `docs/testing-checklist.md`  
  自動テスト方針、手動スモーク、回帰確認

## ディレクトリ構成

```text
docs/
  product-requirements.md
  minimal-panel-architecture.md
  settings-spec.md
  apple-tv-dom-structure.md
  apple-tv-dom-observations.md
  implementation-workflow.md
  testing-checklist.md

src/
  content/
  panel/
  settings/
  shared/
  subtitles/
  ui/
```

## 開発メモ

現時点の npm scripts:

- `npm run dev`  
  esbuild で content script を watch ビルドする
- `npm run build`  
  `dist/` を作り直し、esbuild で bundle して `manifest.json` をコピーする
- `npm run typecheck`  
  TypeScript の型チェックを行う（`npm run check` も同じ）
- `npm run lint`  
  ESLint を実行する
- `npm run test`  
  Vitest を実行する（テストファイルがなくても成功する）

テスト方針は `docs/testing-checklist.md` と `docs/implementation-workflow.md` を参照してください。

## 次の作業

`docs/implementation-workflow.md` の Phase 1 に従って、共有型、dispose helper、設定保存の土台を実装します。
