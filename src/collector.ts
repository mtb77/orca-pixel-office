import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeTerminals, normalizeWorkers, normalizeWorktrees, safeCliError } from './normalizer.js';
import type { NormalizedTerminal, Snapshot, WorkerEnrichment } from './types.js';
const execFileAsync = promisify(execFile);

export interface CollectorOptions {
  worktreeIntervalMs?: number; terminalIntervalMs?: number; jitter?: number; orcaCommand?: string;
  run?: (args: string[]) => Promise<unknown>; now?: () => number; random?: () => number;
  onSnapshot: (snapshot: Snapshot, cold: boolean) => void; onError?: (error: Error) => void;
}
export class SnapshotCollector {
  private clients = 0; private stopped = false; private worktreeTimer: NodeJS.Timeout | undefined; private terminalTimer: NodeJS.Timeout | undefined;
  private agents = [] as Snapshot['agents']; private terminals: NormalizedTerminal[] = [];
  private workers: Array<WorkerEnrichment & { paneKey?: string; terminalHandle?: string }> = [];
  private readonly run: (args: string[]) => Promise<unknown>;
  constructor(private readonly options: CollectorOptions) {
    this.run = options.run ?? (async args => { const { stdout } = await execFileAsync(options.orcaCommand ?? 'orca', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); return JSON.parse(stdout); });
  }
  async addClient(): Promise<void> { if (this.stopped) throw new Error('collector is stopped'); if (++this.clients === 1) await this.coldStart(); }
  removeClient(): void { this.clients = Math.max(0, this.clients - 1); if (!this.clients) this.clearTimers(); }
  async dispose(): Promise<void> { this.stopped = true; this.clients = 0; this.clearTimers(); }
  private async coldStart(): Promise<void> {
    this.clearTimers();
    try {
      const [worktrees, terminals] = await Promise.all([this.command(['worktree','ps','--json']), this.command(['terminal','list','--json'])]);
      this.agents = normalizeWorktrees(worktrees); this.terminals = normalizeTerminals(terminals);
      await this.refreshWorkers(); this.applyWorkerEnrichment(); this.options.onSnapshot({ agents: this.agents, terminals: this.terminals, collectedAt: this.now() }, true);
    } catch (error) { this.options.onError?.(error instanceof Error ? error : new Error('Orca snapshot failed')); }
    if (this.clients) { this.scheduleWorktrees(); this.scheduleTerminals(); }
  }
  private async command(args: string[]): Promise<unknown> { try { return await this.run(args); } catch (error) { throw safeCliError(`orca ${args.slice(0,2).join(' ')}`, error); } }
  private async pollWorktrees(): Promise<void> { try { this.agents = normalizeWorktrees(await this.command(['worktree','ps','--json'])); this.applyWorkerEnrichment(); this.emit(false); } catch (e) { this.options.onError?.(e as Error); } finally { if (this.clients) this.scheduleWorktrees(); } }
  private async pollTerminals(): Promise<void> { try { this.terminals = normalizeTerminals(await this.command(['terminal','list','--json'])); await this.refreshWorkers(); this.applyWorkerEnrichment(); this.emit(false); } catch (e) { this.options.onError?.(e as Error); } finally { if (this.clients) this.scheduleTerminals(); } }
  private async refreshWorkers(): Promise<void> {
    const tasksRaw = await this.command(['orchestration','task-list','--status','dispatched','--json']);
    const root = tasksRaw !== null && typeof tasksRaw === 'object' ? tasksRaw as Record<string, unknown> : {};
    const result = root.result !== null && typeof root.result === 'object' ? root.result as Record<string, unknown> : root;
    const tasks = Array.isArray(result.tasks) ? result.tasks : Array.isArray(result.items) ? result.items : [];
    this.workers = tasks.length ? normalizeWorkers(await this.command(['orchestration','worker-list','--json'])) : [];
  }
  private applyWorkerEnrichment(): void {
    for (const agent of this.agents) {
      delete agent.worker;
      const terminal = this.terminals.find(t => t.paneKey === agent.paneKey);
      const worker = this.workers.find(w => w.paneKey === agent.paneKey || (w.terminalHandle && w.terminalHandle === terminal?.handle));
      if (worker) { const { paneKey: _, terminalHandle: __, ...enrichment } = worker; agent.worker = enrichment; }
    }
  }
  private emit(cold: boolean): void { this.options.onSnapshot({ agents: this.agents, terminals: this.terminals, collectedAt: this.now() }, cold); }
  private delay(base: number): number { const jitter = this.options.jitter ?? 0.1; return Math.max(1, Math.round(base * (1 + (((this.options.random ?? Math.random)() * 2) - 1) * jitter))); }
  private scheduleWorktrees(): void { this.worktreeTimer = setTimeout(() => void this.pollWorktrees(), this.delay(this.options.worktreeIntervalMs ?? 1000)); }
  private scheduleTerminals(): void { this.terminalTimer = setTimeout(() => void this.pollTerminals(), this.delay(this.options.terminalIntervalMs ?? 5000)); }
  private clearTimers(): void { if (this.worktreeTimer) clearTimeout(this.worktreeTimer); if (this.terminalTimer) clearTimeout(this.terminalTimer); this.worktreeTimer = this.terminalTimer = undefined; }
  private now(): number { return (this.options.now ?? Date.now)(); }
}
