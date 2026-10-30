/** 批量写章的页签：只关调度器打开的，作者原本开着的、写完又被改过（未保存）的都不动。 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useWriteBatchTabs } from '../src/components/app/useWriteBatchTabs';
import {
  closeWriteBatchTab,
  dropWriteBatchTab,
  noteWriteBatchTarget,
  writeBatchTabDirty,
} from '../src/lib/write-batch-tabs';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = 'D:\\book';
const tab = (ordinal: number) => `${ROOT}\\正文\\第00${ordinal}章.md`;

let root: Root;
let host: HTMLDivElement;
let openFiles: string[];
let dirtyFiles: Set<string>;
const handleFileClose = vi.fn(async (path: string) => {
  openFiles = openFiles.filter((item) => item !== path);
});
const dropOpenFilePath = vi.fn((path: string) => {
  openFiles = openFiles.filter((item) => item !== path);
});

function Shell() {
  useWriteBatchTabs({
    openFiles,
    previewFile: null,
    dirtyFiles,
    handleFileClose,
    dropOpenFilePath,
  });
  return null;
}
const rerender = () => act(async () => root.render(<Shell />));

beforeEach(async () => {
  handleFileClose.mockClear();
  dropOpenFilePath.mockClear();
  openFiles = [tab(1)];
  dirtyFiles = new Set();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await rerender();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('开写前没开着、写进文件后打开的：下一章开写时关掉（路径写法不同也认）', async () => {
  noteWriteBatchTarget(`D:/book/正文/第004章.md`);
  openFiles = [tab(1), tab(4)];
  await rerender();
  closeWriteBatchTab(`D:/book/正文/第004章.md`);
  expect(handleFileClose).toHaveBeenCalledWith(tab(4));
});

it('作者原本开着的不关', async () => {
  openFiles = [tab(1), tab(4)];
  await rerender();
  noteWriteBatchTarget(tab(4));
  closeWriteBatchTab(tab(4));
  expect(handleFileClose).not.toHaveBeenCalled();
});

it('写进去以后作者又动过（有未保存修改）的不关；没记过开写前状态的也不关', async () => {
  noteWriteBatchTarget(tab(4));
  openFiles = [tab(1), tab(4)];
  dirtyFiles = new Set([tab(4)]);
  await rerender();
  closeWriteBatchTab(tab(4));
  closeWriteBatchTab(tab(1));
  expect(handleFileClose).not.toHaveBeenCalled();
});

it('清单上撤销：删之前答得出这一章有没有未保存的修改（路径写法不同也认）', async () => {
  openFiles = [tab(1), tab(4), tab(5)];
  dirtyFiles = new Set([tab(5)]);
  await rerender();
  expect(writeBatchTabDirty('D:/book/正文/第005章.md')).toBe(true);
  expect(writeBatchTabDirty('D:/book/正文/第004章.md')).toBe(false);
  expect(writeBatchTabDirty('D:/book/正文/第009章.md')).toBe(false);
});

it('删掉以后摘掉它的页签；有未保存修改的不动，没开着的什么也不做', async () => {
  openFiles = [tab(1), tab(4), tab(5)];
  dirtyFiles = new Set([tab(5)]);
  await rerender();
  dropWriteBatchTab('D:/book/正文/第004章.md');
  dropWriteBatchTab('D:/book/正文/第005章.md');
  dropWriteBatchTab('D:/book/正文/第009章.md');
  expect(dropOpenFilePath.mock.calls).toEqual([[tab(4)]]);
  expect(handleFileClose).not.toHaveBeenCalled();
});
