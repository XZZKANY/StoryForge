import { isTauri } from '@tauri-apps/api/core';
import { executeBookContextCommand, type ProjectReader } from '@storyforge/engine';
import { isPathInsideProject, looksAbsolutePath } from '@storyforge/project-core';
import golden from '../../../../../packages/engine/golden/p1-context.windows.json';
import { nativeProjectReader } from '../../src/lib/engine/reader';
import { mapBookContextPayload } from '../../src/lib/book-context';
import {
  commandExpectation,
  commandSecrets,
  hydrate,
} from '../../../../../packages/engine/src/kernel/contextDomain.test-support';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected object');
  return value as Record<string, unknown>;
}
function equivalent(actual: unknown, expected: unknown, path = 'result'): void {
  if (Object.is(actual, expected)) return;
  assert(typeof actual === typeof expected, `Type mismatch at ${path}`);
  if (Array.isArray(expected)) {
    assert(Array.isArray(actual) && actual.length === expected.length, `Array mismatch at ${path}`);
    expected.forEach((value, index) => equivalent(actual[index], value, `${path}[${index}]`));
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    const left = object(actual);
    const right = object(expected);
    equivalent(Object.keys(left).sort(), Object.keys(right).sort(), `${path}.keys`);
    for (const key of Object.keys(right)) equivalent(left[key], right[key], `${path}.${key}`);
    return;
  }
  // Do not put manuscript/prompt/secret contents in discrepancy logs.
  throw new Error(`Value mismatch at ${path}`);
}
async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
type Input = { ownedRoot: string; projects: Record<string, string> };
type ReadRecord = {
  operation: string;
  path: string;
  cap: number | null;
  startedAt: number;
  durationMs: number;
  error?: string;
};
type CaseRecord = {
  fixture: string;
  variant: string;
  outcome: string;
  startedAt: number;
  durationMs: number;
  reads: ReadRecord[];
  promptSha256: string | null;
};

async function runContextProbe(input: Input) {
  assert(isTauri(), 'Context probe requires the real Native host');
  const rows: CaseRecord[] = [];
  const longTasks: { startTime: number; duration: number }[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      longTasks.push({ startTime: entry.startTime, duration: entry.duration });
  });
  observer.observe({ entryTypes: ['longtask'] });
  const startedAt = performance.now();
  const progress = document.createElement('pre');
  document.body.append(progress);
  try {
    for (const fixture of golden.book_context) {
      const root = input.projects[fixture.id];
      assert(
        typeof root === 'string' && isPathInsideProject(input.ownedRoot, root),
        'Unowned fixture root',
      );
      const allowedRoot = fixture.missing_root ? `${root}/missing` : root;
      for (const command of fixture.commands) {
        const reads: ReadRecord[] = [];
        const violations: string[] = [];
        async function observe<T>(
          operation: string,
          base: string,
          path: string,
          cap: number | null,
          call: () => Promise<T>,
        ): Promise<T> {
          const candidate = looksAbsolutePath(path) ? path : `${base}/${path}`;
          if (base !== allowedRoot || !isPathInsideProject(input.ownedRoot, candidate)) {
            violations.push(operation);
            throw new Error('Native fixture attempted an unowned path');
          }
          const start = performance.now();
          const record: ReadRecord = { operation, path, cap, startedAt: start, durationMs: 0 };
          reads.push(record);
          try {
            return await call();
          } catch (error) {
            record.error = error instanceof Error ? error.name : typeof error;
            throw error;
          } finally {
            record.durationMs = performance.now() - start;
          }
        }
        // Observe the real uncached npm invoke adapter; no response/IPC/filesystem mocks.
        const reader: ProjectReader = {
          resolveProjectPath: (base, path) =>
            observe('resolve', base, path, null, () =>
              nativeProjectReader.resolveProjectPath(base, path),
            ),
          inspectProjectPath: (base, path) =>
            observe('inspect', base, path, null, () =>
              nativeProjectReader.inspectProjectPath(base, path),
            ),
          readProjectDirectory: (base, path, cap) =>
            observe('directory', base, path, cap, () =>
              nativeProjectReader.readProjectDirectory(base, path, cap),
            ),
          readProjectBytes: (base, path, cap) =>
            observe('bytes', base, path, cap, () =>
              nativeProjectReader.readProjectBytes(base, path, cap),
            ),
        };
        const args = object(hydrate(command.args_json, root));
        const secrets = commandSecrets(command);
        // 迁移计划 §4.3.1：期望按输入范围逐条判定，见 contextDomain.test-support。
        const expectation = commandExpectation(fixture, command);
        const begin = performance.now();
        let response: Awaited<ReturnType<typeof executeBookContextCommand>> | undefined;
        let failure: unknown;
        console.info(`ENGINE_P1_START ${fixture.id}/${command.id}`);
        try {
          response = await executeBookContextCommand(reader, args, secrets, 'windows');
        } catch (error) {
          failure = error;
        }
        assert(violations.length === 0, `Owned scope violation: ${fixture.id}/${command.id}`);
        let outcome: string;
        let promptSha256: string | null = null;
        if (expectation.kind === 'error') {
          const error = object(failure);
          equivalent(error.status, expectation.status, 'error.status');
          const message = String(error.message);
          assert(
            expectation.exact
              ? message === expectation.message.split('$ROOT').join(root)
              : message.includes(expectation.message),
            'Error message differs',
          );
          outcome = `expected-${expectation.status}`;
        } else {
          assert(failure === undefined, `Unexpected command failure: ${fixture.id}/${command.id}`);
          const expected = object(expectation.output(root));
          equivalent(response, expected);
          const actualPayload = object(response!.payload);
          const expectedPayload = object(expected.payload);
          equivalent(
            mapBookContextPayload(actualPayload.book_context),
            mapBookContextPayload(expectedPayload.book_context),
            'mapper',
          );
          const prompt =
            actualPayload.book_context === null
              ? null
              : object(actualPayload.book_context).prompt_block;
          const bytes = typeof prompt === 'string' ? new TextEncoder().encode(prompt) : null;
          const expectedBytes = expectation.prompt;
          assert(
            bytes === null
              ? expectedBytes === null
              : expectedBytes !== null &&
                  bytes.length === expectedBytes.length &&
                  bytes.every((byte, i) => byte === expectedBytes[i]),
            'Prompt bytes differ',
          );
          promptSha256 = bytes === null ? null : await sha256(bytes);
          outcome = 'matched';
        }
        const row = {
          fixture: fixture.id,
          variant: command.id,
          outcome,
          startedAt: begin,
          durationMs: performance.now() - begin,
          reads,
          promptSha256,
        };
        rows.push(row);
        console.info('ENGINE_P1_CASE ' + JSON.stringify(row));
        progress.textContent = `${rows.length} command cases verified\n${fixture.id}/${command.id}: ${outcome}`;
        await yieldTask();
      }
    }
    await yieldTask();
    for (const entry of observer.takeRecords())
      longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    return {
      native: isTauri(),
      source: 'real uncached Native reader -> engine -> existing mapper',
      rows,
      durationMs: performance.now() - startedAt,
      longTasks,
    };
  } finally {
    observer.disconnect();
  }
}

declare global {
  interface Window {
    __ENGINE_P1__: { runContextProbe: typeof runContextProbe };
  }
}
window.__ENGINE_P1__ = { runContextProbe };
document.documentElement.dataset.engineP1Ready = 'true';
