import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useBookProfile } from '../src/components/app/useBookProfile';
import { BookOverview } from '../src/components/app/BookOverview';
import {
  DiskDriftError,
  HostFileError,
  ProjectFileMissingError,
  ProjectPathOutsideError,
} from '../src/lib/host-file-errors';
import { buildProjectIndex } from '../src/lib/project-context';
import { TauriFileSystem } from '../src/lib/tauri-fs';
import { scanManuscriptTotals } from '../src/lib/manuscript-stats';

vi.mock('../src/lib/project-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/project-context')>();
  return { ...actual, buildProjectIndex: vi.fn() };
});
vi.mock('../src/lib/manuscript-stats', () => ({ scanManuscriptTotals: vi.fn() }));
vi.mock('../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    readProjectFile: vi.fn(),
    writeFile: vi.fn(),
    writeFileIfUnchanged: vi.fn(),
    createDir: vi.fn(),
  },
}));
vi.mock('../src/lib/toast', () => ({ emitToast: vi.fn() }));

const mockedBuild = vi.mocked(buildProjectIndex);
const mockedRead = vi.mocked(TauriFileSystem.readProjectFile);
const mockedWrite = vi.mocked(TauriFileSystem.writeFile);
const mockedCondWrite = vi.mocked(TauriFileSystem.writeFileIfUnchanged);
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
  mockedCondWrite.mockReset();
  mockedCreateDir.mockReset();
  mockedTotals.mockReset();
});

beforeEach(() => {
  mockedBuild.mockResolvedValue(emptyIndex('D:/book'));
  mockedRead.mockImplementation(async (_root, path) =>
    path.endsWith('book.json') ? '{"title":"旧标题"}' : '',
  );
  mockedCreateDir.mockResolvedValue(undefined);
  mockedWrite.mockResolvedValue(undefined);
  mockedCondWrite.mockResolvedValue(undefined);
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
  mockedCondWrite.mockRejectedValueOnce(new Error('写入被拒绝'));
  await render();
  await act(async () => (container!.querySelector('button') as HTMLButtonElement).click());
  assert.equal(container!.querySelector('output')?.textContent, '新标题');
  assert.deepEqual(mockedCondWrite.mock.calls[0]?.[3], {
    kind: 'content',
    content: '{"title":"旧标题"}',
  });
  assert.equal(
    container!.querySelector('[data-save-error]')?.getAttribute('data-save-error'),
    '写入被拒绝',
  );
});

test('does not project a late save failure into a different project lifetime', async () => {
  let rejectWrite!: (reason?: unknown) => void;
  mockedCondWrite.mockImplementationOnce(
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

test('档案读取失败：保存不写盘，原档案不被默认值盖掉', async () => {
  mockedRead.mockImplementation(async (_root, path) => {
    if (path.endsWith('book.json')) throw new Error('permission denied');
    return '';
  });
  await render();
  await act(async () => (container!.querySelector('button') as HTMLButtonElement).click());
  assert.equal(mockedCondWrite.mock.calls.length, 0);
  assert.equal(mockedWrite.mock.calls.length, 0);
  assert.match(
    container!.querySelector('[data-save-error]')?.getAttribute('data-save-error') ?? '',
    /档案没读出来/,
  );
});

test('book.json 不是有效的 JSON：如实报出，保存也不写盘', async () => {
  mockedRead.mockImplementation(async (_root, path) =>
    path.endsWith('book.json') ? '{"title":"旧标题",}' : '',
  );
  await render();
  assert.match(
    container!.querySelector('[data-profile-error]')?.getAttribute('data-profile-error') ?? '',
    /不是有效的 JSON/,
  );
  await act(async () => (container!.querySelector('button') as HTMLButtonElement).click());
  assert.equal(mockedCondWrite.mock.calls.length, 0);
});

test('宿主报文件还没有（missing）：当作档案还没建，保存以「不存在」为基线新建', async () => {
  mockedRead.mockImplementation(async (_root, path) => {
    if (path.endsWith('book.json')) throw new ProjectFileMissingError(`作品文件不存在: ${path}`);
    return '';
  });
  await render();
  assert.equal(
    container!.querySelector('[data-profile-error]')?.getAttribute('data-profile-error'),
    '',
  );
  await act(async () => (container!.querySelector('button') as HTMLButtonElement).click());
  assert.deepEqual(mockedCondWrite.mock.calls[0]?.[3], { kind: 'missing' });
  assert.ok(mockedRead.mock.calls.length > 0);
  assert.ok(mockedRead.mock.calls.every(([projectRoot]) => projectRoot === 'D:/book'));
});

test('宿主报越出作品（outside-project）：不当成还没建，如实报出且不写盘', async () => {
  mockedRead.mockImplementation(async (_root, path) => {
    if (path.endsWith('book.json'))
      throw new ProjectPathOutsideError(`路径不在当前作品内: ${path}`);
    return '';
  });
  await render();
  assert.match(
    container!.querySelector('[data-profile-error]')?.getAttribute('data-profile-error') ?? '',
    /路径不在当前作品内/,
  );
  await act(async () => (container!.querySelector('button') as HTMLButtonElement).click());
  assert.equal(mockedCondWrite.mock.calls.length, 0);
});

test('作品目录本身读不了（io，中文 Windows 系统原话带「找不到」）：不当成档案还没建，如实报出且不写盘', async () => {
  const detail = '无法解析作品目录 D:/book: 系统找不到指定的路径。 (os error 3)';
  mockedRead.mockImplementation(async (_root, path) => {
    if (path.endsWith('book.json')) throw new HostFileError(detail);
    return '';
  });
  await render();
  assert.equal(
    container!.querySelector('[data-profile-error]')?.getAttribute('data-profile-error'),
    detail,
  );
  await act(async () => (container!.querySelector('button') as HTMLButtonElement).click());
  assert.equal(mockedCondWrite.mock.calls.length, 0);
  assert.equal(mockedWrite.mock.calls.length, 0);
});

test('没改动的保存不写盘', async () => {
  mockedRead.mockImplementation(async (_root, path) =>
    path.endsWith('book.json') ? '{"title":"新标题"}' : '',
  );
  await render();
  await act(async () => (container!.querySelector('button') as HTMLButtonElement).click());
  assert.equal(mockedCondWrite.mock.calls.length, 0);
  assert.equal(mockedWrite.mock.calls.length, 0);
});

test('连着两次保存排队写：第二次以第一次写下的内容为基线，不被当成别处改过', async () => {
  let disk = '{"title":"旧标题"}';
  mockedRead.mockImplementation(async (_root, path) => (path.endsWith('book.json') ? disk : ''));
  mockedCondWrite.mockImplementation(async (_root, _path, content, expected) => {
    await Promise.resolve();
    if (expected.kind !== 'content' || expected.content !== disk)
      throw new DiskDriftError('磁盘内容已变化，已拒绝覆盖；请重新读取并处理冲突');
    disk = content;
  });
  function TwoSaves() {
    const handle = useBookProfile({ activeProject: 'D:/book', active: true });
    return (
      <button
        type="button"
        onClick={() => {
          void handle.save({ ...handle.profile, title: '一' });
          void handle.save({ ...handle.profile, title: '一', synopsis: '二' });
        }}
      >
        save
      </button>
    );
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<TwoSaves />));
  await act(async () => {});
  await act(async () => (container!.querySelector('button') as HTMLButtonElement).click());
  await act(async () => {});
  assert.equal(mockedCondWrite.mock.calls.length, 2);
  assert.match(disk, /"synopsis": "二"/);
});
