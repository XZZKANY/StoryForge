/**
 * `/` 菜单里的「写」指令：排在技能上面、默认选中；叫「写」或 goal 的技能照列但标出来、不能选；
 * 只在消息开头第一个点名、打的字对得上时出现。
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
const skill = (name: string, when = `${name}的时候`): ConversationSkillItem => ({
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
  loadSkills.mockReset().mockResolvedValue([skill('立项流程'), skill('写法'), skill('写')]);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function Harness() {
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
      projectPath={PROJECT}
    />
  );
}

const textarea = () => host.querySelector('textarea')!;
const command = () => host.querySelector<HTMLElement>('[data-testid="slash-command-option"]');
const rows = () =>
  [...host.querySelectorAll<HTMLElement>('[data-testid="skill-command-option"]')].map((node) => ({
    lines: [...node.querySelectorAll('span')].map((span) => span.textContent),
    active: node.getAttribute('aria-selected') === 'true',
    disabled: node.getAttribute('aria-disabled') === 'true',
  }));

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

async function press(key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => textarea().dispatchEvent(event));
}

test('打 / 时指令一行在技能上面、默认选中，说明写清楚；Enter 填入 /写 ', async () => {
  await act(async () => root.render(<Harness />));
  await type('/');
  const menu = host.querySelector('[data-testid="skill-command-menu"]')!;
  const order = [...menu.querySelectorAll('[role="option"]')].map(
    (node) => node.querySelector('span')!.textContent,
  );
  expect(order).toEqual(['/写', '/立项流程', '/写法', '/写']);
  expect(command()!.getAttribute('aria-selected')).toBe('true');
  expect(command()!.textContent).toContain('批量写章：/写 4-10，写完直接写进文件，最后统一审');
  await press('Enter');
  expect(textarea().value).toBe('/写 ');
  expect(submitted).toEqual([]);
});

test('叫「写」的技能照列、标出重名且不能选：方向键跳过它，点它也不填', async () => {
  await act(async () => root.render(<Harness />));
  await type('/写');
  expect(command()).not.toBeNull();
  expect(rows()).toEqual([
    { lines: ['/写法', '写法的时候'], active: false, disabled: false },
    {
      lines: ['/写', '与指令重名，/写 会当成指令；要点名它请改名'],
      active: false,
      disabled: true,
    },
  ]);
  await press('ArrowDown');
  expect(rows()[0].active).toBe(true);
  await press('ArrowDown');
  expect(command()!.getAttribute('aria-selected')).toBe('true');
  expect(rows().some((row) => row.active)).toBe(false);

  const conflicted = host.querySelectorAll<HTMLElement>('[data-testid="skill-command-option"]')[1];
  await act(async () => conflicted.click());
  expect(textarea().value).toBe('/写');
  await press('ArrowUp');
  await press('Enter');
  expect(textarea().value).toBe('/写法 ');
});

test('叫 goal 的技能同样标出；打 g 也出指令行', async () => {
  loadSkills.mockResolvedValue([skill('Goal'), skill('立项流程')]);
  await act(async () => root.render(<Harness />));
  await type('/g');
  expect(command()).not.toBeNull();
  expect(rows()).toEqual([
    {
      lines: ['/Goal', '与指令重名，/Goal 会当成指令；要点名它请改名'],
      active: false,
      disabled: true,
    },
  ]);
});

test('打的字对上指令但没有同名技能时，只列指令，不说「没有叫『写』的技能」', async () => {
  loadSkills.mockResolvedValue([skill('立项流程')]);
  await act(async () => root.render(<Harness />));
  await type('/写');
  expect(command()).not.toBeNull();
  expect(rows()).toEqual([]);
  expect(host.querySelector('[data-testid="skill-command-note"]')).toBeNull();
});

test('打的字对不上、或不是开头第一个点名时不出指令行', async () => {
  await act(async () => root.render(<Harness />));
  await type('/立');
  expect(command()).toBeNull();
  expect(rows().map((row) => row.lines[0])).toEqual(['/立项流程']);
  await type('/立项流程 /');
  expect(command()).toBeNull();
  expect(rows().map((row) => row.lines[0])).toEqual(['/立项流程', '/写法', '/写']);
});
