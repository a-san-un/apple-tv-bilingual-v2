/**
 * ui-state.ts
 *
 * 拡張全体の ON/OFF と字幕 panel の開閉だけを持つ
 * runtime UI state の small store。
 * 保存設定、panel DOM、subtitle truth、session lifecycle は担当しない。
 */
import type {
  DisposeFn,
  UiState,
  UiStateListener,
  UiStateStore,
} from '../shared/types';

/**
 * runtime UI state の初期値を作る。
 *
 * @returns 拡張無効・panel 閉の初期 state。
 */
const createInitialState = (): UiState => ({
  extensionEnabled: false,
  panelOpen: false,
});

/**
 * 呼び出し側からの破壊的変更を避けるために state を複製する。
 *
 * @param state 複製元の runtime UI state。
 * @returns 外部へ返してよい独立した state snapshot。
 */
const cloneState = (state: UiState): UiState => ({ ...state });

/**
 * runtime UI state を保持・通知する small store を作る。
 *
 * @returns UI state の取得、更新、購読解除関数付き購読を提供する store。
 */
export const createUiStateStore = (): UiStateStore => {
  let state = createInitialState();
  const listeners = new Set<UiStateListener>();

  /**
   * 登録済み listener へ最新 state を通知する。
   */
  const notify = (): void => {
    const snapshot = cloneState(state);
    listeners.forEach((listener) => {
      listener(snapshot);
    });
  };

  return {
    /**
     * 現在の runtime UI state を取得する。
     *
     * @returns 呼び出し側が安全に読める state の複製。
     */
    getState(): UiState {
      return cloneState(state);
    },

    /**
     * 拡張全体の ON/OFF state を更新する。
     *
     * @param enabled true のとき拡張を有効、false のとき無効として扱う。
     */
    setExtensionEnabled(enabled: boolean): void {
      if (state.extensionEnabled === enabled) {
        return;
      }

      state = {
        ...state,
        extensionEnabled: enabled,
      };
      notify();
    },

    /**
     * 字幕 panel の開閉 state を更新する。
     *
     * @param open true のとき panel を開き、false のとき閉じる。
     */
    setPanelOpen(open: boolean): void {
      if (state.panelOpen === open) {
        return;
      }

      state = {
        ...state,
        panelOpen: open,
      };
      notify();
    },

    /**
     * state 更新通知を購読する。
     *
     * @param listener state 更新時に呼ばれる購読 callback。
     * @returns 呼び出し側が保持し、購読を止めるときに実行する unsubscribe 関数。
     */
    subscribe(listener: UiStateListener): DisposeFn {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
};

