import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, test, vi } from 'vitest';

import { ChatWindow } from '../src/components/ChatWindow';
import { ContextSummaryPanel } from '../src/components/chat-window/panels';
import { getAssistantSession } from '../src/lib/api-client';
import {
  buildProjectIndex,
  readProjectKnowledgeSelection,
  writeProjectKnowledgeSelection,
} from '../src/lib/project-context';

vi.mock('../src/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api-client')>();
  // ConversationHeader 的会话下拉（Q5）挂载即拉列表；测试里 stub 掉，避免打真端口。
  return { ...actual, getAssistantSession: vi.fn(), listAssistantSessions: vi.fn(async () => []) };
});

vi.mock('../src/lib/project-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/project-context')>();
  return { ...actual, buildProjectIndex: vi.fn() };
});

const mockedGetAssistantSession = vi.mocked(getAssistantSession);
const mockedBuildProjectIndex = vi.mocked(buildProjectIndex);

afterEach(() => {
  mockedGetAssistantSession.mockReset();
  mockedBuildProjectIndex.mockReset();
  window.localStorage.clear();
});

test('项目知识选择跨会话恢复并报告陈旧路径', async () => {
  const projectPath = 'D:/Books/story';
  writeProjectKnowledgeSelection(projectPath, ['.资料/规则.md', '.资料/已删除.md']);
  mockedGetAssistantSession.mockImplementation(async (id) => ({
    id,
    title: `Session ${id}`,
    messages: [],
  })) as typeof mockedGetAssistantSession;
  mockedBuildProjectIndex.mockResolvedValue({
    projectPath,
    files: [
      {
        name: '规则.md',
        path: `${projectPath}/.资料/规则.md`,
        relativePath: '.资料/规则.md',
        kind: 'knowledge',
        size: 100,
        modified: 1,
      },
      {
        name: '总纲.md',
        path: `${projectPath}/大纲/总纲.md`,
        relativePath: '大纲/总纲.md',
        kind: 'outline',
        size: 100,
        modified: 1,
      },
    ],
    summary: {
      hasStoryStructure: false,
      counts: {
        outline: 0,
        character: 0,
        setting: 0,
        timeline: 0,
        foreshadowing: 0,
        knowledge: 1,
        draft: 0,
        quality: 0,
        export: 0,
        other: 0,
      },
    },
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <ChatWindow projectPath={projectPath} currentFile={null} assistantSessionId={41} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.match(container.textContent ?? '', /.资料\/规则.md/);
    assert.match(container.textContent ?? '', /未读到：.资料\/已删除.md/);

    const pickerToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="context-picker-toggle"]',
    );
    assert.ok(pickerToggle);
    act(() => pickerToggle.click());
    const outlineToggle = container.querySelector<HTMLButtonElement>(
      '[data-context-path="大纲/总纲.md"]',
    );
    assert.ok(outlineToggle);
    act(() => outlineToggle.click());
    assert.deepEqual(readProjectKnowledgeSelection(projectPath), ['.资料/规则.md']);

    await act(async () => {
      root.render(
        <ChatWindow projectPath={projectPath} currentFile={null} assistantSessionId={42} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.match(container.textContent ?? '', /.资料\/规则.md/);
    assert.doesNotMatch(container.textContent ?? '', /未读到：.资料\/已删除.md/);
    assert.equal(container.querySelector('span[title="大纲/总纲.md"]'), null);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('历史会话加载失败时保留选择并提供重试', async () => {
  mockedGetAssistantSession.mockRejectedValue(new Error('sidecar unavailable'));
  mockedBuildProjectIndex.mockResolvedValue({ files: [] } as Awaited<
    ReturnType<typeof buildProjectIndex>
  >);
  const onAssistantSessionChange = vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <ChatWindow
          projectPath="D:/Books/story"
          currentFile={null}
          assistantSessionId={42}
          onAssistantSessionChange={onAssistantSessionChange}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const error = container.querySelector('[data-testid="assistant-session-load-error"]');
    assert.ok(error);
    assert.match(error.textContent ?? '', /会话 #42 加载失败/);
    assert.equal(onAssistantSessionChange.mock.calls.length, 0);

    const retry = container.querySelector<HTMLButtonElement>(
      '[data-testid="assistant-session-load-retry"]',
    );
    assert.ok(retry);
    await act(async () => {
      retry.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(mockedGetAssistantSession.mock.calls.length, 2);
    assert.equal(onAssistantSessionChange.mock.calls.length, 0);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('切换历史会话失败时不把上一会话内容归到新会话', async () => {
  mockedGetAssistantSession
    .mockResolvedValueOnce({
      id: 41,
      title: 'Session A',
      messages: [{ role: 'user', content: 'A 会话私有内容' }],
    } as Awaited<ReturnType<typeof getAssistantSession>>)
    .mockRejectedValueOnce(new Error('sidecar unavailable'));
  mockedBuildProjectIndex.mockResolvedValue({ files: [] } as Awaited<
    ReturnType<typeof buildProjectIndex>
  >);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <ChatWindow projectPath="D:/Books/story" currentFile={null} assistantSessionId={41} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.match(container.textContent ?? '', /A 会话私有内容/);

    await act(async () => {
      root.render(
        <ChatWindow projectPath="D:/Books/story" currentFile={null} assistantSessionId={42} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.doesNotMatch(container.textContent ?? '', /A 会话私有内容/);
    assert.match(container.textContent ?? '', /会话 #42 加载失败/);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('上下文索引失败态不伪装成项目没有 Markdown，并提供重试', () => {
  const html = renderToStaticMarkup(
    <ContextSummaryPanel
      currentFileLabel={null}
      explicitContextPaths={[]}
      contextCandidates={[]}
      contextCandidatesLoading={false}
      contextCandidatesError="上下文索引读取失败：目录不可读"
      contextPickerOpen
      lastContextBundle={null}
      missingContextPaths={[]}
      onAddContext={() => undefined}
      onTogglePinnedContext={() => undefined}
      onRetryContextCandidates={() => undefined}
    />,
  );

  assert.match(html, /上下文索引读取失败：目录不可读/);
  assert.match(html, /data-testid="context-candidates-retry"/);
  assert.doesNotMatch(html, /当前项目还没有可选的 Markdown 上下文/);
});

test('上下文索引加载中不显示空项目结论', () => {
  const html = renderToStaticMarkup(
    <ContextSummaryPanel
      currentFileLabel={null}
      explicitContextPaths={[]}
      contextCandidates={[]}
      contextCandidatesLoading
      contextCandidatesError={null}
      contextPickerOpen
      lastContextBundle={null}
      missingContextPaths={[]}
      onAddContext={() => undefined}
      onTogglePinnedContext={() => undefined}
      onRetryContextCandidates={() => undefined}
    />,
  );

  assert.match(html, /正在读取项目上下文/);
  assert.doesNotMatch(html, /当前项目还没有可选的 Markdown 上下文/);
});

test('上下文索引失败后点击重试会重新读取项目索引', async () => {
  mockedGetAssistantSession.mockResolvedValue({
    id: 1,
    title: 'unused',
    messages: [],
  } as Awaited<ReturnType<typeof getAssistantSession>>);
  mockedBuildProjectIndex.mockRejectedValue(new Error('目录不可读'));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <ChatWindow projectPath="D:/Books/story" currentFile={null} assistantSessionId={null} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="context-picker-toggle"]',
    );
    assert.ok(toggle);
    act(() => toggle.click());

    const retry = container.querySelector<HTMLButtonElement>(
      '[data-testid="context-candidates-retry"]',
    );
    assert.ok(retry);
    await act(async () => {
      retry.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(mockedBuildProjectIndex.mock.calls.length, 2);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
