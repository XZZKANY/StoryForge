#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const redirects = [
  { source: '/studio', destination: '/ide?tab=legacy%3Astudio&active=legacy%3Astudio' },
  { source: '/retrieval', destination: '/ide?panel.left=search' },
  { source: '/runs', destination: '/ide?panel.bottom=runs' },
  { source: '/artifacts', destination: '/ide?panel.bottom=artifacts' },
  { source: '/evaluations', destination: '/ide?panel.bottom=evaluation' },
];

const messages = {
  unknownArg: '\u672a\u77e5\u53c2\u6570',
  exitedEarly: 'Next dev \u670d\u52a1\u63d0\u524d\u9000\u51fa',
  ready: 'Next \u670d\u52a1\u5df2\u5c31\u7eea',
  returned: '\u8fd4\u56de',
  timeout: '\u7b49\u5f85 Next \u670d\u52a1\u5c31\u7eea\u8d85\u65f6',
  expectedHttp: '\u671f\u671b HTTP 308',
  actual: '\u5b9e\u9645',
  expectedLocation: '\u671f\u671b Location',
  start: '\u542f\u52a8 Next dev',
  failed: '\u65e7\u8def\u7531 HTTP 308 smoke \u5931\u8d25',
};

function parseArgs(argv) {
  const args = { port: 3187, timeoutMs: 60_000, baseUrl: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--port' && value) {
      args.port = Number(value);
      index += 1;
      continue;
    }
    if (name === '--timeout-ms' && value) {
      args.timeoutMs = Number(value);
      index += 1;
      continue;
    }
    if (name === '--base-url' && value) {
      args.baseUrl = value.replace(/\/$/, '');
      index += 1;
      continue;
    }
    throw new Error(`${messages.unknownArg}: ${name}`);
  }
  return args;
}

function stopProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // 进程可能已经退出。
    }
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // 进程可能已经退出。
  }
}

async function waitForReady(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/ide`, { redirect: 'manual' });
      if (response.status < 500) {
        console.log(`${messages.ready}: ${baseUrl}/ide ${messages.returned} ${response.status}`);
        return;
      }
      lastError = new Error(`${messages.returned} ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${messages.timeout}: ${message}`);
}

function normalizeLocation(value, baseUrl) {
  const url = new URL(value, baseUrl);
  const query = url.searchParams.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

async function verifyRedirects(baseUrl) {
  for (const redirect of redirects) {
    const response = await fetch(`${baseUrl}${redirect.source}`, { redirect: 'manual' });
    const location = response.headers.get('location') ?? '';
    if (response.status !== 308) {
      throw new Error(`${redirect.source} ${messages.expectedHttp}, ${messages.actual} ${response.status}`);
    }
    const actualLocation = normalizeLocation(location, baseUrl);
    const expectedLocation = normalizeLocation(redirect.destination, baseUrl);
    if (actualLocation !== expectedLocation) {
      throw new Error(`${redirect.source} ${messages.expectedLocation} ${expectedLocation}, ${messages.actual} ${actualLocation}`);
    }
    console.log(`${redirect.source} -> ${actualLocation}, HTTP ${response.status}`);
  }
}

async function withStartedServer({ port, timeoutMs }, task) {
  const command = process.platform === 'win32'
    ? `pnpm exec next dev --hostname 127.0.0.1 --port ${port}`
    : 'pnpm';
  const args = process.platform === 'win32'
    ? []
    : ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)];
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  console.log(`${messages.start}: ${command} ${args.join(' ')}`.trim());
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  try {
    const earlyExit = once(child, 'exit').then(([code]) => {
      throw new Error(`${messages.exitedEarly}, ${messages.actual} ${code}`);
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    await Promise.race([waitForReady(baseUrl, timeoutMs), earlyExit]);
    await task(baseUrl);
  } finally {
    stopProcessTree(child.pid);
    await Promise.race([once(child, 'exit'), delay(5_000)]).catch(() => undefined);
    stopProcessTree(child.pid);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.baseUrl) {
    await waitForReady(args.baseUrl, args.timeoutMs);
    await verifyRedirects(args.baseUrl);
    return;
  }
  await withStartedServer(args, verifyRedirects);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${messages.failed}: ${message}`);
  process.exitCode = 1;
}
