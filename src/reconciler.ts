import { formatAgentType, formatBranch, formatDisplayName, formatRoomName } from './labels.js';
import { canonicalToolName } from './tools.js';
import type { AgentEventEnvelope, NormalizedAgent, SessionMeta, Snapshot } from './types.js';

interface Tracked { agent: NormalizedAgent; sessionId: string; incarnationId?: string; activeTool?: { id: string; name: string }; lastUpdated: number }
const baseKey = (a: NormalizedAgent) => `${a.runtimeId}:${a.paneKey}`;
const time = (a: NormalizedAgent, fallback: number) => a.updatedAt ? Date.parse(a.updatedAt) || fallback : fallback;
const envelope = (sessionId: string, event: AgentEventEnvelope['event']): AgentEventEnvelope => ({ sessionId, event });

export class Reconciler {
  private tracked = new Map<string, Tracked>();
  private meta = new Map<string, SessionMeta>();
  private counter = 0;
  constructor(private readonly staleAfterMs = 300_000) {}

  getSessionMeta(sessionId: string): SessionMeta | undefined { return this.meta.get(sessionId); }
  replace(snapshot: Snapshot): AgentEventEnvelope[] { this.tracked.clear(); this.meta.clear(); return this.apply(snapshot); }

  apply(snapshot: Snapshot): AgentEventEnvelope[] {
    const events: AgentEventEnvelope[] = [];
    const terminals = new Map(snapshot.terminals.map(t => [t.paneKey, t]));
    const liveIncarnations = new Set(snapshot.terminals.map(t => t.incarnationId).filter((x): x is string => Boolean(x)));
    const current = new Set<string>();
    for (const sourceAgent of snapshot.agents) {
      const terminal = terminals.get(sourceAgent.paneKey);
      const incarnationId = terminal?.incarnationId ?? sourceAgent.terminal.incarnationId;
      const agent: NormalizedAgent = { ...sourceAgent, terminal: { ...sourceAgent.terminal, ...(terminal?.handle ? { handle: terminal.handle } : {}), ...(incarnationId ? { incarnationId } : {}) } };
      const key = baseKey(agent); current.add(key);
      let previous = this.tracked.get(key);
      if (previous?.incarnationId && incarnationId && previous.incarnationId !== incarnationId) {
        this.end(previous, events, terminals); this.tracked.delete(key); previous = undefined;
      }
      const isNew = !previous;
      if (!previous) {
        const sessionId = `${key}:${incarnationId ?? 'unknown'}`;
        previous = { agent, sessionId, ...(incarnationId ? { incarnationId } : {}), lastUpdated: snapshot.collectedAt };
        this.tracked.set(key, previous);
        const agentType = formatAgentType(agent.agentType);
        const branch = formatBranch(agent.placement.branch);
        const roomId = formatRoomName(agent.placement, agent.repoId);
        const displayName = formatDisplayName(agent.agentType, agent.placement.branch);
        this.meta.set(sessionId, { roomId, displayName, agentType, ...(branch ? { branch } : {}), ...(agent.hostId ? { hostId: agent.hostId } : {}), remote: Boolean(agent.hostId && agent.hostId !== 'local') });
        events.push(envelope(sessionId, { kind: 'sessionStart', source: 'orca', ...(agent.placement.path ? { cwd: agent.placement.path } : {}) }));
        if (agent.parentPaneKey) {
          const parentIncarnation = terminals.get(agent.parentPaneKey)?.incarnationId ?? 'unknown';
          const parentToolId = `${agent.runtimeId}:${agent.parentPaneKey}:${parentIncarnation}:spawn:${agent.paneKey}`;
          events.push(envelope(sessionId, { kind: 'subagentStart', parentToolId, toolId: sessionId, toolName: agentType }));
        }
      }
      if (!previous.incarnationId && incarnationId) {
        previous.incarnationId = incarnationId;
        const oldId = previous.sessionId; previous.sessionId = `${key}:${incarnationId}`;
        const oldMeta = this.meta.get(oldId); if (oldMeta) { this.meta.delete(oldId); this.meta.set(previous.sessionId, oldMeta); }
      }
      const observedUpdate = time(agent, previous.lastUpdated);
      const state = snapshot.collectedAt - observedUpdate > this.staleAfterMs ? 'unknown' : agent.state;
      const wasWorking = previous.agent.state === 'working'; const working = state === 'working';
      const rawTool = working ? agent.toolName : undefined;
      if (previous.activeTool && (!working || rawTool !== previous.agent.toolName)) {
        events.push(envelope(previous.sessionId, { kind: 'toolEnd', toolId: previous.activeTool.id })); delete previous.activeTool;
      }
      if (working && rawTool && (isNew || rawTool !== previous.agent.toolName)) {
        const name = canonicalToolName(agent.agentType, rawTool); const id = `${previous.sessionId}:${name}:${++this.counter}`;
        previous.activeTool = { id, name }; events.push(envelope(previous.sessionId, { kind: 'toolStart', toolId: id, toolName: name }));
      }
      if (wasWorking && !working) events.push(envelope(previous.sessionId, { kind: 'turnEnd' }));
      previous.agent = { ...agent, state }; previous.lastUpdated = Math.max(previous.lastUpdated, observedUpdate);
    }
    for (const [key, old] of [...this.tracked]) {
      if (current.has(key)) continue;
      if (!old.incarnationId || liveIncarnations.has(old.incarnationId)) continue;
        this.end(old, events, terminals); this.tracked.delete(key);
    }
    return events;
  }

  private end(old: Tracked, events: AgentEventEnvelope[], terminals: Map<string, Snapshot['terminals'][number]> = new Map()): void {
    if (old.activeTool) events.push(envelope(old.sessionId, { kind: 'toolEnd', toolId: old.activeTool.id }));
    if (old.agent.parentPaneKey) {
      const parentIncarnation = terminals.get(old.agent.parentPaneKey)?.incarnationId ?? 'unknown';
      const parentToolId = `${old.agent.runtimeId}:${old.agent.parentPaneKey}:${parentIncarnation}:spawn:${old.agent.paneKey}`;
      events.push(envelope(old.sessionId, { kind: 'subagentEnd', parentToolId, toolId: old.sessionId }));
    }
    events.push(envelope(old.sessionId, { kind: 'sessionEnd' })); this.meta.delete(old.sessionId);
  }
}
