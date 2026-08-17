import { describe, expect, test } from 'bun:test';
import { SnapshotCollector } from '../src/collector.js';
import { normalizeTerminals, normalizeWorktrees, safeCliError } from '../src/normalizer.js';
import { OrcaBridgeProvider } from '../src/provider.js';
import { Reconciler } from '../src/reconciler.js';
import type { Snapshot } from '../src/types.js';

const paneKey = 'tab:leaf';
const raw = { result: { worktrees: [{ worktreeId:'wt', runtimeId:'rt', repoId:'repo', hostId:'host', path:'/safe', branch:'feat/x', prompt:'secret prompt', taskTitle:'secret title', displayName:'secret name', agents:[{ paneKey, agentType:'codex', state:'working', toolName:'mystery_tool', updatedAt:'2026-08-17T10:00:00Z', prompt:'agent secret', toolInput:{ token:'secret input' }, lastAssistantMessage:'secret assistant', preview:'secret preview' }] }] } };
const terminalRaw = { result: { terminals: [{ tabId:'tab', leafId:'leaf', handle:'term', incarnationId:'inc', preview:'secret preview', title:'secret title' }] } };
const snapshot = (state='working', toolName: string | undefined='mystery_tool', terminals=true, updatedAt='2026-08-17T10:00:00Z'): Snapshot => ({ collectedAt:Date.parse('2026-08-17T10:00:01Z'), agents:[{ runtimeId:'rt', paneKey, repoId:'repo', terminal:{}, placement:{path:'/safe',branch:'feat/x'}, agentType:'codex', state, ...(toolName ? {toolName}:{}), updatedAt }], terminals:terminals?normalizeTerminals(terminalRaw):[] });

describe('privacy and schema boundary', () => {
  test('copies only allowlisted fields, derives paneKey, and sanitizes errors', () => {
    const normalized = normalizeWorktrees(raw); const terminals = normalizeTerminals(terminalRaw);
    expect(normalized).toEqual([{ runtimeId:'rt', worktreeId:'wt', repoId:'repo', hostId:'host', paneKey, terminal:{}, placement:{path:'/safe',branch:'feat/x'}, agentType:'codex', state:'working', toolName:'mystery_tool', updatedAt:'2026-08-17T10:00:00Z' }]);
    expect(terminals).toEqual([{ paneKey, handle:'term', incarnationId:'inc' }]);
    const serialized = JSON.stringify({ normalized, terminals, error:safeCliError('orca worktree ps', { code:1, message:JSON.stringify(raw) }).message });
    for (const forbidden of ['prompt','toolInput','lastAssistantMessage','preview','taskTitle','displayName','secret']) expect(serialized).not.toContain(forbidden);
  });
});

describe('reconciliation', () => {
  test('uses envelopes, passes through unknown tools, and pairs tool ids', () => {
    const r = new Reconciler(); const start = r.replace(snapshot());
    expect(start.map(x=>x.event.kind)).toEqual(['sessionStart','toolStart']);
    expect(start[0]).toEqual({ sessionId:'rt:tab:leaf:inc', event:{kind:'sessionStart',source:'orca',cwd:'/safe'} });
    const toolStart = start[1]!.event; expect(toolStart.kind).toBe('toolStart');
    if (toolStart.kind !== 'toolStart') throw new Error('expected toolStart');
    expect(toolStart.toolName).toBe('mystery_tool');
    const end = r.apply(snapshot('done', undefined)); expect(end.map(x=>x.event.kind)).toEqual(['toolEnd','turnEnd']);
    expect(end[0]!.event).toEqual({kind:'toolEnd',toolId:toolStart.toolId});
    expect(end[1]!.event).toEqual({kind:'turnEnd'});
  });
  test('joins terminal incarnation and ends only after its disappearance', () => {
    const r = new Reconciler(); r.replace(snapshot('done',undefined));
    const absentAgent = snapshot('done',undefined); absentAgent.agents=[];
    expect(r.apply(absentAgent)).toEqual([]);
    absentAgent.terminals=[];
    expect(r.apply(absentAgent)).toEqual([{sessionId:'rt:tab:leaf:inc',event:{kind:'sessionEnd'}}]);
  });
  test('keeps agents that never resolve to a terminal and degrades stale work', () => {
    const r = new Reconciler(1000); const unknown=snapshot(); unknown.terminals=[]; r.replace(unknown);
    const gone={...unknown,agents:[],collectedAt:unknown.collectedAt+60_000}; expect(r.apply(gone)).toEqual([]);
    const r2=new Reconciler(1000); r2.replace(snapshot()); const stale=snapshot('working','mystery_tool',true,'2026-08-17T09:00:00Z'); stale.collectedAt=Date.parse('2026-08-17T10:01:00Z');
    expect(r2.apply(stale).map(x=>x.event.kind)).toEqual(['toolEnd','turnEnd']);
  });
});

test('collector gates polling and checks dispatched tasks before worker metadata', async () => {
  const calls:string[]=[]; const seen:boolean[]=[];
  const collector=new SnapshotCollector({ run:async args=>{calls.push(args.join(' ')); if(args[0]==='worktree') return raw; if(args[0]==='terminal') return terminalRaw; if(args[1]==='task-list') return {result:{tasks:[]}}; throw new Error('worker-list must not run without dispatched tasks');}, onSnapshot:(_,cold)=>seen.push(cold), worktreeIntervalMs:60_000, terminalIntervalMs:60_000 });
  expect(calls).toEqual([]); await collector.addClient(); expect(calls).toEqual(['worktree ps --json','terminal list --json','orchestration task-list --status dispatched --json']); expect(seen).toEqual([true]); collector.removeClient(); await collector.dispose();
});

test('provider exposes stream presentation and metadata seams', async () => {
  const provider = new OrcaBridgeProvider({ run:async args=>args[0]==='worktree'?raw:args[0]==='terminal'?terminalRaw:{result:{tasks:[]}}, worktreeIntervalMs:60_000, terminalIntervalMs:60_000 });
  const emitted:unknown[]=[]; const dispose=await provider.start(value=>emitted.push(value));
  expect(provider.readingTools.has('Read')).toBe(true); expect(provider.formatToolStatus('mystery_tool')).toBe('mystery_tool');
  expect(provider.getSessionMeta('rt:tab:leaf:inc')).toEqual({roomId:'repo',displayName:'codex / feat/x',agentType:'codex',branch:'feat/x',hostId:'host',remote:true});
  expect(emitted).toHaveLength(2); await dispose();
});
