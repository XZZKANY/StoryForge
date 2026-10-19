/**
 * 会话改名迟到、本机存储写不进去（全项目审计 10-19 E-09 / E-10）：
 * 改名回来时按那时的当前会话改标题；存不进去就如实报错，不说「已移除 / 已隐藏」。
 */
import assert from 'node:assert/strict';
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useSessionManagement } from '../src/components/chat-window/useSessionManagement';
import { renameAssistantSession } from '../src/lib/api-client';
import type { AssistantSessionRecord } from '../src/lib/api/types';
import { loadDismissedProposals, saveDismissedProposals } from '../src/lib/dismissed-proposals';
import { emitToast } from '../src/lib/toast';

vi.mock('../src/lib/api-client', () => ({ renameAssistantSession: vi.fn(async () => {}) }));
vi.mock('../src/lib/toast', () => ({ emitToast: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = 'D:/book';
let root: Root;
let container: HTMLDivElement;
let manage: ReturnType<typeof useSessionManagement>;

function Harness({ active }: { active: number }) {
  const [sessions, setSessions] = useState([
    { id: 1, title: 'A' },
    { id: 2, title: 'B' },
  ] as AssistantSessionRecord[]);
  const [title, setTitle] = useState(active === 1 ? 'A' : 'B');
  useEffect(() => setTitle(active === 1 ? 'A' : 'B'), [active]);
  manage = useSessionManagement({
    projectPath: PROJECT,
    sessions,
    setSessions,
    activeSessionId: active,
    setConversationTitle: setTitle,
    onRemovedActive: () => {},
  });
  return <output>{title}</output>;
}
const mount = (active = 1) => act(async () => root.render(<Harness active={active} />));
const title = () => container.querySelector('output')!.textContent;
const failingStorage = () => {
  const real = localStorage;
  const setItem = vi.fn(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });
  vi.stubGlobal('localStorage', { getItem: real.getItem.bind(real), setItem });
  return setItem;
};

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test('改名还在路上时切到另一个会话：回来后不把当前会话的标题改成旧会话的新名', async () => {
  let release!: () => void;
  vi.mocked(renameAssistantSession).mockImplementationOnce(
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  await mount(1);
  let pending!: Promise<void>;
  await act(async () => {
    pending = manage.renameSession(1, 'A 新名');
  });
  await mount(2);
  await act(async () => {
    release();
    await pending;
  });
  assert.equal(title(), 'B');
  assert.deepEqual(
    manage.visibleSessions.map((session) => session.title),
    ['A 新名', 'B'],
  );
});

test('本机存储写不进去：会话还在列表里，就不说「已从列表移除」', async () => {
  await mount(1);
  const setItem = failingStorage();
  await act(async () => manage.removeSession(2));
  assert.equal(setItem.mock.calls.length, 1);
  assert.equal(manage.visibleSessions.length, 2);
  const messages = vi.mocked(emitToast).mock.calls.map(([message]) => message);
  assert.ok(!messages.some((message) => message.startsWith('已从列表移除')));
  assert.match(String(messages.at(-1)), /写不进去/);
});

test('本机存储写不进去：「不要」的提案如实报没存下', () => {
  failingStorage();
  assert.equal(saveDismissedProposals(PROJECT, new Set(['proposal'])), false);
  assert.equal(loadDismissedProposals(PROJECT).has('proposal'), false);
  vi.unstubAllGlobals();
  assert.equal(saveDismissedProposals(PROJECT, new Set(['proposal'])), true);
  assert.equal(loadDismissedProposals(PROJECT).has('proposal'), true);
});
