#!/usr/bin/env node

import { PluginRuntime } from '../dist/src/runtime.js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: orca-pixel-office\n\nStarts the local office. Press Ctrl-C to stop it.');
  process.exit(0);
}

const runtime = new PluginRuntime();
let stopping;

async function stop(signal) {
  if (stopping) return stopping;
  stopping = runtime.stop().then(() => {
    process.exitCode = signal ? 0 : process.exitCode;
  });
  return stopping;
}

process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

try {
  const privateOfficeUrl = await runtime.open();
  // This is the intended one-time delivery of the bearer token to the user.
  // Never redirect or persist this URL.
  console.log(`Office: ${privateOfficeUrl}`);
  console.log('Press Ctrl-C to stop.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Failed to start the office.');
  process.exitCode = 1;
  await stop();
}
