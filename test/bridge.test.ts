import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SnapshotCollector } from '../src/collector.js';
import { formatAgentType, formatBranch, formatDisplayName, formatRoomName } from '../src/labels.js';
import { normalizeTerminals, normalizeWorktrees, safeCliError } from '../src/normalizer.js';
import { OrcaBridgeProvider } from '../src/provider.js';
import { Reconciler } from '../src/reconciler.js';
import { PluginRuntime, findPixelAgentsRuntime, type RuntimeLauncher, type RuntimeMessage, type RuntimeProcess } from '../src/runtime.js';
import type { Snapshot } from '../src/types.js';

const paneKey = 'tab:leaf';
const raw = { result: { worktrees: [{ worktreeId:'wt', runtimeId:'rt', repoId:'repo-uuid', repo:'sample-repo', hostId:'host', path:'/safe', branch:'refs/heads/feat/x', prompt:'secret prompt', taskTitle:'secret title', displayName:'secret name', agents:[{ paneKey, agentType:'codex', state:'working', toolName:'mystery_tool', updatedAt:'2026-08-17T10:00:00Z', prompt:'agent secret', toolInput:{ token:'secret input' }, lastAssistantMessage:'secret assistant', preview:'secret preview' }] }] } };
const terminalRaw = { result: { terminals: [{ tabId:'tab', leafId:'leaf', handle:'term', incarnationId:'inc', preview:'secret preview', title:'secret title' }] } };
const snapshot = (state='working', toolName: string | undefined='mystery_tool', terminals=true, updatedAt='2026-08-17T10:00:00Z'): Snapshot => ({ collectedAt:Date.parse('2026-08-17T10:00:01Z'), agents:[{ runtimeId:'rt', paneKey, repoId:'repo-uuid', terminal:{}, placement:{repo:'sample-repo',path:'/safe',branch:'refs/heads/feat/x'}, agentType:'codex', state, ...(toolName ? {toolName}:{}), updatedAt }], terminals:terminals?normalizeTerminals(terminalRaw):[] });

describe('label formatters', () => {
  test('formats agent types with proper capitalization for known harnesses and passes unknown types through', () => {
    expect(formatAgentType('claude')).toBe('Claude');
    expect(formatAgentType('CLAUDE')).toBe('Claude');
    expect(formatAgentType('Claude')).toBe('Claude');
    expect(formatAgentType('codex')).toBe('Codex');
    expect(formatAgentType('antigravity')).toBe('Antigravity');
    expect(formatAgentType('custom_agent')).toBe('custom_agent');
    expect(formatAgentType(undefined)).toBe('Agent');
    expect(formatAgentType('')).toBe('Agent');
    expect(formatAgentType('   ')).toBe('Agent');
  });

  test('strips refs/heads, refs/remotes, and handles detached/absent branches', () => {
    expect(formatBranch('refs/heads/main')).toBe('main');
    expect(formatBranch('refs/heads/fix/41328-convert-carries-timeline')).toBe('fix/41328-convert-carries-timeline');
    expect(formatBranch('refs/remotes/origin/develop')).toBe('origin/develop');
    expect(formatBranch('refs/tags/v1.0.0')).toBe('v1.0.0');
    expect(formatBranch('feat/simple')).toBe('feat/simple');
    expect(formatBranch('')).toBeUndefined();
    expect(formatBranch('   ')).toBeUndefined();
    expect(formatBranch('refs/heads/')).toBeUndefined();
    expect(formatBranch(undefined)).toBeUndefined();
  });

  test('derives room names preferring repo name over repoId and falls back to path basename', () => {
    expect(formatRoomName({ repo: 'orca-pixel-office' }, 'uuid-123')).toBe('orca-pixel-office');
    expect(formatRoomName({ path: '/Users/sascha/gitroot/my-folder' }, 'folder-workspace:uuid')).toBe('my-folder');
    expect(formatRoomName({ path: 'C:\\projects\\win-folder\\' }, 'folder-workspace:uuid')).toBe('win-folder');
    expect(formatRoomName({}, 'repo-fallback')).toBe('repo-fallback');
    expect(formatRoomName({}, 'folder-workspace:uuid')).toBe('workspace');
    expect(formatRoomName({})).toBe('workspace');
  });

  test('constructs readable display names', () => {
    expect(formatDisplayName('claude', 'refs/heads/main')).toBe('Claude / main');
    expect(formatDisplayName('codex', 'refs/heads/docs/setup')).toBe('Codex / docs/setup');
    expect(formatDisplayName('antigravity', 'refs/heads/fix/123')).toBe('Antigravity / fix/123');
    expect(formatDisplayName('claude', '')).toBe('Claude');
    expect(formatDisplayName('claude', undefined)).toBe('Claude');
    expect(formatDisplayName('unknown_harness', 'refs/heads/feat/custom')).toBe('unknown_harness / feat/custom');
    expect(formatDisplayName(undefined, undefined)).toBe('Agent');
  });
});

describe('privacy and schema boundary', () => {
  test('copies only allowlisted fields, derives paneKey, and sanitizes errors', () => {
    const normalized = normalizeWorktrees(raw); const terminals = normalizeTerminals(terminalRaw);
    expect(normalized).toEqual([{ runtimeId:'rt', worktreeId:'wt', repoId:'repo-uuid', hostId:'host', paneKey, terminal:{}, placement:{repo:'sample-repo',path:'/safe',branch:'refs/heads/feat/x'}, agentType:'codex', state:'working', toolName:'mystery_tool', updatedAt:'2026-08-17T10:00:00Z' }]);
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
  test('restarts the same tool on re-entering working and represents working without a tool', () => {
    const r = new Reconciler();

    const firstWorking = r.replace(snapshot('working', 'shell'));
    expect(firstWorking.map(x=>x.event.kind)).toEqual(['sessionStart','toolStart']);
    expect(firstWorking[1]!.event).toMatchObject({kind:'toolStart',toolName:'Bash'});

    const done = r.apply(snapshot('done', 'shell'));
    expect(done.map(x=>x.event.kind)).toEqual(['toolEnd','turnEnd']);

    const workingAgain = r.apply(snapshot('working', 'shell'));
    expect(workingAgain.map(x=>x.event.kind)).toEqual(['toolStart']);
    expect(workingAgain[0]!.event).toMatchObject({kind:'toolStart',toolName:'Bash'});

    expect(r.apply(snapshot('working', 'shell'))).toEqual([]);

    const noTool = snapshot('working');
    delete noTool.agents[0]!.toolName;
    const workingWithoutTool = r.apply(noTool);
    expect(workingWithoutTool.map(x=>x.event.kind)).toEqual(['toolEnd','toolStart']);
    expect(workingWithoutTool[1]!.event).toMatchObject({kind:'toolStart',toolName:'Working'});
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

test('provider exposes stream presentation and metadata seams with clean labels', async () => {
  const provider = new OrcaBridgeProvider({ run:async args=>args[0]==='worktree'?raw:args[0]==='terminal'?terminalRaw:{result:{tasks:[]}}, worktreeIntervalMs:60_000, terminalIntervalMs:60_000 });
  const emitted:unknown[]=[]; const dispose=await provider.start(value=>emitted.push(value));
  expect(provider.readingTools.has('Read')).toBe(true); expect(provider.formatToolStatus('mystery_tool')).toBe('mystery_tool');
  expect(provider.getSessionMeta('rt:tab:leaf:inc')).toEqual({folderName:'sample-repo',displayName:'Codex / feat/x',remoteLabel:'host'});
  expect(emitted).toHaveLength(2); await dispose();
});

test('handles folder workspaces without branch or git repo', async () => {
  const folderRaw = {
    result: {
      worktrees: [{
        worktreeId: 'folder:123',
        runtimeId: 'rt',
        repoId: 'folder-workspace:9b807680-76ce-4f5f-a15c-0268be8e5069',
        repo: 'genusswerte',
        path: '/Users/sascha/gitroot/genusswerte',
        branch: '',
        workspaceKind: 'folder-workspace',
        agents: [{ paneKey, agentType: 'claude', state: 'done', updatedAt: '2026-08-17T10:00:00Z' }]
      }]
    }
  };
  const provider = new OrcaBridgeProvider({ run: async args => args[0] === 'worktree' ? folderRaw : args[0] === 'terminal' ? terminalRaw : { result: { tasks: [] } }, worktreeIntervalMs: 60_000, terminalIntervalMs: 60_000 });
  const dispose = await provider.start(() => {});
  expect(provider.getSessionMeta('rt:tab:leaf:inc')).toEqual({ folderName: 'genusswerte', displayName: 'Claude' });
  await dispose();
});

test('passes unknown agentType through and strips refs/remotes branch', async () => {
  const customRaw = {
    result: {
      worktrees: [{
        worktreeId: 'wt-custom',
        runtimeId: 'rt',
        repoId: 'custom-uuid',
        repo: 'custom-repo',
        path: '/path/to/custom-repo',
        branch: 'refs/remotes/origin/feat/feature-1',
        agents: [{ paneKey, agentType: 'custom_orchestrator', state: 'done', updatedAt: '2026-08-17T10:00:00Z' }]
      }]
    }
  };
  const provider = new OrcaBridgeProvider({ run: async args => args[0] === 'worktree' ? customRaw : args[0] === 'terminal' ? terminalRaw : { result: { tasks: [] } }, worktreeIntervalMs: 60_000, terminalIntervalMs: 60_000 });
  const dispose = await provider.start(() => {});
  expect(provider.getSessionMeta('rt:tab:leaf:inc')).toEqual({ folderName: 'custom-repo', displayName: 'custom_orchestrator / origin/feat/feature-1' });
  await dispose();
});

function builtRuntimeRoot(): string {
  const packageRoot=mkdtempSync(join(tmpdir(),'orca-pixel-office-'));
  const root=join(packageRoot,'vendor','pixel-agents');
  mkdirSync(join(root,'dist','webview'),{recursive:true});
  writeFileSync(join(root,'dist','stream-runtime.js'),'');
  writeFileSync(join(root,'dist','webview','index.html'),'');
  return packageRoot;
}

test('runtime lookup prefers the bundled build', () => {
  const packageRoot=builtRuntimeRoot();
  expect(findPixelAgentsRuntime(packageRoot).root).toBe(join(packageRoot,'vendor','pixel-agents'));
});

test('lazy runtime start is idempotent and defaults to loopback', async () => {
  const sent:unknown[]=[]; let launches=0; let onMessage:((message:RuntimeMessage)=>void)|undefined;
  const process:RuntimeProcess={send:message=>sent.push(message),stop:async()=>{}};
  const launcher:RuntimeLauncher={launch:async(_location,callback)=>{launches++;onMessage=callback;return process;}};
  const packageRoot=builtRuntimeRoot();
  const runtime=new PluginRuntime({packageRoot,launcher,tokenFactory:()=> 'private-token'});
  const first=runtime.open(); const second=runtime.open();
  expect(first).toBe(second); expect(launches).toBe(1);
  onMessage?.({type:'ready',port:4321});
  expect(await first).toBe('http://127.0.0.1:4321/?token=private-token');
  expect(sent).toEqual([{type:'start',host:'127.0.0.1',port:0,token:'private-token',bridgeModule:join(packageRoot,'dist','src','provider.js')}]);
  await runtime.stop();
});

test('runtime token is redacted from child error paths', async () => {
  const token='never-print-this-token'; let onMessage:((message:RuntimeMessage)=>void)|undefined;
  const launcher:RuntimeLauncher={launch:async(_location,callback)=>{onMessage=callback;return {send:()=>{},stop:async()=>{}};}};
  const runtime=new PluginRuntime({packageRoot:builtRuntimeRoot(),launcher,tokenFactory:()=>token});
  const opening=runtime.open(); onMessage?.({type:'error',message:`startup failed for ${token}`});
  try { await opening; throw new Error('expected failure'); } catch (error) {
    expect((error as Error).message).not.toContain(token);
    expect((error as Error).message).toContain('[redacted]');
  }
});

test('runtime stops after the last-client grace and explicit stop is immediate', async () => {
  let onMessage:((message:RuntimeMessage)=>void)|undefined; let stopped=0; let scheduled:(()=>void)|undefined;
  const launcher:RuntimeLauncher={launch:async(_location,callback)=>{onMessage=callback;return {send:()=>{},stop:async()=>{stopped++;}};}};
  const runtime=new PluginRuntime({
    packageRoot:builtRuntimeRoot(),launcher,tokenFactory:()=> 'token',shutdownGraceMs:600_000,
    setTimer:(callback,delay)=>{expect(delay).toBe(600_000);scheduled=callback;return {} as NodeJS.Timeout;},
    clearTimer:()=>{scheduled=undefined;}
  });
  const opening=runtime.open(); onMessage?.({type:'ready',port:1234}); await opening;
  onMessage?.({type:'clients',count:0}); expect(scheduled).toBeDefined();
  onMessage?.({type:'clients',count:1}); expect(scheduled).toBeUndefined();
  onMessage?.({type:'clients',count:0}); scheduled?.(); await new Promise(resolve=>setTimeout(resolve,0)); expect(stopped).toBe(1);
  const reopened=runtime.open(); onMessage?.({type:'ready',port:1235}); await reopened;
  await runtime.stop(); expect(stopped).toBe(2);
});
