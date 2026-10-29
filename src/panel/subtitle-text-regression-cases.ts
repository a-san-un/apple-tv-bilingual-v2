/**
 * subtitle-text-regression-cases.ts
 *
 * 2026-10-28 に Chrome Console で観測した Apple TV+ の実 cue 12 件。
 * 添付 pasted_text_1793192795.txt の raw / plain / rtCount を固定する。
 * cueIndex は観測時の位置であり、永続 ID や block の対応キーではない。
 * 入力本文は source / truth の保持対象、expectedPlain は表示用変換の期待値。
 * このファイルはケース定義だけであり、テストや hook を登録しない。
 * 標準 API の assertion は subtitle-text.test.ts。API 不在時の skip は成功と扱わない。
 */

/** 読み仮名・傍点・装飾・改行・空白・記号の、ブラウザで観測した固定ケース。 */
export const subtitleTextRegressionCases = [
  {
    "name": "ja-ruby-reading",
    "language": "ja",
    "cueIndex": 0,
    "raw": "本当にあった\n<c.ruby01><ruby>噂<rt>うわさ</rt></ruby></c>に基づく物語",
    "expectedPlain": "本当にあった\n噂に基づく物語",
    "expectedRtCount": 1
  },
  {
    "name": "ja-plain-current",
    "language": "ja",
    "cueIndex": 244,
    "raw": "俺たちは嫌われ者さ",
    "expectedPlain": "俺たちは嫌われ者さ",
    "expectedRtCount": 0
  },
  {
    "name": "ja-plain-fullwidth-space",
    "language": "ja",
    "cueIndex": 243,
    "raw": "聞こえ…　出るから待ってて",
    "expectedPlain": "聞こえ…　出るから待ってて",
    "expectedRtCount": 0
  },
  {
    "name": "ja-plain-space",
    "language": "ja",
    "cueIndex": 245,
    "raw": "無視され 邪険にされ…",
    "expectedPlain": "無視され 邪険にされ…",
    "expectedRtCount": 0
  },
  {
    "name": "ja-ruby-emphasis",
    "language": "ja",
    "cueIndex": 120,
    "raw": "<c.ruby02><ruby>本<rt>・</rt></ruby></c><c.ruby02><ruby>当<rt>・</rt></ruby></c><c.ruby02><ruby>に<rt>・</rt></ruby></c>役に立った時代が",
    "expectedPlain": "本当に役に立った時代が",
    "expectedRtCount": 3
  },
  {
    "name": "ja-ruby-newline",
    "language": "ja",
    "cueIndex": 172,
    "raw": "この<c.ruby03><ruby>面<rt>つら</rt></ruby></c>じゃ\n愛されちまうんだよ",
    "expectedPlain": "この面じゃ\n愛されちまうんだよ",
    "expectedRtCount": 1
  },
  {
    "name": "en-class",
    "language": "en",
    "cueIndex": 0,
    "raw": "<c.white.bg_black>Hooked up with the, uh,</c>",
    "expectedPlain": "Hooked up with the, uh,",
    "expectedRtCount": 0
  },
  {
    "name": "en-class-italic-music",
    "language": "en",
    "cueIndex": 164,
    "raw": "<c.white.bg_black>♪ <i>They don't like our kind </i>♪</c>",
    "expectedPlain": "♪ They don't like our kind ♪",
    "expectedRtCount": 0
  },
  {
    "name": "en-plain",
    "language": "en",
    "cueIndex": 163,
    "raw": "to cancel the appointment.",
    "expectedPlain": "to cancel the appointment.",
    "expectedRtCount": 0
  },
  {
    "name": "en-class-italic-ellipsis",
    "language": "en",
    "cueIndex": 165,
    "raw": "<c.white.bg_black>♪ <i>They don't pay our kind... </i>♪</c>",
    "expectedPlain": "♪ They don't pay our kind... ♪",
    "expectedRtCount": 0
  },
  {
    "name": "en-class-name",
    "language": "en",
    "cueIndex": 2,
    "raw": "<c.white.bg_black>on Tom Cruise</c>",
    "expectedPlain": "on Tom Cruise",
    "expectedRtCount": 0
  },
  {
    "name": "en-italic-sound",
    "language": "en",
    "cueIndex": 3,
    "raw": "in <i>Tropic Thunder. </i>[chuckles]",
    "expectedPlain": "in Tropic Thunder. [chuckles]",
    "expectedRtCount": 0
  }
] as const;
