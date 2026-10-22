# ブラウザテスト記録テンプレ

実施日:2026-10-22
実施者:yama
対象ブランチ:main
対象コミット:
対象作品:窓際のスパイ
対象エピソード:シーズン6 エピソード1
Apple TV+ URL:https://tv.apple.com/jp/show/%E7%AA%93%E9%9A%9B%E3%81%AE%E3%82%B9%E3%83%8F%E3%82%A4/umc.cmc.2szz3fdt71tl1ulnbp8utgq5o?ctx_agid=72d908d4
拡張バージョン:0.1.0
設定:
- primaryLang:en-GB
- secondaryLang:ja

事前確認:
- [x] npm run check が通っている
- [x] npm run lint が通っている
- [x] npm run test が通っている
- [x] npm run build が通っている
- [x] Chrome 拡張を再読み込みした
- [x] Apple TV+ にログイン済み
- [x] 対象作品で再生できる
- [x] DevTools Console を開ける

---

## 1. トップページで残らないか

操作:
- Apple TV+ のトップページを開く
- 再生画面から戻る操作も試す

確認したいこと:
- 再生中用の debug badge がトップページに残らない
- 再生画面を閉じたあとも badge が消える

結果:
- [x] OK
- [ ] NG

メモ:
- 実際に見えた表示:
- 気づいたこと:

---

## 2. 再生画面で badge が出るか

操作:
- 作品を再生開始する
- 再生開始直後から右上を見る

確認したいこと:
- 再生画面では badge が見える
- badge が再生 dialog の中に出ている
- しばらくすると最終的に `running` になる

結果:
- [x] OK
- [ ] NG

メモ:
- badge 表示:再生が始まるとすぐに右上に出る
- 色:緑
- text:`session: running | reason: spa-navigation | tracks: 281`
- tracks:281

---

## 3. 開始直後の待機が不自然でないか

操作:
- ページ再読込後に再生開始する
- 作品を切り替えて再生開始する

確認したいこと:
- 開始直後に一瞬 `waiting` が出てもよい
- その後、数秒以内に `running` に変わる
- `tracks: 0` のまま止まり続けない

結果:
- [x] OK
- [ ] NG
- [ ] waiting は見えなかったが問題なし

メモ:
- waiting を見たか:開始直後にオレンジ色になったテキストまでは分からず。
- running になるまでの体感:一瞬、コンマ数秒
- tracks の変化:早すぎて良く見えなかったがおそらく1-280-281と変化した

---

## 4. 作品切替で古い状態が残らないか

操作:
- 別作品を開く
- 別エピソードを開く
- 可能なら連続で2回以上切り替える

確認したいこと:
- badge が消えずに固まらない
- 新しい作品で再び `running` になる
- `tracks` の値が作品ごとに変わるなら追従する
- 前の作品の状態を引きずらない

結果:
- [x] OK
- [ ] NG

メモ:
- 作品A:窓際のスパイ シーズン6 エピソード1
- 作品B:窓際のスパイ シーズン6 エピソード3
- tracks の変化:あり284になった。ちなみにエピソード2では281だった
- おかしな残り方:特になし

---

## 5. 再生終了・戻る操作で cleanup できるか

操作:
- 再生画面を閉じる
- 戻る
- トップページへ戻る
- 必要なら別タブ移動やリロードも試す

確認したいこと:
- 再生用 badge が消える
- トップページに再生中 UI が残らない
- 戻って再生し直した時に再び正常に出る

結果:
- [x] OK
- [ ] NG

メモ:
- 戻った後の見え方: トップページでは badge は表示されなかった
- 再生し直した時の見え方: 再度再生すると右上に badge が表示され、running になった

---

## 6. Apple TV+ 側の字幕メニュー操作で壊れないか

操作:
- 再生中に Apple TV+ の字幕メニューを開く
- 字幕言語を変える
- 字幕を OFF / ON する
- 数秒再生する

確認したいこと:
- その操作でページが壊れない
- badge が消えない
- `running` のまま維持される、または自然に復帰する

結果:
- [x] OK
- [ ] NG
- [ ] 未確認

メモ:
- 試した字幕設定:日本語、英語、OFF
- badge の変化:特になし
- 気づいたこと:

---

## 7. Console 確認

Apple TV+ の再生ページ上で確認した
topではなくApple TV+ Bilingual Subtitles v2で確認した

実行したコマンド:
```js
document.querySelector('[data-atv-bilingual-debug="session"]')
```

結果:
```txt
document.querySelector('[data-atv-bilingual-debug="session"]')
<div data-atv-bilingual-debug=​"session" style=​"position:​ absolute;​ top:​ 16px;​ right:​ 16px;​ z-index:​ 2147483647;​ padding:​ 6px 8px;​ border-radius:​ 6px;​ font-size:​ 12px;​ line-height:​ 1.4;​ font-family:​ monospace;​ color:​ rgb(255, 255, 255)​;​ background:​ rgba(22, 101, 52, 0.88)​;​ pointer-events:​ none;​ white-space:​ pre-wrap;​">​session: running | reason: spa-navigation | tracks: 281​</div>​
```

実行したコマンド:
```js
(() => ({
  root: !!document.querySelector('dialog.playback-view') || !!document.querySelector('[data-testid="playback-view"]'),
  video: !!document.querySelector('dialog.playback-view video') || !!document.querySelector('video'),
  panelMount: !!document.querySelector('dialog.playback-view [data-testid="video-player-content"]'),
  layoutTarget: !!document.querySelector('dialog.playback-view [data-testid="video-container"]'),
  badge: !!document.querySelector('[data-atv-bilingual-debug="session"]'),
  url: location.href,
}))();
```

結果:
```txt
(() => ({
  root: !!document.querySelector('dialog.playback-view') || !!document.querySelector('[data-testid="playback-view"]'),
  video: !!document.querySelector('dialog.playback-view video') || !!document.querySelector('video'),
  panelMount: !!document.querySelector('dialog.playback-view [data-testid="video-player-content"]'),
  layoutTarget: !!document.querySelector('dialog.playback-view [data-testid="video-container"]'),
  badge: !!document.querySelector('[data-atv-bilingual-debug="session"]'),
  url: location.href,
}))();
{root: true, video: true, panelMount: true, layoutTarget: true, badge: true, …}badge: truelayoutTarget: truepanelMount: trueroot: trueurl: "https://tv.apple.com/jp/show/%E7%AA%93%E9%9A%9B%E3%81%AE%E3%82%B9%E3%83%8F%E3%82%A4/umc.cmc.2szz3fdt71tl1ulnbp8utgq5o?ctx_agid=72d908d4"video: true[[Prototype]]: Object
```

実行したコマンド:
```js
(() => {
  const badge = document.querySelector('[data-atv-bilingual-debug="session"]');
  const root =
    document.querySelector('dialog.playback-view') ??
    document.querySelector('[data-testid="playback-view"]');

  if (!badge || !root) return null;

  return {
    badgeParent: badge.parentElement?.tagName ?? null,
    badgeParentClass: badge.parentElement?.className ?? null,
    rootTag: root.tagName,
    rootClass: root.className,
    sameParent: badge.parentElement === root,
  };
})();
```

結果:
```txt
(() => {
  const badge = document.querySelector('[data-atv-bilingual-debug="session"]');
  const root =
    document.querySelector('dialog.playback-view') ??
    document.querySelector('[data-testid="playback-view"]');

  if (!badge || !root) return null;

  return {
    badgeParent: badge.parentElement?.tagName ?? null,
    badgeParentClass: badge.parentElement?.className ?? null,
    rootTag: root.tagName,
    rootClass: root.className,
    sameParent: badge.parentElement === root,
  };
})();
{badgeParent: 'DIALOG', badgeParentClass: 'playback-view svelte-6e68jn is-full-viewport is-playback-active', rootTag: 'DIALOG', rootClass: 'playback-view svelte-6e68jn is-full-viewport is-playback-active', sameParent: true}badgeParent: "DIALOG"badgeParentClass: "playback-view svelte-6e68jn is-full-viewport is-playback-active"rootClass: "playback-view svelte-6e68jn is-full-viewport is-playback-active"rootTag: "DIALOG"sameParent: true[[Prototype]]: Object
```

---

## 総合判定

- [x] Phase 3-B の実機確認として十分
- [ ] 追加調査が必要
- [x] 次の Phase へ進める

総合メモ:
- 良かった点:デバッグUIの色が変わるのが良かった
- 気になる点:少し表示が上すぎる
- 次に直す候補:表示位置を下げる。今回分かったApple TVのデバッグUIの構造を次も活用できる用意に調査結果をわかりやすくまとめること
