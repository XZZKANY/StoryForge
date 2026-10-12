import { isTauri } from '@tauri-apps/api/core';
import { appConfigDir } from '@tauri-apps/api/path';
import { checkParagraphPatterns } from '../../../../../packages/engine/src/index';
import golden from '../../../../../packages/engine/golden/p0.json';

const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// P0 uses the official crate-supplied global API. npm import wrappers remain unverified.
interface P0Database {
  path: string;
  select(query: string, values?: unknown[]): Promise<unknown>;
  execute(query: string, values?: unknown[]): Promise<unknown>;
  close(db?: string): Promise<boolean>;
}

async function runHttpProbe(baseUrl: string) {
  if (!isTauri()) throw new Error('HTTP probe requires Native plugin-http');
  const fetch = window.__TAURI__.http.fetch;
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/p0/stream`);
  if (!response.body) throw new Error('Native HTTP stream has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks = [];
  let text = '';
  const visible = document.createElement('pre');
  document.body.append(visible);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    visible.textContent = text;
    chunks.push({
      receivedAt: Date.now(),
      bytes: Array.from(value),
      visibleText: visible.textContent,
    });
  }
  text += decoder.decode();
  visible.textContent = text;
  const stream = { startedAt, status: response.status, chunks, text, endedAt: Date.now() };
  const failure = await fetch(`${baseUrl}/p0/error`);
  const error = { status: failure.status, ok: failure.ok, text: await failure.text() };
  const cancellation = [];
  for (const mode of ['reader', 'signal']) {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/p0/cancel-${mode}`, { signal: controller.signal });
    if (!res.body) throw new Error('Cancellation response has no body');
    const body = res.body.getReader();
    const first = await body.read();
    if (first.done) throw new Error('Cancellation fixture ended before cancellation');
    const cancelledAt = Date.now();
    let rejection: string | null = null;
    if (mode === 'reader') {
      await body.cancel('synthetic P0 cancellation');
      if (!(await body.read()).done) throw new Error('Cancelled reader did not finish');
    } else {
      controller.abort();
      try {
        await body.read();
      } catch (cause) {
        rejection = String(cause);
      }
      if (rejection === null) throw new Error('Aborted body did not reject');
    }
    cancellation.push({ mode, cancelledAt, firstBytes: Array.from(first.value), rejection });
  }
  let denied: string | null = null;
  try {
    await fetch(`${baseUrl}/outside`);
  } catch (cause) {
    denied = String(cause);
  }
  if (denied === null) throw new Error('Probe HTTP ACL allowed an out-of-scope URL');
  return { stream, error, cancellation, denied, transport: 'official global plugin-http 2.6.1' };
}

const sqlConnections: P0Database[] = [];
async function runSqlProbe(input: {
  readonly: string;
  new: string;
  missing: string;
  queries: Record<string, string>;
}) {
  if (!isTauri()) throw new Error('SQL probe requires Native plugin-sql');
  const Database = window.__TAURI__.sql;
  const startedAt = performance.now();
  const old = await Database.load(`sqlite:${input.readonly}?mode=ro`);
  sqlConnections.push(old);
  const oldLoadMs = performance.now() - startedAt;
  const actual: Record<string, unknown> = {};
  for (const [name, query] of Object.entries(input.queries)) actual[name] = await old.select(query);
  const oldPath = await old.select('PRAGMA database_list');
  const rejectedWrites = [];
  for (const command of ['execute', 'select'] as const) {
    let error: string | null = null;
    try {
      await old[command]("UPDATE assistant_sessions SET title='must-not-write' WHERE id=1");
    } catch (cause) {
      error = String(cause);
    }
    if (error === null) throw new Error(`Read-only driver allowed a write through ${command}`);
    rejectedWrites.push({ command, error });
  }
  const afterWrites = await old.select(input.queries.sessions);
  let missingError: string | null = null;
  try {
    const unexpected = await Database.load(`sqlite:${input.missing}?mode=ro`);
    sqlConnections.push(unexpected);
  } catch (cause) {
    missingError = String(cause);
  }
  if (missingError === null) throw new Error('Missing read-only database unexpectedly loaded');
  const newStartedAt = performance.now();
  const fresh = await Database.load(`sqlite:${input.new}`);
  sqlConnections.push(fresh);
  const newLoadMs = performance.now() - newStartedAt;
  await fresh.execute('PRAGMA journal_mode=WAL');
  const journalMode = await fresh.select('PRAGMA journal_mode');
  const schemaStartedAt = performance.now();
  // One connection/transaction prevents exposing a partially initialized schema.
  await fresh.execute(
    [
      'BEGIN IMMEDIATE;',
      'CREATE TABLE schema_version (version INTEGER NOT NULL);',
      'INSERT INTO schema_version VALUES (1);',
      'CREATE TABLE probe (id INTEGER PRIMARY KEY, text TEXT, payload TEXT);',
      'COMMIT;',
    ].join('\n'),
  );
  const schemaMs = performance.now() - schemaStartedAt;
  await fresh.execute('INSERT INTO probe (text, payload) VALUES ($1, $2)', [
    '合成新库𠀀\r\n',
    JSON.stringify({ nested: [true, null, 1] }),
  ]);
  return {
    actual,
    oldPath,
    oldLoadMs,
    rejectedWrites,
    afterWrites,
    missingError,
    newPath: await fresh.select('PRAGMA database_list'),
    journalMode,
    newLoadMs,
    schemaMs,
    schemaOperation:
      'single IPC execute; one explicit transaction containing both tables and version',
    newRows: await fresh.select('SELECT * FROM probe'),
    schemaVersion: await fresh.select('SELECT * FROM schema_version'),
    totalSqlMs: performance.now() - startedAt,
    transport: 'official global plugin-sql 2.4.1; no migrations registered for old DB',
    appConfigDir: await appConfigDir(),
  };
}

async function closeSqlProbe() {
  for (const connection of sqlConnections) await connection.close(connection.path);
  sqlConnections.length = 0;
}

async function runCpuProbe() {
  if (!isTauri()) throw new Error('P0 CPU measurement requires the real Tauri WebView');
  const results = [];
  for (const fixture of golden.cpu) {
    const prose = fixture.block.repeat(fixture.repetitions) + 'x'.repeat(fixture.padding);
    const bytes = new TextEncoder().encode(prose);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (bytes.byteLength !== 1_048_576 || sha256 !== fixture.sha256) {
      throw new Error('CPU corpus descriptor does not match the Python oracle');
    }
    const expected = JSON.stringify(fixture.output);
    for (let index = 0; index < 10; index++) {
      if (JSON.stringify(checkParagraphPatterns(prose)) !== expected) {
        throw new Error(`Warmup result differs from Python: ${fixture.id}`);
      }
      await yieldTask();
    }
    const longTasks: { startTime: number; duration: number }[] = [];
    const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    });
    if (supported) observer.observe({ entryTypes: ['longtask'] });
    const samples = [];
    const measuredFrom = performance.now();
    for (let index = 0; index < 10; index++) {
      const start = performance.now();
      const actual = checkParagraphPatterns(prose);
      const duration = performance.now() - start;
      if (JSON.stringify(actual) !== expected) {
        throw new Error(`Measured result differs from Python: ${fixture.id}`);
      }
      samples.push(duration);
      await yieldTask();
    }
    const measuredUntil = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 100));
    observer.disconnect();
    const sorted = [...samples].sort((a, b) => a - b);
    results.push({
      id: fixture.id,
      bytes: bytes.byteLength,
      codepoints: Array.from(prose).length,
      utf16Units: prose.length,
      sha256,
      warmups: 10,
      samplesMs: samples,
      p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      maxMs: sorted[sorted.length - 1],
      below200Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] < 200,
      longTasksSupported: supported,
      longTasks: longTasks.filter(
        (entry) =>
          entry.startTime + entry.duration > measuredFrom && entry.startTime < measuredUntil,
      ),
      issueCount: fixture.output.length,
      scope: 'complete four paragraph-pattern families; not full prose_static_scan',
    });
  }
  return { native: true, userAgent: navigator.userAgent, sources: golden.sources, results };
}

declare global {
  interface Window {
    __TAURI__: {
      http: { fetch: typeof fetch };
      sql: { load(path: string): Promise<P0Database> };
    };
    __ENGINE_P0__: {
      runCpuProbe: typeof runCpuProbe;
      runHttpProbe: typeof runHttpProbe;
      runSqlProbe: typeof runSqlProbe;
      closeSqlProbe: typeof closeSqlProbe;
    };
  }
}
window.__ENGINE_P0__ = { runCpuProbe, runHttpProbe, runSqlProbe, closeSqlProbe };
document.documentElement.dataset.engineP0Ready = 'true';
