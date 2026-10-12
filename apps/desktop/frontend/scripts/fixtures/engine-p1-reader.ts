import { isTauri } from '@tauri-apps/api/core';
import { ProjectTreeError, scanProjectFiles, type ProjectReader } from '@storyforge/engine';
import { isPathInsideProject, looksAbsolutePath } from '@storyforge/project-core';
import golden from '../../../../../packages/engine/golden/p1-reader.windows.json';
import { nativeProjectReader } from '../../src/lib/engine/reader';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Result = { output: string[] } | { error: { name: string; message: string } };
type ReadRecord = { operation: string; path: string; cap: number | null; error?: string };

async function runReaderProbe(input: { ownedRoot: string }) {
  assert(isTauri(), 'Reader probe requires the real Native host');
  assert(looksAbsolutePath(input.ownedRoot), 'Reader fixture root must be absolute');
  const rows: {
    fixture: string;
    action: string;
    expected: Result;
    actual: Result;
    matched: boolean;
    durationMs: number;
    reads: ReadRecord[];
  }[] = [];
  const skipped: { fixture: string; actions: number; reason: unknown }[] = [];
  const longTasks: { startTime: number; duration: number }[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      longTasks.push({ startTime: entry.startTime, duration: entry.duration });
  });
  observer.observe({ entryTypes: ['longtask'] });
  const progress = document.createElement('pre');
  document.body.append(progress);
  const begin = performance.now();
  try {
    for (const fixture of golden.fixtures) {
      if (fixture.skip !== null) {
        skipped.push({
          fixture: fixture.id,
          actions: fixture.actions.length,
          reason: fixture.skip,
        });
        continue;
      }
      const root = `${input.ownedRoot}/${fixture.id}/${fixture.root}`;
      assert(isPathInsideProject(input.ownedRoot, root), 'Unowned reader project');
      for (const action of fixture.actions) {
        const reads: ReadRecord[] = [];
        async function observe<T>(
          operation: string,
          base: string,
          path: string,
          cap: number | null,
          call: () => Promise<T>,
        ) {
          const candidate = looksAbsolutePath(path) ? path : `${base}/${path}`;
          assert(
            base === root && isPathInsideProject(input.ownedRoot, candidate),
            'Unowned reader request',
          );
          const record: ReadRecord = { operation, path, cap };
          reads.push(record);
          try {
            return await call();
          } catch (error) {
            record.error = error instanceof Error ? error.name : typeof error;
            throw error;
          }
        }
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
          readProjectBytes: () => {
            throw new Error('Tree traversal must not read file bytes');
          },
        };
        let expected: Result;
        if ('error' in action && action.error !== undefined) expected = { error: action.error };
        else {
          assert(
            'output' in action && action.output !== undefined,
            'Incomplete Python reader oracle',
          );
          expected = { output: action.output };
        }
        const startedAt = performance.now();
        let actual: Result;
        try {
          actual = {
            output: await scanProjectFiles(reader, root, {
              visible: (path) =>
                path === '.' ||
                action.visible === 'all' ||
                !path.split('/').some((part) => part.startsWith('.')),
              scope: action.scope,
              explicitFiles: action.explicit_files,
              maxEntries: 'max_entries' in action ? action.max_entries : undefined,
              maxDepth: 'max_depth' in action ? action.max_depth : undefined,
            }),
          };
        } catch (error) {
          if (!(error instanceof ProjectTreeError)) throw error;
          actual = { error: { name: error.name, message: error.message } };
        }
        const row = {
          fixture: fixture.id,
          action: action.id,
          expected,
          actual,
          matched: JSON.stringify(actual) === JSON.stringify(expected),
          durationMs: performance.now() - startedAt,
          reads,
        };
        rows.push(row);
        progress.textContent = `${rows.length} reader cases replayed\n${fixture.id}/${action.id}: ${row.matched ? 'matched' : 'DIFF'}`;
      }
    }
    // Yield once to deliver the final long-task entries, not to mask traversal timings.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (const entry of observer.takeRecords())
      longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    return { native: isTauri(), rows, skipped, longTasks, durationMs: performance.now() - begin };
  } finally {
    observer.disconnect();
  }
}

declare global {
  interface Window {
    __ENGINE_P1_READER__: { runReaderProbe: typeof runReaderProbe };
  }
}
window.__ENGINE_P1_READER__ = { runReaderProbe };
document.documentElement.dataset.engineP1ReaderReady = 'true';
