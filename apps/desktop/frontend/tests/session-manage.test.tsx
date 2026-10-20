/**
 * 会话的增删改查（作者 10-17 巡检：会话只能新建和切换）：可搜、行内改名、从列表移除（记录还在、可撤销）。
 */
import assert from 'node:assert/strict';
import React, { useRef, useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { SessionMenu } from '../src/components/chat-window/SessionMenu';
import { useSessionManagement } from '../src/components/chat-window/useSessionManagement';
import { renameAssistantSession } from '../src/lib/api-client';
import type { AssistantSessionRecord } from '../src/lib/api/types';
import { emitToast } from '../src/lib/toast';

vi.mock('../src/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api-client')>()),
  renameAssistantSession: vi.fn(async () => undefined),
}));
vi.mock('../src/lib/toast', () => ({ emitToast: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = 'D:\\连载\\末世吞噬';
const session = (id: number, title: string): AssistantSessionRecord => ({
  id,
  title,
  task_type: 'chat',
  project_path: PROJECT,
  messages: [],
  created_at: '2026-10-17 05:16:21',
  updated_at: '2026-10-17 05:16:21',
});
const SESSIONS = [
  session(1, '看看第5章结尾的节奏'),
  session(2, '十七楼那条线怎么收'),
  session(3, '起草第6章'),
];

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  localStorage.clear();
  vi.mocked(emitToast).mockClear();
  vi.mocked(renameAssistantSession).mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

function Menu(props: Partial<React.ComponentProps<typeof SessionMenu>>) {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger}>会话</button>
      <SessionMenu
        sessions={SESSIONS}
        activeSessionId={1}
        triggerRef={trigger}
        onDismiss={() => undefined}
        {...props}
      />
    </>
  );
}

const items = () =>
  [...document.querySelectorAll('[data-testid="session-item"]')].map((item) => item.textContent);

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

test('搜会话标题：只留下标题里含关键字的', () => {
  act(() => root.render(<Menu />));
  act(() =>
    type(document.querySelector<HTMLInputElement>('[data-testid="session-search"]')!, '十七楼'),
  );
  assert.equal(items().length, 1);
  assert.match(items()[0] ?? '', /十七楼那条线怎么收/);
});

test('行内改名：点改名、输入新标题、回车，交给上层保存', () => {
  const onRenameSession = vi.fn();
  act(() => root.render(<Menu onRenameSession={onRenameSession} />));
  act(() =>
    document.querySelectorAll<HTMLButtonElement>('[data-testid="session-rename"]')[1]!.click(),
  );
  const input = document.querySelector<HTMLInputElement>('[data-testid="session-rename-input"]')!;
  assert.equal(input.value, '十七楼那条线怎么收');
  act(() => type(input, '收十七楼伏笔'));
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  assert.deepEqual(onRenameSession.mock.calls[0], [2, '收十七楼伏笔']);
});

function Managed({ onRemovedActive }: { onRemovedActive: () => void }) {
  const [sessions, setSessions] = useState(SESSIONS);
  const [title, setTitle] = useState('看看第5章结尾的节奏');
  const manage = useSessionManagement({
    projectPath: PROJECT,
    sessions,
    setSessions,
    activeSessionId: 1,
    setConversationTitle: setTitle,
    onRemovedActive,
  });
  return (
    <div>
      <p data-testid="title">{title}</p>
      <Menu
        sessions={manage.visibleSessions}
        onRenameSession={manage.renameSession}
        onRemoveSession={manage.removeSession}
      />
    </div>
  );
}

test('改名写进引擎库；改的是当前会话时对话头标题跟着变', async () => {
  act(() => root.render(<Managed onRemovedActive={() => undefined} />));
  act(() =>
    document.querySelectorAll<HTMLButtonElement>('[data-testid="session-rename"]')[0]!.click(),
  );
  const input = document.querySelector<HTMLInputElement>('[data-testid="session-rename-input"]')!;
  act(() => type(input, '第5章节奏'));
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
  assert.deepEqual(vi.mocked(renameAssistantSession).mock.calls[0], [1, '第5章节奏']);
  assert.equal(document.querySelector('[data-testid="title"]')!.textContent, '第5章节奏');
  assert.match(items()[0] ?? '', /第5章节奏/);
});

test('从列表移除：列表里不见了、换项目也记得；可撤销；移除当前会话就换成新会话', async () => {
  const onRemovedActive = vi.fn();
  act(() => root.render(<Managed onRemovedActive={onRemovedActive} />));
  act(() =>
    document.querySelectorAll<HTMLButtonElement>('[data-testid="session-remove"]')[0]!.click(),
  );
  assert.equal(items().length, 2);
  assert.equal(onRemovedActive.mock.calls.length, 1);
  assert.equal(localStorage.getItem(`storyforge:hidden-sessions:${PROJECT}`), '[1]');
  const [message, options] = vi.mocked(emitToast).mock.calls[0]!;
  assert.match(message, /已从列表移除「看看第5章结尾的节奏」/);
  await act(async () => options!.action!.run());
  assert.equal(items().length, 3);
  assert.equal(localStorage.getItem(`storyforge:hidden-sessions:${PROJECT}`), '[]');
});

test('改名没存进去（全项目审计 E-16）：新标题放回输入框，可以直接再回车', async () => {
  const onRenameSession = vi.fn(async () => false);
  act(() => root.render(<Menu onRenameSession={onRenameSession} />));
  act(() =>
    document.querySelectorAll<HTMLButtonElement>('[data-testid="session-rename"]')[1]!.click(),
  );
  const input = document.querySelector<HTMLInputElement>('[data-testid="session-rename-input"]')!;
  act(() => type(input, '收十七楼伏笔'));
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
  assert.deepEqual(onRenameSession.mock.calls[0], [2, '收十七楼伏笔']);
  const back = document.querySelector<HTMLInputElement>('[data-testid="session-rename-input"]');
  assert.equal(back?.value, '收十七楼伏笔');
});

test('改名写进引擎库失败：hook 报 false，成功报 true', async () => {
  let manage: ReturnType<typeof useSessionManagement> | null = null;
  function Probe() {
    const [sessions, setSessions] = useState(SESSIONS);
    manage = useSessionManagement({
      projectPath: PROJECT,
      sessions,
      setSessions,
      activeSessionId: 1,
      setConversationTitle: () => undefined,
      onRemovedActive: () => undefined,
    });
    return null;
  }
  act(() => root.render(<Probe />));
  vi.mocked(renameAssistantSession).mockRejectedValueOnce(new Error('database is locked'));
  let saved: boolean | undefined;
  await act(async () => {
    saved = await manage!.renameSession(1, '新标题');
  });
  assert.equal(saved, false);
  await act(async () => {
    saved = await manage!.renameSession(1, '新标题');
  });
  assert.equal(saved, true);
});
