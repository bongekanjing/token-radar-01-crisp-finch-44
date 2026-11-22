// Capture the dashboard's three screenshots through the Chrome DevTools Protocol.
//
// Why not `chrome --screenshot`: a single screenshot fires before the page's scripts have run,
// so the board comes back as an empty shell. This holds the page open, waits for the render to
// report itself done (body[data-rendered]), then captures at a fixed viewport.
//
//   node shoot.mjs [--out screenshots] [--width 1440] [--height 900]
//
// The three views the bounty asks for are driven by the page's own hash routing: the board, one
// protocol's detail view, and a filtered view. Nothing here is composited or edited.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH
  || "/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};

const out = arg('--out', 'screenshots');
const width = Number(arg('--width', '1440'));
const height = Number(arg('--height', '900'));
const port = Number(arg('--port', '8511'));

// name, and the hash that selects the view
// The board and the filtered view are shot tall enough to show the board, the benchmark table and
// the model notes in one frame; the detail view is a drawer, so 900 px shows all of it.
const VIEWS = [
  ['1-board.png', '', 1180],
  ['2-detail.png', '#p=gauntlet', 1000],
  ['3-filtered.png', '#category=Risk%20Curators&w=1', 1180],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(out, { recursive: true });

// Serve the rendered /output tree: index.html sits beside data.js, exactly as the entry ships.
const profile = mkdtempSync(join(tmpdir(), 'shoot-'));
const chrome = spawn(CHROME, [
  `--user-data-dir=${profile}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--remote-debugging-port=9411',
  `--window-size=${width},${height}`,
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let noise = '';
chrome.stderr.on('data', (b) => { noise += b.toString(); });

await sleep(2500);
const list = await (await fetch('http://127.0.0.1:9411/json/list')).json();
const target = list.find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);

let nextId = 0;
const pending = new Map();
const events = [];
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

ws.onmessage = (raw) => {
  const msg = JSON.parse(raw.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    events.push(`EXCEPTION: ${d.exception?.description || d.text}`);
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    events.push(`ERROR: ${msg.params.entry.text.slice(0, 200)}`);
  }
};

await new Promise((r) => { ws.onopen = r; });
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile: false,
});

for (const [name, hash, tall] of VIEWS) {
  events.length = 0;
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: tall, deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.navigate', { url: `http://localhost:${port}/dashboard/index.html?v=${encodeURIComponent(name)}${hash}` });

  // Wait for the render to land, then a beat for fonts and the detail dialog's transition.
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt++) {
    await sleep(250);
    const probe = await send('Runtime.evaluate', {
      expression: "document.body.dataset.rendered === '1'",
      returnByValue: true,
    });
    ready = probe?.result?.value === true;
  }
  if (!ready) {
    console.error(`${name}: the page never reported rendered`);
    if (events.length) console.error(events.join('\n'));
    continue;
  }
  await sleep(700);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  writeFileSync(join(out, name), buf);
  console.log(`${join(out, name)}: ${buf.length} bytes`);
  if (events.length) console.log(`  ${events.length} console error(s):\n  ` + events.join('\n  '));
}

ws.close();
chrome.kill('SIGKILL');
rmSync(profile, { recursive: true, force: true });
process.exit(0);
