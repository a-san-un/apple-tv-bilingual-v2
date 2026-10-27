/**
 * subtitle-block-builder.test.ts
 *
 * 最小4ケース、コピー境界、track 非参照、開発途中の入力ガードを確認する。
 * source や DOM を生成せず、純関数の契約だけを検証する。
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SubtitleBlock, SubtitleCueSnapshot } from '../shared/types';
import { buildSubtitleBlocks } from './subtitle-block-builder';

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

describe('buildSubtitleBlocks の最小契約', () => {
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
    ['primary 複数', [cue(), cue()], []],
    ['secondary 複数', [cue()], [cue(), cue()]],
    ['開始時刻不一致', [cue()], [cue({ startTime: 1.2 })]],
    ['終了時刻不一致', [cue()], [cue({ endTime: 3 })]],
  ] as const)('%s を RangeError で拒否する', (_label, primary, secondary) => {
    expect(() => buildSubtitleBlocks(primary, secondary)).toThrow(RangeError);
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

  it('母国語だけでも複数 cue はまだ受け付けない', () => {
    expect(() => buildSubtitleBlocks([], [cue(), cue()])).toThrow(RangeError);
  });
});
