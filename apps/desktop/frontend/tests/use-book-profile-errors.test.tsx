import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useBookProfile } from '../src/components/app/useBookProfile';
import { BookOverview } from '../src/components/app/BookOverview';
import { buildProjectIndex } from '../src/lib/project-context';
import { TauriFileSystem } from '../src/lib/tauri-fs';
import { scanManuscriptTotals } from '../src/lib/manuscript-stats';

vi.mock('../src/lib/project-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/project-context')>();
  return { ...actual, buildProjectIndex: vi.fn() };
});
vi.mock('../src/lib/manuscript-stats', () => ({ scanManuscriptTotals: vi.fn() }));
vi.mock('../src/lib/tauri-fs', () => ({
  TauriFileSystem: { readFile: vi.fn(), writeFile: vi.fn(), createDir: vi.fn() },
}));
vi.mock('../src/lib/toast', () => ({ emitToast: vi.fn() }));

const mockedBuild = vi.mocked(buildProjectIndex);
const mockedRead = vi.mocked(TauriFileSystem.readFile);
const mockedWrite = vi.mocked(TauriFileSystem.writeFile);
const mockedCreateDir = vi.mocked(TauriFileSystem.createDir);
const mockedTotals = vi.mocked(scanManuscriptTotals);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness({ projectPath = 'D:/book' }: { projectPath?: string | null }) {
  const handle = useBookProfile({ activeProject: projectPath, active: true });
  return (
    <div
      data-profile-error={handle.profileError ?? ''}
      data-outline-error={handle.outlineError ?? ''}
      data-save-error={handle.saveError ?? ''}
      data-outline-loading={handle.outlineLoading ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={() => void handle.save({ ...handle.profile, title: '新标题' })}
      >
        save
      </button>
      <output>{handle.profile.title}</output>
    </div>
  );
}

const emptyIndex = (projectPath: string) => ({
  projectPath,
  files: [],
  summary: {
    hasStoryStructure: false,
    counts: {
      outline: 0,
      character: 0,
      setting: 0,
      timeline: 0,
      foreshadowing: 0,
      knowledge: 0,
      draft: 0,
      quality: 0,
      export: 0,
      other: 0,
    },
  },
});

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness />));
  await act(async () => {});
}

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  mockedBuild.mockReset();
  mockedRead.mockReset();
  mockedWrite.mockReset();
  mockedCreateDir.mockReset();
  mockedTotals.mockReset();
});

beforeEach(() => {
  mockedBuild.mockResolvedValue(emptyIndex('D:/book'));
  mockedRead.mockImplementation(async (path) =>
    path.endsWith('book.json') ? '{"title":"旧标题"}' : '',
  );
  mockedCreateDir.mockResolvedValue(undefined);
  mockedWrite.mockResolvedValue(undefined);
  mockedTotals.mockResolvedValue({ chapters: 0, chars: 0, unreadable: 0 });
});

test('surfaces non-missing profile read errors instead of silently showing empty metadata', async () => {
  mockedRead.mockRejectedValueOnce(new Error('permission denied'));
  await render();
  assert.equal(
    container!.querySelector('[data-profile-error]')?.getAttribute('data-profile-error'),
    'permission denied',
  );
});

test('surfaces outline index read errors and keeps outline loading terminal', async () => {
  mockedBuild.mockRejectedValueOnce(new Error('目录读取失败'));
  await render();
  assert.equal(
    container!.querySelector('[data-outline-error]')?.getAttribute('data-outline-error'),
    '目录读取失败',
  );
  assert.equal(
    container!.querySelector('[data-outline-loading]')?.getAttribute('data-outline-loading'),
    'false',
  );
});

test('keeps optimistic profile value but exposes save failure for retry UX', async () => {
  mockedWrite.mockRejectedValueOnce(new Error('写入被拒绝'));
  await render();
  await act(async () => (container!.querySelector('button') as HTMLButtonElement).click());
  assert.equal(container!.querySelector('output')?.textContent, '新标题');
  assert.equal(
    container!.querySelector('[data-save-error]')?.getAttribute('data-save-error'),
    '写入被拒绝',
  );
});

test('does not project a late save failure into a different project lifetime', async () => {
  let rejectWrite!: (reason?: unknown) => void;
  mockedWrite.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectWrite = reject;
      }),
  );
  await render();
  await act(async () => (container!.querySelector('button') as HTMLButtonElement).click());
  await act(async () => root!.render(<Harness projectPath="D:/other-book" />));
  rejectWrite(new Error('旧项目写入失败'));
  await act(async () => {});
  assert.equal(container!.querySelector('[data-save-error]')?.getAttribute('data-save-error'), '');
});

test('总览通过真实读取 hook 重试恢复，成功的空档案才显示填写引导', async () => {
  function OverviewHarness() {
    const profile = useBookProfile({ activeProject: 'D:/book', active: true });
    return <BookOverview projectPath="D:/book" profile={profile} onContinueWriting={() => {}} />;
  }
  mockedRead.mockRejectedValueOnce(new Error('档案无读取权限'));
  mockedBuild.mockRejectedValueOnce(new Error('大纲目录无法读取'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<OverviewHarness />));
  assert.match(container!.textContent ?? '', /档案无读取权限/);
  assert.match(container!.textContent ?? '', /大纲目录无法读取/);
  assert.doesNotMatch(container!.textContent ?? '', /还没有简介|尚未设置全书字数目标|还没有可展示/);
  mockedRead.mockImplementation(async () => '');
  await act(async () =>
    container!
      .querySelector<HTMLButtonElement>('[data-testid="book-overview-retry-profile"]')!
      .click(),
  );
  assert.doesNotMatch(container!.textContent ?? '', /档案无读取权限|大纲目录无法读取/);
  assert.match(container!.textContent ?? '', /还没有简介/);
  assert.match(container!.textContent ?? '', /尚未设置全书字数目标/);
  assert.match(container!.textContent ?? '', /还没有可展示的大纲标题/);
  assert.equal(mockedWrite.mock.calls.length, 0);
});
