#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const tarball = resolve(process.argv[2] ?? 'orca-pixel-office-0.1.0.tgz');
const testRoot = mkdtempSync(join(tmpdir(), 'orca-pixel-office-packed-'));
let child;

try {
  const install = spawnSync('npm', ['install', '--ignore-scripts', tarball], {
    cwd: testRoot,
    encoding: 'utf8'
  });
  if (install.status !== 0) throw new Error(install.stderr || install.stdout || 'npm install failed');
  console.log(install.stdout.trim());

  const cli = join(testRoot, 'node_modules', 'orca-pixel-office', 'scripts', 'cli.mjs');
  child = spawn(process.execPath, [cli], { cwd: testRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await waitForUrl(child);
  console.log(`Office: ${redact(url)}`);

  const authenticated = await fetch(url);
  const publicUrl = new URL(url); publicUrl.search = '';
  const unauthenticated = await fetch(publicUrl);
  console.log(`authenticated GET: ${authenticated.status}`);
  console.log(`unauthenticated GET: ${unauthenticated.status}`);
  if (authenticated.status !== 200 || unauthenticated.status !== 401) {
    throw new Error('Unexpected authentication status codes.');
  }

  child.kill('SIGTERM');
  const exit = await waitForExit(child);
  console.log(`SIGTERM exit: code=${exit.code ?? 'null'} signal=${exit.signal ?? 'null'}`);
  if (exit.code !== 0) throw new Error(`CLI did not exit cleanly (code ${exit.code}, signal ${exit.signal}).`);
} finally {
  if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  rmSync(testRoot, { recursive: true, force: true });
}

function waitForUrl(process) {
  return new Promise((resolveUrl, rejectUrl) => {
    let stdout = ''; let stderr = '';
    const timeout = setTimeout(() => rejectUrl(new Error(`Timed out waiting for office URL. ${stderr}`)), 30_000);
    process.stdout.setEncoding('utf8'); process.stderr.setEncoding('utf8');
    process.stdout.on('data', chunk => {
      stdout += chunk;
      const match = stdout.match(/Office: (http:\/\/[^\s]+)/);
      if (match?.[1]) { clearTimeout(timeout); resolveUrl(match[1]); }
    });
    process.stderr.on('data', chunk => { stderr += chunk; });
    process.once('exit', code => {
      clearTimeout(timeout);
      rejectUrl(new Error(`CLI exited before readiness (code ${code}). ${stderr}`));
    });
  });
}

function waitForExit(process) {
  return new Promise(resolveExit => process.once('exit', (code, signal) => resolveExit({ code, signal })));
}

function redact(url) {
  const parsed = new URL(url); parsed.searchParams.set('token', '[redacted]');
  return parsed.toString().replace('%5Bredacted%5D', '[redacted]');
}
