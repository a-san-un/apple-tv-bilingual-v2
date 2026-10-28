/* @vitest-environment jsdom */
/** panel host の所有・重複防止・解放を確認する。実画面の可視性は対象外。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountPanelHost } from './panel-host';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('panel-host', () => {
  it('指定先に空の host を追加し、既存 DOM を保持する', () => {
    const mount = document.createElement('section');
    const existing = document.createElement('p');
    mount.append(existing);
    document.body.append(mount);
    const host = mountPanelHost(mount);
    expect(host.element?.id).toBe('atv-panel-host');
    expect(host.element?.parentElement).toBe(mount);
    expect(host.element?.childNodes.length).toBe(0);
    expect(mount.firstChild).toBe(existing);
    host.dispose();
    expect(host.element).toBeNull();
    expect(mount.childNodes.length).toBe(1);
    expect(mount.firstChild).toBe(existing);
  });

  it('同じ document の別の mount 先でも重複を拒否する', () => {
    const firstMount = document.createElement('div');
    const secondMount = document.createElement('div');
    document.body.append(firstMount, secondMount);
    const first = mountPanelHost(firstMount);
    const element = first.element;
    expect(() => mountPanelHost(secondMount)).toThrow('Panel host already exists');
    expect(first.element).toBe(element);
    expect(element?.parentElement).toBe(firstMount);
    expect(secondMount.childNodes.length).toBe(0);
    expect(document.querySelectorAll('#atv-panel-host')).toHaveLength(1);
    first.dispose();
  });

  it('未接続の mount 先でも配下の重複を拒否する', () => {
    const mount = document.createElement('div');
    const first = mountPanelHost(mount);
    expect(() => mountPanelHost(mount)).toThrow('Panel host already exists');
    expect(mount.querySelectorAll('#atv-panel-host')).toHaveLength(1);
    first.dispose();
  });

  it('mount 先自体が host ID の場合も既存要素に触れない', () => {
    const mount = document.createElement('div');
    mount.id = 'atv-panel-host';
    expect(() => mountPanelHost(mount)).toThrow('Panel host already exists');
    expect(mount.childNodes.length).toBe(0);
    expect(mount.id).toBe('atv-panel-host');
  });

  it('mount 先の ownerDocument で要素を生成する', () => {
    const doc = document.implementation.createHTMLDocument();
    const host = mountPanelHost(doc.body);
    expect(host.element?.ownerDocument).toBe(doc);
    expect(doc.getElementById('atv-panel-host')).toBe(host.element);
    host.dispose();
    expect(doc.getElementById('atv-panel-host')).toBeNull();
  });

  it('親から先に外されても一度だけ除去を試す', () => {
    const mount = document.createElement('div');
    const host = mountPanelHost(mount);
    const element = host.element!;
    mount.replaceChildren();
    const remove = vi.spyOn(element, 'remove');
    host.dispose();
    host.dispose();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(host.element).toBeNull();
    expect(element.parentNode).toBeNull();
  });

  it('旧 host の再 dispose が新 host を除去しない', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const oldHost = mountPanelHost(mount);
    const oldElement = oldHost.element;
    oldHost.dispose();
    const newHost = mountPanelHost(mount);
    oldHost.dispose();
    expect(oldHost.element).toBeNull();
    expect(newHost.element).not.toBe(oldElement);
    expect(newHost.element?.parentElement).toBe(mount);
    expect(mount.querySelectorAll('#atv-panel-host')).toHaveLength(1);
    newHost.dispose();
  });

  it('除去失敗でも内部参照を解放し、成功とは扱わず再試行しない', () => {
    const mount = document.createElement('div');
    const host = mountPanelHost(mount);
    const element = host.element!;
    const error = new Error('remove failed');
    const remove = vi.spyOn(element, 'remove').mockImplementation(() => {
      throw error;
    });
    expect(() => host.dispose()).toThrow(error);
    expect(host.element).toBeNull();
    expect(element.parentElement).toBe(mount);
    expect(() => host.dispose()).not.toThrow();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('mount 失敗を呼出元へ伝え、既存 DOM を保持する', () => {
    const mount = document.createElement('div');
    const existing = document.createElement('p');
    mount.append(existing);
    const error = new Error('mount failed');
    vi.spyOn(mount, 'appendChild').mockImplementation(() => {
      throw error;
    });
    expect(() => mountPanelHost(mount)).toThrow(error);
    expect(mount.childNodes.length).toBe(1);
    expect(mount.firstChild).toBe(existing);
    expect(mount.querySelector('#atv-panel-host')).toBeNull();
  });
});
