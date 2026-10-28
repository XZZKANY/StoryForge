import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { mergeFailedTurns } from '../src/components/chat-window/conversation-utils';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { useChatSessionContext } from '../src/components/chat-window/useChatSessionContext';
import { getAssistantSession, getAssistantSessionFailedTurns } from '../src/lib/api-client';

vi.mock('../src/lib/api-client', async (original) => ({
  ...(await original<typeof import('../src/lib/api-client')>()),
  getAssistantSession: vi.fn(),
  getAssistantSessionFailedTurns: vi.fn(),
  listAssistantSessions: vi.fn().mockResolvedValue([]),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
let current: ReturnType<typeof useChatWindowState>;
function Harness({ session }: { session: number }) {
  const props = { projectPath: null, currentFile: null, assistantSessionId: session };
  const state = useChatWindowState(props);
  useChatSessionContext(state, props);
  current = state;
  return null;
}
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

const message = (id: number, role: 'user' | 'assistant', content: string, at: string) => ({
  id,
  session_id: 7,
  role,
  content,
  created_at: at,
  updated_at: at,
});

it('keeps a pre-model failure after switching away and back', async () => {
  vi.mocked(getAssistantSession).mockImplementation(async (id) => ({
    id,
    title: `会话 ${id}`,
    task_type: 'agent_chat',
    project_path: null,
    messages:
      id === 7
        ? [
            message(1, 'user', '先写修炼体系', '2026-10-28T07:05:00'),
            message(2, 'assistant', '好的。', '2026-10-28T07:05:00'),
          ]
        : [],
    created_at: '2026-10-28T07:00:00',
    updated_at: '2026-10-28T07:00:00',
  }));
  vi.mocked(getAssistantSessionFailedTurns).mockImplementation(async (id) =>
    id === 7
      ? [
          {
            run_id: 'run-2',
            user_message: '好让我们做下一步',
            failure: '会话历史超出保真预算',
            created_at: '2026-10-28T07:15:00',
          },
        ]
      : [],
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness session={7} />));
  const expected = [
    { role: 'user', content: '先写修炼体系' },
    { role: 'assistant', content: '好的。' },
    { role: 'user', content: '好让我们做下一步' },
    { role: 'assistant', content: '这轮没跑通：会话历史超出保真预算' },
  ];
  expect(current.messages).toEqual(expected);
  await act(async () => root.render(<Harness session={8} />));
  expect(current.messages).toEqual([]);
  await act(async () => root.render(<Harness session={7} />));
  expect(current.messages).toEqual(expected);
});

it('still loads the session when the failed-turn read fails', async () => {
  vi.mocked(getAssistantSession).mockResolvedValue({
    id: 7,
    title: '会话',
    task_type: 'agent_chat',
    project_path: null,
    messages: [message(1, 'user', '在吗', '2026-10-28T07:05:00')],
    created_at: '2026-10-28T07:00:00',
    updated_at: '2026-10-28T07:00:00',
  });
  vi.mocked(getAssistantSessionFailedTurns).mockRejectedValue(new Error('读不到运行记录'));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness session={7} />));
  expect(current.messages).toEqual([{ role: 'user', content: '在吗' }]);
  expect(current.sessionLoadError).toBeNull();
});

it('places failed turns by time, after messages written in the same second', () => {
  expect(
    mergeFailedTurns(
      [
        message(1, 'user', 'A', '2026-10-28T07:00:00'),
        message(2, 'assistant', 'a', '2026-10-28T07:00:00'),
        { ...message(3, 'system', '摘要', '2026-10-28T07:10:00') },
        message(4, 'user', 'C', '2026-10-28T07:20:00'),
      ],
      [
        { user_message: 'B2', failure: '二', created_at: '2026-10-28T07:15:00' },
        { user_message: 'B1', failure: '一', created_at: '2026-10-28T07:00:00' },
        { user_message: 'D', failure: '末', created_at: '2026-10-28T07:30:00' },
      ],
    ).map((item) => item.content),
  ).toEqual(['A', 'a', 'B1', '这轮没跑通：一', 'B2', '这轮没跑通：二', 'C', 'D', '这轮没跑通：末']);
});
