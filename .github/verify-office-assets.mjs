#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tarball = resolve(process.argv[2] ?? 'orca-pixel-office-0.1.0.tgz');
const testRoot = mkdtempSync(join(tmpdir(), 'orca-pixel-office-assets-'));
let child;
let secret;

try {
  const install = spawnSync('npm', ['install', '--ignore-scripts', tarball], {
    cwd: testRoot,
    encoding: 'utf8',
  });
  if (install.status !== 0) {
    throw new Error(install.stderr || install.stdout || 'npm install failed');
  }

  const packageRoot = join(testRoot, 'node_modules', 'orca-pixel-office');
  const cli = join(packageRoot, 'scripts', 'cli.mjs');
  child = spawn(process.execPath, [cli], {
    cwd: testRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const officeUrl = await waitForOfficeUrl(child);
  secret = new URL(officeUrl).searchParams.get('token') ?? undefined;
  const counts = await collectAssetCounts(officeUrl, packageRoot);

  for (const [type, count] of Object.entries(counts)) {
    console.log(`${type}: ${count}`);
  }

  const missing = Object.entries(counts)
    .filter(([, count]) => count === 0)
    .map(([type]) => type);
  if (missing.length > 0) {
    throw new Error(`Office asset handshake was incomplete: ${missing.join(', ')}`);
  }

  child.kill('SIGTERM');
  const exit = await waitForExit(child);
  if (exit.code !== 0) {
    throw new Error(`CLI did not exit cleanly (code ${exit.code}, signal ${exit.signal}).`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redact(message, secret));
  process.exitCode = 1;
} finally {
  if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  rmSync(testRoot, { recursive: true, force: true });
}

async function collectAssetCounts(officeUrl, packageRoot) {
  const require = createRequire(join(packageRoot, 'package.json'));
  const { WebSocket } = require('ws');
  const url = new URL(officeUrl);
  const wsUrl = new URL('/ws', url);
  wsUrl.protocol = 'ws:';
  wsUrl.search = url.search;

  const counts = {
    characterSpritesLoaded: 0,
    petSpritesLoaded: 0,
    floorTilesLoaded: 0,
    wallTilesLoaded: 0,
    carpetTilesLoaded: 0,
    furnitureAssetsLoaded: 0,
  };

  await new Promise((resolveAssets, rejectAssets) => {
    const socket = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      socket.terminate();
      rejectAssets(new Error(`Timed out waiting for office assets; observed ${summary(counts)}`));
    }, 30_000);

    socket.on('open', () => socket.send(JSON.stringify({ type: 'webviewReady' })));
    socket.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }

      switch (message.type) {
        case 'characterSpritesLoaded': counts[message.type] = lengthOf(message.characters); break;
        case 'petSpritesLoaded': counts[message.type] = lengthOf(message.pets); break;
        case 'floorTilesLoaded': counts[message.type] = lengthOf(message.sprites); break;
        case 'wallTilesLoaded': counts[message.type] = lengthOf(message.sets); break;
        case 'carpetTilesLoaded': counts[message.type] = lengthOf(message.sets); break;
        case 'furnitureAssetsLoaded': counts[message.type] = lengthOf(message.catalog); break;
        default: return;
      }

      if (Object.values(counts).every((count) => count > 0)) {
        clearTimeout(timeout);
        socket.close();
        resolveAssets();
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timeout);
      rejectAssets(error);
    });
  });

  return counts;
}

function waitForOfficeUrl(process) {
  return new Promise((resolveUrl, rejectUrl) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => rejectUrl(new Error('Timed out waiting for office readiness.')), 30_000);
    process.stdout.setEncoding('utf8');
    process.stderr.setEncoding('utf8');
    process.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = stdout.match(/Office: (http:\/\/[^\s]+)/);
      if (match?.[1]) {
        clearTimeout(timeout);
        resolveUrl(match[1]);
      }
    });
    process.stderr.on('data', (chunk) => { stderr += chunk; });
    process.once('exit', (code) => {
      clearTimeout(timeout);
      rejectUrl(new Error(`CLI exited before readiness (code ${code}). ${stderr}`));
    });
  });
}

function waitForExit(process) {
  return new Promise((resolveExit) => process.once('exit', (code, signal) => resolveExit({ code, signal })));
}

function lengthOf(value) {
  return Array.isArray(value) ? value.length : 0;
}

function summary(counts) {
  return Object.entries(counts).map(([type, count]) => `${type}=${count}`).join(', ');
}

function redact(message, token) {
  return token ? message.split(token).join('[redacted]') : message;
}
