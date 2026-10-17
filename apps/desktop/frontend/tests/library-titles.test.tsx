/**
 * 作品库（作者 10-17 巡检）：改了书名作品库和文件树顶部仍是文件夹名；作品库行上没有「移出」；
 * 新建作品每次都得从系统对话框重选保存位置。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { ProjectLibrary } from '../src/components/app/ProjectLibrary';
import { useBookTitles } from '../src/components/app/useBookTitles';
import { defaultNewProjectParent } from '../src/components/app/useNewProject';
import { FS_MUTATION_EVENT, TauriFileSystem } from '../src/lib/tauri-fs';

vi.mock('../src/lib/tauri-fs', () => ({
  FS_MUTATION_EVENT: 'storyforge:fs-mutation',
  TauriFileSystem: { readProjectFile: vi.fn() },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOOK = 'D:\\连载\\末世吞噬';
const OTHER = 'D:\\连载\\新书';
const titles = new Map<string, string>([[BOOK, '末世吞噬·修订版']]);

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.mocked(TauriFileSystem.readProjectFile).mockImplementation(async (project: string) => {
    const title = titles.get(project);
    if (title === undefined) throw new Error('missing');
    return JSON.stringify({ version: 1, title, synopsis: '', tags: [], cover: null, wordGoal: 0 });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Library({ onRemove }: { onRemove: (path: string) => void }) {
  const titleOf = useBookTitles([BOOK, OTHER]);
  return (
    <ProjectLibrary
      projects={[BOOK, OTHER]}
      activeProject={BOOK}
      onNewProject={() => undefined}
      onOpenProject={() => undefined}
      onSelectProject={() => undefined}
      onResumeProject={() => undefined}
      onOpenSettings={() => undefined}
      titleOf={titleOf}
      onRemoveProject={onRemove}
    />
  );
}

test('作品库显示作品资料里的书名；没起名的用文件夹名；书名改了跟着变', async () => {
  await act(async () => root.render(<Library onRemove={() => undefined} />));
  const row = (path: string) =>
    container.querySelector(`[data-project-path="${CSS.escape(path)}"]`)?.textContent ?? '';
  const text = () => row(BOOK);
  assert.match(row(BOOK), /末世吞噬·修订版/);
  assert.match(row(OTHER), /新书/);

  titles.set(BOOK, '吞噬纪元');
  await act(async () =>
    window.dispatchEvent(
      new CustomEvent(FS_MUTATION_EVENT, { detail: { path: `${BOOK}\\.storyforge\\book.json` } }),
    ),
  );
  assert.match(text(), /吞噬纪元/);
  titles.set(BOOK, '末世吞噬·修订版');
});

test('能按书名搜；当前作品之外的每一本都能从作品库移除', async () => {
  const onRemove = vi.fn();
  await act(async () => root.render(<Library onRemove={onRemove} />));
  const removes = container.querySelectorAll<HTMLButtonElement>(
    '[data-testid="library-remove-project"]',
  );
  assert.equal(removes.length, 1, '正在写的那本不给移除');
  act(() => removes[0]!.click());
  assert.deepEqual(onRemove.mock.calls[0], [OTHER]);

  const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, '修订');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const rows = [...container.querySelectorAll('[data-project-path]')].map((row) =>
    row.getAttribute('data-project-path'),
  );
  assert.deepEqual(rows, [BOOK]);
});

test('新建作品的保存位置默认放在正在写的那本（没开就最近那本）旁边', () => {
  assert.equal(defaultNewProjectParent(BOOK), 'D:\\连载');
  localStorage.setItem('recent-projects', JSON.stringify(['E:\\书\\旧书', BOOK]));
  assert.equal(defaultNewProjectParent(null), 'E:\\书');
  localStorage.clear();
  assert.equal(defaultNewProjectParent(null), '');
  assert.equal(defaultNewProjectParent('D:\\末世吞噬'), 'D:\\', '盘符根下补上分隔符');
});
