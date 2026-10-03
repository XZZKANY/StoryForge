import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as apiClient from '../src/lib/api-client';
import * as projectContext from '../src/lib/project-context';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import type { ChatWindowState } from '../src/components/chat-window/useChatWindowState';
import type { ChapterBrief } from '../src/components/chat-window/types';

const { run, captured } = vi.hoisted(() => ({
  run: vi.fn(),
  captured: { state: null as ChatWindowState | null },
}));
vi.mock('../src/components/chat-window/useRunAuthorAgent', () => ({
  useRunAuthorAgent: () => run,
}));
vi.mock('../src/components/chat-window/useChatSessionContext', () => ({
  useChatSessionContext: () => ({
    handleSelectSession: () => {},
    handleNewSession: () => {},
    retryAssistantSessionLoad: () => {},
    retryContextCandidates: () => {},
    addExplicitContext: () => {},
    togglePinnedContext: () => {},
  }),
}));
vi.mock('../src/components/chat-window/useAgentRunRecovery', () => ({
  useAgentRunRecovery: () => ({}),
}));
vi.mock('../src/components/chat-window/useAgentStreamEvent', () => ({
  useAgentStreamEvent: () => () => {},
}));
vi.mock('../src/components/chat-window/useAgentRunControls', () => ({
  useAgentRunControls: () => ({ retryLastFailedRun: () => {}, agentRunControls: {} }),
}));
// 保留真实 state hook，但把句柄暴露给测试，用于构造 agentBusy / 待确认守卫场景。
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
import {
  emitChapterWriteRequest,
  REQUEST_SAVE_ACTIVE_FILE_EVENT,
  SAVE_ACTIVE_FILE_DONE_EVENT,
} from '../src/lib/assistant-events';
import { TauriFileSystem } from '../src/lib/tauri-fs';
import type { SemanticFile } from '../src/lib/project/types';
import { TOAST_EVENT, type ToastDetail } from '../src/lib/toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let toasts: string[];
const onToast = (event: Event) => {
  toasts.push((event as CustomEvent<ToastDetail>).detail.message);
};

const pendingBrief: ChapterBrief = {
  briefId: 'chapter-brief-1',
  revision: 1,
  targetPath: '正文/第004章.md',
  chapterOrdinal: 4,
  chapterTitle: null,
  goal: '推进冲突',
  pov: null,
  setting: null,
  requiredBeats: [],
  forbiddenItems: [],
  continuityConstraints: [],
  targetCharsMin: 1600,
  targetCharsMax: 2600,
};

beforeEach(async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  toasts = [];
  run.mockReset().mockResolvedValue(undefined);
  window.addEventListener(TOAST_EVENT, onToast);
  await act(async () =>
    root.render(<ChatWindow projectPath="D:/fixture" currentFile={null} assistantSessionId={1} />),
  );
});
afterEach(() => {
  window.removeEventListener(TOAST_EVENT, onToast);
  act(() => root.unmount());
  host.remove();
});

test('起草事件转成 chapter.write run：goal 带章号与标题，目标路径透传', async () => {
  await act(async () => {
    emitChapterWriteRequest({
      targetPath: '正文/第004章.md',
      chapterOrdinal: 4,
      chapterTitle: '潮声',
    });
  });

  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]).toEqual([
    '起草第4章《潮声》',
    undefined,
    'chapter.write',
    [],
    { targetFilePath: '正文/第004章.md' },
  ]);
  const userMessages = [...host.querySelectorAll('[data-testid="user-message"]')];
  expect(userMessages.map((node) => node.textContent)).toEqual(['起草第4章《潮声》']);
});

test('无章号时 goal 回退为「起草下一章」', async () => {
  await act(async () => {
    emitChapterWriteRequest({ targetPath: '正文/第001章.md' });
  });

  expect(run.mock.calls[0]?.[0]).toBe('起草下一章');
  expect(run.mock.calls[0]?.[4]).toEqual({ targetFilePath: '正文/第001章.md' });
});

test('agentBusy / 待确认 brief / waiting run 时拦截，不发起 run 也不进消息列表', async () => {
  const userMessageCount = () => host.querySelectorAll('[data-testid="user-message"]').length;

  await act(async () => captured.state!.setAgentBusy(true));
  await act(async () => {
    emitChapterWriteRequest({ targetPath: '正文/第004章.md', chapterOrdinal: 4 });
  });
  expect(run).not.toHaveBeenCalled();
  expect(toasts).toEqual(['先处理当前待确认内容，再发起新的起草。']);
  expect(userMessageCount()).toBe(0);

  await act(async () => {
    captured.state!.setAgentBusy(false);
    captured.state!.setChapterBrief(pendingBrief);
  });
  await act(async () => {
    emitChapterWriteRequest({ targetPath: '正文/第004章.md', chapterOrdinal: 4 });
  });
  expect(run).not.toHaveBeenCalled();
  expect(toasts).toHaveLength(2);

  await act(async () => {
    captured.state!.setChapterBrief(null);
    captured.state!.setAgentRun({
      id: 'r1',
      sessionId: 'r1',
      goal: '修订',
      status: 'waiting',
      steps: [],
    });
  });
  await act(async () => {
    emitChapterWriteRequest({ targetPath: '正文/第004章.md', chapterOrdinal: 4 });
  });
  expect(run).not.toHaveBeenCalled();
  expect(toasts).toHaveLength(3);
  expect(userMessageCount()).toBe(0);

  // 确认收口后恢复可发起。
  await act(async () =>
    captured.state!.setAgentRun((value) => (value ? { ...value, status: 'completed' } : null)),
  );
  await act(async () => {
    emitChapterWriteRequest({ targetPath: '正文/第004章.md', chapterOrdinal: 4 });
  });
  expect(run).toHaveBeenCalledTimes(1);
});

const chapterCandidates: SemanticFile[] = [1, 2, 3].map((ordinal) => ({
  name: `第0${ordinal}章.md`,
  relativePath: `正文/第0${ordinal}章.md`,
  path: `D:/fixture/正文/第0${ordinal}章.md`,
  kind: 'draft',
  modified: 0,
  size: 10,
}));

async function submitComposer(value: string) {
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="composer-submit"]')!.click(),
  );
}

/** 提交一条真实 Composer 指令，返回跨章端点的 POST 次数；其余出网一律视为意外。 */
async function submitChapterMessage(value: string): Promise<string[]> {
  const readSpy = vi.spyOn(TauriFileSystem, 'readProjectFile').mockResolvedValue('合成章节正文');
  const crossCalls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/api/ide/review/cross-chapter')) {
        crossCalls.push(url);
        return Response.json({ findings: [], model: 'synthetic' });
      }
      throw new Error(`Unexpected fetch: ${init?.method} ${url}`);
    }),
  );
  const acknowledge = (event: Event) => {
    const detail = (event as CustomEvent<{ filePath: string }>).detail;
    window.dispatchEvent(
      new CustomEvent(SAVE_ACTIVE_FILE_DONE_EVENT, {
        detail: { filePath: detail?.filePath, status: 'ok' },
      }),
    );
  };
  window.addEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, acknowledge);
  try {
    await act(async () => captured.state!.setContextCandidates(chapterCandidates));
    await submitComposer(value);
  } finally {
    window.removeEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, acknowledge);
    readSpy.mockRestore();
    vi.unstubAllGlobals();
  }
  return crossCalls;
}

test('T03: 参考多章 + 写新章 走 agent，引用章作 pinned 上下文，不被跨章通道抢', async () => {
  const crossCalls = await submitChapterMessage('参考第2章和第3章，写第4章');
  expect(crossCalls).toHaveLength(0);
  expect(run).toHaveBeenCalledTimes(1);
  const [goal, , intent, , options] = run.mock.calls[0];
  expect(intent).toBe('chapter.write');
  // wave1-A(d): 作者原话逐字进 userMessage/instruction，引用章不再以 @ 形式拼进 instruction。
  expect(goal).toBe('参考第2章和第3章，写第4章');
  expect(options).toEqual({
    targetFilePath: '正文/第004章.md',
    planFallback: false,
    explicitContextPaths: ['正文/第02章.md', '正文/第03章.md'],
  });
});

test('T09: 写新章（目标不存在）不被吞，透传三位补零目标路径', async () => {
  await submitChapterMessage('写第4章');
  expect(run).toHaveBeenCalledTimes(1);
  const [, , intent, , options] = run.mock.calls[0];
  expect(intent).toBe('chapter.write');
  expect(options).toEqual({
    targetFilePath: '正文/第004章.md',
    planFallback: false,
    explicitContextPaths: [],
  });
});

test('T09: 写已有章号透传真实草稿相对路径', async () => {
  await submitChapterMessage('写第3章');
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]?.[2]).toBe('chapter.write');
  expect(run.mock.calls[0]?.[4]).toEqual({
    targetFilePath: '正文/第03章.md',
    planFallback: false,
    explicitContextPaths: [],
  });
});

test('T09: 写下一章无具体目标，走计划回退', async () => {
  await submitChapterMessage('写下一章');
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]?.[2]).toBe('chapter.write');
  expect(run.mock.calls[0]?.[4]).toEqual({
    targetFilePath: undefined,
    planFallback: true,
    explicitContextPaths: [],
  });
});

test('wave1-A(d): 路径含空格的引用章也逐字保留原话，且仍进 pinned 上下文', async () => {
  const spaced: SemanticFile[] = [
    {
      name: '第05章 旧梦.md',
      relativePath: '正文/第05章 旧梦.md',
      path: 'D:/fixture/正文/第05章 旧梦.md',
      kind: 'draft',
      modified: 0,
      size: 10,
    },
    {
      name: '第06章 变局.md',
      relativePath: '正文/第06章 变局.md',
      path: 'D:/fixture/正文/第06章 变局.md',
      kind: 'draft',
      modified: 0,
      size: 10,
    },
  ];
  const previous = chapterCandidates.slice();
  chapterCandidates.splice(0, chapterCandidates.length, ...spaced);
  try {
    const instruction = '参考第5章和第6章，写第7章';
    await submitChapterMessage(instruction);
    expect(run.mock.calls[0]?.[0]).toBe(instruction);
    expect(run.mock.calls[0]?.[4]?.explicitContextPaths).toEqual([
      '正文/第05章 旧梦.md',
      '正文/第06章 变局.md',
    ]);
  } finally {
    chapterCandidates.splice(0, chapterCandidates.length, ...previous);
  }
});

test('T03: 纯比较问题仍走跨章端点，不进 agent', async () => {
  const crossCalls = await submitChapterMessage('检查第1章和第2章是否一致');
  expect(crossCalls).toHaveLength(1);
  expect(crossCalls[0]).toContain('/api/ide/review/cross-chapter');
  expect(run).not.toHaveBeenCalled();
});

// 走真实 useRunAuthorAgent：本文件顶层 mock 只替换了 ChatWindow 的 run 句柄，
// importActual 取回真实实现，验证 planFallback / explicitContextPaths 在发请求边界上的行为。
test('wave1-A(c)(d): 真实 hook 下 planFallback 不锚定当前稿，explicitContextPaths 进 pinned', async () => {
  const real = (
    await vi.importActual<typeof import('../src/components/chat-window/useRunAuthorAgent')>(
      '../src/components/chat-window/useRunAuthorAgent',
    )
  ).useRunAuthorAgent;
  const sendSpy = vi
    .spyOn(apiClient, 'sendAgentUserMessage')
    .mockImplementation(() => new Promise(() => undefined));
  const bundleSpy = vi.spyOn(projectContext, 'buildContextBundle').mockResolvedValue({
    projectRoot: 'D:/fixture',
    currentFile: null,
    files: [],
    summary: { hasStoryStructure: false, counts: {} },
    budget: {
      fileCount: 0,
      charCount: 0,
      maxFiles: 8,
      maxExcerptChars: 1200,
      truncated: false,
      pinnedFileCount: 0,
      missingPinnedFiles: [],
    },
  } as unknown as projectContext.ContextBundle);
  const readSpy = vi.spyOn(TauriFileSystem, 'readProjectFile').mockResolvedValue('合成章节正文');

  let realRun: ReturnType<typeof real> | null = null;
  const container = document.createElement('div');
  document.body.append(container);
  const fallbackRoot = createRoot(container);
  const Harness = () => {
    const state = useChatWindowState({
      projectPath: 'D:/fixture',
      currentFile: 'D:/fixture/正文/第09章.md',
      assistantSessionId: 1,
    });
    realRun = real(
      state,
      () => {},
      () => {},
      async () => {},
      () => {},
      'ask',
    );
    return null;
  };
  try {
    await act(async () => fallbackRoot.render(<Harness />));
    await act(async () => {
      void realRun!('写下一章', undefined, 'chapter.write', [], {
        planFallback: true,
        explicitContextPaths: ['正文/第02章.md'],
      });
    });

    expect(bundleSpy).toHaveBeenCalled();
    expect(bundleSpy.mock.calls[0][0].pinnedFiles).toEqual(['正文/第02章.md']);
    // planFallback 不刷盘不读当前稿：当前打开的第09章一次都不该被读。
    expect(readSpy.mock.calls.some((call) => String(call[1]).includes('第09章'))).toBe(false);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const request = sendSpy.mock.calls[0][0];
    expect(request.args?.current_file).toBeUndefined();
    expect(request.args?.file_path).toBeUndefined();
    expect(request.args?.content).toBeUndefined();
    expect(JSON.stringify(request.args?.context_bundle)).toContain('第02章');
  } finally {
    act(() => fallbackRoot.unmount());
    container.remove();
    sendSpy.mockRestore();
    bundleSpy.mockRestore();
    readSpy.mockRestore();
  }
});
