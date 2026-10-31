/* @vitest-environment jsdom */
/** 寸法を固定した追従契約。実ブラウザのスクロール入力判定は別検証。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelFollow, type PanelFollowInput } from './panel-follow';
import type { SubtitleDisplayBlock } from '../shared/types';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
/** @returns 固定寸法のスクロール領域・枠・追従入力。 */
const fixture = () => {
  const scrollEl = document.createElement('div'); const resumeButton = document.createElement('button');
  const blocks: SubtitleDisplayBlock[] = [
    { kind: 'auxiliary', startTime: 1, endTime: 5, primary: [{ sourceIndex: 0, text: 'a' }], secondary: [] },
    { kind: 'dialogue', startTime: 2, endTime: 6, primary: [{ sourceIndex: 1, text: 'b' }], secondary: [] },
  ];
  const rows = blocks.map(() => document.createElement('div')); scrollEl.append(...rows); document.body.append(scrollEl,resumeButton);
  Object.defineProperties(scrollEl, { clientHeight: { value: 100 }, scrollHeight: { value: 1000 } });
  const rect = (top: number, bottom: number) => ({ top,bottom,left:0,right:100,width:100,height:bottom-top,x:0,y:top,toJSON:()=>({}) });
  vi.spyOn(scrollEl,'getBoundingClientRect').mockImplementation(() => rect(0,100));
  rows.forEach((row,i) => vi.spyOn(row,'getBoundingClientRect').mockImplementation(() => rect(200+i*100-scrollEl.scrollTop,240+i*100-scrollEl.scrollTop)));
  const input: PanelFollowInput = { presentation: { generation: 1, display: { status: 'ready', blocks, history: { past: [], current: blocks, future: [] } }, panelOpen:true, extensionEnabled:true }, rendered: { scrollEl,resumeButton,blockElements:rows }, trigger:'initial' };
  return { input,scrollEl,resumeButton,blocks,rows };
};

describe('panel-follow', () => {
  it('現在セリフを補助より優先し、同対象で反復移動せずseekだけ再案内する', () => {
    const f=fixture(); const follow=createPanelFollow();
    try {
      follow.afterRender(f.input); expect(f.scrollEl.scrollTop).toBe(300);
      f.scrollEl.scrollTop=0; follow.afterRender({...f.input,trigger:'time'}); expect(f.scrollEl.scrollTop).toBe(0);
      follow.afterRender({...f.input,trigger:'ui'}); expect(f.scrollEl.scrollTop).toBe(0);
      follow.afterRender({...f.input,trigger:'seek'}); expect(f.scrollEl.scrollTop).toBe(300);
    } finally { follow.dispose(); }
  });
  it.each(['wheel','touchmove'] as const)('%sで停止しseekでも再開せずボタンで再開する', event => {
    const f=fixture(); const follow=createPanelFollow();
    try {
      follow.afterRender(f.input); f.scrollEl.dispatchEvent(new Event(event)); f.scrollEl.scrollTop=40;
      follow.beforeRender(); follow.afterRender({...f.input,trigger:'seek'}); expect(f.scrollEl.scrollTop).toBe(40);
      f.resumeButton.click(); expect(f.scrollEl.scrollTop).toBe(300);
    } finally { follow.dispose(); }
  });
  it('非表示では計測せず手動停止を維持する', () => {
    const f=fixture(); const follow=createPanelFollow();
    try {
      const hidden={...f.input,presentation:{...f.input.presentation,panelOpen:false}};
      follow.afterRender(hidden); expect(f.rows[1]!.getBoundingClientRect).not.toHaveBeenCalled();
      f.scrollEl.dispatchEvent(new Event('wheel')); follow.afterRender(f.input); expect(f.scrollEl.scrollTop).toBe(0);
      f.resumeButton.click(); expect(f.scrollEl.scrollTop).toBe(300);
    } finally { follow.dispose(); }
  });
  it('不正時刻と利用不能では案内せず終了後のボタンも無効', () => {
    const f=fixture(); const follow=createPanelFollow();
    follow.afterRender({...f.input,presentation:{...f.input.presentation,display:{status:'invalid-time',blocks:f.blocks}}});
    expect(f.scrollEl.scrollTop).toBe(0);
    follow.afterRender(null); f.resumeButton.click(); expect(f.scrollEl.scrollTop).toBe(0);
    follow.afterRender(f.input); follow.dispose(); f.scrollEl.scrollTop=0; f.resumeButton.click();
    follow.afterRender(f.input); expect(f.scrollEl.scrollTop).toBe(0); follow.dispose();
  });
  it('現在なしでは最も直近に終了した過去、過去なしでは最初の未来を選ぶ', () => {
    const f=fixture(); const follow=createPanelFollow();
    try {
      const display=f.input.presentation.display; if(display?.status!=='ready') throw new Error('Expected ready');
      follow.afterRender({...f.input,presentation:{...f.input.presentation,display:{...display,history:{past:f.blocks,current:[],future:[]}}}});
      expect(f.scrollEl.scrollTop).toBe(300);
      follow.afterRender({...f.input,presentation:{...f.input.presentation,display:{...display,history:{past:[],current:[],future:f.blocks}}}});
      expect(f.scrollEl.scrollTop).toBe(200);
    } finally { follow.dispose(); }
  });
});


describe('panel-followの境界とcleanup', () => {
  it('現在が補助だけでも案内し、通常更新では必要最小限だけ移動する', () => {
    const f=fixture(); const follow=createPanelFollow();
    try {
      const display=f.input.presentation.display; if(display?.status!=='ready') throw new Error('Expected ready');
      follow.afterRender({...f.input,trigger:'time',presentation:{...f.input.presentation,display:{...display,history:{past:[],current:[f.blocks[0]!],future:[f.blocks[1]!]}}}});
      expect(f.scrollEl.scrollTop).toBe(101);
      follow.afterRender({...f.input,trigger:'time'}); expect(f.scrollEl.scrollTop).toBe(201);
    } finally { follow.dispose(); }
  });
  it('過去の終了時刻が同じなら一覧順の先頭を選ぶ', () => {
    const f=fixture(); const follow=createPanelFollow();
    try {
      const a={...f.blocks[0]!,endTime:6}; const b={...f.blocks[1]!,endTime:6};
      follow.afterRender({...f.input,presentation:{...f.input.presentation,display:{status:'ready',blocks:[a,b],history:{past:[a,b],current:[],future:[]}}}});
      expect(f.scrollEl.scrollTop).toBe(200);
    } finally { follow.dispose(); }
  });
  it('範囲末尾へ制限された長い対象を時刻更新で再案内しない', () => {
    const f=fixture(); const follow=createPanelFollow();
    try {
      vi.mocked(f.rows[1]!.getBoundingClientRect).mockReturnValue({top:5000,bottom:6000,left:0,right:100,width:100,height:1000,x:0,y:5000,toJSON:()=>({})});
      follow.afterRender(f.input); expect(f.scrollEl.scrollTop).toBe(900);
      f.scrollEl.scrollTop=0; follow.afterRender({...f.input,trigger:'time'}); expect(f.scrollEl.scrollTop).toBe(0);
    } finally { follow.dispose(); }
  });
  it('手動閲覧中の世代変更では旧添字を使わずscrollTopを維持する', () => {
    const f=fixture(); const follow=createPanelFollow();
    try {
      follow.afterRender(f.input); f.scrollEl.dispatchEvent(new Event('wheel')); f.scrollEl.scrollTop=225;
      follow.beforeRender();
      const row=document.createElement('div'); const measure=vi.spyOn(row,'getBoundingClientRect');
      f.scrollEl.replaceChildren(row); f.scrollEl.scrollTop=0;
      follow.afterRender({...f.input,presentation:{...f.input.presentation,generation:2},rendered:{...f.input.rendered,blockElements:[row]}});
      expect(f.scrollEl.scrollTop).toBe(225); expect(measure).not.toHaveBeenCalled();
    } finally { follow.dispose(); }
  });
  it('スクロールイベントや本文クリックだけでは停止せず、キー入力では停止する', () => {
    const f=fixture(); const follow=createPanelFollow();
    try {
      follow.afterRender(f.input); f.scrollEl.scrollTop=0;
      f.scrollEl.dispatchEvent(new Event('scroll')); f.rows[0]!.click();
      follow.afterRender({...f.input,trigger:'seek'}); expect(f.scrollEl.scrollTop).toBe(300);
      f.scrollEl.dispatchEvent(new KeyboardEvent('keydown',{key:'PageDown'})); f.scrollEl.scrollTop=30;
      follow.afterRender({...f.input,trigger:'seek'}); expect(f.scrollEl.scrollTop).toBe(30);
    } finally { follow.dispose(); }
  });
  it('listenerを重複登録せず、解除失敗でも全件を試して旧ボタンを無効化する', () => {
    const f=fixture(); const follow=createPanelFollow();
    const add=vi.spyOn(f.scrollEl,'addEventListener');
    follow.afterRender(f.input); follow.afterRender({...f.input,trigger:'time'}); expect(add).toHaveBeenCalledTimes(4);
    const remove=vi.spyOn(f.scrollEl,'removeEventListener');
    const buttonRemove=vi.spyOn(f.resumeButton,'removeEventListener').mockImplementationOnce(()=>{throw new Error('remove failed');});
    expect(()=>follow.dispose()).toThrow(AggregateError); expect(remove).toHaveBeenCalledTimes(4);
    expect(buttonRemove).toHaveBeenCalledTimes(1); f.scrollEl.scrollTop=0; f.resumeButton.click(); expect(f.scrollEl.scrollTop).toBe(0);
    expect(()=>follow.dispose()).not.toThrow(); expect(remove).toHaveBeenCalledTimes(4);
  });
});
