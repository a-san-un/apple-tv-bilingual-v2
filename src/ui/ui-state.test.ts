import { describe, expect, it, vi } from 'vitest';

import { createUiStateStore } from './ui-state';

/**
 * ui-state small store の責務境界だけを確認する unit test。
 * DOM、subtitle、session lifecycle の責務はここに持ち込まない。
 */
describe('ui-state', () => {
  it('starts with the default runtime ui state', () => {
    const store = createUiStateStore();

    expect(store.getState()).toEqual({
      extensionEnabled: false,
      panelOpen: false,
    });
  });

  it('updates extension enabled and panel open state', () => {
    const store = createUiStateStore();

    store.setExtensionEnabled(true);
    store.setPanelOpen(true);

    expect(store.getState()).toEqual({
      extensionEnabled: true,
      panelOpen: true,
    });
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const store = createUiStateStore();
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);

    store.setExtensionEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({
      extensionEnabled: true,
      panelOpen: false,
    });

    unsubscribe();
    store.setPanelOpen(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies multiple listeners with the same state snapshot', () => {
    const store = createUiStateStore();
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    store.subscribe(firstListener);
    store.subscribe(secondListener);
    store.setPanelOpen(true);

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(firstListener).toHaveBeenLastCalledWith({
      extensionEnabled: false,
      panelOpen: true,
    });
    expect(secondListener).toHaveBeenLastCalledWith({
      extensionEnabled: false,
      panelOpen: true,
    });
  });

  it('keeps state update order predictable across notifications', () => {
    const store = createUiStateStore();
    const receivedStates: Array<ReturnType<typeof store.getState>> = [];

    store.subscribe((state) => {
      receivedStates.push(state);
    });

    store.setExtensionEnabled(true);
    store.setPanelOpen(true);

    expect(receivedStates).toEqual([
      {
        extensionEnabled: true,
        panelOpen: false,
      },
      {
        extensionEnabled: true,
        panelOpen: true,
      },
    ]);
  });

  it('keeps internal state safe from external snapshot mutation', () => {
    const store = createUiStateStore();
    const snapshot = store.getState();

    snapshot.extensionEnabled = true;
    snapshot.panelOpen = true;

    expect(store.getState()).toEqual({
      extensionEnabled: false,
      panelOpen: false,
    });
  });
});
