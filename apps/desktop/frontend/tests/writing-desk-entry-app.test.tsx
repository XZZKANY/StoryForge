import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { App } from '../src/App';
import { RECENT_PROJECTS_KEY } from '../src/components/app/helpers';
import { invalidateFileSystemCache, type FileEntry } from '../src/lib/tauri-fs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 编辑器换成探针：显示当前文件；没文件时照真 Editor 的样子把壳层给的去处画出来。
vi.mock('../src/components/Editor', () => ({
  Editor: ({ filePath, emptyState }: { filePath: string | null; emptyState?: ReactNode }) => (
    <div data-testid="editor-probe" data-file={filePath ?? ''}>
      {filePath ? null : emptyState}
    </div>
  ),
}));
vi.mock('../src/components/ChatWindow', () => ({ ChatWindow: () => <div /> }));

function entry(path: string, isDir: boolean): FileEntry {
  const name = path.split('/').pop()!;
  return {
    name,
    path,
    isDir,
    size: isDir ? 0 : 10,
    modified: 1,
    extension: isDir ? undefined : 'md',
  };
}

async function openProject(projectPath: string, files: string[]) {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"detail":"offline test"}', { status: 503 })),
  );
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
  }
  const entries = [
    entry(projectPath, true),
    ...[...dirs].map((dir) => entry(`${projectPath}/${dir}`, true)),
    ...files.map((file) => entry(`${projectPath}/${file}`, false)),
  ];
  window.__STORYFORGE_MOCK_FS__ = {
    listDir: (path: string, recursive?: boolean) =>
      recursive
        ? entries
        : entries.filter((item) => item.path.slice(0, item.path.lastIndexOf('/')) === path),
    pathExists: () => true,
    readFile: () => '',
  };
  invalidateFileSystemCache(projectPath);
  localStorage.clear();
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify([projectPath]));
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<App />));
  await act(async () =>
    Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes(projectPath.split('/').pop()!))!
      .click(),
  );
  const get = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = async (id: string) => {
    expect(get(id), id).toBeTruthy();
    await act(async () => get(id)!.click());
  };
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
  };
  await settle();
  return {
    host,
    get,
    click,
    settle,
    file: () => get('editor-probe')?.getAttribute('data-file') ?? null,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
      localStorage.clear();
      delete window.__STORYFORGE_MOCK_FS__;
      invalidateFileSystemCache(projectPath);
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}

test('从总览点「写作工作台」：没开着文件就直接打开停下的那一章（阅读序最新一章）', async () => {
  const app = await openProject('D:/desk-test', [
    '.草稿/废稿.md',
    '正文/第001章.md',
    '正文/第002章.md',
  ]);
  try {
    expect(app.get('desktop-shell')?.getAttribute('data-main-surface')).toBe('overview');
    await app.click('open-writing-workspace');
    await app.settle();
    expect(app.get('desktop-shell')?.getAttribute('data-main-surface')).toBe('workspace');
    expect(app.file()).toBe('D:/desk-test/正文/第002章.md');
  } finally {
    await app.cleanup();
  }
});

test('从别的入口进写作台不自动开章，中栏给「接着写第 N 章」', async () => {
  const app = await openProject('D:/desk-side', ['正文/第001章.md', '正文/第002章.md']);
  try {
    await app.click('activity-explorer');
    await app.settle();
    expect(app.file()).toBe('');
    expect(app.get('writing-desk-resume-chapter')?.textContent).toBe('接着写第 2 章');
    await app.click('writing-desk-resume-chapter');
    await app.settle();
    expect(app.file()).toBe('D:/desk-side/正文/第002章.md');
  } finally {
    await app.cleanup();
  }
});

test('空书进写作台：中栏先引去和 AI 聊，点了切成对话占满', async () => {
  const app = await openProject('D:/desk-empty', []);
  try {
    await app.click('open-writing-workspace');
    await app.settle();
    expect(app.file()).toBe('');
    expect(app.get('writing-desk-empty-book')?.textContent).toContain('这本书还没有正文');
    await app.click('writing-desk-discuss-book');
    expect(app.get('desktop-shell')?.getAttribute('data-layout-focus')).toBe('chat');
  } finally {
    await app.cleanup();
  }
});
