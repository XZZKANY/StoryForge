#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const messages = {
  timeout: '\u7b49\u5f85 EventSource \u91cd\u8fde smoke \u8d85\u65f6',
  failed: 'BookRun EventSource \u91cd\u8fde smoke \u5931\u8d25',
  passed: 'BookRun EventSource \u91cd\u8fde smoke \u901a\u8fc7',
};

function parseArgs(argv) {
  const args = { timeoutMs: 10_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--timeout-ms' && value) {
      args.timeoutMs = Number(value);
      index += 1;
      continue;
    }
    throw new Error(`${'\u672a\u77e5\u53c2\u6570'}: ${name}`);
  }
  return args;
}

function createFlakySseServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    if (request.url !== '/api/ide/runs/12/events') {
      response.writeHead(404);
      response.end('not found');
      return;
    }

    requests.push({ url: request.url, at: Date.now() });
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });

    if (requests.length === 1) {
      response.write('retry: 50\n');
      response.write('event: progress\n');
      response.write('data: {"book_run_id":12,"status":"running"}\n\n');
      response.end();
      return;
    }

    response.write('event: completed\n');
    response.write('data: {"book_run_id":12,"status":"completed"}\n\n');
    response.end();
  });
  return { server, requests };
}

function parseSseFrames(buffer) {
  const frames = [];
  const chunks = buffer.split(/\n\n/);
  for (const chunk of chunks) {
    const lines = chunk.split(/\n/).map((line) => line.trimEnd()).filter(Boolean);
    if (lines.length === 0) continue;
    const frame = { event: 'message', data: '', retry: null };
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith('event:')) frame.event = line.slice('event:'.length).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
      if (line.startsWith('retry:')) frame.retry = Number(line.slice('retry:'.length).trim());
    }
    frame.data = dataLines.join('\n');
    frames.push(frame);
  }
  return frames;
}

async function readSseOnce(url) {
  const response = await fetch(url, { headers: { accept: 'text/event-stream' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type')?.startsWith('text/event-stream'), true);
  const body = await response.text();
  return parseSseFrames(body);
}

async function runReconnectSmoke(timeoutMs) {
  const { server, requests } = createFlakySseServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/ide/runs/12/events`;

  try {
    const deadline = Date.now() + timeoutMs;
    const observed = [];
    let retryMs = 50;

    while (Date.now() < deadline) {
      const frames = await readSseOnce(url);
      for (const frame of frames) {
        if (Number.isFinite(frame.retry) && frame.retry > 0) retryMs = frame.retry;
        if (frame.data) observed.push(frame);
      }
      if (observed.some((frame) => frame.event === 'completed')) {
        assert.equal(requests.length, 2, '\u5ba2\u6237\u7aef\u5e94\u5728\u9996\u4e2a SSE \u8fde\u63a5\u65ad\u5f00\u540e\u91cd\u65b0\u8fde\u63a5\u4e00\u6b21');
        assert.deepEqual(observed.map((frame) => frame.event), ['progress', 'completed']);
        return { requests: requests.length, events: observed.map((frame) => frame.event) };
      }
      await delay(retryMs);
    }
    throw new Error(messages.timeout);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  const result = await runReconnectSmoke(args.timeoutMs);
  console.log(`${messages.passed}: requests=${result.requests}, events=${result.events.join(' -> ')}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${messages.failed}: ${message}`);
  process.exitCode = 1;
}
