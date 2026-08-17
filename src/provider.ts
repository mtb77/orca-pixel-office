import { SnapshotCollector, type CollectorOptions } from './collector.js';
import { Reconciler } from './reconciler.js';
import type { AgentEventEnvelope, AgentEventProvider, StreamSessionMeta } from './types.js';

export class OrcaBridgeProvider implements AgentEventProvider {
  readonly kind = 'stream' as const; readonly id = 'orca'; readonly displayName = 'Orca'; readonly protocolVersion = 1;
  readonly readingTools: ReadonlySet<string> = new Set(['Read', 'Glob', 'Grep', 'Search', 'WebFetch']);
  private collector: SnapshotCollector | undefined;
  private reconciler: Reconciler | undefined;
  constructor(private readonly options: Omit<CollectorOptions, 'onSnapshot'> = {}) {}
  formatToolStatus(toolName: string): string { return toolName; }
  getSessionMeta(sessionId: string): StreamSessionMeta | undefined {
    const meta = this.reconciler?.getSessionMeta(sessionId);
    if (!meta) return undefined;
    return {
      folderName: meta.roomId,
      displayName: meta.displayName,
      ...(meta.remote ? { remoteLabel: meta.hostId ?? 'remote' } : {})
    };
  }
  async start(emit: (envelope: AgentEventEnvelope) => void): Promise<() => Promise<void>> {
    const reconciler = new Reconciler(); this.reconciler = reconciler;
    this.collector = new SnapshotCollector({ ...this.options, onSnapshot: (snapshot, cold) => { for (const event of cold ? reconciler.replace(snapshot) : reconciler.apply(snapshot)) emit(event); } });
    await this.collector.addClient();
    return async () => { await this.collector?.dispose(); this.collector = undefined; this.reconciler = undefined; };
  }
}

/** Generic stream-runtime module contract: construct this package's provider. */
export function createStreamProvider(): OrcaBridgeProvider {
  return new OrcaBridgeProvider();
}
export * from './types.js';
