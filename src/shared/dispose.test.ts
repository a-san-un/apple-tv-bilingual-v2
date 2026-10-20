/**
 * `src/shared/dispose.ts` の unit test。
 * reverse-order cleanup、二重 dispose 防止、dispose 済み bag への追加時の即時 cleanup を確認する。
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
});
