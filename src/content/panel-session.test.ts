/* @vitest-environment jsdom */
/**
 * panel-session.test.ts
 *
 * Vitest / jsdom と実際の host・renderer で接続と DOM 解放を確認する。
 * 取得・購読だけを test double にし、解除後の旧 callback も意図的に発火する。
 * 実機の可視性・寸法、lifecycle への接続、GC による回収は検証しない。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelSession } from './panel-session';
import * as panelRenderer from '../panel/panel-renderer';
import type { Disposable, DisposeFn, UiState } from '../shared/types';
import type { SubtitleSessionSnapshot } from '../subtitles/subtitle-session';

const sessions: Disposable[] = [];

/** @returns 各言語の入力がない状態を表す独立した空配列。 */
const emptyTimeline = () => ({ primary: [], secondary: [] });

/** @returns 3区分とも字幕を持たない期待値。 */
const emptyHistory = () => ({ past: emptyTimeline(), current: emptyTimeline(), future: emptyTimeline() });

/** @returns 接続中で字幕を持たない期待値。接続なしのnullとは区別する。 */
const emptySnapshot = () => ({ timeline: emptyTimeline(), history: emptyHistory() });



/**
 * 識別用本文を持つ snapshot を作る。
 * @param text primary 本文。
 * @returns 独立したtimelineとhistoryを持つsnapshot。
 */
const snapshot = (text: string): SubtitleSessionSnapshot => {
  const timeline = { primary: [{ startTime: 0, endTime: 1, text }], secondary: [{ startTime: 0, endTime: 1, text: '訳' }] };
  return { timeline, history: { past: emptyTimeline(), current: timeline, future: emptyTimeline() } };
};

/**
 * 解除後にも旧通知を発火できる購読境界を作る。
 * @param name cleanup 順序の識別名。
 * @param operations cleanup 試行順の記録先。
 * @returns 登録・解除 spy と、残存 callback の発火関数。
 */
const channel = (name: string, operations: string[]) => {
  let callback: (() => void) | null = null;
  /** 解除試行を記録する。旧 callback は残存ケースの検証用に保持する。 */
  const unsubscribe = vi.fn((): void => { operations.push(name); });
  /**
   * 更新 callback を保持する。
   * @param listener 発火時に呼ぶ callback。
   * @returns 接続側が保持・実行する解除関数。
   */
  const subscribe = vi.fn((listener: () => void): DisposeFn => {
    callback = listener;
    return unsubscribe;
  });
  return {
    subscribe, unsubscribe,
    /** 解除成功後の残存通知も含め、保持中の callback を発火する。 */
    fire(): void { callback?.(); },
  };
};

/**
 * 独立した mount と取得・購読境界を用意する。
 * @returns 入力、spy、DOM 観測先、後処理登録付き生成関数。
 */
const fixture = () => {
  const mount = document.createElement('section');
  document.body.append(mount);
  const operations: string[] = [];
  const subtitles = channel('subtitle', operations);
  const ui = channel('ui', operations);
  /** @returns 表示可能な UI state の独立した値。 */
  const getState = vi.fn((): UiState => ({ extensionEnabled: true, panelOpen: true }));
  /** @returns 初回描画用の字幕 snapshot。 */
  const getSubtitleSnapshot = vi.fn((): SubtitleSessionSnapshot | null => snapshot('first'));
  const options = { mountEl: mount, uiState: { getState, subscribe: ui.subscribe }, getSubtitleSnapshot, subscribeSubtitle: subtitles.subscribe };
  return {
    mount, operations, subtitles, ui, getState, getSubtitleSnapshot, options,
    /**
     * 接続を生成し、テスト後の破棄対象へ登録する。
     * @returns テストが停止操作できる接続。
     * @throws 接続の初期化失敗。
     */
    start(): Disposable {
      const session = createPanelSession(options);
      sessions.push(session);
      return session;
    },
  };
};

/**
 * renderer が生成した表示領域を取得する。
 * @param mount 検索対象の mount。
 * @returns 表示領域。
 * @throws 領域が存在しない場合。
 */
const content = (mount: HTMLElement): HTMLElement => {
  const root = mount.querySelector<HTMLElement>('[data-subtitle-panel]');
  if (root === null) throw new Error('Panel content must exist');
  return root;
};

afterEach(/** 購読と DOM を次のケースへ持ち越さない。 */ () => {
  // 失敗系でも dispose 済み接続は二度目に何もしない契約を利用する。
  for (const session of sessions) session.dispose();
  sessions.length = 0;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('panel-session', /** 接続契約のケースを登録する。 */ () => {
  it('初回・字幕更新を描画し、UI 更新では表示だけを切り替える', /** 最新入力と外部状態の非変更を検証する。 */ () => {
    const f = fixture();
    f.start();
    expect(f.mount.textContent).toBe('first訳');
    expect(content(f.mount).hidden).toBe(false);
    expect(f.subtitles.subscribe).toHaveBeenCalledTimes(1);
    expect(f.ui.subscribe).toHaveBeenCalledTimes(1);
    f.getSubtitleSnapshot.mockReturnValue(snapshot('second'));
    f.subtitles.fire();
    expect(f.mount.textContent).toBe('second訳');
    f.getState.mockReturnValue({ extensionEnabled: true, panelOpen: false });
    f.ui.fire();
    expect(content(f.mount).hidden).toBe(true);
    expect(f.subtitles.unsubscribe).not.toHaveBeenCalled();
    f.getState.mockReturnValue({ extensionEnabled: false, panelOpen: true });
    f.ui.fire();
    expect(content(f.mount).hidden).toBe(true);
    f.getState.mockReturnValue({ extensionEnabled: true, panelOpen: true });
    f.ui.fire();
    expect(content(f.mount).hidden).toBe(false);
    expect(f.mount.querySelectorAll('#atv-panel-host')).toHaveLength(1);
  });

  it('null・空 history・current なしの future を扱う', /** 未取得字幕を補完しないことを確認する。 */ () => {
    const f = fixture();
    f.getSubtitleSnapshot.mockReturnValue(null);
    f.start();
    expect(f.mount.textContent).toBe('表示できる字幕はありません');
    f.getSubtitleSnapshot.mockReturnValue(emptySnapshot());
    f.subtitles.fire();
    expect(f.mount.textContent).toBe('表示できる字幕はありません');
    const next = snapshot('future');
    next.history = { past: emptyTimeline(), current: emptyTimeline(), future: next.timeline };
    const before = JSON.stringify(next);
    f.getSubtitleSnapshot.mockReturnValue(next);
    f.subtitles.fire();
    expect(f.mount.textContent).toBe('future訳');
    expect(f.mount.querySelector('[aria-current]')).toBeNull();
    expect(JSON.stringify(next)).toBe(before);
  });

  it('購読を逆順で解除して DOM を一度だけ外し、旧通知を無効化する', /** 解除順序と停止後の非干渉を検証する。 */ () => {
    const f = fixture();
    const session = f.start();
    const root = content(f.mount);
    const host = f.mount.querySelector<HTMLElement>('#atv-panel-host')!;
    const removeRoot = root.remove.bind(root);
    const removeHost = host.remove.bind(host);
    vi.spyOn(root, 'remove').mockImplementation(/** 描画領域の実除去と順序を記録する。 */ () => { f.operations.push('renderer'); removeRoot(); });
    vi.spyOn(host, 'remove').mockImplementation(/** host の実除去と順序を記録する。 */ () => { f.operations.push('host'); removeHost(); });
    session.dispose();
    session.dispose();
    expect(f.operations).toEqual(['ui', 'subtitle', 'renderer', 'host']);
    expect(f.mount.children).toHaveLength(0);
    f.getSubtitleSnapshot.mockClear();
    f.getState.mockClear();
    f.ui.fire();
    f.subtitles.fire();
    expect(f.getSubtitleSnapshot).not.toHaveBeenCalled();
    expect(f.getState).not.toHaveBeenCalled();
    expect(f.mount.children).toHaveLength(0);
  });

  it.each(['subtitle', 'ui', 'snapshot'] as const)('%s の初期化失敗で生成済み資源を解放する',
    /**
     * 各登録段階と初回取得での失敗を確認する。
     * @param stage 失敗させる境界。
     */
    (stage) => {
      const f = fixture();
      const error = new Error(stage);
      /** 初期化失敗を再現する。@throws テスト用の元エラー。 */
      const fail = (): never => { throw error; };
      if (stage === 'subtitle') f.subtitles.subscribe.mockImplementationOnce(fail);
      if (stage === 'ui') f.ui.subscribe.mockImplementationOnce(fail);
      if (stage === 'snapshot') f.getSubtitleSnapshot.mockImplementationOnce(fail);
      expect(/** 初期化エラーを観測する。@returns 作成された接続。@throws 元エラー。 */ () => f.start()).toThrow(error);
      expect(f.mount.children).toHaveLength(0);
      expect(f.subtitles.unsubscribe).toHaveBeenCalledTimes(stage === 'subtitle' ? 0 : 1);
      expect(f.ui.unsubscribe).toHaveBeenCalledTimes(stage === 'snapshot' ? 1 : 0);
      f.getSubtitleSnapshot.mockClear();
      f.subtitles.fire();
      f.ui.fire();
      expect(f.getSubtitleSnapshot).not.toHaveBeenCalled();
    },
  );

  it('解除失敗でも残りの解除と DOM 除去を続ける', /** 解除試行と成功を区別して検証する。 */ () => {
    const f = fixture();
    const session = f.start();
    f.ui.unsubscribe.mockImplementation(/** UI 購読解除の失敗を再現する。@throws 解除エラー。 */ () => { f.operations.push('ui-failed'); throw new Error('unsubscribe'); });
    expect(/** cleanup を実行する。@throws 全件試行後の AggregateError。 */ () => session.dispose()).toThrow(AggregateError);
    expect(f.operations).toEqual(['ui-failed', 'subtitle']);
    expect(f.mount.children).toHaveLength(0);
    f.getSubtitleSnapshot.mockClear();
    f.ui.fire();
    f.subtitles.fire();
    expect(f.getSubtitleSnapshot).not.toHaveBeenCalled();
    expect(/** 二度目の cleanup を確認する。 */ () => session.dispose()).not.toThrow();
    expect(f.ui.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('初期化失敗と cleanup 失敗の両原因を保持する', /** AggregateError の中身を捕捉境界の外で確認する。 */ () => {
    const f = fixture();
    const initial = new Error('initial');
    const cleanup = new Error('cleanup');
    f.getSubtitleSnapshot.mockImplementationOnce(/** 初回取得に失敗する。@throws 初期化エラー。 */ () => { throw initial; });
    f.subtitles.unsubscribe.mockImplementation(/** 解除に失敗する。@throws cleanup エラー。 */ () => { throw cleanup; });
    let caught: unknown;
    try { f.start(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError);
    const errors = (caught as AggregateError).errors as unknown[];
    expect(errors[0]).toBe(initial);
    expect(errors[1]).toBeInstanceOf(AggregateError);
    expect((errors[1] as AggregateError).errors).toContain(cleanup);
    expect(f.ui.unsubscribe).toHaveBeenCalledTimes(1);
    expect(f.mount.children).toHaveLength(0);
  });

  it('通知中の取得失敗を記録し、次の更新で復帰する', /** 通知元への例外伝播を防ぐ契約を確認する。 */ () => {
    const f = fixture();
    f.start();
    const log = vi.spyOn(console, 'error').mockImplementation(/** 期待される失敗ログを観測する。 */ () => {});
    const error = new Error('read');
    f.getSubtitleSnapshot.mockImplementationOnce(/** 更新時の読取失敗を再現する。@throws 取得エラー。 */ () => { throw error; });
    expect(/** 更新通知を発火する。 */ () => f.subtitles.fire()).not.toThrow();
    expect(log).toHaveBeenCalledWith('[atv-bilingual:panel] panel update failed', error);
    expect(f.mount.textContent).toBe('first訳');
    f.getSubtitleSnapshot.mockReturnValue(snapshot('recovered'));
    f.subtitles.fire();
    expect(f.mount.textContent).toBe('recovered訳');
  });

  it('snapshot 取得中の再入で古い結果を描画しない', /** 内側の新しい表示が外側に上書きされないことを確認する。 */ () => {
    const f = fixture();
    f.start();
    f.getSubtitleSnapshot.mockReturnValue(snapshot('new'));
    f.getSubtitleSnapshot.mockImplementationOnce(/** 新しい更新を再入させる。@returns 外側の古い snapshot。 */ () => { f.subtitles.fire(); return snapshot('old'); });
    f.subtitles.fire();
    expect(f.mount.textContent).toBe('new訳');
  });

  it('UI state 取得中の再入でも古い結果を描画しない', /** 両取得境界で revision を確認する契約を検証する。 */ () => {
    const f = fixture();
    f.start();
    f.getState.mockReturnValue({ extensionEnabled: true, panelOpen: false });
    f.getState.mockImplementationOnce(/** 新しい UI 更新を再入させる。@returns 外側の古い UI state。 */ () => { f.ui.fire(); return { extensionEnabled: true, panelOpen: true }; });
    f.ui.fire();
    expect(content(f.mount).hidden).toBe(true);
  });

  it('取得中に dispose されても旧 DOM を再生成しない', /** 取得途中の停止後に描画を継続しないことを確認する。 */ () => {
    const f = fixture();
    const session = f.start();
    f.getSubtitleSnapshot.mockImplementationOnce(/** 接続を停止する。@returns 停止前に取得した想定の snapshot。 */ () => { session.dispose(); return snapshot('late'); });
    f.subtitles.fire();
    expect(f.mount.children).toHaveLength(0);
  });

  it('旧接続の cleanup と通知が新接続に干渉しない', /** 同じ mount 先への再接続を確認する。 */ () => {
    const first = fixture();
    const old = first.start();
    old.dispose();
    const next = fixture();
    next.options.mountEl = first.mount;
    const current = next.start();
    const host = first.mount.querySelector('#atv-panel-host');
    old.dispose();
    first.ui.fire();
    first.subtitles.fire();
    expect(first.mount.querySelector('#atv-panel-host')).toBe(host);
    expect(first.mount.querySelectorAll('#atv-panel-host')).toHaveLength(1);
    current.dispose();
    expect(first.mount.children).toHaveLength(0);
  });
});

/** 初期化時の失敗と、通知時の失敗・復帰を分けて確認する。 */
describe('panel-session の生成・描画失敗', () => {
  it('renderer 生成失敗で host を除去し、購読を開始しない',
    /** 生成済み host の cleanup と元エラーの伝播を確認する。 */
    () => {
      const f = fixture();
      const error = new Error('renderer creation failed');
      vi.spyOn(panelRenderer, 'createPanelRenderer').mockImplementationOnce(
        /** renderer 生成失敗を再現する。@throws テスト用の元エラー。 */
        () => { throw error; },
      );
      expect(
        /** 失敗する初期化を実行する。@returns 作成された接続。@throws 元エラー。 */
        () => f.start(),
      ).toThrow(error);
      expect(f.mount.children).toHaveLength(0);
      expect(f.subtitles.subscribe).not.toHaveBeenCalled();
      expect(f.ui.subscribe).not.toHaveBeenCalled();
      expect(f.getSubtitleSnapshot).not.toHaveBeenCalled();
    },
  );

  it('初回描画失敗で両購読と panel DOM を解放する',
    /** DOM 更新失敗後の解除順と旧通知の無効化を確認する。 */
    () => {
      const f = fixture();
      const error = new Error('initial render failed');
      // 初回描画の置換だけを失敗させ、host / renderer の生成・除去は実処理を使う。
      vi.spyOn(Element.prototype, 'replaceChildren').mockImplementationOnce(
        /** 初回 DOM 更新失敗を再現する。@throws 描画エラー。 */
        () => { throw error; },
      );
      expect(
        /** 失敗する初期化を実行する。@returns 作成された接続。@throws 描画エラー。 */
        () => f.start(),
      ).toThrow(error);
      expect(f.operations).toEqual(['ui', 'subtitle']);
      expect(f.ui.unsubscribe).toHaveBeenCalledTimes(1);
      expect(f.subtitles.unsubscribe).toHaveBeenCalledTimes(1);
      expect(f.mount.children).toHaveLength(0);
      f.getSubtitleSnapshot.mockClear();
      f.getState.mockClear();
      f.ui.fire();
      f.subtitles.fire();
      expect(f.getSubtitleSnapshot).not.toHaveBeenCalled();
      expect(f.getState).not.toHaveBeenCalled();
    },
  );

  it('更新時の描画失敗を記録し、次の更新で復帰する',
    /** 通知例外の分離と既存 DOM の保持・描画復帰を確認する。 */
    () => {
      const f = fixture();
      f.start();
      const root = content(f.mount);
      const error = new Error('update render failed');
      const log = vi.spyOn(console, 'error').mockImplementation(
        /** 期待する描画失敗ログを観測する。 */
        () => {},
      );
      vi.spyOn(root, 'replaceChildren').mockImplementationOnce(
        /** 更新時 DOM 操作の失敗を再現する。@throws 描画エラー。 */
        () => { throw error; },
      );
      f.getSubtitleSnapshot.mockReturnValue(snapshot('recovered'));
      expect(/** 字幕更新を発火する。 */ () => f.subtitles.fire()).not.toThrow();
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith('[atv-bilingual:panel] panel update failed', error);
      expect(f.mount.textContent).toBe('first訳');
      expect(f.subtitles.unsubscribe).not.toHaveBeenCalled();
      f.subtitles.fire();
      expect(f.mount.textContent).toBe('recovered訳');
      expect(content(f.mount)).toBe(root);
      expect(log).toHaveBeenCalledTimes(1);
    },
  );

  it('初回 UI state 取得失敗で両購読と panel DOM を解放する',
    /** snapshot 取得後の失敗でも初期化を中断して全資源を解放する。 */
    () => {
      const f = fixture();
      const error = new Error('initial UI read failed');
      f.getState.mockImplementationOnce(
        /** 初回 UI state 読取失敗を再現する。@throws 取得エラー。 */
        () => { throw error; },
      );
      expect(
        /** 初期化失敗を観測する。@returns 作成された接続。@throws 取得エラー。 */
        () => f.start(),
      ).toThrow(error);
      expect(f.getSubtitleSnapshot).toHaveBeenCalledTimes(1);
      expect(f.operations).toEqual(['ui', 'subtitle']);
      expect(f.ui.unsubscribe).toHaveBeenCalledTimes(1);
      expect(f.subtitles.unsubscribe).toHaveBeenCalledTimes(1);
      expect(f.mount.children).toHaveLength(0);
      f.getSubtitleSnapshot.mockClear();
      f.getState.mockClear();
      f.ui.fire();
      f.subtitles.fire();
      expect(f.getSubtitleSnapshot).not.toHaveBeenCalled();
      expect(f.getState).not.toHaveBeenCalled();
    },
  );

  it('更新時 UI state 取得失敗を記録し、次の更新で復帰する',
    /** UI 通知元への例外伝播を防ぎ、表示更新が再開できることを確認する。 */
    () => {
      const f = fixture();
      f.start();
      const error = new Error('update UI read failed');
      const log = vi.spyOn(console, 'error').mockImplementation(
        /** 期待する UI state 読取失敗ログを観測する。 */
        () => {},
      );
      f.getState.mockImplementationOnce(
        /** 更新時の UI state 読取失敗を再現する。@throws 取得エラー。 */
        () => { throw error; },
      );
      expect(/** UI 更新を発火する。 */ () => f.ui.fire()).not.toThrow();
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith('[atv-bilingual:panel] panel update failed', error);
      expect(content(f.mount).hidden).toBe(false);
      expect(f.ui.unsubscribe).not.toHaveBeenCalled();
      f.getState.mockReturnValue({ extensionEnabled: true, panelOpen: false });
      f.ui.fire();
      expect(content(f.mount).hidden).toBe(true);
      expect(log).toHaveBeenCalledTimes(1);
    },
  );
});

/** 個別解除の失敗を、試行順・実際の DOM 状態・停止後通知に分けて確認する。 */
describe('panel-session の個別 cleanup 失敗',
  /** 個別資源の解除失敗ケースを登録する。 */
  () => {
    it.each(['subtitle', 'renderer', 'host'] as const)(
      '%s の解除失敗後も全件を試し、旧通知を無効化する',
      /**
       * 解除試行と成功を区別し、失敗後の再操作を防ぐ契約を確認する。
       * @param stage 解除を失敗させる資源。
       */
      (stage) => {
        const f = fixture();
        const session = f.start();
        const root = content(f.mount);
        const host = f.mount.querySelector<HTMLElement>('#atv-panel-host')!;
        const removeRoot = root.remove.bind(root);
        const removeHost = host.remove.bind(host);
        const error = new Error(`${stage} cleanup failed`);

        f.subtitles.unsubscribe.mockImplementation(
          /** 字幕購読解除の試行を記録する。@throws subtitle ケースでは解除エラー。 */
          () => {
            f.operations.push('subtitle');
            if (stage === 'subtitle') throw error;
          },
        );
        const rendererRemove = vi.spyOn(root, 'remove').mockImplementation(
          /** 描画領域の除去を試す。@throws renderer ケースでは除去エラー。 */
          () => {
            f.operations.push('renderer');
            if (stage === 'renderer') throw error;
            removeRoot();
          },
        );
        const hostRemove = vi.spyOn(host, 'remove').mockImplementation(
          /** host の除去を試す。@throws host ケースでは除去エラー。 */
          () => {
            f.operations.push('host');
            if (stage === 'host') throw error;
            removeHost();
          },
        );

        // 例外捕捉境界の内側で assertion を行わず、元エラーを外側で検証する。
        let caught: unknown;
        try { session.dispose(); } catch (cleanupError) { caught = cleanupError; }
        expect(caught).toBeInstanceOf(AggregateError);
        expect((caught as AggregateError).errors).toEqual([error]);
        expect(f.operations).toEqual(['ui', 'subtitle', 'renderer', 'host']);
        expect(f.ui.unsubscribe).toHaveBeenCalledTimes(1);
        expect(f.subtitles.unsubscribe).toHaveBeenCalledTimes(1);
        expect(rendererRemove).toHaveBeenCalledTimes(1);
        expect(hostRemove).toHaveBeenCalledTimes(1);

        // 親ごと外れたことと、描画領域自身の remove 成功を区別する。
        expect(root.parentElement).toBe(stage === 'renderer' ? host : null);
        expect(root.isConnected).toBe(false);
        expect(host.parentElement).toBe(stage === 'host' ? f.mount : null);
        expect(host.isConnected).toBe(stage === 'host');
        expect(f.mount.querySelector('#atv-panel-host')).toBe(stage === 'host' ? host : null);

        const oldMarkup = root.innerHTML;
        const remainingMarkup = f.mount.innerHTML;
        f.getSubtitleSnapshot.mockReturnValue(snapshot('must not render'));
        f.getSubtitleSnapshot.mockClear();
        f.getState.mockClear();
        f.subtitles.fire();
        f.ui.fire();
        expect(f.getSubtitleSnapshot).not.toHaveBeenCalled();
        expect(f.getState).not.toHaveBeenCalled();
        expect(root.innerHTML).toBe(oldMarkup);
        expect(f.mount.innerHTML).toBe(remainingMarkup);

        expect(/** 二度目は解除を再試行しない。 */ () => session.dispose()).not.toThrow();
        expect(f.operations).toEqual(['ui', 'subtitle', 'renderer', 'host']);
        expect(f.ui.unsubscribe).toHaveBeenCalledTimes(1);
        expect(f.subtitles.unsubscribe).toHaveBeenCalledTimes(1);
        expect(rendererRemove).toHaveBeenCalledTimes(1);
        expect(hostRemove).toHaveBeenCalledTimes(1);
      },
    );
  },
);

/** 同期 callback と cleanup の再入が、旧接続や新接続を壊さないことを確認する。 */
describe('panel-session の同期通知と cleanup 再入',
  /** 同期実行・再入のケースを登録する。 */
  () => {
    it.each(['subtitle', 'ui'] as const)(
      '%s 購読登録中の同期通知後も、最後に最新入力を表示する',
      /**
       * 同期通知の描画と、その後の初回最新値取得を確認する。
       * @param stage 登録中に通知を発生させる境界。
       */
      (stage) => {
        const f = fixture();
        const target = stage === 'subtitle' ? f.subtitles : f.ui;
        const register = target.subscribe.getMockImplementation()!;
        f.getSubtitleSnapshot.mockReturnValue(snapshot('during'));
        f.getState.mockReturnValue({ extensionEnabled: true, panelOpen: false });
        let duringText: string | null = null;
        let duringHidden: boolean | undefined;
        target.subscribe.mockImplementationOnce(
          /**
           * 登録完了前に同期通知し、その後で入力を変更する。
           * @param listener 接続の更新 callback。
           * @returns 接続側が保持する解除関数。
           */
          (listener) => {
            const unsubscribe = register(listener);
            listener();
            // 通知中は観測だけ行い、assertion は初期化の捕捉境界の外へ置く。
            duringText = f.mount.textContent;
            duringHidden = content(f.mount).hidden;
            f.getSubtitleSnapshot.mockReturnValue(snapshot('latest'));
            f.getState.mockReturnValue({ extensionEnabled: true, panelOpen: true });
            return unsubscribe;
          },
        );
        f.start();
        expect(duringText).toBe('during訳');
        expect(duringHidden).toBe(true);
        expect(f.mount.textContent).toBe('latest訳');
        expect(content(f.mount).hidden).toBe(false);
        expect(f.getSubtitleSnapshot).toHaveBeenCalledTimes(2);
        expect(f.getState).toHaveBeenCalledTimes(2);
        expect(f.subtitles.subscribe).toHaveBeenCalledTimes(1);
        expect(f.ui.subscribe).toHaveBeenCalledTimes(1);
        expect(f.mount.querySelectorAll('#atv-panel-host')).toHaveLength(1);
      },
    );

    it('UI state 取得中の dispose 後は描画と後続取得を行わない',
      /** UI state の取得後にも接続の有効性を確認する契約を検証する。 */
      () => {
        const f = fixture();
        const session = f.start();
        const root = content(f.mount);
        const before = root.innerHTML;
        const replace = vi.spyOn(root, 'replaceChildren');
        f.getSubtitleSnapshot.mockReturnValue(snapshot('late'));
        f.getState.mockImplementationOnce(
          /** 取得途中で接続を停止する。@returns 停止前の表示意思を想定した値。 */
          () => { session.dispose(); return { extensionEnabled: true, panelOpen: true }; },
        );
        f.ui.fire();
        expect(replace).not.toHaveBeenCalled();
        expect(root.innerHTML).toBe(before);
        expect(f.mount.children).toHaveLength(0);
        expect(f.ui.unsubscribe).toHaveBeenCalledTimes(1);
        expect(f.subtitles.unsubscribe).toHaveBeenCalledTimes(1);
        f.getSubtitleSnapshot.mockClear();
        f.getState.mockClear();
        f.ui.fire();
        f.subtitles.fire();
        expect(f.getSubtitleSnapshot).not.toHaveBeenCalled();
        expect(f.getState).not.toHaveBeenCalled();
      },
    );

    it.each(['ui', 'subtitle'] as const)(
      '%s 購読解除中の旧通知と再 dispose を無効化する',
      /**
       * 個別解除の実行前に、接続を無効化していることを確認する。
       * @param stage 再入を発生させる解除境界。
       */
      (stage) => {
        const f = fixture();
        const session = f.start();
        const root = content(f.mount);
        const replace = vi.spyOn(root, 'replaceChildren');
        const target = stage === 'ui' ? f.ui : f.subtitles;
        target.unsubscribe.mockImplementation(
          /** 解除中に両方の旧通知と再停止を発生させる。 */
          () => {
            f.operations.push(stage);
            f.ui.fire();
            f.subtitles.fire();
            session.dispose();
          },
        );
        f.getSubtitleSnapshot.mockClear();
        f.getState.mockClear();
        session.dispose();
        expect(f.operations).toEqual(['ui', 'subtitle']);
        expect(f.ui.unsubscribe).toHaveBeenCalledTimes(1);
        expect(f.subtitles.unsubscribe).toHaveBeenCalledTimes(1);
        expect(f.getSubtitleSnapshot).not.toHaveBeenCalled();
        expect(f.getState).not.toHaveBeenCalled();
        expect(replace).not.toHaveBeenCalled();
        expect(f.mount.children).toHaveLength(0);
      },
    );

    it('旧 host 除去中に作った新接続を旧 cleanup が破棄しない',
      /** 同一 ID の旧 host を外した後に限り、新接続を再入生成する。 */
      () => {
        const first = fixture();
        const old = first.start();
        const oldHost = first.mount.querySelector<HTMLElement>('#atv-panel-host')!;
        const removeOldHost = oldHost.remove.bind(oldHost);
        const next = fixture();
        next.options.mountEl = first.mount;
        next.getSubtitleSnapshot.mockReturnValue(snapshot('new connection'));
        let createdHost: Element | null = null;
        const remove = vi.spyOn(oldHost, 'remove').mockImplementation(
          /**
           * 旧 host の実除去後、同じ mount に新接続を生成する。
           * @throws 新接続の初期化失敗。
           */
          () => {
            removeOldHost();
            next.start();
            createdHost = first.mount.querySelector('#atv-panel-host');
          },
        );
        old.dispose();
        expect(remove).toHaveReturnedTimes(1);
        expect(createdHost).not.toBeNull();
        expect(createdHost).not.toBe(oldHost);
        expect(oldHost.isConnected).toBe(false);
        expect(first.mount.querySelector('#atv-panel-host')).toBe(createdHost);
        old.dispose();
        first.ui.fire();
        first.subtitles.fire();
        expect(first.mount.textContent).toBe('new connection訳');
        expect(first.mount.querySelectorAll('#atv-panel-host')).toHaveLength(1);
        expect(next.ui.unsubscribe).not.toHaveBeenCalled();
        expect(next.subtitles.unsubscribe).not.toHaveBeenCalled();
        next.getSubtitleSnapshot.mockReturnValue(snapshot('updated new'));
        next.subtitles.fire();
        expect(first.mount.textContent).toBe('updated new訳');
      },
    );
  },
);
