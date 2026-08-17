import { PluginRuntime } from '../src/runtime.js';

async function main() {
  const runtime = new PluginRuntime({ packageRoot: process.cwd() });
  const rawUrl = await runtime.open();
  const url = new URL(rawUrl);
  const token = url.searchParams.get('token')!;
  const wsUrl = `ws://${url.host}/ws?token=${encodeURIComponent(token)}`;

  console.log(`Connected to runtime at http://${url.host}/ (token redacted)`);

  const ws = new WebSocket(wsUrl);
  const agents = new Map<number | string, { folderName?: string; displayName?: string }>();

  ws.onopen = () => {
    console.log('WebSocket open, sending webviewReady');
    ws.send(JSON.stringify({ type: 'webviewReady' }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      if (msg.type === 'agentCreated' && msg.id !== undefined) {
        agents.set(msg.id, {
          folderName: msg.folderName,
          displayName: msg.displayName
        });
      }
    } catch {
      // ignore non-JSON messages
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };

  await new Promise((resolve) => setTimeout(resolve, 20000));

  console.log('\n--- LIVE AGENTS CAPTURED ---');
  for (const [id, info] of [...agents.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  id=${id}  folderName="${info.folderName}"  displayName="${info.displayName}"`);
  }
  console.log('----------------------------\n');

  ws.close();
  await runtime.stop();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
