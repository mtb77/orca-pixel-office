#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const forkRoot = resolve(packageRoot, '..', 'pixel-agents-orca');
const vendorRoot = join(packageRoot, 'vendor', 'pixel-agents');
const requiredSources = [
  join(forkRoot, 'dist', 'stream-runtime.js'),
  join(forkRoot, 'dist', 'webview'),
  join(forkRoot, 'LICENSE')
];

if (!existsSync(join(forkRoot, 'package.json'))) {
  throw new Error(`Pixel Agents sibling checkout is missing at ${forkRoot}.`);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npmCommand, ['run', 'package'], {
  cwd: forkRoot,
  stdio: 'inherit',
  env: process.env
});
if (build.status !== 0) {
  throw new Error(`Pixel Agents package build failed with exit code ${build.status ?? 'unknown'}.`);
}

for (const source of requiredSources) {
  if (!existsSync(source)) throw new Error(`Pixel Agents package build did not produce ${source}.`);
}

rmSync(vendorRoot, { recursive: true, force: true });
mkdirSync(join(vendorRoot, 'dist'), { recursive: true });
cpSync(requiredSources[0], join(vendorRoot, 'dist', 'stream-runtime.js'));
cpSync(requiredSources[1], join(vendorRoot, 'dist', 'webview'), { recursive: true });
cpSync(requiredSources[2], join(vendorRoot, 'LICENSE'));
writeFileSync(join(vendorRoot, 'package.json'), '{\n  "private": true,\n  "type": "commonjs"\n}\n');

console.log('Packaged Pixel Agents runtime, webview, CommonJS boundary, and MIT license in vendor/pixel-agents/.');
