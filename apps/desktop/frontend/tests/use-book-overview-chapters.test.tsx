import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useBookOverviewChapters } from '../src/components/app/useBookOverviewChapters';
import { buildProjectIndex } from '../src/lib/project-context';
import { FS_MUTATION_EVENT } from '../src/lib/tauri-fs';

vi.mock('../src/lib/project-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/project-context')>();
  return { ...actual, buildProjectIndex: vi.fn() };
});

const mockedBuild = vi.mocked(buildProjectIndex);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness({
  projectPath,
  currentFile,
  active = true,
}: {
  projectPath: string | null;
  currentFile?: string | null;
  active?: boolean;
}) {
  const state = useBookOverviewChapters({ projectPath, currentFile, active });
  return (
    <output
      data-status={state.status}
      data-error={state.error ?? ''}
      data-current={state.currentChapter?.relativePath ?? ''}
    >
      {state.chapters.map((chapter) => (
        <span
          key={chapter.path}
          data-chapter={chapter.relativePath}
          data-ordinal={chapter.ordinal}
        />
      ))}
    </output>
  );
}

function index(
  projectPath: string,
  files: Array<{
    name: string;
    relativePath: string;
    path?: string;
    modified?: number;
    size?: number;
  }>,
) {
  return {
    projectPath,
    files: files.map((file) => ({
      path: file.path ?? `${projectPath}/${file.relativePath}`,
      relativePath: file.relativePath,
      name: file.name,
      kind: 'draft' as const,
      modified: file.modified ?? 0,
      size: file.size ?? 0,
    })),
    summary: {
      hasStoryStructure: true,
      counts: {
        outline: 0,
        character: 0,
        setting: 0,
        timeline: 0,
        foreshadowing: 0,
        knowledge: 0,
        draft: files.length,
        quality: 0,
        export: 0,
        other: 0,
      },
    },
  };
}

async function render(props: {
  projectPath: string | null;
  currentFile?: string | null;
  active?: boolean;
}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness {...props} />));
}

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  mockedBuild.mockReset();
});

beforeEach(() => {
  vi.useRealTimers();
});

test('loads the complete deterministic draft index and resolves current chapter inside project', async () => {
  const project = 'D:/books/alpha';
  mockedBuild.mockResolvedValue(
    index(project, [
      { name: '序章.md', relativePath: '正文/序章.md' },
      { name: '第002章.md', relativePath: '正文/第002章.md' },
      { name: '第010章.md', relativePath: '正文/第010章.md' },
    ]),
  );
  await render({ projectPath: project, currentFile: '正文/第002章.md' });
  await act(async () => {});
  assert.equal(container!.querySelectorAll('[data-chapter]').length, 3);
  assert.equal(
    container!.querySelector('[data-current]')?.getAttribute('data-current'),
    '正文/第002章.md',
  );
  assert.equal(
    container!.querySelector('[data-chapter="正文/第010章.md"]')?.getAttribute('data-ordinal'),
    '10',
  );
  assert.equal(
    container!.querySelector('[data-chapter="正文/序章.md"]')?.getAttribute('data-ordinal'),
    '1',
  );
});

test('rejects out-of-project current file and ignores late result from previous project', async () => {
  const first = 'D:/books/alpha';
  const second = 'D:/books/beta';
  let resolveFirst!: (value: ReturnType<typeof index>) => void;
  const firstPromise = new Promise<ReturnType<typeof index>>((resolve) => {
    resolveFirst = resolve;
  });
  mockedBuild
    .mockReturnValueOnce(firstPromise)
    .mockResolvedValueOnce(
      index(second, [{ name: '第001章.md', relativePath: '正文/第001章.md' }]),
    );
  await render({ projectPath: first, currentFile: 'D:/outside/secret.md' });
  await act(async () =>
    root!.render(<Harness projectPath={second} currentFile="正文/第001章.md" />),
  );
  await act(async () => {});
  resolveFirst(index(first, [{ name: '旧章.md', relativePath: '正文/旧章.md' }]));
  await act(async () => {});
  assert.equal(
    container!.querySelector('[data-chapter]')?.getAttribute('data-chapter'),
    '正文/第001章.md',
  );
  assert.equal(
    container!.querySelector('[data-current]')?.getAttribute('data-current'),
    '正文/第001章.md',
  );
});

test('retries after index error and refreshes on in-project filesystem mutation', async () => {
  const project = 'D:/books/alpha';
  mockedBuild
    .mockRejectedValueOnce(new Error('目录不可读'))
    .mockResolvedValue(index(project, [{ name: '第001章.md', relativePath: '正文/第001章.md' }]));
  await render({ projectPath: project });
  await act(async () => {});
  assert.equal(container!.querySelector('[data-status]')?.getAttribute('data-status'), 'error');
  await act(async () => {
    (container!.querySelector('output') as HTMLElement).dispatchEvent(new Event('noop'));
  });
  // Public refresh is exercised by the same event bridge used by writeback; debounce is fake-timer controlled.
  vi.useFakeTimers();
  await act(async () =>
    window.dispatchEvent(
      new CustomEvent(FS_MUTATION_EVENT, { detail: { path: 'D:/books/alpha/正文/第001章.md' } }),
    ),
  );
  await act(async () => vi.advanceTimersByTime(300));
  await act(async () => {});
  assert.equal(mockedBuild.mock.calls.length, 2);
  assert.equal(container!.querySelector('[data-status]')?.getAttribute('data-status'), 'available');
  assert.equal(
    container!.querySelector('[data-chapter]')?.getAttribute('data-chapter'),
    '正文/第001章.md',
  );
});
