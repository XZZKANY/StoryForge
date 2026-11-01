import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('../src/lib/desktop-llm-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/desktop-llm-config')>()),
  listLlmProfiles: vi.fn(async () => null),
}));
vi.mock('../src/lib/api-client', () => ({ probeProviderHealth: vi.fn() }));
vi.mock('../src/lib/update-check', () => ({
  currentAppVersion: async () => null,
  checkForUpdate: vi.fn(),
}));
vi.mock('../src/lib/plugin-library', () => ({
  pluginLibraryDir: vi.fn(async () => 'C:\\库'),
  stagePluginImport: vi.fn(),
  commitPluginImport: vi.fn(),
  discardPluginImport: vi.fn(async () => undefined),
  removePlugin: vi.fn(async () => undefined),
}));
vi.mock('../src/lib/api/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/plugins')>()),
  listPlugins: vi.fn(),
  describeStagedPlugin: vi.fn(),
  readEnabledPlugins: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { open } from '@tauri-apps/plugin-dialog';
import { SettingsView } from '../src/components/SettingsView';
import { PluginImportDialog } from '../src/components/settings/PluginImportDialog';
import {
  describeStagedPlugin,
  listPlugins,
  type PluginDescription,
  type PluginEntry,
} from '../src/lib/api/plugins';
import { PLUGINS_CHANGED_EVENT } from '../src/lib/plugin-events';
import {
  commitPluginImport,
  discardPluginImport,
  removePlugin,
  stagePluginImport,
  type StagedPluginImport,
} from '../src/lib/plugin-library';
import { requestSettingsSection } from '../src/lib/settings-section';
import { TOAST_EVENT, type ToastDetail } from '../src/lib/toast';
import { DEFAULT_APP_SETTINGS } from '../src/lib/user-settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (name: string, sha = name, body = `${name}的全文\n第二行`): PluginEntry => ({
  path: `技能/${name}.md`,
  name,
  when: `${name}的时候`,
  body,
  sha256: sha,
});
const manifest = (
  name: string,
  extra: Partial<NonNullable<PluginDescription['manifest']>> = {},
) => ({
  name,
  version: '1.0.0',
  description: `${name}的说明`,
  author: null,
  homepage: null,
  displayName: null,
  format: 'storyforge' as const,
  ...extra,
});
const plugin = (id: string, extra: Partial<PluginDescription> = {}): PluginDescription => ({
  id,
  root: `C:\\库\\${id}`,
  manifest: manifest(id),
  bundled: false,
  skills: [],
  styles: [],
  instructions: null,
  problems: [],
  ...extra,
});
const staged = (extra: Partial<StagedPluginImport> = {}): StagedPluginImport => ({
  stageId: 'stage-1',
  stageRoot: 'C:\\库\\.staging\\stage-1',
  files: [],
  skipped: [],
  ...extra,
});

let root: Root;
let host: HTMLDivElement;
let toasts: ToastDetail[];
let changed: number;
const onToast = (event: Event) => toasts.push((event as CustomEvent<ToastDetail>).detail);
const onChanged = () => {
  changed += 1;
};

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  toasts = [];
  changed = 0;
  window.addEventListener(TOAST_EVENT, onToast);
  window.addEventListener(PLUGINS_CHANGED_EVENT, onChanged);
  vi.mocked(listPlugins).mockResolvedValue([]);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.removeEventListener(TOAST_EVENT, onToast);
  window.removeEventListener(PLUGINS_CHANGED_EVENT, onChanged);
});

const $ = (testid: string, scope: ParentNode = document) =>
  scope.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const $$ = (testid: string, scope: ParentNode = document) => [
  ...scope.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`),
];
const click = async (node: HTMLElement | null | undefined) => {
  expect(node).toBeTruthy();
  await act(async () => node!.click());
};
const dialog = () => $('plugin-import-dialog');
async function mountSettings() {
  await act(async () =>
    root.render(
      <SettingsView settings={DEFAULT_APP_SETTINGS} onChange={() => {}} onClose={() => {}} />,
    ),
  );
}
async function importFrom(description: PluginDescription, stage = staged()) {
  vi.mocked(open).mockResolvedValueOnce('D:\\下载\\写法包');
  vi.mocked(stagePluginImport).mockResolvedValueOnce(stage);
  vi.mocked(describeStagedPlugin).mockResolvedValueOnce(description);
  await click($('plugins-import'));
  await vi.waitFor(() => expect(dialog()).toBeTruthy());
}
const groupTitle = (testid: string) => $(testid, dialog()!)!.querySelector('h3')!.textContent;

test('「插件」排在模型服务之后：导航锚点 plugins、分组在模型服务与外观之间', async () => {
  await mountSettings();
  const links = [...host.querySelectorAll('nav a')].map((link) => link.getAttribute('href'));
  expect(links).toEqual(['#provider', '#plugins', '#appearance', '#editor', '#about']);
  const groups = [...host.querySelectorAll('section.sf-settings-group')].map((group) => group.id);
  expect(groups.slice(0, 3)).toEqual(['provider', 'plugins', 'appearance']);
  expect($('plugins-section')!.textContent).toContain(
    '插件装在本机；每本书在对话头「上下文」里自己选用。只收文本，StoryForge 不运行插件里的程序。',
  );
});

test('设置搜索按插件分组的关键词命中（不分大小写），搜别的就藏起来', async () => {
  await mountSettings();
  const search = $('settings-search') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  const type = (value: string) =>
    act(async () => {
      setValue!.call(search, value);
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await type('ZIP');
  expect($('plugins-section')).toBeTruthy();
  await type('字号');
  expect($('plugins-section')).toBeNull();
});

test('已装插件一张卡：名字回退、版本作者、计数照写 0、问题只显示第一条加「等 N 条」', async () => {
  vi.mocked(listPlugins).mockResolvedValue([
    plugin('mist', {
      manifest: manifest('mist', { displayName: '雾港写法', author: '阿青', version: '1.2.0' }),
      skills: [entry('立项'), entry('审稿')],
      instructions: { path: '指令.md', text: '口径', sha256: 'i', truncated: false },
      problems: ['清单缺 homepage。', '技能目录有坏文件。', '指令太长。'],
    }),
    plugin('plain', { styles: [entry('冷白')] }),
    plugin('bare', { manifest: null, problems: ['没有找到插件清单。'] }),
  ]);
  await mountSettings();
  await vi.waitFor(() => expect($$('plugin-card')).toHaveLength(3));
  const [mist, plain, bare] = $$('plugin-card');
  expect($('plugin-card-title', mist)!.textContent).toBe('雾港写法 · v1.2.0 · 阿青');
  expect($('plugin-card-counts', mist)!.textContent).toBe('技能 2 · 写法 0 · 指令 有');
  expect($('plugin-card-problem', mist)!.textContent).toBe('清单缺 homepage。等 3 条');
  expect($('plugin-card-title', plain)!.textContent).toBe('plain · v1.0.0');
  expect($('plugin-card-counts', plain)!.textContent).toBe('技能 0 · 写法 1 · 指令 无');
  expect($('plugin-card-problem', plain)).toBeNull();
  expect($('plugin-card-title', bare)!.textContent).toBe('bare');
  expect($('plugin-card-problem', bare)!.textContent).toBe('没有找到插件清单。');

  await click($('plugin-card-toggle', mist));
  const details = $('plugin-card-details', mist)!;
  expect($('plugin-card-toggle', mist)!.textContent).toBe('收起');
  expect($$('plugin-entry', details).map((row) => row.textContent)).toEqual([
    '立项— 立项的时候',
    '审稿— 审稿的时候',
    '指令.md',
  ]);
  expect([...$('plugin-problems', details)!.querySelectorAll('li')]).toHaveLength(3);
});

test('自带插件：版本后有「内置」小标，没有「移除」，「查看」照旧', async () => {
  vi.mocked(listPlugins).mockResolvedValue([
    plugin('起书基础包', {
      manifest: manifest('起书基础包', { author: 'StoryForge' }),
      bundled: true,
      skills: [entry('立项流程'), entry('审稿口径')],
    }),
    plugin('写法包'),
  ]);
  await mountSettings();
  await vi.waitFor(() => expect($$('plugin-card')).toHaveLength(2));
  const [starter, other] = $$('plugin-card');
  expect($('plugin-card-title', starter)!.textContent).toBe(
    '起书基础包 · v1.0.0 · StoryForge 内置',
  );
  expect($('plugin-card-bundled', starter)!.textContent).toBe('内置');
  expect($('plugin-card-bundled', starter)!.className).toBe(
    'rounded-sm border border-border px-1.5 py-px text-3xs leading-4 text-muted',
  );
  expect($('plugin-card-remove', starter)).toBeNull();
  expect($('plugin-card-bundled', other)).toBeNull();
  expect($('plugin-card-remove', other)).toBeTruthy();

  await click($('plugin-card-toggle', starter));
  expect($$('plugin-entry', $('plugin-card-details', starter)!)).toHaveLength(2);
});

test('没有插件时一行「还没有插件。」', async () => {
  await mountSettings();
  await vi.waitFor(() => expect($('plugins-empty')!.textContent).toBe('还没有插件。'));
  expect($('plugin-cards')).toBeNull();
});

test('从文件夹导入：选文件夹 → 暂存 → 用暂存根预览', async () => {
  await mountSettings();
  await importFrom(plugin('stage-1', { manifest: manifest('写法包'), skills: [entry('立项')] }));
  expect(vi.mocked(open).mock.calls[0][0]).toMatchObject({ directory: true, multiple: false });
  expect(vi.mocked(stagePluginImport)).toHaveBeenCalledWith('D:\\下载\\写法包');
  expect(vi.mocked(describeStagedPlugin)).toHaveBeenCalledWith('C:\\库\\.staging\\stage-1');
  expect($('plugin-import-head', dialog()!)!.textContent).toContain('写法包 · v1.0.0');
});

test('选文件夹时取消：不暂存、不弹预览', async () => {
  await mountSettings();
  vi.mocked(open).mockResolvedValueOnce(null);
  await click($('plugins-import'));
  expect(vi.mocked(stagePluginImport)).not.toHaveBeenCalled();
  expect(dialog()).toBeNull();
  expect(toasts).toEqual([]);
});

test('从压缩包导入：选 .zip 文件（不是文件夹）→ 同一暂存 → 预览', async () => {
  await mountSettings();
  vi.mocked(open).mockResolvedValueOnce('D:\\下载\\写法包.zip');
  vi.mocked(stagePluginImport).mockResolvedValueOnce(staged());
  vi.mocked(describeStagedPlugin).mockResolvedValueOnce(
    plugin('stage-1', { manifest: manifest('写法包'), skills: [entry('立项')] }),
  );
  await click($('plugins-import-zip'));
  await vi.waitFor(() => expect(dialog()).toBeTruthy());
  const options = vi.mocked(open).mock.calls[0][0]!;
  expect(options).toMatchObject({
    multiple: false,
    filters: [{ name: '插件压缩包', extensions: ['zip'] }],
  });
  expect(options.directory).not.toBe(true);
  expect(vi.mocked(stagePluginImport)).toHaveBeenCalledWith('D:\\下载\\写法包.zip');
  expect(vi.mocked(describeStagedPlugin)).toHaveBeenCalledWith('C:\\库\\.staging\\stage-1');
  expect($('plugin-import-head', dialog()!)!.textContent).toContain('写法包 · v1.0.0');
});

test('选压缩包时取消：不暂存、不弹预览', async () => {
  await mountSettings();
  vi.mocked(open).mockResolvedValueOnce(null);
  await click($('plugins-import-zip'));
  expect(vi.mocked(open)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(stagePluginImport)).not.toHaveBeenCalled();
  expect(dialog()).toBeNull();
  expect(toasts).toEqual([]);
});

test('压缩包暂存失败照样弹宿主给的原因', async () => {
  await mountSettings();
  vi.mocked(open).mockResolvedValueOnce('D:\\下载\\坏包.zip');
  vi.mocked(stagePluginImport).mockRejectedValueOnce(
    '打不开这个压缩包（可能已损坏，或不是 zip 格式）',
  );
  await click($('plugins-import-zip'));
  await vi.waitFor(() => expect(toasts).toHaveLength(1));
  expect(toasts[0]).toMatchObject({ tone: 'error' });
  expect(toasts[0].message).toContain('打不开这个压缩包');
  expect(dialog()).toBeNull();
});

test('暂存失败弹宿主给的原因；预览读失败时把已暂存的清掉', async () => {
  await mountSettings();
  vi.mocked(open).mockResolvedValueOnce('D:\\下载\\坏包');
  vi.mocked(stagePluginImport).mockRejectedValueOnce('文件夹里没有可收的文本文件。');
  await click($('plugins-import'));
  await vi.waitFor(() => expect(toasts).toHaveLength(1));
  expect(toasts[0]).toMatchObject({ tone: 'error' });
  expect(toasts[0].message).toContain('文件夹里没有可收的文本文件。');
  expect(vi.mocked(discardPluginImport)).not.toHaveBeenCalled();

  vi.mocked(open).mockResolvedValueOnce('D:\\下载\\坏包');
  vi.mocked(stagePluginImport).mockResolvedValueOnce(staged({ stageId: 'stage-2' }));
  vi.mocked(describeStagedPlugin).mockRejectedValueOnce(new Error('读不到暂存。'));
  await click($('plugins-import'));
  await vi.waitFor(() => expect(toasts).toHaveLength(2));
  expect(toasts[1].message).toContain('读不到暂存。');
  expect(vi.mocked(discardPluginImport)).toHaveBeenCalledWith('stage-2');
  expect(dialog()).toBeNull();
});

test('移除先确认；确认后 removePlugin → 重读 → 发事件 → 提示', async () => {
  vi.mocked(listPlugins).mockResolvedValue([
    plugin('mist', { manifest: manifest('mist', { displayName: '雾港写法' }) }),
  ]);
  await mountSettings();
  await vi.waitFor(() => expect($$('plugin-card')).toHaveLength(1));

  await click($('plugin-card-remove'));
  expect(document.getElementById('app-dialog-title')!.textContent).toBe('移除插件「雾港写法」？');
  expect($('app-dialog-message')!.textContent).toBe(
    '会从本机插件库挪进回收夹；已经启用它的作品会显示「本机没装」。',
  );
  await click($('app-dialog-cancel'));
  expect(vi.mocked(removePlugin)).not.toHaveBeenCalled();

  vi.mocked(listPlugins).mockResolvedValue([]);
  await click($('plugin-card-remove'));
  await click($('app-dialog-primary'));
  await vi.waitFor(() => expect($('plugins-empty')).toBeTruthy());
  expect(vi.mocked(removePlugin)).toHaveBeenCalledWith('mist');
  expect(changed).toBe(1);
  expect(toasts.at(-1)).toMatchObject({ message: '已移除插件「雾港写法」', tone: 'success' });
});

test('预览：三组计数、点开看全文、跳过的文件默认折叠、问题列出', async () => {
  await mountSettings();
  await importFrom(
    plugin('stage-1', {
      manifest: manifest('写法包', { format: 'codex', author: '阿青' }),
      skills: [entry('立项'), entry('审稿')],
      styles: [entry('冷白')],
      instructions: { path: '指令.md', text: '只写短句', sha256: 'i', truncated: true },
      problems: ['这个 Codex 插件里的连接器 / MCP 不会被使用。'],
    }),
    staged({ skipped: [{ path: 'bin/tool.exe', reason: '不是文本文件' }] }),
  );
  const box = dialog()!;
  expect($('plugin-import-codex', box)!.textContent).toBe('Codex 插件：只用其中的技能');
  expect(groupTitle('plugin-skills')).toBe('技能（2）');
  expect(groupTitle('plugin-styles')).toBe('写法（1）');
  expect(groupTitle('plugin-instructions')).toBe('指令片段（有）');
  expect($('plugin-instructions', box)!.textContent).toContain('超过 4000 字的部分不会用');

  const [first] = $$('plugin-entry', box);
  expect(first.textContent).toBe('立项— 立项的时候');
  await click(first);
  expect($('plugin-entry-body', box)!.textContent).toBe('立项的全文\n第二行');
  await click(first);
  expect($('plugin-entry-body', box)).toBeNull();

  const toggle = $('plugin-import-skipped-toggle', box)!;
  expect(toggle.textContent).toBe('跳过的文件（1）');
  expect($('plugin-import-skipped', box)).toBeNull();
  await click(toggle);
  expect($('plugin-import-skipped', box)!.textContent).toBe('bin/tool.exe — 不是文本文件');
  expect($('plugin-problems', box)!.textContent).toContain('MCP 不会被使用');
  expect($('plugin-import-replace', box)).toBeNull();
});

test('同名已装：说明会替换，并按名字对齐数出新增 / 去掉 / 改动', async () => {
  vi.mocked(listPlugins).mockResolvedValue([
    plugin('写法包', {
      manifest: manifest('写法包', { version: '0.9.0' }),
      skills: [entry('立项', 'a'), entry('审稿', 'b'), entry('旧技能', 'c')],
      styles: [entry('冷白', 'd')],
      instructions: { path: '指令.md', text: '旧', sha256: 'old', truncated: false },
    }),
  ]);
  await mountSettings();
  await vi.waitFor(() => expect($$('plugin-card')).toHaveLength(1));
  await importFrom(
    plugin('stage-1', {
      manifest: manifest('写法包', { version: '1.0.0' }),
      skills: [entry('立项', 'a'), entry('审稿', 'b2'), entry('新技能', 'e'), entry('又一个', 'f')],
      styles: [entry('冷白', 'd')],
      instructions: { path: '指令.md', text: '旧', sha256: 'old', truncated: false },
    }),
  );
  expect($('plugin-import-replace', dialog()!)!.textContent).toBe(
    '已装同名插件 v0.9.0，安装后会替换它（旧的进回收夹）：技能 新增 2、去掉 1、改动 1；写法 新增 0、去掉 0、改动 0；指令 不变',
  );
});

test('取消：清掉暂存并关闭；安装：按清单里的名字提交 → 重读 → 发事件 → 提示 → 关闭', async () => {
  await mountSettings();
  await importFrom(plugin('stage-1', { manifest: manifest('写法包'), skills: [entry('立项')] }));
  await click($('plugin-import-cancel', dialog()!));
  expect(vi.mocked(discardPluginImport)).toHaveBeenCalledWith('stage-1');
  expect(dialog()).toBeNull();

  await importFrom(
    plugin('stage-9', {
      manifest: manifest('写法包', { displayName: '雾港写法' }),
      skills: [entry('立项')],
    }),
    staged({ stageId: 'stage-9' }),
  );
  let finish!: (value: string) => void;
  vi.mocked(commitPluginImport).mockReturnValueOnce(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  const listCalls = vi.mocked(listPlugins).mock.calls.length;
  await click($('plugin-import-install', dialog()!));
  expect(vi.mocked(commitPluginImport)).toHaveBeenCalledWith('stage-9', '写法包');
  const install = $('plugin-import-install', dialog()!) as HTMLButtonElement;
  expect(install.disabled).toBe(true);
  expect(($('plugin-import-cancel', dialog()!) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => install.click());
  expect(vi.mocked(commitPluginImport)).toHaveBeenCalledTimes(1);

  await act(async () => finish('C:\\库\\写法包'));
  await vi.waitFor(() => expect(dialog()).toBeNull());
  expect(vi.mocked(listPlugins).mock.calls.length).toBe(listCalls + 1);
  expect(changed).toBe(1);
  expect(toasts.at(-1)).toMatchObject({ message: '已安装插件「雾港写法」', tone: 'success' });
  expect(vi.mocked(discardPluginImport)).toHaveBeenCalledTimes(1);
});

test.each([
  ['没有清单', plugin('stage-1', { manifest: null, skills: [entry('立项')] }), '插件清单'],
  [
    '名字不合规',
    plugin('stage-1', { manifest: manifest('con'), skills: [entry('立项')] }),
    '插件名「con」不能用',
  ],
  ['什么都没有', plugin('stage-1', { manifest: manifest('空包') }), '没有技能、写法或指令片段'],
])('装不了（%s）：安装按钮禁用，按钮上方写明原因', async (_label, description, reason) => {
  await act(async () =>
    root.render(
      <PluginImportDialog
        preview={{ staged: staged(), description }}
        installed={[]}
        installing={false}
        onCancel={() => {}}
        onInstall={() => {}}
      />,
    ),
  );
  expect(($('plugin-import-install') as HTMLButtonElement).disabled).toBe(true);
  expect($('plugin-import-blocker')!.textContent).toContain(reason);
  expect($('plugin-import-blocker')!.className).toContain('text-warning');
});

test('别处请求打开设置的「插件」分组：导航高亮插件并滚到那一组', async () => {
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
  try {
    requestSettingsSection('plugins');
    await mountSettings();
    expect(scrolled[0]).toBe('plugins');
    expect(host.querySelector('a[href="#plugins"]')!.getAttribute('aria-current')).toBe('true');
    act(() => root.render(<div />));
    scrolled.length = 0;
    await mountSettings();
    expect(scrolled).toEqual([]);
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});
