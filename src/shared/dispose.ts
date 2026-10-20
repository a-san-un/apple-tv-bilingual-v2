import type { Disposable, DisposeFn } from './types';

/**
 * session cleanup の共通基盤。
 * listener / timer / observer / binding / DOM の owner 自体は各 module に残し、
 * ここでは cleanup の合成、reverse-order cleanup、二重 dispose 防止だけを担う。
 */

const noop: DisposeFn = () => {};

const toDisposeFn = (value: Disposable | DisposeFn): DisposeFn => {
  // module ごとに関数返却と disposable object 返却が混ざっても、ここで同じ形にそろえる。
  if (typeof value === 'function') {
    return value;
  }

  return value.dispose.bind(value);
};

/** 登録対象 1 件分。未登録を表す null / undefined も受け取れるようにする。 */
export type DisposeEntry = Disposable | DisposeFn | null | undefined;

/**
 * session 単位で disposer を束ねる最小 bag。
 * 各 module が返した cleanup を `add()` し、最後に `dispose()` でまとめて解放する。
 */
export type DisposeBag = Disposable & {
  add(entry: DisposeEntry): DisposeFn;
};

/**
 * 複数 disposer を 1 つの `DisposeFn` に合成する。
 *
 * @param entries 合成する cleanup。null / undefined は無視する。
 * @returns 呼び出し側が保持し、session owner など適切な owner が 1 回だけ実行する disposer。
 */
export const composeDisposers = (...entries: DisposeEntry[]): DisposeFn => {
  const bag = createDisposeBag();

  for (const entry of entries) {
    bag.add(entry);
  }

  return bag.dispose;
};

/**
 * reverse-order cleanup と二重 dispose 防止を持つ disposer bag を作る。
 *
 * @returns cleanup を登録する `add()` と、呼び出し側が保持して session owner が実行する `dispose()` を持つ bag。
 */
export const createDisposeBag = (): DisposeBag => {
  const disposers: DisposeFn[] = [];
  let disposed = false;

  const add = (entry: DisposeEntry): DisposeFn => {
    if (!entry) {
      return noop;
    }

    const dispose = toDisposeFn(entry);

    // stop 済み session に後から資源がぶら下がるのを防ぐため、その場で即 cleanup する。
    if (disposed) {
      dispose();
      return noop;
    }

    let called = false;

    const wrapped: DisposeFn = () => {
      // 同じ resource が bag 側と呼び出し側の両方から dispose されても 1 回だけに止める。
      if (called) {
        return;
      }

      called = true;
      dispose();
    };

    disposers.push(wrapped);
    return wrapped;
  };

  const dispose = () => {
    if (disposed) {
      return;
    }

    disposed = true;

    // 後から登録した resource ほど内側の依存を持ちやすいため、登録の逆順で cleanup する。
    while (disposers.length > 0) {
      const current = disposers.pop();
      current?.();
    }
  };

  return {
    add,
    dispose,
  };
};
