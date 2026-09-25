import assert from 'node:assert/strict';
import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { open as chooseDirectory } from '@tauri-apps/plugin-dialog';
import { App } from '../src/App';
import type { Editor as DesktopEditor } from '../src/components/Editor';
import { RECENT_PROJECTS_KEY } from '../src/components/app/helpers';
import { TauriFileSystem } from '../src/lib/tauri-fs';
import { APP_SETTINGS_KEY, DEFAULT_APP_SETTINGS } from '../src/lib/user-settings';
import { parseWorkspaceSession, type WorkspaceSession } from '../src/lib/workspace-session';

// 真 App / shell / workspace / session / tabs；只替换重型叶子，以公开 props 检查 editor seam。
// 这里证明 cursor 被交给 Editor，不冒充实际 Monaco 定位或原生文件系统验收。
type EditorProbeProps = Pick<
  ComponentProps<typeof DesktopEditor>,
  'projectPath' | 'filePath' | 'initialCursors' | 'retainedFilePaths' | 'onDirtyChange'
>;
vi.mock('../src/components/Editor', () => ({
  Editor: ({
    projectPath,
    filePath,
    initialCursors,
    retainedFilePaths,
    onDirtyChange,
  }: EditorProbeProps) => (
    <output
      data-testid="restore-editor-probe"
      data-project={projectPath ?? ''}
      data-file={filePath ?? ''}
      data-cursors={JSON.stringify(initialCursors)}
      data-retained-files={JSON.stringify(retainedFilePaths)}
    >
      <button data-testid="restore-dirty-probe" onClick={() => onDirtyChange?.(filePath, true)}>
        标记未保存
      </button>
    </output>
  ),
}));
vi.mock('../src/components/ChatWindow', () => ({ ChatWindow: () => null }));
vi.mock('../src/components/SettingsView', () => ({ SettingsView: () => null }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const SESSION_KEY = 'storyforge:workspace-session';
const ROOT = 'D:/__library_restore_test__/存档作品';
const OTHER = 'D:/__library_restore_test__/另一作品';
const stored: WorkspaceSession = {
  project: ROOT,
  openFiles: [`${ROOT}/正文/01.md`, `${ROOT}/大纲/总纲.md`],
  activeFile: `${ROOT}/正文/01.md`,
  cursors: {
    [`${ROOT}/正文/01.md`]: { line: 17, column: 4 },
    [`${ROOT}/大纲/总纲.md`]: { line: 5, column: 2 },
  },
};
const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLElement }> = [];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify([ROOT, OTHER]));
  localStorage.setItem(
    APP_SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_APP_SETTINGS, restoreLastSession: true }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"detail":"isolated restore fixture"}', { status: 503 })),
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(TauriFileSystem, 'readFile').mockRejectedValue(
    new Error('ENOENT: isolated fixture has no metadata'),
  );
  vi.spyOn(TauriFileSystem, 'listDir').mockResolvedValue([]);
  vi.spyOn(TauriFileSystem, 'writeFile').mockRejectedValue(new Error('unexpected fixture write'));
  vi.spyOn(TauriFileSystem, 'createDir').mockRejectedValue(new Error('unexpected fixture mkdir'));
  vi.mocked(chooseDirectory).mockReset();
});
afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function mountApp() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => root.render(<App />));
  return host;
}
const get = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const surface = (host: HTMLElement) => get(host, 'desktop-shell')?.dataset.mainSurface;
async function click(target: HTMLElement | null | undefined) {
  assert.ok(target, 'public UI target exists');
  await act(async () => target.click());
}
const recent = (host: HTMLElement, path: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[data-project-path]')).find(
    (button) => button.dataset.projectPath === path,
  );
const tabPaths = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLElement>('[role="tab"][data-tab-path]')).map(
    (tab) => tab.dataset.tabPath,
  );
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('真实 App 有存档仍先停作品库；仅点击同一最近作品后校验、恢复页签/正文并传递光标', async () => {
  const check = deferred<boolean>();
  const exists = vi
    .spyOn(TauriFileSystem, 'pathExists')
    .mockImplementation(async (path) =>
      path === ROOT ? check.promise : stored.openFiles.includes(path),
    );
  const host = await mountApp();
  assert.equal(surface(host), 'library');
  assert.equal(get(host, 'library-resume-project'), null, '启动尚未选择当前作品');
  assert.equal(get(host, 'restore-editor-probe'), null);
  assert.equal(exists.mock.calls.length, 0, '启动不自动校验存档或选择项目');
  assert.deepEqual(parseWorkspaceSession(localStorage.getItem(SESSION_KEY)), stored);
  await click(recent(host, ROOT));
  assert.equal(surface(host), 'library');
  assert.match(get(host, 'project-library')?.textContent ?? '', /正在打开「存档作品」/);
  assert.equal(get(host, 'restore-editor-probe'), null);
  assert.deepEqual(parseWorkspaceSession(localStorage.getItem(SESSION_KEY)), stored);
  await act(async () => {
    check.resolve(true);
    await Promise.resolve();
  });
  assert.equal(surface(host), 'workspace');
  assert.equal(get(host, 'writing-workspace-surface')?.hidden, false);
  assert.deepEqual(tabPaths(host), stored.openFiles);
  const editor = get(host, 'restore-editor-probe');
  assert.equal(editor?.dataset.project, ROOT);
  assert.equal(editor?.dataset.file, stored.activeFile);
  assert.deepEqual(JSON.parse(editor?.dataset.cursors ?? 'null'), stored.cursors);
  assert.deepEqual(JSON.parse(editor?.dataset.retainedFiles ?? 'null'), stored.openFiles);
  assert.deepEqual(parseWorkspaceSession(localStorage.getItem(SESSION_KEY)), stored);
});

test('真实 App 选择另一最近作品只进入其总览，不错误恢复旧作品页签或光标', async () => {
  const exists = vi.spyOn(TauriFileSystem, 'pathExists').mockResolvedValue(false);
  const host = await mountApp();
  await click(recent(host, OTHER));
  assert.equal(surface(host), 'overview');
  assert.deepEqual(tabPaths(host), []);
  const editor = get(host, 'restore-editor-probe');
  assert.equal(editor?.dataset.project, OTHER);
  assert.equal(editor?.dataset.file, '');
  assert.equal(JSON.parse(editor?.dataset.cursors ?? 'null'), null);
  assert.ok(
    !exists.mock.calls.some(([path]) => stored.openFiles.includes(path)),
    '不启动旧文件恢复校验',
  );
  assert.deepEqual(parseWorkspaceSession(localStorage.getItem(SESSION_KEY)), {
    project: OTHER,
    openFiles: [],
    activeFile: null,
    cursors: {},
  });
});

test('恢复校验中显式返回作品库，迟到结果不能夺走导航；之后仍可重试原存档', async () => {
  const check = deferred<boolean>();
  const exists = vi
    .spyOn(TauriFileSystem, 'pathExists')
    .mockImplementation(async (path) =>
      path === ROOT ? check.promise : stored.openFiles.includes(path),
    );
  const host = await mountApp();
  await click(recent(host, ROOT));
  await click(get(host, 'titlebar-library'));
  assert.doesNotMatch(get(host, 'project-library')?.textContent ?? '', /正在打开/);
  await act(async () => {
    check.resolve(true);
    await Promise.resolve();
  });
  assert.equal(surface(host), 'library');
  assert.equal(get(host, 'restore-editor-probe'), null);
  assert.deepEqual(parseWorkspaceSession(localStorage.getItem(SESSION_KEY)), stored);
  exists.mockResolvedValue(true);
  await click(recent(host, ROOT));
  assert.equal(surface(host), 'workspace');
  assert.deepEqual(tabPaths(host), stored.openFiles);
});

test('打开新建对话框接管在途恢复；新建文件系统等待期间旧结果不切项目或令创建过期', async () => {
  const restoreCheck = deferred<boolean>();
  const mkdir = deferred<void>();
  const parent = 'D:/__library_restore_test__';
  const createdProject = `${parent}/新建作品`;
  vi.spyOn(TauriFileSystem, 'pathExists').mockImplementation(async (path) =>
    path === ROOT ? restoreCheck.promise : stored.openFiles.includes(path),
  );
  vi.mocked(TauriFileSystem.createDir).mockImplementation(async (_root, path) => {
    if (path === createdProject) await mkdir.promise;
  });
  vi.mocked(TauriFileSystem.writeFile).mockResolvedValue(undefined);
  vi.mocked(chooseDirectory).mockResolvedValue(parent);
  const host = await mountApp();
  await click(recent(host, ROOT));
  await click(get(host, 'library-new-project'));
  const dialog = get(host, 'new-project-dialog');
  assert.ok(dialog);
  const title = dialog.querySelector<HTMLInputElement>('#new-project-title');
  assert.ok(title);
  await fill(title, '新建作品');
  await click(
    Array.from(dialog.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('选择文件夹'),
    ),
  );
  await click(dialog.querySelector<HTMLButtonElement>('button[type="submit"]'));
  assert.equal(dialog.getAttribute('aria-busy'), 'true');
  await act(async () => {
    restoreCheck.resolve(true);
    await Promise.resolve();
  });
  assert.equal(surface(host), 'library', '旧存档不能在新建流程中途变成当前作品');
  assert.equal(get(host, 'restore-editor-probe'), null);
  assert.equal(get(host, 'new-project-dialog'), dialog);
  assert.deepEqual(parseWorkspaceSession(localStorage.getItem(SESSION_KEY)), stored);
  await act(async () => {
    mkdir.resolve();
    await Promise.resolve();
  });
  assert.equal(
    get(host, 'new-project-dialog'),
    null,
    '真实创建 owner 应成功收尾，不出现 scope-stale 错误',
  );
  assert.equal(surface(host), 'overview');
  assert.equal(get(host, 'restore-editor-probe')?.dataset.project, createdProject);
  assert.deepEqual(tabPaths(host), []);
  assert.equal(parseWorkspaceSession(localStorage.getItem(SESSION_KEY))?.project, createdProject);
});

test('同一 Windows 根目录从原生 chooser 再打开只继续当前作品，保留脏页签且工作台不跳总览', async () => {
  vi.spyOn(TauriFileSystem, 'pathExists').mockResolvedValue(true);
  const host = await mountApp();
  await click(recent(host, ROOT));
  await click(get(host, 'restore-dirty-probe'));
  const editor = get(host, 'restore-editor-probe');
  assert.equal(surface(host), 'workspace');
  await click(get(host, 'titlebar-library'));
  vi.mocked(chooseDirectory).mockResolvedValue(ROOT.toUpperCase().replaceAll('/', '\\') + '\\');
  await click(get(host, 'library-open-project'));
  assert.ok(host.querySelector('[role="dialog"]') === null, '同作品不是切换，不要求放弃未保存内容');
  assert.equal(surface(host), 'workspace');
  assert.equal(get(host, 'restore-editor-probe'), editor);
  assert.deepEqual(tabPaths(host), stored.openFiles);
  assert.equal(editor?.dataset.file, stored.activeFile);
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true }));
  });
  assert.equal(surface(host), 'workspace', '在工作台直接打开同作品不使用库的旧 overview 返回记录');
  assert.ok(host.querySelector('[role="dialog"]') === null);
  assert.deepEqual(tabPaths(host), stored.openFiles);
  assert.equal(get(host, 'restore-editor-probe'), editor);
});
