/**
 * `src/shared/dispose.ts` の unit test。
 * reverse-order cleanup、二重 dispose 防止、dispose 済み bag への追加時の即時 cleanup、
 * cleanup 失敗時の継続実行と AggregateError による失敗報告を確認する。
 */

import { describe, expect, it, vi } from 'vitest';

import { composeDisposers, createDisposeBag } from './dispose';

describe('createDisposeBag', () => {
  it('登録した disposer を逆順で cleanup する', () => {
    const bag = createDisposeBag();
    const calls: string[] = [];

    bag.add(() => {
      calls.push('first');
    });
    bag.add(() => {
      calls.push('second');
    });
    bag.add(() => {
      calls.push('third');
    });

    bag.dispose();

    expect(calls).toEqual(['third', 'second', 'first']);
  });

  it('bag 自体の二重 dispose を防ぐ', () => {
    const bag = createDisposeBag();
    const disposer = vi.fn();

    bag.add(disposer);

    bag.dispose();
    bag.dispose();

    expect(disposer).toHaveBeenCalledTimes(1);
  });

  it('返された disposer と bag 側の両方から呼ばれても 1 回だけ実行する', () => {
    const bag = createDisposeBag();
    const disposer = vi.fn();

    const registered = bag.add(disposer);

    // bag 側でまとめて dispose しても、個別に保持した disposer は二重実行しない。
    registered();
    bag.dispose();
    registered();

    expect(disposer).toHaveBeenCalledTimes(1);
  });

  it('dispose 済み bag に add した disposer はその場で cleanup する', () => {
    const bag = createDisposeBag();
    const disposer = vi.fn();

    bag.dispose();
    const returned = bag.add(disposer);
    returned();

    expect(disposer).toHaveBeenCalledTimes(1);
  });

  it('disposable object も登録できる', () => {
    const bag = createDisposeBag();
    const dispose = vi.fn();

    bag.add({ dispose });
    bag.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('cleanup が失敗しても残りを逆順で試し、失敗をまとめて報告する', () => {
    const bag = createDisposeBag();
    const calls: string[] = [];
    const secondError = new Error('second failed');
    const thirdError = new Error('third failed');

    bag.add(() => {
      calls.push('first');
    });
    bag.add(() => {
      calls.push('second');
      throw secondError;
    });
    bag.add(() => {
      calls.push('third');
      throw thirdError;
    });

    let caught: unknown;

    try {
      bag.dispose();
    } catch (error) {
      caught = error;
    }

    // 途中の失敗で止まらず、登録の逆順ですべて試す。
    expect(calls).toEqual(['third', 'second', 'first']);
    expect(caught).toBeInstanceOf(AggregateError);

    if (!(caught instanceof AggregateError)) {
      throw new Error('cleanup failures must be reported as AggregateError');
    }

    // 失敗は、実際に cleanup を試した順序で報告する。
    expect(caught.errors).toEqual([thirdError, secondError]);

    // 失敗したものも含め、同じ cleanup を自動で再実行しない。
    expect(() => bag.dispose()).not.toThrow();
    expect(calls).toEqual(['third', 'second', 'first']);
  });

  it('個別 disposer が失敗しても bag から二重実行せず、残りを解除する', () => {
    const bag = createDisposeBag();
    const failure = new Error('individual cleanup failed');
    const healthy = vi.fn();
    const failing = vi.fn(() => {
      throw failure;
    });

    bag.add(healthy);
    const registered = bag.add(failing);

    expect(registered).toThrow(failure);

    // 個別実行で失敗した cleanup は試行済みなので、bag では残りだけを実行する。
    expect(() => bag.dispose()).not.toThrow();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);

    expect(() => registered()).not.toThrow();
    expect(() => bag.dispose()).not.toThrow();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
  });
});

describe('composeDisposers', () => {
  it('複数 disposer を 1 つに合成し、逆順で cleanup する', () => {
    const calls: string[] = [];

    const dispose = composeDisposers(
      () => {
        calls.push('first');
      },
      null,
      () => {
        calls.push('second');
      },
      undefined,
      () => {
        calls.push('third');
      },
    );

    // optional な cleanup が混ざっても compose 側で吸収できることを確認する。
    dispose();
    dispose();

    expect(calls).toEqual(['third', 'second', 'first']);
  });

  it('cleanup が失敗しても残りを試し、二度目は実行しない', () => {
    const calls: string[] = [];
    const failure = new Error('second failed');

    const dispose = composeDisposers(
      () => {
        calls.push('first');
      },
      () => {
        calls.push('second');
        throw failure;
      },
      () => {
        calls.push('third');
      },
    );

    expect(dispose).toThrow(AggregateError);
    expect(calls).toEqual(['third', 'second', 'first']);

    // 合成した disposer も、失敗後に同じ cleanup を再実行しない。
    expect(() => dispose()).not.toThrow();
    expect(calls).toEqual(['third', 'second', 'first']);
  });
});
