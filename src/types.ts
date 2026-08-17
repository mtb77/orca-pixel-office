export interface Placement { repo?: string; path?: string; branch?: string }
export interface TerminalIdentity { handle?: string; incarnationId?: string }
export interface NormalizedAgent {
  runtimeId: string;
  worktreeId?: string;
  repoId?: string;
  hostId?: string;
  paneKey: string;
  parentPaneKey?: string;
  terminal: TerminalIdentity;
  placement: Placement;
  agentType?: string;
  state: string;
  toolName?: string;
  stateStartedAt?: string;
  updatedAt?: string;
  interrupted?: boolean;
  worker?: WorkerEnrichment;
}
export interface NormalizedTerminal {
  paneKey: string;
  parentPaneKey?: string;
  handle?: string;
  incarnationId?: string;
  worktreeId?: string;
  updatedAt?: string;
}
export interface WorkerEnrichment {
  runId?: string;
  taskId?: string;
  dispatchId?: string;
  status?: string;
  hostId?: string;
}
export interface Snapshot { agents: NormalizedAgent[]; terminals: NormalizedTerminal[]; collectedAt: number }

export type AgentEvent =
  | { kind: 'toolStart'; toolId: string; toolName: string }
  | { kind: 'toolEnd'; toolId: string }
  | { kind: 'turnEnd'; awaitingInput?: boolean }
  | { kind: 'subagentStart'; parentToolId: string; toolId: string; toolName: string }
  | { kind: 'subagentEnd'; parentToolId: string; toolId: string }
  | { kind: 'sessionStart'; source?: string; cwd?: string }
  | { kind: 'sessionEnd'; reason?: string };

export interface AgentEventEnvelope { sessionId: string; event: AgentEvent }
export interface SessionMeta { roomId: string; displayName: string; agentType: string; branch?: string; hostId?: string; remote: boolean }
export interface StreamSessionMeta { folderName?: string; displayName?: string; remoteLabel?: string }

export interface AgentEventProvider {
  readonly kind: 'stream';
  readonly id: string;
  readonly displayName: string;
  readonly protocolVersion: number;
  readonly readingTools: ReadonlySet<string>;
  formatToolStatus(toolName: string): string;
  start(emit: (envelope: AgentEventEnvelope) => void): Promise<() => Promise<void>>;
  getSessionMeta?(sessionId: string): StreamSessionMeta | undefined;
}
