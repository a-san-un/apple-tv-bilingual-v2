# Apple TV+ DOM Observations

この文書は Apple TV+ DOM の詳細観測ログである。

実装時に必要な結論は `docs/apple-tv-dom-structure.md` を参照する。

全体の module 構成、責務境界、session の原則は
`docs/minimal-panel-architecture.md` を参照する。

## 1. 観測ルール

- 推測ではなく、既存コードまたは実機観測で確認できた事実だけを書く
- 既存コードの調査結果と実機観測結果を分けて書く
- selector を書く場合は、確認条件と安定性を併記する
- root、video、`textTracks`、controls、panel host candidate、観測時の問題を記録する
- 実機で未確認の項目は「未確認」と明記する
- selector を Apple TV+ の安定仕様として断定しない
- 実装判断は `docs/apple-tv-dom-structure.md` に集約し、この文書には詳細な観測事実を置く
- panel 候補や selector 候補については、採用判断ではなく観測上の利点・懸念・確認結果だけを書く

## 2. 観測環境

| 項目 | 2026-10-19 の初回観測 | 2026-10-20 の probe 観測 |
| --- | --- | --- |
| ブラウザ | 未記録 | 未記録 |
| macOS | 未記録 | 未記録 |
| Apple TV+ 画面 | 再生画面 | 再生画面 |
| タイトル | 未記録 | 未記録 |
| 初期字幕 | 日本語 | 日本語 |
| 開発者ツール | ブラウザ DevTools Console | ブラウザ DevTools Console |
| 操作 | 字幕 menu を開いて DOM と `textTracks` を調査 | seek、字幕言語切替、再生コンテンツ切替を観測 |
| probe 開始時刻 | - | 2026-10-20 04:45:04 UTC |
| probe 記録数 | - | 330件 |

- 2026-10-20 の probe は、seek、字幕言語切替、日本語字幕から英語字幕への切替、英語字幕から日本語字幕への切替、再生コンテンツ切替を含む。
- 再生コンテンツ切替は、PSA、別作品の宣伝、本編前あらすじを含む連続再生中に観測した。
- この観測では SPA 内の video replacement を確認できたが、明示的な別エピソード移動および次話自動再生は未確認である。

## 3. 既存コード調査

### 3.1 調査対象

- `secondary-subtitle-dom.js`
- `runtime-observers.js`
- `playback-controls-layout.js`
- `modules/playback-controls-layout-controller.js`
- `modules/playback-context-controller.js`
- `modules/playback-startup-coordinator.js`
- `modules/cue-track-binder.js`
- `modules/text-track-debug.js`
- `native-toggle.css`
- `content.js`

### 3.2 root / video / readiness

- `modules/playback-context-controller.js` では、再生対象の検出に `video`、`dialog.playback-view`、`[data-testid="playback-view"]` を使用していた
- readiness 判定は URL ではなく DOM 条件で行っていた
- readiness 条件は `video` が存在し、かつ `video.textTracks.length > 0` であることだった
- `getVideoAndDialog()` は `playbackDialog` を優先し、取れない場合は `playbackView?.closest("dialog")` を使っていた

### 3.3 監視と再初期化

- `modules/playback-startup-coordinator.js` では、startup / rebuild request の入口を 1 つに集約していた
- settings change、SPA target change、delayed retry を同じ起動判定経路へ収束させていた
- `textTracks` readiness の待機責務は coordinator が持っていた
- readiness は cue の安定化までは見ず、requested track の存在を基準にしていた
- target change 時は旧 session cleanup の一度化が必要だった
- 同一 target に対する重複 request は dedupe / skip / replace していた

### 3.4 track bind と cleanup

- `modules/cue-track-binder.js` では、primary の bind / unbind / handoff / restore は cueController へ委譲していた
- secondary は binder が listener attach / cleanup だけでなく、`track.mode` の適用・復元・同一 track 判定まで持っていた
- secondary monitor は track、cleanup、meta、originalMode、requestedMode を保持していた
- listener cleanup 後は保持参照を明示的に破棄する前提だった
- ON/OFF toggle 時は secondary monitor の参照を全て手放し、古い track を次回 session へ持ち越さない設計だった

### 3.5 controls / layout 観測対象

- `runtime-observers.js` は controls layout の観測対象として `.video-player__header`、`.video-player__controls`、`.video-player__progress`、`.video-player__footer`、`.unified-controls`、`amp-volume-control-unified`、`.video-player__video-container`、`#atv-panel-host` を使っていた
- panel open 中に限り `MutationObserver` と `ResizeObserver` を有効化していた
- `ResizeObserver` の対象は panel、footer、unified controls、volume control、video container だった
- `MutationObserver` / `ResizeObserver` / event listener をまとめて解除する cleanup 経路を持っていた

### 3.6 7:3 layout 関連

- `playback-controls-layout.js` には header、controls、progress、metadata、tabs、auto subs note、footer、panel、video container 用の selector 定義がある
- panel selector は `#atv-panel-host` だった
- video selector は `.video-player__video-container` だった
- visible area は panel の矩形と video container の矩形から計算していた
- controls、unified controls、volume、progress、remaining などの右端位置は panel 左端を基準に補正していた
- `amp-playback-controls-progress` 配下の progress bar と `time.remaining` も取得対象にしていた

### 3.7 panel host と secondary subtitle

- `secondary-subtitle-dom.js` は target 配下から `#atv-panel-host` を探索していた
- secondary subtitle 要素は panel host 配下に append していた
- secondary subtitle 要素の探索には `[data-secondary-subtitle]` と `.dual-subtitles-secondary` を使っていた
- panel 本体の探索には `[data-dual-subtitles-panel]` と `.dual-subtitles-panel` を使っていた
- document 全体で見つからない場合は panel host の shadow root 配下も探索していた
- panel host 配下の secondary 要素を重複排除する cleanup 経路を持っていた

### 3.8 layout controller の観測対象

- `modules/playback-controls-layout-controller.js` は `.video-container.svelte-1psbnd5.is-opaque`、`.video-container.is-opaque`、`.video-container` を取得候補にしていた
- あわせて `.video-player__video-container`、`.video-player__content`、`video`、`.background-video` を取得候補にしていた
- controller は `panelOpen` を状態として持ち、panel open 時だけ layout 更新と settle 処理を進める前提だった

### 3.9 native toggle

- `native-toggle.css` には `#atvb-native-toggle`、`.atvb-native-toggle__control`、`.atvb-native-toggle__track`、`.atvb-native-toggle__knob`、`.atvb-native-toggle__label` の定義がある
- 既存コード確認だけでは、toggle の実際の注入先までは確定できない

### 3.10 `textTracks` debug

- `modules/text-track-debug.js` は `Array.from(video?.textTracks || [])` で track 一覧を取得していた
- track 調査では `kind`、`label`、`language`、`mode`、cue 数、active cue 数を観測対象にしていた

## 4. playback root と video

### 4.1 playback root

| 候補 | 確認条件 | 結果 | 安定性 | 備考 |
| --- | --- | --- | --- | --- |
| `dialog.playback-view` | 実機再生画面、2026-10-19 / 2026-10-20 | 検出 | 中 | 2026-10-20 probe 中は継続して同一 root が検出された |
| `[data-testid="playback-view"]` | 既存コード | 使用実績あり | 中 | 2026-10-20 は第一候補が取得できたため fallback は未使用 |
| `dialog.playback-view video` | 実機再生画面、2026-10-20 | 検出 | 中 | root 配下の video を解決できた |
| `document.querySelector("video")` | 実機再生画面、2026-10-20 | 検出 | 中 | root 内探索に失敗した場合の fallback 候補 |

- 2026-10-20 の probe 開始時、root は `dialog.playback-view` として検出された。
- root path は `html > body > div.body-container > div.main-playback-view > dialog.playback-view.svelte-6e68jn.is-full-viewport` だった。
- 観測範囲内では root replacement は記録されなかった。
- ただし、この事実だけでは SPA 遷移や次話自動再生で root が維持されるとは断定できない。

### 4.2 video

| 観測時点 | video の状態 | 備考 |
| --- | --- | --- |
| probe 開始時 | root 配下の `video#apple-music-video-player` を検出 | `video-changed` を 1 回記録 |
| seek 前後 | 同一 video を維持 | replacement は未発生 |
| 再生コンテンツ切替開始時 | 旧 video が DOM から消失 | `video-changed` で next が `null` |
| 約 0.6 秒後 | 新しい `video#apple-music-video-player` を検出 | 同じ ID だが別 DOM node |
| 新 video 挿入直後 | `currentTime = 0`、`textTracks = 0` | readiness 未完了 |
| 約 1 秒後 | `textTracks = 1` | 字幕 track は未安定 |
| 約 2 秒後 | `textTracks = 284`、日本語 track が `showing` | 初期 session に必要な状態へ到達 |

- 2026-10-20 04:46:40 UTC 頃、旧 video が消失した。
- 約 0.6 秒後に root 配下の新 video が検出された。
- video ID は同じでも DOM node identity は変わるため、ID 文字列だけでは同一 session と判定できない。
- 同じ playback root を維持したまま video だけが差し替わる事例を確認した。
- この切替は PSA、別作品の宣伝、本編前あらすじを含む連続再生中に観測した。

### 4.3 root / video change 時系列ログ

| 時点 | root | video | 補足 |
| --- | --- | --- | --- |
| probe 開始時 | `dialog.playback-view` を検出 | root 配下 video を検出 | 初期状態 |
| seek 前後 | 同一 root | 同一 video | 差し替えなし |
| 再生コンテンツ切替開始時 | 同一 root を維持 | 旧 video 消失 | `video-changed` で next が `null` |
| 約 0.6 秒後 | 同一 root を維持 | 新 video 検出 | 同じ ID だが別 node |
| 約 2 秒後 | 同一 root を維持 | 新 video 維持 | `textTracks` が安定状態へ到達 |

- 今回の観測範囲では root replacement は確認していない。
- 今回確認したのは root 維持下での video replacement である。
- DOM 契機と再起動理由の採用判断は `docs/apple-tv-dom-structure.md` に委ねる。

## 5. `textTracks` と字幕 track

### 5.1 初期観測

- `video.textTracks` は利用できた。
- 字幕 track は日本語・英語を含む複数言語で存在した。
- `language`、`label`、`kind`、`mode`、cue 数、active cue 数の組み合わせで観測した。
- 同じ言語でも複数 track が存在し得るため、言語コードだけで採用 track を断定できない。
- `mode === "showing"` の track が画面表示字幕の有力な候補だった。
- hidden track にも active cue が存在する事例があった。

### 5.2 2026-10-20 probe の track 状態

| 観測時点 | track 数 | `showing` track | active track の補足 |
| --- | ---: | --- | --- |
| probe 開始時 | 284 | `82: subtitles: 日本語: ja` | active cue は未取得 |
| seek 開始時 | 284 | `82: subtitles: 日本語: ja` | active cue は未取得 |
| seek 500ms後 | 284 | `82: subtitles: 日本語: ja` | active cue は未取得 |
| 日本語 → 英語 `input` | 284 | `82: subtitles: 日本語: ja` | 日本語 showing、英語 hidden の active cue を観測 |
| 日本語 → 英語 `change` | 284 | `28: subtitles: English: en` | 日本語は hidden、英語 showing へ変化 |
| 日本語 → 英語 500ms後 | 284 | `28: subtitles: English: en` | 英語 showing の active cue を観測 |
| 英語 → 日本語 `input` | 284 | `28: subtitles: English: en` | 英語 showing |
| 英語 → 日本語 `change` | 284 | `28: subtitles: English: en` | `select` は日本語を示すが showing は英語 |
| 英語 → 日本語 RAF後 | 284 | `82: subtitles: 日本語: ja` | 日本語 showing へ変化 |
| 英語 → 日本語 500ms後 | 284 | `82: subtitles: 日本語: ja` | 状態を維持 |
| 新 video 挿入直後 | 0 | なし | readiness 前 |
| 新 video 約 1 秒後 | 1 | なし | track 構成は未安定 |
| 新 video 約 2 秒後 | 284 | `82: subtitles: 日本語: ja` | showing track を再取得 |

- 新 video の `textTracks` は直後に 0 件になり得る。
- `textTracks` は 1 回で揃うとは限らず、段階的に増える。
- `activeCueCount > 0` の hidden track を観測したため、active cue の存在だけでは画面表示字幕を決められない。

### 5.3 seek

| 観測時点 | track 数 | showing track | 結果 |
| --- | ---: | --- | --- |
| seek 開始 | 284 | 日本語 | 基準値 |
| 最初の RAF後 | 284 | 日本語 | track state は不変 |
| `seeked` | 284 | 日本語 | track state は不変 |
| 500ms後 | 284 | 日本語 | track state は不変 |

- seek は約 93.656 秒から 160 秒への移動で実施した。
- seek 中、最初の RAF後、`seeked`、500ms後のいずれでも track 数と showing track は変化しなかった。
- probe 記録では seek 後にも `cuechange` が継続した。
- この 1 回の観測範囲では、seek は video replacement や session 再生成を必要とする変化を起こさなかった。

### 5.4 readiness 遷移ログ

| 時点 | `textTracks.length` | showing track | 補足 |
| --- | ---: | --- | --- |
| 新 video 挿入直後 | 0 | なし | readiness 前 |
| 新 video 約 1 秒後 | 1 | なし | track 構成は未安定 |
| 新 video 約 2 秒後 | 284 | 日本語 | session 開始候補状態 |

- readiness は 1 回の同期的な取得で確定しなかった。
- 新 video 検出直後の bind は不安定になる可能性が高い。
- readiness 遷移の採用判断は `docs/apple-tv-dom-structure.md` に委ねる。

## 6. native subtitle menu

### 6.1 menu 構造

| selector | 対象 | 確認条件 | 結果 | 安定性 |
| --- | --- | --- | --- | --- |
| `ul.contextual-menu__list[role="menu"]` | native menu root | 字幕 menu open 中 | 検出 | 中 |
| `select.contextual-menu-item__select` | 字幕言語 select | 字幕 menu open 中 | 検出 | 中 |
| `.contextual-menu-item__subtext` | 選択言語の表示 | 字幕 menu open 中 | 検出 | 低 |
| `div.contextual-menu__group` | menu group | 字幕 menu open 中 | 検出 | 中 |
| `li.contextual-menu-item` | menu item | 字幕 menu open 中 | 検出 | 中 |

- menu root と select は字幕 menu を開いた状態でだけ検出できた。
- `select` の `option.value` は track index 相当の値であり、言語設定の永続値として扱えない。
- menu close 時に menu root と select がいつ unmount されるかは未確認である。

### 6.2 切替時系列

#### 日本語 → 英語

| 時点 | select 表示 | showing track | active cue の補足 |
| --- | --- | --- | --- |
| `input` | 英語 | 日本語 | 日本語 showing、英語 hidden の active cue |
| `change` | 英語 | 英語 | 日本語 hidden、英語 showing |
| 最初の RAF後 | 一時的に日本語 | 英語 | select 表示が一時的に旧値へ戻った |
| 500ms後 | 英語 | 英語 | 英語 showing の active cue を確認 |

#### 英語 → 日本語

| 時点 | select 表示 | showing track | active cue の補足 |
| --- | --- | --- | --- |
| `input` | 日本語 | 英語 | 英語 showing |
| `change` | 日本語 | 英語 | select は新値、showing は旧値 |
| 最初の RAF後 | 日本語 | 日本語 | showing が日本語へ切り替わった |
| 500ms後 | 日本語 | 日本語 | 状態を維持 |

- `input`、`change`、RAF後、500ms後のどこで `showing` が切り替わるかは切替方向で異なった。
- select の値・表示テキストは一時的に旧値へ戻る事例があった。
- menu の DOM 表示だけを字幕の真実源にはできない。
- `TextTrack.mode === "showing"` は、今回の観測では表示中字幕判定に最も安定していた。
- active cue は showing track 以外の hidden track にも存在した。

### 6.3 native menu close 観測項目

次回観測では、menu close の前後で少なくとも次を記録する。

- menu root の存在有無
- select 要素の存在有無
- select の `value`
- 選択表示テキスト
- 親要素 path
- `display`、`visibility`、`opacity`
- close 直後、最初の RAF後、500ms後の差分

## 7. controls と layout

### 7.1 controls 周辺

既存コードでの取得候補は次のとおり。

- `.video-player__header`
- `.video-player__controls`
- `.video-player__progress`
- `.video-player__footer`
- `.unified-controls`
- `amp-volume-control-unified`
- `.video-player__video-container`
- `#atv-panel-host`

実機で、controls 表示・非表示による mount / unmount、resize、class 変化は未確認である。

### 7.2 7:3 layout 基準候補

| 候補 | 根拠 | 安定性 | 注意 |
| --- | --- | --- | --- |
| `.video-player__video-container` | 既存版の video container selector、2026-10-20 の video 親要素 | 中 | class 名依存 |
| `.video-player__content` | video の親要素として検出 | 低 | layout 境界として未検証 |
| `dialog.playback-view` | playback root として実機検出 | 中 | panel を含む全体領域になる可能性 |
| `video` | 実機検出 | 中 | controls を含まない |

- `.video-player__video-container` は最初の layout 基準候補である。
- layout の正確な基準と controls 補正値は、panel 実装後に resize / fullscreen / controls visible 状態を含めて測定する必要がある。
- `svelte-*` を含む class は framework 生成値のため、安定 selector として使わない。

### 7.3 controls 観測項目

次回観測では、controls 表示・非表示ごとに少なくとも次を記録する。

- header、controls、progress、footer、unified controls、volume control の存在有無
- 各要素の bounding rect
- class 変化
- mount / unmount の有無
- pointer event と z-index
- controls 非表示中に残る要素と消える要素の差分

## 8. panel と各 UI の注入先候補

### 8.1 右側字幕 panel

| 候補 | 観測上の利点 | 観測上の懸念 | 状態 |
| --- | --- | --- | --- |
| playback root 直下の extension host | extension 側の owner が明確 | native controls との重なりを要確認 | 候補 |
| `.video-player__video-container` 配下 | video 領域との同期が取りやすい | container replacement を要確認 | 候補 |
| `.video-player__content` 配下 | video container の親で配置しやすい可能性 | layout との関係が未確認 | 候補 |

- extension が所有する host ID は `#atv-panel-host` とする。
- host の mount / unmount は `src/panel/panel-host.ts` だけが行う。
- 最終注入先の採用判断は `docs/apple-tv-dom-structure.md` に委ねる。

### 8.2 ON/OFF toggle

| 候補 | 観測上の利点 | 観測上の懸念 | 状態 |
| --- | --- | --- | --- |
| native controls / footer 近傍 | 操作導線が分かりやすい | controls の再描画・消失に追随が必要 | 候補 |
| playback root 直下の extension host | lifecycle が単純 | native UI との位置関係を要確認 | 候補 |
| panel host 配下 | host を共有できる | panel close 中の導線を失う可能性 | 不採用候補 |

- ON/OFF toggle は enabled state のみを扱う前提で観測している。
- 最終注入先の採用判断は `docs/apple-tv-dom-structure.md` に委ねる。

### 8.3 panel 開閉ボタン

| 候補 | 観測上の利点 | 観測上の懸念 | 状態 |
| --- | --- | --- | --- |
| panel host 配下 | panel と近い | panel close 後の導線を別途確保する必要 | 候補 |
| native controls 近傍 | 見つけやすい | controls 再描画への追随が必要 | 候補 |
| playback root 直下の extension host | lifecycle が単純 | native UI との重なりを要確認 | 候補 |

- panel 開閉ボタンは panel open state のみを扱う前提で観測している。
- 最終注入先の採用判断は `docs/apple-tv-dom-structure.md` に委ねる。

### 8.4 注入先比較軸

候補比較では、少なくとも次の軸を記録する。

- z-index
- pointer event
- fullscreen 時の位置維持
- viewport resize 時の追随性
- controls 表示 / 非表示時の重なり
- DOM replacement 耐性
- mount / unmount の単純さ
- observer 追加負荷の有無

## 9. SPA 遷移、再描画、seek

| 項目 | 確認条件 | 結果 | 備考 |
| --- | --- | --- | --- |
| SPA target change の存在 | 既存コード | あり | coordinator が rebuild request に収束 |
| delayed retry の存在 | 既存コード | あり | readiness 待機と連動 |
| target change 時の旧 session cleanup | 既存コード | 必要 | 一度化が必要 |
| seek 後の track state | 実機、2026-10-20 | 不変 | 284 tracks、showing 日本語を維持 |
| seek 後の cuechange | 実機、2026-10-20 | 継続 | 同一 session で更新継続 |
| 再生コンテンツ切替時の video replacement | 実機、2026-10-20 | あり | root は維持、video は消失後に新 node を検出 |
| 新 video 直後の `textTracks` | 実機、2026-10-20 | 未準備 | 0件 → 1件 → 284件 |
| 再描画時の root / controls 差し替え | 実機 | 未確認 | controls は未観測 |
| 明示的な別エピソード移動時の root / video 差し替え | 実機 | 未確認 | 次回確認 |
| 次話自動再生時の root / video 差し替え | 実機 | 未確認 | 次回確認 |

- 今回確認したのは、SPA 内で連続再生コンテンツが切り替わる際の video replacement である。
- PSA、別作品の宣伝、本編前あらすじのどの境界で video replacement が起きたかは、今回のログだけでは特定できない。
- seek は session 再生成の契機とせず、同一 session 内で cuechange により回復できる前提を検証できた。
- 新 video の `textTracks` は段階的に増えるため、video 発見時点だけで字幕 source を bind してはならない。

## 10. selector 安定性評価

| selector / 探索方法 | 対象 | 確認条件 | 安定性 | 理由 |
| --- | --- | --- | --- | --- |
| `dialog.playback-view` | playback root | 実機と既存コード | 中 | class 名依存だが `dialog` と組み合わせ可能 |
| `[data-testid="playback-view"]` | playback root | 既存コード | 中 | テスト用属性のため変更可能性あり |
| `dialog.playback-view video` | video | 実機 | 中 | root 配下での探索 |
| `document.querySelector("video")` | video | 実機 | 中 | 現在は一意だが複数 video の可能性を否定できない |
| `#apple-music-video-player` | video | 実機 | 低 | 内部 ID の可能性。同じ ID の別 node が出現した |
| `.video-player__video-container` | video container | 実機と既存コード | 中 | layout 用 class だが複数箇所で利用の可能性 |
| `ul.contextual-menu__list[role="menu"]` | native subtitle menu root | 実機、字幕 menu open 中 | 中 | menu open 中のみ確認 |
| `div.contextual-menu__group` | native menu group | 実機、字幕 menu open 中 | 中 | group class 依存 |
| `li.contextual-menu-item` | menu item | 実機、字幕 menu open 中 | 中 | menu item class 依存 |
| `select.contextual-menu-item__select` | native subtitle language select | 実機、字幕 menu open 中 | 中 | native `<select>` だが menu open 中のみ確認 |
| `.contextual-menu-item__subtext` | selected language display | 実機、字幕 menu open 中 | 低 | 表示用要素であり正本ではない |
| `#atv-panel-host` | extension panel host | extension 側が所有 | 高 | extension が生成・削除を管理する |
| `[data-secondary-subtitle]` | extension secondary subtitle | extension 側が所有 | 高 | extension が生成・削除を管理する |
| `[data-dual-subtitles-panel]` | extension panel shell | extension 側が所有 | 高 | extension が生成・削除を管理する |
| `.video-container.svelte-1psbnd5.is-opaque` | opaque video container | 既存コード | 低 | framework hash を含む |
| `.video-container.is-opaque` | opaque video container | 既存コード | 低 | Apple TV+ の実装 class に依存 |
| `.background-video` | background video | 既存コード | 低 | 実機で未確認 |

## 11. 未確認事項と次回観測手順

### 11.1 未確認事項

- `dialog.playback-view` と `[data-testid="playback-view"]` が明示的な別エピソード移動、次話自動再生後も同じ関係を維持するか
- video が明示的な別エピソード移動、次話自動再生で差し替わるか
- native subtitle menu close 時に `ul.contextual-menu__list` と `select.contextual-menu-item__select` が unmount されるか
- controls 表示 / 非表示で、header、controls、progress、footer、unified controls、volume、video container のどれが mount / unmount / resize / class 変化するか
- controls 表示状態と字幕 menu open 状態の lifecycle 関係
- panel host を `dialog.playback-view` のどの子要素へ mount するのが最も安定するか
- ON/OFF toggle の最適な注入先
- panel 開閉ボタンの最適な注入先
- 7:3 layout の基準を video container、playback root、video のどれに置くか
- fullscreen 時の root、video container、controls、panel host の変化
- panel host、native controls、native menu の z-index と pointer event の競合
- 広告・予告・本編・次話ごとに root、video、`textTracks` の差し替え条件が異なるか
- root disconnect と video disconnect を確実に観測できるか

### 11.2 次回観測手順

1. 現行 probe を開始し、明示的な別エピソード移動または次話自動再生を実施する。
2. 新しい再生が開始して 10 秒以上待ち、root change、video change、`textTracks` の 0 件から安定状態までの遷移を JSON で保存する。
3. native subtitle menu を開き、閉じる直前と閉じた直後に `__atvbProbe.snapshot()` を実行して、menu root と select の存在を比較する。
4. controls を表示・非表示にし、各状態で `__atvbProbe.snapshot()` を実行する。
5. panel 実装後、候補 mount 位置ごとに fullscreen、viewport resize、controls visible 状態の z-index、pointer event、layout を確認する。


## 2026-10-22: playback dialog の top layer と debug badge の可視性

### 観測条件

- 作品: 窓際のスパイ、シーズン 6 エピソード 1
- 設定: `primaryLang: en-GB`、`secondaryLang: ja`
- 操作: 再生開始、作品切替、再生終了・戻る、再生再開、Apple TV+ native 字幕メニュー操作

### 観測結果

- 再生画面の `dialog.playback-view` は `HTMLDialogElement` として `open: true` で存在し、再生中は前面レイヤーとして振る舞った。
- `document.body` または `document.documentElement` 側へ追加した `position: fixed` の debug badge は、`z-index: 2147483647` でも再生 dialog の前面には出ず、DevTools の `elementsFromPoint()` でも `dialog.playback-view` 配下の scrim / video container / content が先に返った。
- 一方で同じ badge を `dialog.playback-view` 配下へ移すと即座に可視化できたため、再生画面向け UI は document 直下ではなく playback dialog 配下へ mount する必要がある。
- 再生画面を閉じると badge は残らず、再生を再開すると再表示されて `running` になった。
- 初回再生直後に waiting 状態を短時間許容する設計でも、この確認では体感上ほぼ即時に `running` へ遷移した。
- Apple TV+ の native 字幕メニュー操作後も、badge は `running` を維持するか自然に復帰した。
- Console に extension 起因の error は確認されなかった。

### 再生画面のレイヤー構造

```text
document
└─ body
   ├─ ... Apple TV+ の通常ページ DOM
   └─ dialog.playback-view
      ├─ video
      ├─ [data-testid="video-player-content"]
      │  ├─ 各種 overlay / 再生 UI
      │  └─ panel host 候補
      ├─ [data-testid="video-container"]
      │  └─ layout 計算の基準候補
      └─ debug badge
```

### mount 位置の観測メモ

- 見えなかった配置:

```text
document
└─ html / body
   └─ div[data-atv-bilingual-debug="session"]
```

- 見えた配置:

```text
dialog.playback-view
└─ div[data-atv-bilingual-debug="session"]
```

### 未確定事項

- panel host は `dialog.playback-view` 配下に置く。
- その具体的な子要素は Phase 6 の panel 実装時に再確認する。
- `[data-testid="video-player-content"]` は panel host 候補、`[data-testid="video-container"]` は layout 計算の基準候補であり、この時点では最終決定ではない。
