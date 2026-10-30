/**
 * 输入框「下一句」灰字的接线：空着时显示、Tab 填入、有字时 Tab 照旧、运行中不显示、
 * 刚接受的那一章换成「接着写下一章」、作者再发一句即失效、按键不重读立项事实。
 */
import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { captured } = vi.hoisted(() => ({
  captured: { state: null as ChatWindowState | null },
}));

vi.mock('../src/lib/api/ide-commands', () => ({ executeIdeCommand: vi.fn() }));
vi.mock('../src/lib/api/chapter-checks', () => ({
  queryChapterCheckHistory: vi.fn().mockResolvedValue({ entries: [], truncated: false }),
}));
vi.mock('../src/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api-client')>();
  return { ...actual, getAssistantSession: vi.fn(), listAssistantSessions: vi.fn(async () => []) };
});
vi.mock('../src/lib/project-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/project-context')>();
  return { ...actual, buildProjectIndex: vi.fn(() => new Promise(() => {})) };
});
vi.mock('../src/lib/api/project-setup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api/project-setup')>();
  return { ...actual, loadProjectSetupFacts: vi.fn() };
});
vi.mock('../src/components/chat-window/useChatWindowState', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/components/chat-window/useChatWindowState')>();
  return {
    ...actual,
    useChatWindowState: (props: Parameters<typeof actual.useChatWindowState>[0]) => {
      const state = actual.useChatWindowState(props);
      captured.state = state;
      return state;
    },
  };
});

import { ChatWindow } from '../src/components/ChatWindow';
import { ComposerBox } from '../src/components/chat-window/Composer';
import type { ChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { executeIdeCommand } from '../src/lib/api/ide-commands';
import { loadProjectSetupFacts } from '../src/lib/api/project-setup';
import { emitAuthorLoopResult, emitNewSessionRequest } from '../src/lib/assistant-events';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockedFacts = vi.mocked(loadProjectSetupFacts);
const projectPath = 'D:\\Books\\末世';
const chapters = [1, 2, 3, 4, 5].map((ordinal) => ({
  ordinal,
  relativePath: `正文/第00${ordinal}章.md`,
  estimatedChars: 3000,
}));
const DEFAULT_PLACEHOLDER = '输入想法，@ 提及角色，/ 用技能';

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.mocked(executeIdeCommand).mockResolvedValue({
    command_id: 'book.context',
    status: 'accepted',
    payload: { book_context: { chapters: [], previous_chapter: null } },
  } as unknown as Awaited<ReturnType<typeof executeIdeCommand>>);
  mockedFacts.mockReset().mockResolvedValue({ hasManuscript: true, missing: [] });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  captured.state = null;
  window.localStorage.clear();
});

const textarea = () => host.querySelector('textarea')!;
async function pressTab(init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => textarea().dispatchEvent(event));
  return event;
}
async function type(value: string) {
  const input = textarea();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function renderChat() {
  await act(async () => {
    root.render(
      <ChatWindow
        projectPath={projectPath}
        currentFile={null}
        assistantSessionId={null}
        bookChapters={chapters}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

test('新会话空输入框显示下一句；Tab 填进去，有字时 Tab 不接管', async () => {
  await renderChat();
  expect(textarea().placeholder).toBe('先聊聊第 6 章怎么写\u3000· Tab 填入');

  const fill = await pressTab();
  expect(fill.defaultPrevented).toBe(true);
  expect(textarea().value).toBe('先聊聊第 6 章怎么写');

  const again = await pressTab();
  expect(again.defaultPrevented).toBe(false);
  expect(textarea().value).toBe('先聊聊第 6 章怎么写');
});

test('运行中不显示提示，Tab 也不接管', async () => {
  await renderChat();
  await act(async () => captured.state!.setAgentBusy(true));
  expect(textarea().placeholder).toBe(DEFAULT_PLACEHOLDER);
  const event = await pressTab();
  expect(event.defaultPrevented).toBe(false);
  expect(textarea().value).toBe('');
});

test('刚接受第 5 章 → 接着写第 6 章；作者再发一句就失效；打字不重读立项事实', async () => {
  await renderChat();
  await act(async () =>
    captured.state!.setMessages([
      { role: 'user', content: '起草第5章' },
      { role: 'assistant', content: '写好了。' },
    ]),
  );
  expect(textarea().placeholder).toBe(DEFAULT_PLACEHOLDER);

  await act(async () => {
    emitAuthorLoopResult({
      filePath: `${projectPath}\\正文\\第005章.md`,
      status: 'completed',
      action: 'revision_accepted',
      message: '修订已写回',
    });
    await Promise.resolve();
  });
  expect(textarea().placeholder).toBe('接着写第 6 章\u3000· Tab 填入');

  const reads = mockedFacts.mock.calls.length;
  expect(reads).toBeGreaterThan(0);
  expect(mockedFacts).toHaveBeenLastCalledWith(projectPath);
  await type('接');
  await type('接着');
  await type('');
  expect(mockedFacts.mock.calls.length).toBe(reads);

  await act(async () =>
    captured.state!.setMessages((current) => [...current, { role: 'user', content: '先等等' }]),
  );
  expect(textarea().placeholder).toBe(DEFAULT_PLACEHOLDER);
});

test('切到新会话后刚接受作废', async () => {
  await renderChat();
  await act(async () => captured.state!.setMessages([{ role: 'assistant', content: '写好了。' }]));
  await act(async () => {
    emitAuthorLoopResult({
      filePath: `${projectPath}\\正文\\第005章.md`,
      status: 'completed',
      action: 'revision_accepted',
      message: '修订已写回',
    });
  });
  expect(textarea().placeholder).toBe('接着写第 6 章\u3000· Tab 填入');
  await act(async () => {
    emitNewSessionRequest();
    await Promise.resolve();
  });
  expect(textarea().placeholder).toBe('先聊聊第 6 章怎么写\u3000· Tab 填入');
});

test('别处接受失败或导出不算刚接受', async () => {
  await renderChat();
  await act(async () => captured.state!.setMessages([{ role: 'assistant', content: '写好了。' }]));
  await act(async () => {
    emitAuthorLoopResult({
      filePath: `${projectPath}\\正文\\第005章.md`,
      status: 'error',
      action: 'revision_accepted',
      message: '写回失败',
    });
    emitAuthorLoopResult({
      filePath: `${projectPath}\\正文\\第005章.md`,
      status: 'completed',
      action: 'exported',
      message: '已导出',
    });
  });
  expect(textarea().placeholder).toBe(DEFAULT_PLACEHOLDER);
});

type BoxProps = Partial<ComponentProps<typeof ComposerBox>>;
function Box(props: BoxProps) {
  const [value, setValue] = useState('');
  return (
    <ComposerBox
      value={value}
      onChange={setValue}
      onSubmit={() => undefined}
      disabled={false}
      busy={false}
      explicitContextPaths={[]}
      onAddContext={() => undefined}
      permissionProfile="ask"
      onPermissionProfileChange={() => undefined}
      hint="按你的建议来"
      {...props}
    />
  );
}

test.each([
  ['Shift+Tab', { shiftKey: true }, {}],
  ['输入法组字中', { isComposing: true }, {}],
  ['上下文选择打开时', {}, { contextPickerOpen: true }],
])('%s 不接管 Tab', async (_label, init, props) => {
  await act(async () => root.render(<Box {...props} />));
  const event = await pressTab(init);
  expect(event.defaultPrevented).toBe(false);
  expect(textarea().value).toBe('');
});

test('没打开项目时仍是禁用占位文字，Tab 不填', async () => {
  await act(async () => root.render(<Box disabled />));
  expect(textarea().placeholder).toBe('打开作品后即可使用 StoryForge');
  const event = await pressTab();
  expect(event.defaultPrevented).toBe(false);
});
