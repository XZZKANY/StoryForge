import { parsePluginsFile, serializePluginsFile } from '@storyforge/project-core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('../src/lib/api/author-instructions', () => ({ loadAuthorInstructions: vi.fn() }));
vi.mock('../src/lib/api/conversation-skills', () => ({ loadConversationSkills: vi.fn() }));
vi.mock('../src/lib/plugin-library', () => ({
  pluginLibraryDir: vi.fn(async () => 'C:\\库'),
}));
vi.mock('../src/lib/api/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/plugins')>()),
  listPlugins: vi.fn(),
  describeStagedPlugin: vi.fn(),
  readEnabledPlugins: vi.fn(),
}));

import { ContextPanel } from '../src/components/chat-window/ContextPanel';
import { writePluginChoice } from '../src/components/chat-window/PluginsBlock';
import { loadAuthorInstructions } from '../src/lib/api/author-instructions';
import { loadConversationSkills } from '../src/lib/api/conversation-skills';
import { listPlugins, readEnabledPlugins, type PluginDescription } from '../src/lib/api/plugins';
import { PLUGINS_CHANGED_EVENT } from '../src/lib/plugin-events';
import { takeRequestedSettingsSection } from '../src/lib/settings-section';
import { FS_MUTATION_EVENT, TauriFileSystem } from '../src/lib/tauri-fs';
import { TOAST_EVENT, type ToastDetail } from '../src/lib/toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = 'D:\\连载\\雾港';
const DIR = `${ROOT}\\.storyforge`;
const FILE = `${DIR}\\plugins.json`;
const plugin = (id: string, displayName: string | null = null): PluginDescription => ({
  id,
  root: `C:\\库\\${id}`,
  manifest: {
    name: id,
    version: '1.0.0',
    description: '',
    author: null,
    homepage: null,
    displayName,
    format: 'storyforge',
  },
  skills: [],
  styles: [],
  instructions: null,
  problems: [],
});

let root: Root;
let host: HTMLDivElement;
let toasts: ToastDetail[];
let enabledOnDisk: string[];
const onToast = (event: Event) => toasts.push((event as CustomEvent<ToastDetail>).detail);
const writeFile = vi.spyOn(TauriFileSystem, 'writeFile');
const pathExists = vi.spyOn(TauriFileSystem, 'pathExists');
const createDir = vi.spyOn(TauriFileSystem, 'createDir');

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  toasts = [];
  enabledOnDisk = [];
  window.addEventListener(TOAST_EVENT, onToast);
  takeRequestedSettingsSection();
  vi.mocked(loadAuthorInstructions).mockResolvedValue({ status: 'missing', filePath: 'x' });
  vi.mocked(loadConversationSkills).mockResolvedValue([]);
  vi.mocked(listPlugins).mockResolvedValue([]);
  vi.mocked(readEnabledPlugins).mockImplementation(async () => ({
    enabled: [...enabledOnDisk],
    problem: null,
  }));
  pathExists.mockResolvedValue(true);
  createDir.mockResolvedValue(undefined);
  writeFile.mockImplementation(async (_root, _path, content) => {
    enabledOnDisk = (JSON.parse(content) as { enabled: string[] }).enabled;
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.removeEventListener(TOAST_EVENT, onToast);
});

const $ = (testid: string, scope: ParentNode = host) =>
  scope.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const $$ = (testid: string, scope: ParentNode = host) => [
  ...scope.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`),
];
const rows = () => [
  ...host.querySelectorAll<HTMLElement>('[data-testid="context-plugins-list"] li'),
];
const box = (row: HTMLElement) => $('context-plugin-toggle', row) as HTMLInputElement;
async function renderPanel(onOpenSettings?: () => void) {
  await act(async () =>
    root.render(<ContextPanel projectPath={ROOT} run={null} onOpenSettings={onOpenSettings} />),
  );
  await vi.waitFor(() =>
    expect($('context-plugins-list') ?? $('context-plugins-empty')).toBeTruthy(),
  );
}

test('插件块挂在技能块后面：标题、提示，列出本机插件，勾选状态跟作品文件走（不分大小写）', async () => {
  vi.mocked(listPlugins).mockResolvedValue([plugin('Foo', '雾港写法'), plugin('bar')]);
  enabledOnDisk = ['foo'];
  await renderPanel();
  const blocks = [...host.querySelectorAll('[data-testid="context-panel"] > div')].map((node) =>
    node.getAttribute('data-testid'),
  );
  expect(blocks.indexOf('context-plugins')).toBe(blocks.indexOf('context-skills') + 1);
  expect($('context-plugins')!.querySelector('h3')!.textContent).toBe('插件');
  expect($('context-plugins')!.textContent).toContain('本机插件库 · 勾选这本书要用的');
  const [foo, bar] = rows();
  expect(foo.textContent).toBe('雾港写法v1.0.0');
  expect(box(foo).checked).toBe(true);
  expect(box(bar).checked).toBe(false);
});

test('勾上：读当前文件、追加到末尾写回；目录不在先建 .storyforge', async () => {
  vi.mocked(listPlugins).mockResolvedValue([plugin('甲'), plugin('乙')]);
  enabledOnDisk = ['甲'];
  pathExists.mockResolvedValue(false);
  await renderPanel();
  await act(async () => box(rows()[1]).click());
  await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
  expect(writeFile).toHaveBeenCalledWith(ROOT, FILE, serializePluginsFile(['甲', '乙']));
  expect(pathExists).toHaveBeenCalledWith(DIR);
  expect(createDir).toHaveBeenCalledWith(ROOT, DIR);
  await vi.waitFor(() => expect(box(rows()[1]).disabled).toBe(false));
  expect(box(rows()[1]).checked).toBe(true);
});

test('取消勾：只去掉这一个，本机没装的名字原样留着；没装的行有「本机没装」小标', async () => {
  vi.mocked(listPlugins).mockResolvedValue([plugin('甲')]);
  enabledOnDisk = ['远方', '甲', '别处'];
  await renderPanel();
  const missing = $$('context-plugin-missing');
  expect(missing.map((row) => row.textContent)).toEqual(['远方本机没装', '别处本机没装']);
  expect(missing.every((row) => (row.querySelector('input') as HTMLInputElement).checked)).toBe(
    true,
  );
  const tag = $('context-plugin-missing-tag', missing[0])!;
  expect(tag.className).toBe(
    'flex-shrink-0 rounded-sm border border-border px-1.5 py-px text-3xs leading-4 text-muted',
  );
  expect(missing[0].querySelector('span')!.className).toContain('text-subtle');

  await act(async () => box($('context-plugin')!).click());
  await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
  expect(writeFile).toHaveBeenCalledWith(ROOT, FILE, serializePluginsFile(['远方', '别处']));
  expect(createDir).not.toHaveBeenCalled();

  await act(async () => (missing[1].querySelector('input') as HTMLInputElement).click());
  await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(2));
  expect(writeFile).toHaveBeenLastCalledWith(ROOT, FILE, serializePluginsFile(['远方']));
});

test('写入中这一行禁用；写失败弹提示并恢复原来的勾选', async () => {
  vi.mocked(listPlugins).mockResolvedValue([plugin('甲')]);
  let fail!: (error: Error) => void;
  writeFile.mockReturnValueOnce(
    new Promise<void>((_resolve, reject) => {
      fail = reject;
    }),
  );
  await renderPanel();
  await act(async () => box(rows()[0]).click());
  await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
  expect(box(rows()[0]).checked).toBe(true);
  expect(box(rows()[0]).disabled).toBe(true);
  await act(async () => fail(new Error('磁盘满了')));
  await vi.waitFor(() => expect(box(rows()[0]).disabled).toBe(false));
  expect(box(rows()[0]).checked).toBe(false);
  expect(toasts).toHaveLength(1);
  expect(toasts[0]).toMatchObject({ tone: 'error' });
  expect(toasts[0].message).toContain('磁盘满了');
});

test('没有已装插件也没有启用记录：一行「本机还没有插件。」', async () => {
  await renderPanel();
  expect($('context-plugins-empty')!.textContent).toBe('本机还没有插件。');
});

test('「管理插件」先记下要滚到插件分组再打开设置；没有打开设置的回调就不显示', async () => {
  await renderPanel();
  expect($('context-plugins-manage')).toBeNull();
  const openSettings = vi.fn(() => {
    expect(takeRequestedSettingsSection()).toBe('plugins');
  });
  await renderPanel(openSettings);
  await act(async () => $('context-plugins-manage')!.click());
  expect(openSettings).toHaveBeenCalledTimes(1);
});

test('技能目录跟着插件变：插件库变动与作品插件启用文件写盘都会重读，别的文件不会', async () => {
  await renderPanel();
  const calls = () => vi.mocked(loadConversationSkills).mock.calls.length;
  const before = calls();
  await act(async () => window.dispatchEvent(new Event(PLUGINS_CHANGED_EVENT)));
  await vi.waitFor(() => expect(calls()).toBe(before + 1));
  await act(async () =>
    window.dispatchEvent(new CustomEvent(FS_MUTATION_EVENT, { detail: { path: FILE } })),
  );
  await vi.waitFor(() => expect(calls()).toBe(before + 2));
  await act(async () =>
    window.dispatchEvent(
      new CustomEvent(FS_MUTATION_EVENT, { detail: { path: `${ROOT}\\正文\\第001章.md` } }),
    ),
  );
  expect(calls()).toBe(before + 2);
});

const fileReads = (text: string) =>
  vi.mocked(readEnabledPlugins).mockImplementation(async () => parsePluginsFile(text));
const unreadable = (text: string) =>
  `.storyforge/plugins.json 读不懂，先修好或删掉它再勾选：${parsePluginsFile(text).problem}`;

test('启用文件是坏 JSON：所有复选框禁用，块里说明读不懂并接上原因', async () => {
  vi.mocked(listPlugins).mockResolvedValue([plugin('甲'), plugin('乙')]);
  fileReads('{ "version": 1, "enabled": [');
  await renderPanel();
  expect(rows().map((row) => box(row).disabled)).toEqual([true, true]);
  const line = $('context-plugins-problem')!;
  expect(line.textContent).toBe(unreadable('{ "version": 1, "enabled": ['));
  expect(line.textContent).toMatch(
    /^\.storyforge\/plugins\.json 读不懂，先修好或删掉它再勾选：插件启用文件不是合法的 JSON/,
  );
  expect(line.className).toContain('text-warning');
});

test('只有不合规的名字被丢：同样锁住，连本机没装的那行也不能取消', async () => {
  const text = '{ "version": 1, "enabled": ["甲", "远方", "con"] }';
  vi.mocked(listPlugins).mockResolvedValue([plugin('甲'), plugin('乙')]);
  fileReads(text);
  await renderPanel();
  expect(rows().map((row) => [box(row).checked, box(row).disabled])).toEqual([
    [true, true],
    [false, true],
    [true, true],
  ]);
  expect($('context-plugins-problem')!.textContent).toBe(unreadable(text));
});

test.each([
  ['坏 JSON', '{ "version": 1, "enabled": ['],
  ['version 不对', '{ "version": 2, "enabled": ["甲"] }'],
  ['有被丢掉的名字', '{ "version": 1, "enabled": ["甲", "con"] }'],
])('writePluginChoice 写前重读，文件读不懂（%s）就抛错、不写', async (_label, text) => {
  fileReads(text);
  await expect(writePluginChoice(ROOT, '乙', true)).rejects.toThrow(unreadable(text));
  await expect(writePluginChoice(ROOT, '甲', false)).rejects.toThrow(unreadable(text));
  expect(writeFile).not.toHaveBeenCalled();
  expect(createDir).not.toHaveBeenCalled();
});

test('界面还是旧的、文件已在外面改坏：点了也不覆盖，提示原因并重读成锁住状态', async () => {
  vi.mocked(listPlugins).mockResolvedValue([plugin('甲')]);
  await renderPanel();
  expect(box(rows()[0]).disabled).toBe(false);
  fileReads('not json');
  await act(async () => box(rows()[0]).click());
  await vi.waitFor(() => expect(toasts).toHaveLength(1));
  expect(toasts[0]).toMatchObject({ tone: 'error' });
  expect(toasts[0].message).toContain(unreadable('not json'));
  expect(writeFile).not.toHaveBeenCalled();
  await vi.waitFor(() => expect($('context-plugins-problem')).toBeTruthy());
  expect(box(rows()[0]).disabled).toBe(true);
  expect(box(rows()[0]).checked).toBe(false);
});

test('启用文件不存在不算读不懂：照常写', async () => {
  vi.mocked(listPlugins).mockResolvedValue([plugin('甲')]);
  await renderPanel();
  expect($('context-plugins-problem')).toBeNull();
  await expect(writePluginChoice(ROOT, '甲', true)).resolves.toEqual(['甲']);
  expect(writeFile).toHaveBeenCalledWith(ROOT, FILE, serializePluginsFile(['甲']));
});
