import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SHUTDOWN_GRACE_MS = 10 * 60 * 1000;
const RUNTIME_ENTRY = join('dist', 'stream-runtime.js');

export interface RuntimeLocation { root: string; entry: string }
export type RuntimeControlMessage =
  | { type: 'start'; host: string; port: number; token: string; bridgeModule: string }
  | { type: 'stop' };
export type RuntimeMessage =
  | { type: 'ready'; port: number }
  | { type: 'clients'; count: number }
  | { type: 'error'; message: string };
export interface RuntimeProcess { readonly pid?: number; send(message: RuntimeControlMessage): void; stop(): Promise<void> }
export interface RuntimeLauncher { launch(location: RuntimeLocation, onMessage: (message: RuntimeMessage) => void): Promise<RuntimeProcess> }
export interface PluginRuntimeOptions {
  packageRoot?: string; host?: string; port?: number; shutdownGraceMs?: number;
  launcher?: RuntimeLauncher; tokenFactory?: () => string;
  setTimer?: (callback: () => void, delay: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
}

export function findPixelAgentsRuntime(packageRoot: string): RuntimeLocation {
  const candidates = [
    { label: 'bundled', root: join(packageRoot, 'vendor', 'pixel-agents') },
    { label: 'sibling development', root: resolve(packageRoot, '..', 'pixel-agents-orca') }
  ];
  const present: string[] = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate.root)) continue;
    present.push(`${candidate.label} checkout at ${candidate.root}`);
    const entry = join(candidate.root, RUNTIME_ENTRY);
    const webview = join(candidate.root, 'dist', 'webview', 'index.html');
    if (existsSync(entry) && existsSync(webview)) return { root: candidate.root, entry };
  }
  if (present.length) throw new Error(`Pixel Agents is present but unbuilt: ${present.join(' and ')}; missing ${RUNTIME_ENTRY} and/or dist/webview/index.html.`);
  throw new Error(`Pixel Agents runtime is missing: expected ${join(packageRoot, 'vendor', 'pixel-agents')} or ${resolve(packageRoot, '..', 'pixel-agents-orca')}.`);
}

class NodeRuntimeLauncher implements RuntimeLauncher {
  async launch(location: RuntimeLocation, onMessage: (message: RuntimeMessage) => void): Promise<RuntimeProcess> {
    const child = fork(location.entry, [], { cwd: location.root, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    child.on('message', value => { if (isRuntimeMessage(value)) onMessage(value); });
    return childProcessHandle(child);
  }
}

export class PluginRuntime {
  private process: RuntimeProcess | undefined;
  private startPromise: Promise<string> | undefined;
  private token: string | undefined;
  private shutdownTimer: NodeJS.Timeout | undefined;
  private readonly packageRoot: string;
  private readonly host: string;
  private readonly port: number;
  private readonly shutdownGraceMs: number;
  private readonly launcher: RuntimeLauncher;
  private readonly tokenFactory: () => string;
  private readonly setTimer: (callback: () => void, delay: number) => NodeJS.Timeout;
  private readonly clearTimer: (timer: NodeJS.Timeout) => void;

  constructor(options: PluginRuntimeOptions = {}) {
    this.packageRoot = options.packageRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    this.host = options.host ?? '127.0.0.1'; this.port = options.port ?? 0;
    this.shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
    this.launcher = options.launcher ?? new NodeRuntimeLauncher();
    this.tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString('base64url'));
    this.setTimer = options.setTimer ?? setTimeout; this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  open(): Promise<string> {
    if (this.startPromise) return this.startPromise;
    this.cancelShutdown();
    this.startPromise = this.start().catch(error => {
      const token = this.token;
      this.token = undefined; this.process = undefined; this.startPromise = undefined;
      throw sanitizeRuntimeError(error, token);
    });
    return this.startPromise;
  }

  async stop(): Promise<void> {
    this.cancelShutdown();
    const running = this.process;
    this.process = undefined; this.startPromise = undefined; this.token = undefined;
    if (running) await running.stop();
  }

  private async start(): Promise<string> {
    const location = findPixelAgentsRuntime(this.packageRoot);
    const token = this.tokenFactory(); this.token = token;
    return new Promise<string>(async (resolveReady, rejectReady) => {
      try {
        this.process = await this.launcher.launch(location, message => {
          if (message.type === 'ready') resolveReady(`http://${this.host}:${message.port}/?token=${encodeURIComponent(token)}`);
          else if (message.type === 'clients') this.clientsChanged(message.count);
          else if (message.type === 'error') rejectReady(sanitizeRuntimeError(message.message, token));
        });
        this.process.send({ type: 'start', host: this.host, port: this.port, token, bridgeModule: join(this.packageRoot, 'dist', 'src', 'provider.js') });
      } catch (error) { rejectReady(error); }
    });
  }

  private clientsChanged(count: number): void {
    if (count > 0) { this.cancelShutdown(); return; }
    if (this.shutdownTimer || !this.process) return;
    this.shutdownTimer = this.setTimer(() => void this.stop(), this.shutdownGraceMs);
  }
  private cancelShutdown(): void {
    if (!this.shutdownTimer) return;
    this.clearTimer(this.shutdownTimer); this.shutdownTimer = undefined;
  }
}

function childProcessHandle(child: ChildProcess): RuntimeProcess {
  return {
    ...(child.pid ? { pid: child.pid } : {}),
    send: message => { child.send(message); },
    stop: () => new Promise(resolveStop => {
      if (child.exitCode !== null || child.signalCode !== null) { resolveStop(); return; }
      child.once('exit', () => resolveStop()); child.send({ type: 'stop' } satisfies RuntimeControlMessage);
    })
  };
}
function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return message.type === 'ready' && typeof message.port === 'number'
    || message.type === 'clients' && typeof message.count === 'number'
    || message.type === 'error' && typeof message.message === 'string';
}
function sanitizeRuntimeError(error: unknown, token?: string): Error {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Pixel Agents runtime failed to start.';
  return new Error(token ? message.split(token).join('[redacted]') : message);
}
