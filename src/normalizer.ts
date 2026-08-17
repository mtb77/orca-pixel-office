import type { NormalizedAgent, NormalizedTerminal, WorkerEnrichment } from './types.js';

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): UnknownRecord => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const boolean = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const payload = (input: unknown): UnknownRecord => {
  const root = record(input);
  return Object.keys(record(root.result)).length ? record(root.result) : root;
};
const put = <T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void => { if (value !== undefined) target[key] = value; };

export function normalizeWorktrees(input: unknown): NormalizedAgent[] {
  const root = payload(input);
  const worktrees = array(root.worktrees ?? root.items ?? input);
  const result: NormalizedAgent[] = [];
  for (const rawWorktree of worktrees) {
    const worktree = record(rawWorktree);
    const placement = record(worktree.placement);
    for (const rawAgent of array(worktree.agents)) {
      const agent = record(rawAgent);
      const terminal = record(agent.terminal);
      const paneKey = string(agent.paneKey);
      const runtimeId = string(agent.runtimeId) ?? string(worktree.runtimeId) ?? string(worktree.worktreeId);
      if (!paneKey || !runtimeId) continue;
      const normalized: NormalizedAgent = {
        runtimeId,
        paneKey,
        terminal: {},
        placement: {},
        state: string(agent.state) ?? 'unknown'
      };
      put(normalized, 'worktreeId', string(agent.worktreeId) ?? string(worktree.worktreeId));
      put(normalized, 'repoId', string(agent.repoId) ?? string(worktree.repoId));
      put(normalized, 'hostId', string(agent.hostId) ?? string(worktree.hostId));
      put(normalized, 'parentPaneKey', string(agent.parentPaneKey));
      put(normalized.terminal, 'handle', string(terminal.handle) ?? string(agent.terminalHandle));
      put(normalized.terminal, 'incarnationId', string(terminal.incarnationId) ?? string(agent.incarnationId) ?? string(agent.terminalIncarnationId));
      put(normalized.placement, 'repo', string(placement.repo) ?? string(worktree.repo));
      put(normalized.placement, 'path', string(placement.path) ?? string(worktree.path));
      put(normalized.placement, 'branch', string(placement.branch) ?? string(worktree.branch));
      put(normalized, 'agentType', string(agent.agentType));
      put(normalized, 'toolName', string(agent.toolName));
      put(normalized, 'stateStartedAt', string(agent.stateStartedAt));
      put(normalized, 'updatedAt', string(agent.updatedAt));
      put(normalized, 'interrupted', boolean(agent.interrupted));
      result.push(normalized);
    }
  }
  return result;
}

export function normalizeTerminals(input: unknown): NormalizedTerminal[] {
  const root = payload(input);
  return array(root.terminals ?? root.items ?? input).flatMap(raw => {
    const item = record(raw);
    const paneKey = string(item.paneKey) ?? (string(item.tabId) && string(item.leafId) ? `${string(item.tabId)}:${string(item.leafId)}` : undefined);
    if (!paneKey) return [];
    const terminal: NormalizedTerminal = { paneKey };
    put(terminal, 'parentPaneKey', string(item.parentPaneKey));
    put(terminal, 'handle', string(item.handle) ?? string(item.terminalHandle));
    put(terminal, 'incarnationId', string(item.incarnationId));
    put(terminal, 'worktreeId', string(item.worktreeId));
    put(terminal, 'updatedAt', string(item.updatedAt));
    return [terminal];
  });
}

export function normalizeWorkers(input: unknown): Array<WorkerEnrichment & { paneKey?: string; terminalHandle?: string }> {
  const root = payload(input);
  return array(root.workers ?? root.items ?? input).map(raw => {
    const worker = record(raw); const terminal = record(worker.terminal);
    const out: WorkerEnrichment & { paneKey?: string; terminalHandle?: string } = {};
    put(out, 'runId', string(worker.runId)); put(out, 'taskId', string(worker.taskId));
    put(out, 'dispatchId', string(worker.dispatchId)); put(out, 'status', string(worker.status));
    put(out, 'hostId', string(worker.hostId)); put(out, 'paneKey', string(worker.paneKey) ?? string(terminal.paneKey));
    put(out, 'terminalHandle', string(worker.terminalHandle) ?? string(terminal.handle));
    return out;
  });
}

export function safeCliError(command: string, error: unknown): Error {
  const code = record(error).code;
  return new Error(`${command} failed${typeof code === 'number' || typeof code === 'string' ? ` (code ${String(code)})` : ''}`);
}
