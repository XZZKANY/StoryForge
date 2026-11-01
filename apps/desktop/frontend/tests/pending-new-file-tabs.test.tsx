import assert from 'node:assert/strict';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useEditorWorkspaceTabs } from '../src/components/app/useEditorWorkspaceTabs';
import { useProjectWorkspace } from '../src/components/app/useProjectWorkspace';
import { useSessionRestore } from '../src/components/app/useSessionRestore';
import { TauriFileSystem } from '../src/lib/host/tauri-fs';
import { TOAST_EVENT, type ToastDetail } from '../src/lib/toast';
import type { FileEntry } from '@storyforge/project-core';

vi.mock('../src/lib/host/tauri-env', () => ({ isTauriRuntime: () => true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION_KEY = 'storyforge:workspace-session';
const PROJECT = 'P';
const CHAPTER1 = 'P/正文/第1章.md';
const NEW_CHAPTER = 'P/正文/第003章.md';
const JOURNALS = 'P/.storyforge/pending-suggestions';
const dialogs = {
  alert: async () => undefined,
  confirm: async () => false,
  choose: async () => null,
  prompt: async () => null,
};
const noop = () => undefined;
const mounted: Array<() => void> = [];
const toasts: ToastDetail[] = [];
const onToast = (event: Event) => toasts.push((event as CustomEvent<ToastDetail>).detail);

async function journalName(file: string) {
  const relative = file.slice(PROJECT.length + 1);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(relative));
  return `${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}.json`;
}

function descriptor(file: string, before = '') {
  return JSON.stringify({
    version: 1,
    owner: 'owner-1',
    proposal: {
      id: 'chapter-writing-1',
      filePath: file,
      title: '第003章.md',
      summary: '章节草稿通过了章纲检查',
      before,
      after: '# 第3章\n\n周梨去问老读者。',
      note: '',
      createdAt: 1,
      runId: 'run-33',
      assistantSessionId: 4,
      requiresConfirmation: true,
    },
    requests: [],
  });
}

type Disk = { files: Map<string, string>; journals: FileEntry[] };

async function diskWith(journals: Array<{ name?: string; target: string; raw: string }>) {
  const disk: Disk = { files: new Map([[CHAPTER1, '# 第1章']]), journals: [] };
  for (const journal of journals) {
    const name = journal.name ?? (await journalName(journal.target));
    const path = `${JOURNALS}/${name}`;
    disk.files.set(path, journal.raw);
    disk.journals.push({ name, path, isDir: false, size: journal.raw.length, modified: 0 });
  }
  const exists = (path: string) => path === PROJECT || path === JOURNALS || disk.files.has(path);
  vi.spyOn(TauriFileSystem, 'projectFolderExists').mockImplementation(async (path) => exists(path));
  vi.spyOn(TauriFileSystem, 'projectPathExists').mockImplementation(async (_root, path) =>
    exists(path),
  );
  vi.spyOn(TauriFileSystem, 'listProjectDir').mockImplementation(async (root, path) => {
    assert.equal(root, PROJECT);
    assert.equal(path, JOURNALS);
    return disk.journals;
  });
  vi.spyOn(TauriFileSystem, 'readProjectFile').mockImplementation(async (_root, path) => {
    const raw = disk.files.get(path);
    if (raw === undefined) throw new Error(`missing ${path}`);
    return raw;
  });
  return disk;
}

function mountApp() {
  let value!: {
    workspace: ReturnType<typeof useProjectWorkspace>;
    tabs: ReturnType<typeof useEditorWorkspaceTabs>;
    session: ReturnType<typeof useSessionRestore>;
  };
  function Probe() {
    const workspace = useProjectWorkspace({ onProjectSelected: noop, onFileSelected: noop });
    const session = useSessionRestore({
      enabled: true,
      deferUntilProjectSelected: true,
      selectProject: workspace.selectProject,
    });
    const tabs = useEditorWorkspaceTabs({
      activeProject: workspace.activeProject,
      currentFile: workspace.currentFile,
      selectProject: session.selectProjectManually,
      selectFile: workspace.selectFile,
      closeFile: workspace.closeFile,
      removeProject: workspace.removeProject,
      dialogs,
      onShowEditor: noop,
      pendingRestore: session.pendingRestore,
      onRestoreApplied: session.handleRestoreApplied,
    });
    useEffect(() =>
      session.persistSession(workspace.activeProject, tabs.openFiles, workspace.currentFile),
    );
    value = { workspace, tabs, session };
    return null;
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<Probe />));
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return {
    get value() {
      return value;
    },
  };
}

async function settle() {
  for (let index = 0; index < 8; index += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

beforeEach(() => {
  localStorage.clear();
  // 重启前作者开着第 1 章和 AI 刚起草、尚未接受的第 3 章。
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      project: PROJECT,
      openFiles: [CHAPTER1, NEW_CHAPTER],
      activeFile: CHAPTER1,
      cursors: {},
    }),
  );
  toasts.length = 0;
  window.addEventListener(TOAST_EVENT, onToast);
});
afterEach(() => {
  window.removeEventListener(TOAST_EVENT, onToast);
  mounted.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});

test('重启恢复现场后，待确认的新建章节页签被放回，并给出可跳转的提示', async () => {
  await diskWith([{ target: NEW_CHAPTER, raw: descriptor(NEW_CHAPTER) }]);
  const app = mountApp();
  act(() => app.value.session.selectProjectManually(PROJECT));
  await settle();
  assert.equal(app.value.workspace.activeProject, PROJECT);
  assert.deepEqual(app.value.tabs.openFiles, [CHAPTER1, NEW_CHAPTER]);
  assert.equal(app.value.workspace.currentFile, CHAPTER1, '后台挂回，不抢作者正在看的稿');
  assert.equal(toasts.length, 1);
  assert.match(toasts[0].message, /第003章\.md.*待确认的新稿/);
  await act(async () => toasts[0].action!.run());
  assert.equal(app.value.workspace.currentFile, NEW_CHAPTER);
});

test('换到没有存档现场的作品时，同样找回待确认的新建文件', async () => {
  localStorage.clear();
  await diskWith([{ target: NEW_CHAPTER, raw: descriptor(NEW_CHAPTER) }]);
  const app = mountApp();
  act(() => app.value.session.selectProjectManually(PROJECT));
  await settle();
  assert.deepEqual(app.value.tabs.openFiles, [NEW_CHAPTER]);
  assert.equal(toasts.length, 1);
});

test.each([
  ['已作废的日志', async () => [{ target: NEW_CHAPTER, raw: 'null' }]],
  [
    '不是新建（原文非空）',
    async () => [{ target: NEW_CHAPTER, raw: descriptor(NEW_CHAPTER, '旧稿') }],
  ],
  [
    '日志名与目标对不上',
    async () => [
      { name: await journalName(CHAPTER1), target: NEW_CHAPTER, raw: descriptor(NEW_CHAPTER) },
    ],
  ],
  ['损坏的日志', async () => [{ target: NEW_CHAPTER, raw: '{"version":' }]],
] as const)('%s不挂回页签、不提示，也不挡作品打开', async (_label, journals) => {
  await diskWith(await journals());
  const app = mountApp();
  act(() => app.value.session.selectProjectManually(PROJECT));
  await settle();
  assert.equal(app.value.workspace.activeProject, PROJECT);
  assert.deepEqual(app.value.tabs.openFiles, [CHAPTER1]);
  assert.equal(toasts.length, 0);
});

test('目标已经落盘（作者已接受）时不重复挂回', async () => {
  const disk = await diskWith([{ target: NEW_CHAPTER, raw: descriptor(NEW_CHAPTER) }]);
  disk.files.set(NEW_CHAPTER, '# 第3章\n\n周梨去问老读者。');
  const app = mountApp();
  act(() => app.value.session.selectProjectManually(PROJECT));
  await settle();
  assert.deepEqual(app.value.tabs.openFiles, [CHAPTER1, NEW_CHAPTER]);
  assert.equal(toasts.length, 0, '页签是恢复现场原样恢复的，不是待确认新稿');
});
