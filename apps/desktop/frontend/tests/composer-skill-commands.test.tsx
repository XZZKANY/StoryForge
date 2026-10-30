/**
 * 输入框开头打 / 点名技能：弹出这本书的技能、按输入筛、方向键选、Enter/Tab 填入不发送、
 * Esc 关掉再打字重新弹、中文输入法的「、」也认、不在开头不弹。
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('../src/lib/api/conversation-skills', () => ({ loadConversationSkills: vi.fn() }));
vi.mock('../src/lib/desktop-llm-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/desktop-llm-config')>();
  return {
    ...actual,
    listLlmProfiles: vi.fn(async () => ({
      profiles: [],
      activeProfileId: null,
      polishProfileId: null,
    })),
  };
});

import { ComposerSurface } from '../src/components/chat-window/Composer';
import {
  loadConversationSkills,
  type ConversationSkillItem,
} from '../src/lib/api/conversation-skills';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = 'D:\\书\\甲';
const loadSkills = vi.mocked(loadConversationSkills);
const skill = (name: string, when: string): ConversationSkillItem => ({
  path: `技能/${name}.md`,
  name,
  when,
  plugin: null,
  filePath: `${PROJECT}\\技能\\${name}.md`,
});

let host: HTMLDivElement;
let root: Root;
let submitted: string[];

beforeEach(() => {
  localStorage.clear();
  submitted = [];
  loadSkills
    .mockReset()
    .mockResolvedValue([
      skill('立项流程', '作者问「下一步干什么」时'),
      skill('审稿口径', '作者让你审稿时'),
      skill('本书禁用词', '起草、修订正文时'),
    ]);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function Harness({ projectPath = PROJECT }: { projectPath?: string | null }) {
  const [value, setValue] = useState('');
  return (
    <ComposerSurface
      value={value}
      disabled={false}
      busy={false}
      explicitContextPaths={[]}
      onAddContext={() => undefined}
      onChange={setValue}
      onSubmit={() => submitted.push(value)}
      permissionProfile="ask"
      onPermissionProfileChange={() => undefined}
      projectPath={projectPath}
    />
  );
}

async function mount(projectPath?: string | null) {
  await act(async () => root.render(<Harness projectPath={projectPath} />));
}

const textarea = () => host.querySelector('textarea')!;
const menu = () => host.querySelector('[data-testid="skill-command-menu"]');
const options = () =>
  [...host.querySelectorAll<HTMLElement>('[data-testid="skill-command-option"]')].map((node) => ({
    name: node.querySelector('span')!.textContent,
    active: node.getAttribute('aria-selected') === 'true',
  }));
const note = () => host.querySelector('[data-testid="skill-command-note"]')?.textContent;
const commandActive = () =>
  host.querySelector('[data-testid="slash-command-option"]')?.getAttribute('aria-selected');

async function type(value: string) {
  const input = textarea();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

async function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  await act(async () => textarea().dispatchEvent(event));
  return event;
}

test('打 / 弹出这本书的技能，打字筛选，没有匹配时说明', async () => {
  await mount();
  expect(textarea().placeholder).toBe('输入想法，@ 提及角色，/ 用技能');
  expect(menu()).toBeNull();

  await type('/');
  expect(loadSkills).toHaveBeenCalledWith(PROJECT);
  // 指令「写」排在最上面、默认选中（见 write-batch-menu.test.tsx）。
  expect(commandActive()).toBe('true');
  expect(options()).toEqual([
    { name: '/立项流程', active: false },
    { name: '/审稿口径', active: false },
    { name: '/本书禁用词', active: false },
  ]);

  await type('/审');
  expect(options().map((item) => item.name)).toEqual(['/审稿口径']);
  await type('/禁用');
  expect(options().map((item) => item.name)).toEqual(['/本书禁用词']);

  await type('/不存在');
  expect(options()).toEqual([]);
  expect(note()).toBe('没有叫「不存在」的技能。');
});

test('方向键选，Enter 填入 /名字 加空格、不发送；填完菜单收起，再按 Enter 才发送', async () => {
  await mount();
  await type('/');
  await press('ArrowDown');
  expect(options()[0].active).toBe(true);
  await press('ArrowDown');
  await press('ArrowDown');
  await press('ArrowDown');
  expect(commandActive()).toBe('true');
  await press('ArrowUp');
  expect(options()[2].active).toBe(true);
  await press('ArrowUp');
  expect(options()[1].active).toBe(true);

  const pick = await press('Enter');
  expect(pick.defaultPrevented).toBe(true);
  expect(textarea().value).toBe('/审稿口径 ');
  expect(submitted).toEqual([]);
  expect(menu()).toBeNull();

  await type('/审稿口径 看看第一章');
  await press('Enter');
  expect(submitted).toEqual(['/审稿口径 看看第一章']);
});

test('中文输入法打出的「、」也弹，Tab 填入换成半角 /；可以接着点第二个', async () => {
  await mount();
  await type('、立项');
  expect(options().map((item) => item.name)).toEqual(['/立项流程']);
  const tab = await press('Tab');
  expect(tab.defaultPrevented).toBe(true);
  expect(textarea().value).toBe('/立项流程 ');

  await type('/立项流程 /审');
  await press('Enter');
  expect(textarea().value).toBe('/立项流程 /审稿口径 ');
});

test('Esc 关掉菜单，再打一个字重新弹；不在开头或没打开作品时不弹', async () => {
  await mount();
  await type('/立');
  const escape = await press('Escape');
  expect(escape.defaultPrevented).toBe(true);
  expect(menu()).toBeNull();
  await type('/立项');
  expect(options().map((item) => item.name)).toEqual(['/立项流程']);

  await type('按 /立项流程');
  expect(menu()).toBeNull();
  await type('比例 1/2');
  expect(menu()).toBeNull();

  await act(async () => root.render(<Harness projectPath={null} />));
  await type('/');
  expect(menu()).toBeNull();
});

test('书里还没有技能时提示去上下文面板新建', async () => {
  loadSkills.mockResolvedValue([]);
  await mount();
  await type('/');
  expect(options()).toEqual([]);
  expect(note()).toBe('这本书还没有技能。在对话头「上下文」里可以按模板新建。');
});

test('插件技能第二行带插件名，Enter 照样填入 /名字', async () => {
  loadSkills.mockResolvedValue([
    skill('立项流程', '作者问「下一步干什么」时'),
    {
      path: '技能/对白.md',
      name: '对白打磨',
      when: '改对白时',
      plugin: '网文工具箱',
      filePath: null,
    },
  ]);
  await mount();
  await type('/对白');
  const option = host.querySelector<HTMLElement>('[data-testid="skill-command-option"]')!;
  const lines = [...option.querySelectorAll('span')].map((node) => node.textContent);
  expect(lines).toEqual(['/对白打磨', '插件「网文工具箱」 · 改对白时']);
  await press('Enter');
  expect(textarea().value).toBe('/对白打磨 ');
});
