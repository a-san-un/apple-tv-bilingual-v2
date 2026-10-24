/**
 * session cleanup の共通基盤。
 * listener / timer / observer / binding / DOM の owner 自体は各 module に残し、
 * ここでは cleanup の合成、reverse-order cleanup、二重 dispose 防止だけを担う。
 *
 * bag の dispose は、途中で失敗しても残りの cleanup をすべて試す。
 * 失敗があれば最後に AggregateError として報告し、呼び出し側が記録・処理する。
 */
import type { Disposable, DisposeFn } from './types';

/** 未登録の entry や、dispose 済み bag への追加後に返す no-op disposer。 */
const noop: DisposeFn = () => { };

/**
 * cleanup 関数と disposable object を、同じ関数形式にそろえる。
 *
 * @param value cleanup 関数、または dispose method を持つ object。
 * @returns 実行可能な cleanup 関数。object の場合は this を元の object に固定する。
 */
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
 * 各 module が返した cleanup を add() し、最後に dispose() でまとめて解放する。
 * dispose() は全件を試し、失敗があれば AggregateError を投げる。
 */
export type DisposeBag = Disposable & {
  add(entry: DisposeEntry): DisposeFn;
};

/**
 * 複数 disposer を 1 つの DisposeFn に合成する。
 * 作成時には cleanup を実行せず、返した disposer の実行時に逆順で処理する。
 *
 * @param entries 合成する cleanup。null / undefined は無視する。
 * @returns 呼び出し側が保持し、session owner など適切な owner が実行する disposer。
 *   2 回目以降は何もしない。cleanup が失敗した場合は、残りも試してから
 *   AggregateError を投げる。
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
 * resource を実際に解除する責務は、登録された各 cleanup が持つ。
 *
 * @returns cleanup を登録する add() と、呼び出し側の owner が実行する dispose() を持つ bag。
 *   dispose() は全件を試し、失敗があれば AggregateError を投げる。
 */
export const createDisposeBag = (): DisposeBag => {
  const disposers: DisposeFn[] = [];
  let disposed = false;

  /**
   * cleanup を登録し、個別に解除できる一度化済みの disposer を返す。
   * dispose 済み bag へ追加した場合は、その場で cleanup を実行する。
   *
   * @param entry 登録する cleanup。null / undefined は無視する。
   * @returns 呼び出し側が保持して実行できる disposer。
   *   未登録または即時 cleanup 済みの場合は no-op。
   *   登録した cleanup が失敗した場合も、自動で再実行はしない。
   * @throws dispose 済み bag への追加時に即時 cleanup が失敗した場合、その例外をそのまま返す。
   */
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

    /**
     * 登録した cleanup を一度だけ試す。
     * 失敗時も呼出済みとして扱い、bag 側との二重実行を防ぐ。
     *
     * @throws 登録した cleanup が失敗した場合、その例外をそのまま返す。
     */
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

  /**
   * 登録の逆順で、すべての cleanup を一度ずつ試す。
   * 途中の失敗で残りの resource を取り残さないよう、例外は最後にまとめて報告する。
   *
   * @throws {AggregateError} 1 件以上の cleanup が失敗した場合。残りの cleanup は試行済み。
   */
  const dispose = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;
    const errors: unknown[] = [];

    // 後から登録した resource ほど内側の依存を持ちやすいため、登録の逆順で cleanup する。
    while (disposers.length > 0) {
      const current = disposers.pop();

      try {
        current?.();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, 'One or more cleanup operations failed');
    }
  };

  return {
    add,
    dispose,
  };
};
