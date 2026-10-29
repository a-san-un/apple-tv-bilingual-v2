/**
 * subtitle-block-builder.test.ts
 *
 * 入力検証・完全重複除去・同時刻正規化・対応選択・block 出力と純関数の責務境界を確認する。
 * source や DOM を生成せず、純関数の契約だけを検証する。
 */
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { SubtitleBlock, SubtitleCueSnapshot } from '../shared/types';
import { buildSubtitleBlocks, selectSubtitleCandidates } from './subtitle-block-builder';
import * as blockCandidates from './subtitle-block-candidates';
import type { SubtitleMatchCandidate } from './subtitle-block-candidates';
import { deriveLegacySubtitleHistory } from './subtitle-history';

/**
 * track を持たない最小テスト入力を作る。
 * @param overrides 時刻・本文などの差し替え値。
 * @returns 独立した cue snapshot。
 */
const cue = (overrides: Partial<SubtitleCueSnapshot> = {}): SubtitleCueSnapshot => ({
  startTime: 1.12345,
  endTime: 2.98765,
  text: ' Hello\n ',
  track: null,
  ...overrides,
});

describe('buildSubtitleBlocks の基本契約', () => {
  it('両言語が空なら呼び出しごとに新しい空配列を返す', () => {
    const first = buildSubtitleBlocks([], []);
    expect(first).toEqual([]);
    expect(buildSubtitleBlocks([], [])).not.toBe(first);
  });

  it('primary のみなら時刻と本文を保持し secondaryText を null にする', () => {
    expect(buildSubtitleBlocks([cue()], [])).toEqual([{
      startTime: 1.12345,
      endTime: 2.98765,
      primaryText: ' Hello\n ',
      secondaryText: null,
    }]);
  });

  it('同時刻範囲の二言語を1 block にまとめる', () => {
    expect(buildSubtitleBlocks([cue()], [cue({ text: ' こんにちは\n ' })])).toEqual([{
      startTime: 1.12345,
      endTime: 2.98765,
      primaryText: ' Hello\n ',
      secondaryText: ' こんにちは\n ',
    }]);
  });

  it('入力を変更せず戻り値と入力の変更をほかの結果へ伝えない', () => {
    const primary = cue();
    const secondary = cue({ text: 'こんにちは' });
    const inputs = [primary];
    const secondaryInputs = [secondary];
    const before = { ...primary };
    const secondaryBefore = { ...secondary };
    const first = buildSubtitleBlocks(Object.freeze(inputs), Object.freeze(secondaryInputs));
    const second = buildSubtitleBlocks(inputs, secondaryInputs);
    expect(primary).toEqual(before);
    expect(secondary).toEqual(secondaryBefore);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    const block = first[0];
    if (block === undefined) throw new Error('Expected one block');
    block.primaryText = 'changed output';
    primary.text = 'changed input';
    secondary.text = 'changed secondary';
    expect(second[0]).toEqual({
      startTime: 1.12345,
      endTime: 2.98765,
      primaryText: before.text,
      secondaryText: secondaryBefore.text,
    });
    expect(buildSubtitleBlocks([cue()], [cue({ text: 'こんにちは' })])).toEqual(second);
  });

  it('凍結した cue も受け取り track を読まず block に余分な情報を含めない', () => {
    const primary: SubtitleCueSnapshot = {
      startTime: 0,
      endTime: 1,
      text: 'Hello',
      get track(): null { throw new Error('track must not be read'); },
    };
    const secondary: SubtitleCueSnapshot = {
      startTime: 0,
      endTime: 1,
      text: 'こんにちは',
      get track(): null { throw new Error('track must not be read'); },
    };
    expect(buildSubtitleBlocks(
      Object.freeze([Object.freeze(primary)]),
      Object.freeze([Object.freeze(secondary)]),
    )).toEqual([{
      startTime: 0,
      endTime: 1,
      primaryText: 'Hello',
      secondaryText: 'こんにちは',
    }]);
  });

  it.each([
    ['primary 複数', [cue(), cue({ text: 'different' })], []],
    ['secondary 複数', [cue()], [cue(), cue({ text: 'different' })]],
    ['開始時刻不一致', [cue()], [cue({ startTime: 1.2 })]],
    ['終了時刻不一致', [cue()], [cue({ endTime: 3 })]],
  ] as const)('%s も有効な入力として扱う', (_label, primary, secondary) => {
    expect(() => buildSubtitleBlocks(primary, secondary)).not.toThrow();
  });

  it.each([
    { startTime: NaN },
    { endTime: Infinity },
    { startTime: -1 },
    { endTime: 1 },
    { startTime: 2, endTime: 2 },
    { text: '' },
    { text: ' \n\t ' },
  ])('不正な時刻・本文 %j を両役割で拒否する', (overrides) => {
    expect(() => buildSubtitleBlocks([cue(overrides)], [])).toThrow(RangeError);
    expect(() => buildSubtitleBlocks([], [cue(overrides)])).toThrow(RangeError);
    expect(() => buildSubtitleBlocks([cue()], [cue(overrides)])).toThrow(RangeError);
  });
});

describe('SubtitleBlock の欠損表現', () => {
  it('両言語の本文型は string | null とする', () => {
    expectTypeOf<SubtitleBlock['primaryText']>().toEqualTypeOf<string | null>();
    expectTypeOf<SubtitleBlock['secondaryText']>().toEqualTypeOf<string | null>();
  });
});

describe('buildSubtitleBlocks の母国語のみの生成', () => {
  it('母国語の時刻と空白・改行を保持し primaryText を null にする', () => {
    expect(buildSubtitleBlocks([], [cue({ text: ' こんにちは\n ' })])).toEqual([{
      startTime: 1.12345,
      endTime: 2.98765,
      primaryText: null,
      secondaryText: ' こんにちは\n ',
    }]);
  });

  it('凍結した入力を変更せず track を読まず呼び出しごとに新しい結果を返す', () => {
    const secondary: SubtitleCueSnapshot = Object.freeze({
      startTime: 0,
      endTime: 1,
      text: 'こんにちは',
      get track(): null { throw new Error('track must not be read'); },
    });
    const inputs = Object.freeze([secondary]);
    const first = buildSubtitleBlocks(Object.freeze([]), inputs);
    const second = buildSubtitleBlocks([], inputs);
    expect(first).toEqual([{
      startTime: 0,
      endTime: 1,
      primaryText: null,
      secondaryText: 'こんにちは',
    }]);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    const block = first[0];
    if (block === undefined) throw new Error('Expected one block');
    block.secondaryText = 'changed output';
    expect(second[0]?.secondaryText).toBe('こんにちは');
    expect(secondary.text).toBe('こんにちは');
  });

  it('母国語だけの同時刻cueを元の本文順で正規化する', () => {
    const blocks = buildSubtitleBlocks([], [cue(), cue({ text: 'different' })]);
    expect(blocks.map((block) => block.secondaryText)).toEqual([' Hello\n \ndifferent']);
    expect(blocks.every((block) => block.primaryText === null)).toBe(true);
  });
});

describe('buildSubtitleBlocks の配列全体の入力検証', () => {
  it.each([
    { startTime: NaN },
    { endTime: Infinity },
    { startTime: -1 },
    { startTime: 3, endTime: 3 },
    { startTime: 4, endTime: 3 },
    { text: '' },
    { text: ' \n\t ' },
  ])('2件目の不正入力 %j も両言語で検出する', (overrides) => {
    const inputs = [cue(), cue({ startTime: 3, endTime: 4, ...overrides })];
    for (const [primary, secondary] of [[inputs, []], [[], inputs]] as const) {
      expect(() => buildSubtitleBlocks(primary, secondary)).toThrow(RangeError);
      expect(() => buildSubtitleBlocks(primary, secondary)).toThrow('Subtitle cue time, text, or input order is invalid');
    }
  });

  it('開始時刻の逆順を拒否し入力を並べ替えない', () => {
    const inputs = Object.freeze([
      Object.freeze(cue({ startTime: 3, endTime: 4 })),
      Object.freeze(cue({ startTime: 1, endTime: 2 })),
    ]);
    expect(() => buildSubtitleBlocks(inputs, [])).toThrow('Subtitle cue time, text, or input order is invalid');
    expect(() => buildSubtitleBlocks([], inputs)).toThrow('Subtitle cue time, text, or input order is invalid');
    expect(inputs.map((item) => item.startTime)).toEqual([3, 1]);
  });

  it.each([
    [1, 1],
    [1, 3],
  ])('有効な開始時刻列 %j は入力順を維持して片言語blockを生成する', (firstStart, secondStart) => {
    const makeCue = (startTime: number, text = ' 有効な本文\n '): SubtitleCueSnapshot => Object.freeze({
      startTime,
      endTime: startTime + 1,
      text,
      get track(): null { throw new Error('track must not be read'); },
    });
    const inputs = Object.freeze([makeCue(firstStart), makeCue(secondStart, '別の本文')]);
    for (const [primary, secondary] of [[inputs, []], [[], inputs]] as const) {
      const blocks = buildSubtitleBlocks(primary, secondary);
      expect(blocks.map((block) => block.startTime)).toEqual(
        firstStart === secondStart ? [firstStart] : [firstStart, secondStart]);
      expect(blocks.map((block) => block.primaryText ?? block.secondaryText)).toEqual(
        firstStart === secondStart ? [inputs.map((item) => item.text).join('\n')] : inputs.map((item) => item.text));
    }
    expect(inputs.map((item) => item.text)).toEqual([' 有効な本文\n ', '別の本文']);
  });
});

describe('buildSubtitleBlocks の完全重複除去', () => {
  it.each(['primary', 'secondary', 'both'] as const)('%s の完全重複を除去して基本ケースを生成する', (role) => {
    const input: SubtitleCueSnapshot = Object.freeze({
      startTime: 1,
      endTime: 2,
      text: ' 同じ本文\n ',
      get track(): null { throw new Error('track must not be read'); },
    });
    const duplicates = Object.freeze([input, input, input]);
    const primary = role === 'secondary' ? [] : duplicates;
    const secondary = role === 'primary' ? [] : duplicates;
    const first = buildSubtitleBlocks(primary, secondary);
    const second = buildSubtitleBlocks(primary, secondary);
    expect(first).toEqual([{
      startTime: 1,
      endTime: 2,
      primaryText: role === 'secondary' ? null : ' 同じ本文\n ',
      secondaryText: role === 'primary' ? null : ' 同じ本文\n ',
    }]);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(duplicates).toHaveLength(3);
  });

  it.each([
    { startTime: 1.2 },
    { endTime: 3 },
    { text: 'different' },
    { text: ' Hello\n' },
    { text: ' Hello ' },
  ])('時刻または本文が違う cue %j は同一視しない', (overrides) => {
    const inputs = [cue(), cue(overrides)];
    const first = inputs[0];
    const second = inputs[1];
    if (first === undefined || second === undefined) throw new Error('Expected two cues');
    const expected = first.startTime === second.startTime && first.endTime === second.endTime
      ? [[first.startTime, first.endTime, [first.text, second.text].join('\n')]]
      : inputs.map((item) => [item.startTime, item.endTime, item.text]);
    expect(buildSubtitleBlocks(inputs, []).map((block) => [block.startTime, block.endTime, block.primaryText])).toEqual(expected);
    expect(buildSubtitleBlocks([], inputs).map((block) => [block.startTime, block.endTime, block.secondaryText])).toEqual(expected);
  });

  it('異なる言語の同一本文はそれぞれ残す', () => {
    expect(buildSubtitleBlocks([cue()], [cue()])).toEqual([{
      startTime: 1.12345,
      endTime: 2.98765,
      primaryText: ' Hello\n ',
      secondaryText: ' Hello\n ',
    }]);
  });

  it('重複があっても入力順の違反を先に拒否する', () => {
    const inputs = [cue(), cue({ startTime: 3, endTime: 4 }), cue()];
    expect(() => buildSubtitleBlocks(inputs, [])).toThrow('Subtitle cue time, text, or input order is invalid');
    expect(() => buildSubtitleBlocks([], inputs)).toThrow('Subtitle cue time, text, or input order is invalid');
  });
});

/** 正規化単位の位置・件数で、採用判断だけを分離して検証する候補を作る。 */
const candidate = (
  p: number, s: number, score: number,
  primaryCount: 1 | 2 = 1, secondaryCount: 1 | 2 = 1,
): SubtitleMatchCandidate => ({
  primaryOffset: p, secondaryOffset: s, primaryInputIndex: p, secondaryInputIndex: s,
  primaryCount, secondaryCount, score,
  overlapRatio: 0.60 + score / (primaryCount + secondaryCount),
});

describe('対応候補の系列全体での選択', () => {
  it('空入力ごとに新しい空配列を返す', () => {
    const first = selectSubtitleCandidates([]);
    expect(first).toEqual([]);
    expect(selectSubtitleCandidates([])).not.toBe(first);
  });

  it('局所最高点より系列全体の合計点を優先する', () => {
    const first = candidate(0, 0, 0.5);
    const second = candidate(1, 1, 0.5);
    expect(selectSubtitleCandidates([candidate(0, 1, 0.75), second, first])).toEqual([first, second]);
  });

  it.each([
    [candidate(0, 0, 0.5), candidate(0, 1, 0.25)],
    [candidate(0, 0, 0.5), candidate(1, 0, 0.25)],
    [candidate(0, 1, 0.5), candidate(1, 0, 0.25)],
    [candidate(0, 0, 0.5, 2, 1), candidate(1, 1, 0.25)],
    [candidate(0, 0, 0.5, 1, 2), candidate(1, 1, 0.25)],
  ])('再利用または交差する候補を同時採用しない', (first, second) => {
    expect(selectSubtitleCandidates([second, first])).toEqual([first]);
  });

  it('同点なら対応単位数より対応結合回数の少なさを優先する', () => {
    const single = candidate(0, 0, 0.5);
    expect(selectSubtitleCandidates([candidate(0, 0, 0.5, 1, 2), single])).toEqual([single]);
  });

  it('合計点と対応結合回数が同じなら対応単位数を優先する', () => {
    const first = candidate(0, 0, 0.25);
    const second = candidate(1, 1, 0.25);
    expect(selectSubtitleCandidates([candidate(0, 1, 0.5), second, first])).toEqual([first, second]);
  });

  it('同点なら先頭cueの元入力位置と単位数の辞書順を使う', () => {
    const early = { ...candidate(0, 1, 0.5), primaryInputIndex: 3, secondaryInputIndex: 8 };
    const late = { ...candidate(1, 0, 0.5), primaryInputIndex: 9, secondaryInputIndex: 2 };
    expect(selectSubtitleCandidates([late, early])).toEqual([early]);
    const left = candidate(0, 0, 0.5, 1, 2);
    expect(selectSubtitleCandidates([candidate(0, 0, 0.5, 2, 1), left])).toEqual([left]);
    const a = candidate(0, 0, 0.5);
    const b = candidate(0, 1, 0.5);
    expect(selectSubtitleCandidates([b, a])).toEqual([a]);
  });

  it('辞書順では共通する先頭の後も比較する', () => {
    const head = candidate(0, 0, 0.5);
    const early = candidate(1, 2, 0.5);
    expect(selectSubtitleCandidates([candidate(2, 1, 0.5), early, head])).toEqual([head, early]);
  });

  it('60%の1対1は未対応より優先し、点数0の結合は選ばない', () => {
    const single = candidate(0, 0, 0);
    expect(selectSubtitleCandidates([single])).toEqual([single]);
    expect(selectSubtitleCandidates([candidate(0, 0, 0, 1, 2)])).toEqual([]);
    expect(selectSubtitleCandidates([candidate(0, 0, 0, 2, 1)])).toEqual([]);
  });

  it('高得点の結合を1対1優先という理由で排除しない', () => {
    const merged = candidate(0, 0, 1, 1, 2);
    expect(selectSubtitleCandidates([candidate(0, 0, 0.5), merged])).toEqual([merged]);
  });

  it('候補生成結果から順序を維持して採用する', () => {
    const inputs = [
      { startTime: 0, endTime: 4, text: 'a', inputIndex: 0 },
      { startTime: 4, endTime: 8, text: 'b', inputIndex: 3 },
    ];
    const selected = selectSubtitleCandidates(blockCandidates.generateSubtitleCandidates(inputs, inputs));
    expect(selected.map((c) => [c.primaryInputIndex, c.secondaryInputIndex])).toEqual([[0, 0], [3, 3]]);
  });

  it('凍結した入力を変更せず結果も独立させる', () => {
    const input = Object.freeze(candidate(0, 0, 0.5));
    const inputs = Object.freeze([input]);
    const first = selectSubtitleCandidates(inputs);
    const second = selectSubtitleCandidates(inputs);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(input);
    expect(first[0]).not.toBe(second[0]);
    const output = first[0];
    if (output === undefined) throw new Error('Expected selected candidate');
    output.score = -1;
    expect(input.score).toBe(0.5);
    expect(second[0]?.score).toBe(0.5);
  });

  it('小規模な候補集合で全列挙の最良解と一致する', () => {
    const pool = [
      candidate(0, 0, 0), candidate(0, 1, 0.5), candidate(1, 0, 0.25),
      candidate(1, 1, 0.25), candidate(2, 2, 0.5),
      candidate(0, 0, 0.75, 1, 2), candidate(0, 0, 0.75, 2, 1),
    ];
    const rank = (list: SubtitleMatchCandidate[]): number[] => [
      -list.reduce((sum, c) => sum + c.score, 0),
      list.filter((c) => c.primaryCount + c.secondaryCount === 3).length,
      -list.reduce((sum, c) => sum + c.primaryCount + c.secondaryCount, 0),
      ...list.flatMap((c) => [c.primaryInputIndex, c.secondaryInputIndex, c.primaryCount, c.secondaryCount]),
    ];
    const compare = (a: SubtitleMatchCandidate[], b: SubtitleMatchCandidate[]): number => {
      const x = rank(a), y = rank(b);
      for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
        const delta = (x[i] ?? 0) - (y[i] ?? 0);
        if (delta !== 0) return delta;
      }
      return x.length - y.length;
    };
    for (let mask = 0; mask < 2 ** pool.length; mask += 1) {
      const inputs = pool.filter((_c, i) => (mask & (1 << i)) !== 0);
      const options: SubtitleMatchCandidate[][] = [];
      for (let sub = 0; sub < 2 ** inputs.length; sub += 1) {
        const list = inputs.filter((_c, i) => (sub & (1 << i)) !== 0)
          .sort((a, b) => a.primaryOffset - b.primaryOffset || a.secondaryOffset - b.secondaryOffset);
        if (list.every((c, i) => {
          const previous = list[i - 1];
          return previous === undefined ||
            (c.primaryOffset >= previous.primaryOffset + previous.primaryCount &&
             c.secondaryOffset >= previous.secondaryOffset + previous.secondaryCount);
        })) options.push(list);
      }
      options.sort(compare);
      expect(selectSubtitleCandidates(inputs)).toEqual(options[0]);
      expect(selectSubtitleCandidates([...inputs].reverse())).toEqual(options[0]);
    }
  });
});

/** block 出力の時間範囲・本文を明示するテスト入力。 */
const timedCue = (startTime: number, endTime: number, text: string): SubtitleCueSnapshot => ({
  startTime, endTime, text, track: null,
});

describe('複数 cue からの block 出力', () => {
  it('時刻ずれのある1対1では primary の時間範囲を使う', () => {
    expect(buildSubtitleBlocks([timedCue(1, 11, 'p')], [timedCue(0, 10, 's')])).toEqual([
      { startTime: 1, endTime: 11, primaryText: 'p', secondaryText: 's' },
    ]);
  });

  it('1対2の本文を改行で結合し元の空白・改行を保持する', () => {
    expect(buildSubtitleBlocks([timedCue(0, 10, ' p\n ')], [
      timedCue(0, 5, ' s1\n '), timedCue(5, 10, ' s2 '),
    ])).toEqual([
      { startTime: 0, endTime: 10, primaryText: ' p\n ', secondaryText: ' s1\n \n s2 ' },
    ]);
  });

  it('2対1ではprimaryを入力順に結合し最大終了を使う', () => {
    expect(buildSubtitleBlocks([
      timedCue(0, 10, 'p1'), timedCue(2, 3, 'p2'),
    ], [timedCue(0, 10, 's')])).toEqual([
      { startTime: 0, endTime: 10, primaryText: 'p1\np2', secondaryText: 's' },
    ]);
  });

  it('片言語の隣接cueを相手なしで強制結合しない', () => {
    const inputs = [timedCue(0, 5, 'same'), timedCue(5, 10, 'same')];
    expect(buildSubtitleBlocks(inputs, []).map((b) => b.primaryText)).toEqual(['same', 'same']);
    expect(buildSubtitleBlocks([], inputs).map((b) => b.secondaryText)).toEqual(['same', 'same']);
  });

  it('未対応の両言語cueを欠落なく残し同じ開始時刻ではprimaryを先にする', () => {
    const blocks = buildSubtitleBlocks([
      timedCue(1, 1.1, 'p1'), timedCue(1, 1.2, 'p1b'), timedCue(3, 3.1, 'p3'),
    ], [
      timedCue(0, 0.1, 's0'), timedCue(1, 1.01, 's1'), timedCue(1, 1.02, 's1b'),
      timedCue(2, 2.1, 's2'), timedCue(4, 4.1, 's4'),
    ]);
    expect(blocks.map((b) => b.primaryText ?? b.secondaryText)).toEqual([
      's0', 'p1', 'p1b', 's1', 's1b', 's2', 'p3', 's4',
    ]);
    expect(blocks.every((b) => (b.primaryText === null) !== (b.secondaryText === null))).toBe(true);
  });

  it('完全重複を除去した後の対応候補と未対応cueを一度ずつ出力する', () => {
    const a = timedCue(0, 5, 'p1');
    const b = timedCue(5, 10, 'p2');
    expect(buildSubtitleBlocks([a, { ...a }, b], [timedCue(0, 10, 's'), timedCue(20, 21, 'tail')])).toEqual([
      { startTime: 0, endTime: 10, primaryText: 'p1\np2', secondaryText: 's' },
      { startTime: 20, endTime: 21, primaryText: null, secondaryText: 'tail' },
    ]);
  });

  it('60%の1対1を出力し、点数0の結合に採用されないcueは個別に残す', () => {
    expect(buildSubtitleBlocks([timedCue(0, 10, 'p')], [timedCue(0, 6, 's')])).toEqual([
      { startTime: 0, endTime: 10, primaryText: 'p', secondaryText: 's' },
    ]);
    expect(buildSubtitleBlocks([timedCue(0, 10, 'p')], [timedCue(0, 3, 'a'), timedCue(3, 6, 'b')])).toEqual([
      { startTime: 0, endTime: 10, primaryText: 'p', secondaryText: null },
      { startTime: 0, endTime: 3, primaryText: null, secondaryText: 'a' },
      { startTime: 3, endTime: 6, primaryText: null, secondaryText: 'b' },
    ]);
  });

  it('系列全体で選んだ複数の対応を重複なく出力する', () => {
    expect(buildSubtitleBlocks([timedCue(0, 4, 'p1'), timedCue(4, 8, 'p2')], [
      timedCue(0, 5, 's1'), timedCue(5, 8, 's2'),
    ])).toEqual([
      { startTime: 0, endTime: 4, primaryText: 'p1', secondaryText: 's1' },
      { startTime: 4, endTime: 8, primaryText: 'p2', secondaryText: 's2' },
    ]);
  });

  it('正規化後の3単位以上は連鎖結合せず未対応単位も残す', () => {
    const blocks = buildSubtitleBlocks([timedCue(0, 9, 'p')], [
      timedCue(0, 3, 'a'), timedCue(3, 6, 'b'), timedCue(6, 9, 'c'),
    ]);
    expect(blocks).toEqual([
      { startTime: 0, endTime: 9, primaryText: 'p', secondaryText: 'a\nb' },
      { startTime: 6, endTime: 9, primaryText: null, secondaryText: 'c' },
    ]);
  });

  it('複数cueでも凍結入力・track非参照・出力の独立性を維持する', () => {
    const makeInput = (startTime: number, endTime: number, text: string): SubtitleCueSnapshot => Object.freeze({
      startTime, endTime, text,
      get track(): null { throw new Error('track must not be read'); },
    });
    const primary = Object.freeze([makeInput(0, 5, 'a'), makeInput(5, 10, 'b')]);
    const secondary = Object.freeze([makeInput(0, 10, 's')]);
    const first = buildSubtitleBlocks(primary, secondary);
    const second = buildSubtitleBlocks(primary, secondary);
    expect(first).toEqual(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first.every((b) => Object.keys(b).sort().join(',') === 'endTime,primaryText,secondaryText,startTime')).toBe(true);
    const block = first[0];
    if (block === undefined) throw new Error('Expected block');
    block.primaryText = 'changed';
    expect(second[0]?.primaryText).toBe('a\nb');
    expect(primary.map((c) => c.text)).toEqual(['a', 'b']);
  });
});


describe('連続した同時刻cueの正規化', () => {
  it.each([1, 2, 3, 64])('%s件を件数上限なしで両役割に適用する', (count) => {
    const inputs = Array.from({ length: count }, (_, index) => timedCue(10, 12, `line-${index}`));
    const text = inputs.map((item) => item.text).join('\n');
    for (const role of ['primary', 'secondary', 'both'] as const) {
      const blocks = buildSubtitleBlocks(role === 'secondary' ? [] : inputs, role === 'primary' ? [] : inputs);
      expect(blocks).toEqual([{
        startTime: 10, endTime: 12,
        primaryText: role === 'secondary' ? null : text,
        secondaryText: role === 'primary' ? null : text,
      }]);
    }
  });

  it.each([
    ['非連続', [timedCue(10, 12, 'a'), timedCue(10, 13, 'b'), timedCue(10, 12, 'c')]],
    ['開始だけ一致', [timedCue(10, 12, 'a'), timedCue(10, 13, 'b')]],
    ['終了だけ一致', [timedCue(10, 13, 'a'), timedCue(11, 13, 'b')]],
    ['開始の微小差', [timedCue(10, 12, 'a'), timedCue(10.000000001, 12, 'b')]],
    ['終了の微小差', [timedCue(10, 12, 'a'), timedCue(10, 12.000000001, 'b')]],
  ] as const)('%sを正規化でまとめない', (_label, inputs) => {
    for (const role of ['primary', 'secondary'] as const) {
      const blocks = buildSubtitleBlocks(role === 'primary' ? inputs : [], role === 'secondary' ? inputs : []);
      expect(blocks.map((block) => block.primaryText ?? block.secondaryText)).toEqual(inputs.map((item) => item.text));
    }
  });

  it('同時刻の区間が変わるごとに確定する', () => {
    const blocks = buildSubtitleBlocks([
      timedCue(10, 12, 'a'), timedCue(10, 12, 'b'),
      timedCue(10, 13, 'c'), timedCue(10, 13, 'd'), timedCue(14, 15, 'e'),
    ], []);
    expect(blocks.map((block) => block.primaryText)).toEqual(['a\nb', 'c\nd', 'e']);
  });

  it('完全重複除去後の配列で連続性を判定する', () => {
    const blocks = buildSubtitleBlocks([
      timedCue(0, 1, 'a'), timedCue(0, 2, 'x'), timedCue(0, 1, 'b'),
      timedCue(0, 2, 'x'), timedCue(0, 1, 'c'),
    ], []);
    expect(blocks.map((block) => block.primaryText)).toEqual(['a', 'x', 'b\nc']);
  });

  it('連結後に本文が一致しても重複除去し直さない', () => {
    const blocks = buildSubtitleBlocks([
      timedCue(0, 1, 'a\nb'), timedCue(0, 2, 'x'),
      timedCue(0, 1, 'a'), timedCue(0, 1, 'b'),
    ], []);
    expect(blocks.map((block) => block.primaryText)).toEqual(['a\nb', 'x', 'a\nb']);
  });

  it('凍結入力の本文・タグ・改行を保持し、入力やtrackを変更・参照しない', () => {
    const texts = [' <c.white>a</c>\n ', ' b\t', 'c '];
    const inputs = Object.freeze(texts.map((text) => Object.freeze({
      startTime: 1, endTime: 2, text,
      get track(): null { throw new Error('track must not be read'); },
    })));
    const first = buildSubtitleBlocks(inputs, []);
    const second = buildSubtitleBlocks(inputs, []);
    expect(first[0]?.primaryText).toBe(texts.join('\n'));
    expect(inputs.map((item) => item.text)).toEqual(texts);
    expect(first[0]).not.toBe(second[0]);
    const output = first[0];
    if (output === undefined) throw new Error('Expected block');
    output.primaryText = 'changed';
    expect(second[0]?.primaryText).toBe(texts.join('\n'));
  });

  it('先頭cueの元入力位置と正規化後のoffsetを区別して候補生成へ渡す', () => {
    const spy = vi.spyOn(blockCandidates, 'generateSubtitleCandidates');
    try {
      buildSubtitleBlocks([
        timedCue(0, 1, 'a'), timedCue(0, 1, 'a'), timedCue(0, 1, 'b'), timedCue(2, 3, 'c'),
      ], []);
      expect(spy).toHaveBeenCalledWith([
        { startTime: 0, endTime: 1, text: 'a\nb', inputIndex: 0 },
        { startTime: 2, endTime: 3, text: 'c', inputIndex: 3 },
      ], []);
    } finally { spy.mockRestore(); }
  });

  it('正規化前に空本文などの不正cueを検出する', () => {
    const inputs = [timedCue(1, 2, 'a'), timedCue(1, 2, ''), timedCue(1, 2, 'b')];
    expect(() => buildSubtitleBlocks(inputs, [])).toThrow(RangeError);
    expect(() => buildSubtitleBlocks([], inputs)).toThrow(RangeError);
  });

  it('実機の英語3断片と日本語を1blockにしてcurrentへ渡す', () => {
    const start = 558.9016666666666;
    const end = 561.8427;
    const texts = ['<c.white.bg_black>No. And besides,</c>', 'I thought you were', 'on top of the DNA?'];
    const blocks = buildSubtitleBlocks(texts.map((text) => timedCue(start, end, text)), [
      timedCue(559.0591666666667, 561.8111666666666, 'それに 採取は\nお前の担当だろ？'),
    ]);
    expect(blocks).toEqual([{ startTime: start, endTime: end, primaryText: texts.join('\n'), secondaryText: 'それに 採取は\nお前の担当だろ？' }]);
    const history = deriveLegacySubtitleHistory(blocks, 561.034888);
    expect(history.current?.primaryText).toBe(texts.join('\n'));
    expect(history.future).toEqual([]);
  });
});


describe('正規化と後続評価の組み合わせ', () => {
  it('多数cueを正規化した単位と隣接単位を2対1・1対2で採用し残りも一度だけ出力する', () => {
    const primary = [
      timedCue(0, 4, 'p1'), timedCue(0, 4, 'p2'), timedCue(0, 4, 'p3'),
      timedCue(0, 4, 'p4'), timedCue(0, 4, 'p5'),
      timedCue(4, 10, 'p-next'), timedCue(12, 13, 'p-tail'),
    ];
    const secondary = [timedCue(0, 10, 's'), timedCue(16, 17, 's-tail')];
    const expected: SubtitleBlock[] = [
      { startTime: 0, endTime: 10, primaryText: 'p1\np2\np3\np4\np5\np-next', secondaryText: 's' },
      { startTime: 12, endTime: 13, primaryText: 'p-tail', secondaryText: null },
      { startTime: 16, endTime: 17, primaryText: null, secondaryText: 's-tail' },
    ];
    expect(buildSubtitleBlocks(primary, secondary)).toEqual(expected);
    expect(buildSubtitleBlocks(secondary, primary)).toEqual(expected.map((block) => ({
      startTime: block.startTime, endTime: block.endTime,
      primaryText: block.secondaryText, secondaryText: block.primaryText,
    })));
  });

  it('生cueが1件・5件・32件でも同じ2単位の候補点数を使う', () => {
    const spy = vi.spyOn(blockCandidates, 'generateSubtitleCandidates');
    try {
      for (const count of [1, 5, 32]) {
        spy.mockClear();
        const primary = [
          ...Array.from({ length: count }, (_, index) => timedCue(10, 20, `p-${index}`)),
          timedCue(30, 40, 'p-tail'),
        ];
        const blocks = buildSubtitleBlocks(primary, [timedCue(10, 20, 's'), timedCue(30, 40, 's-tail')]);
        const result = spy.mock.results[0];
        if (result?.type !== 'return') throw new Error('Candidate generation must return');
        expect(result.value.map((match) => ({
          primaryOffset: match.primaryOffset, secondaryOffset: match.secondaryOffset,
          primaryCount: match.primaryCount, secondaryCount: match.secondaryCount, score: match.score,
        }))).toEqual([
          { primaryOffset: 0, secondaryOffset: 0, primaryCount: 1, secondaryCount: 1, score: 0.8 },
          { primaryOffset: 1, secondaryOffset: 1, primaryCount: 1, secondaryCount: 1, score: 0.8 },
        ]);
        expect(blocks).toEqual([
          { startTime: 10, endTime: 20, primaryText: primary.slice(0, count).map((item) => item.text).join('\n'), secondaryText: 's' },
          { startTime: 30, endTime: 40, primaryText: 'p-tail', secondaryText: 's-tail' },
        ]);
      }
    } finally { spy.mockRestore(); }
  });

  it('重複除去・正規化で飛んだ元入力位置を同点競合に使いoffsetと混同しない', () => {
    const spy = vi.spyOn(blockCandidates, 'generateSubtitleCandidates');
    try {
      const primary = [
        timedCue(0, 1, 'p-lead'), timedCue(0, 1, 'p-lead'),
        timedCue(0, 1, 'p-lead2'), timedCue(0, 1, 'p-lead3'),
        timedCue(10, 20, 'p1'), timedCue(10, 20, 'p2'), timedCue(10, 20, 'p3'),
      ];
      const secondary = [
        timedCue(0, 2, 's-lead'), timedCue(0, 2, 's-lead'), timedCue(0, 2, 's-lead2'),
        timedCue(5, 20, 's1'), timedCue(5, 20, 's1'), timedCue(5, 20, 's2'), timedCue(5, 20, 's3'),
        timedCue(10, 25, 's-later1'), timedCue(10, 25, 's-later2'),
      ];
      const blocks = buildSubtitleBlocks(primary, secondary);
      const result = spy.mock.results[0];
      if (result?.type !== 'return') throw new Error('Candidate generation must return');
      const candidates = result.value;
      expect(candidates.map((match) => ({
        primaryOffset: match.primaryOffset, secondaryOffset: match.secondaryOffset,
        primaryInputIndex: match.primaryInputIndex, secondaryInputIndex: match.secondaryInputIndex,
        primaryCount: match.primaryCount, secondaryCount: match.secondaryCount,
      }))).toEqual([
        { primaryOffset: 1, secondaryOffset: 1, primaryInputIndex: 4, secondaryInputIndex: 3, primaryCount: 1, secondaryCount: 1 },
        { primaryOffset: 1, secondaryOffset: 2, primaryInputIndex: 4, secondaryInputIndex: 7, primaryCount: 1, secondaryCount: 1 },
      ]);
      for (const match of candidates) expect(match.score).toBeCloseTo((2 / 3 - 0.60) * 2);
      const selected = selectSubtitleCandidates([...candidates].reverse());
      expect(selected).toHaveLength(1);
      expect(selected[0]).toMatchObject({ primaryOffset: 1, secondaryOffset: 1, primaryInputIndex: 4, secondaryInputIndex: 3 });
      expect(blocks).toEqual([
        { startTime: 0, endTime: 1, primaryText: 'p-lead\np-lead2\np-lead3', secondaryText: null },
        { startTime: 0, endTime: 2, primaryText: null, secondaryText: 's-lead\ns-lead2' },
        { startTime: 10, endTime: 20, primaryText: 'p1\np2\np3', secondaryText: 's1\ns2\ns3' },
        { startTime: 10, endTime: 25, primaryText: null, secondaryText: 's-later1\ns-later2' },
      ]);
    } finally { spy.mockRestore(); }
  });
});
