# Apple TV+ DOM Structure

この文書は、Apple TV+ 固有実装の判断資料である。

ブラウザで得た詳細な観測値、selector の網羅表、既存コード調査ログ、track index、時系列ログは
`docs/apple-tv-dom-observations.md` を参照する。

全体の module 構成、責務境界、session の原則は
`docs/minimal-panel-architecture.md` を正本とする。

## 1. この文書の役割

- v2 実装に必要な Apple TV+ 固有の観測結論だけを書く
- 確認済み、暫定、未確認を区別する
- Apple TV+ 固有の責務を一般 module へ漏らさないための判断資料とする
- 詳細ログを日常的な実装判断に持ち込まない
- selector や DOM 事実そのものは `docs/apple-tv-dom-observations.md` に置き、この文書では採用判断だけを固定する

## 2. 現時点の結論

### playback root と video

- `src/content/playback-root.ts` は `dialog.playback-view` を playback root の第一候補として扱う
- `[data-testid="playback-view"]` は fallback 候補として扱う
- video は playback root 配下で解決し、root 内にない場合だけ document 全体を fallback 探索する
- playback root と video は永続参照と見なさない
- 同じ playback root を維持したまま、video 要素だけが DOM から外れ、新しい video が挿入される場合がある
- `src/content/playback-root.ts` と `src/content/session-lifecycle.ts` は root / video の target change、disconnect、identity 変更時に再解決する
- 詳細な selector と観測条件は `docs/apple-tv-dom-observations.md` を参照する

### `textTracks` と字幕 track

- session は video 発見だけで開始しない
- `video.textTracks.length > 0` を最低限の readiness 条件とする
- 新しい video の挿入直後は `textTracks` が 0 件または一部だけの状態になり得る
- `textTracks` が 0 件でも session を失敗・終了扱いにしない
- `src/content/session-lifecycle.ts` は readiness 待機と再試行を所有し、同じ video を再確認する
- readiness 待機中に video が差し替わった場合、古い待機を dispose し、新 video を対象に待機をやり直す
- `src/content/playback-root.ts` は video 解決だけを担い、待機・再試行・停止判断を持たない
- `src/subtitles/text-track-resolver.ts` は `language` だけで primary / secondary track を採用しない
- track 採用判定は `language`、`label`、`kind`、`mode` を合わせて評価する
- 表示中字幕の優先判定には `TextTrack.mode === "showing"` を使う
- `activeCueCount` は補助情報として扱い、表示中字幕の決定条件にはしない
- track 採用判定は `src/subtitles/text-track-resolver.ts` に閉じ込める
- 詳細な track 一覧、track index、cue 数、active cue 数は `docs/apple-tv-dom-observations.md` を参照する

### native subtitle menu

- `src/subtitles/native-menu-sync.ts` は native menu DOM の探索、同期、listener cleanup を所有する
- native menu の `change` 直後は、表示中 track の真実源として扱わない
- `change` 後に少なくとも 1 回の `requestAnimationFrame` を待ち、`TextTrack.mode === "showing"` を再解決する
- `showing` の反映時点は切替方向によって異なる
- `change` 時点、1フレーム後、500ms後のいずれでも反映し得る
- 500ms 固定待機を通常経路にせず、1フレーム後の再解決を主経路、短い遅延または次の `cuechange` を fallback とする
- native menu の `option.value` は index であり、`primaryLang` / `secondaryLang`、または track の永続識別子に使わない
- native menu close は menu binding の cleanup 契機であり、session 全体の終了とは限らない
- 詳細な menu 構造、selector、切替時系列は `docs/apple-tv-dom-observations.md` を参照する

### native menu 同期の再解決順序

- `src/subtitles/native-menu-sync.ts` は `input` / `change` の発火だけで track 決定を更新しない
- 第1段階として、`change` 後の最初の `requestAnimationFrame` で `TextTrack.mode === "showing"` を再評価する
- 第2段階として、最初の `requestAnimationFrame` で更新が確定しない場合だけ、短い遅延後に再評価する
- 第3段階として、遅延後も確定しない場合は次の `cuechange` を待って再評価する
- fixed な 500ms 待機は通常経路にせず、観測上の fallback 確認時点としてだけ扱う
- 再解決は `src/subtitles/text-track-resolver.ts` に委譲し、native menu 側で採用判定ロジックを重複させない

## 3. UI の注入と layout 方針

### 字幕 panel

- `src/panel/panel-host.ts` を panel host の生成・mount・unmount の唯一の owner とする
- `src/panel/panel-renderer.ts` は Apple TV+ selector を直接持たない
- panel host は playback session と同じ lifecycle で破棄する
- 再生中 UI は `document.body` や `document.documentElement` へ直接注入せず、再生中に前面レイヤーとなる `dialog.playback-view` 配下へ mount する
- panel host の具体的な子要素は Phase 6 で確定する
- 現時点では `[data-testid="video-player-content"]` を panel host 候補として扱う
- host mount 候補の詳細は `docs/apple-tv-dom-observations.md` を参照する

### ON/OFF toggle

- `src/controls/on-off-toggle.ts` は ON/OFF toggle の描画と操作だけを扱う
- ON/OFF toggle は拡張全体の enabled state だけを扱う
- 注入先は controls 近傍、footer 近傍、playback root 直下の独自 host を候補とする
- 注入先は controls の mount / unmount、z-index、pointer event、fullscreen をブラウザで確認してから確定する
- panel open state は扱わない

### panel 開閉ボタン

- `src/controls/panel-open-close-button.ts` は panel 開閉ボタンの描画と操作だけを扱う
- panel 開閉ボタンは `src/ui/ui-state.ts` の panel open state だけを扱う
- ON/OFF toggle とは別責務とする
- 注入先は panel host 配下、controls 近傍、playback root 直下の独自 host を候補とする
- 注入先はブラウザ確認後に確定する

### 7:3 layout

- `src/layout/player-layout.ts` は Apple TV+ 固有の 7:3 layout と controls 補正を扱う
- 最初の基準候補は `.video-player__video-container` とする
- panel と video container の矩形を基に、既存 UI を含む再生画面領域と panel を 7:3 に分ける
- panel open 中だけ layout observer を動かす
- panel close 時には observer、timer、補正 style を必ず解除する
- `svelte-*` を含む selector は安定 selector と見なさない
- layout 基準要素と controls 補正候補の詳細は `docs/apple-tv-dom-observations.md` を参照する

### available width の扱い

- available width は、panel open 時に拡張が再配置対象として扱う横幅とする
- 初期版では `.video-player__video-container` の矩形幅を第一基準とする
- `src/layout/player-layout.ts` は、video 自体の描画矩形ではなく、既存 UI を含む再生画面領域を 70% 側として扱う
- controls、footer、overlay の視覚上のはみ出しにより `.video-player__video-container` だけでは不足する場合、playback root 直下の再生画面領域を再基準候補として再評価する
- available width の最終定義は panel 実装後の fullscreen、viewport resize、controls visible 状態の観測をもって確定する
- available width の観測値と比較結果は `docs/apple-tv-dom-observations.md` に置く

### controls 補正の停止条件

- `src/layout/player-layout.ts` は panel open 中だけ controls 補正を有効化する
- panel close 時は、補正 style、observer、timer、再計算予約を必ず解除する
- controls 自体が非表示になった場合、layout observer は維持してもよいが、controls 補正 style は残さない
- controls の mount / unmount や replacement を検出した場合、古い要素への補正参照は破棄する
- layout 補正は session cleanup 時にも必ず解除し、次 session へ持ち越さない

## 4. session と再初期化

- `src/content/session-lifecycle.ts` は処理 session の開始停止と controller の最終 dispose を一元管理する
- DOM の検出元は再評価を要求し、lifecycle が現在 target の再解決・比較・restart 要否・理由選択・重複抑制・実行を所有する
- readiness retry も lifecycle の共通再評価経路を使う
- 再初期化候補は SPA target change、playback root disconnect、video disconnect、video replacement とする
- 理由コードの型は `docs/minimal-panel-architecture.md` §18、選択規則と実行順序は同文書 §13 を参照する
- DOM 上の契機だけで restart や新しい視聴を確定しない
- 対象消失時は旧処理・参照を解放し、現在の有効 target がある場合だけ開始条件と readiness を評価する
- seek は session 再生成の契機にしない
- seek 自体を理由に既存 track binding を作り直さない。history の時刻更新と source 更新による truth 再構築の区別は、`docs/minimal-panel-architecture.md` §13 を参照する
- listener、observer、timer、track binding、拡張 DOM の owner は 1 つに限定する
- 処理 session に属する track binding、cue listener、native menu binding、layout observer、panel host、controls binding は、それぞれの owner が cleanup する
- OFF から ON に戻す操作経路と操作側 runtime は、字幕処理 session の寿命と区別する。詳細は architecture §12・§15〜§16 を参照する
- cleanup の解除試行と成功を区別し、失敗後も残りの解除・参照整理を継続する
- SPA 遷移、再描画、seek の詳細観測は `docs/apple-tv-dom-observations.md` を参照する

### DOM 契機と再初期化の扱い

| DOM 契機 | 扱い・確認すること |
| --- | --- |
| 監視中の video が DOM から外れた | 同一 root 内での差し替えの可能性を確認する |
| 旧 video とは別 identity の新 video を検出した | ID 文字列ではなく DOM node identity で判定する |
| playback root が DOM から外れた | root の再探索が必要になる |
| SPA target change を検出した | URL だけで判断せず、target の変化を確認する |
| seek が発生した | seek 自体を再初期化の契機にしない |
| native menu close | menu binding の解放契機であり、session restart とは区別する |

理由コードの定義は `docs/minimal-panel-architecture.md` §18 を参照する。
この表は観測契機を整理するものであり、restart の確定条件や理由対応を再定義しない。
検出元は再評価要求までとし、判断・理由選択・開始停止は同文書 §13 に従って lifecycle が行う。

video identity や restart reason だけでは、新しい視聴と技術的な再接続を区別しない。
その具体的な識別条件は未確認であり、確認前に恒久的な selector や判定規則を追加しない。

## 5. module への反映

| module | Apple TV+ 固有の責務 |
| --- | --- |
| `src/content/playback-root.ts` | playback root、video、panel 注入先候補、layout 基準領域の discovery と target snapshot 比較 |
| `src/content/session-lifecycle.ts` | target 再評価、restart 要否・理由選択、重複要求の収束、処理 session の開始停止、readiness 待機、controller の最終 dispose |
| `src/subtitles/native-menu-sync.ts` | native menu の探索、同期、listener cleanup、RAF後の track 再解決要求 |
| `src/subtitles/text-track-resolver.ts` | track の正規化と採用判定 |
| `src/panel/panel-host.ts` | panel host の生成・mount・unmount |
| `src/layout/player-layout.ts` | 7:3 layout、controls 補正、layout observer |
| `src/controls/on-off-toggle.ts` | ON/OFF toggle の描画と操作 |
| `src/controls/panel-open-close-button.ts` | panel 開閉ボタンの描画と操作 |
| `src/ui/ui-state.ts` | enabled state と panel open state の runtime 管理 |

## 6. 未確認事項

### 実装前に優先して確認したい項目

- native menu close 時の menu root と select 要素の破棄タイミング
- controls の表示・非表示時に mount / unmount / resize / class 変更される要素
- panel host の最も安定した mount 位置
- ON/OFF toggle と panel 開閉ボタンの最終注入先
- fullscreen、viewport resize、panel open 時の video container と controls の変化

### 実装後の検証でよい項目

- 明示的な別エピソード移動で playback root まで差し替わるか
- 次話自動再生で playback root まで差し替わるか
- root disconnect と video disconnect を確実に観測できるか
- 広告、予告、本編、次話で track 構成がどの程度変わるか

## 7. 詳細観測ログ

詳細は `docs/apple-tv-dom-observations.md` を参照する。
