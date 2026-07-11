import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, test, vi } from 'vitest';

import { ChatWindow } from '../src/components/ChatWindow';
import { ContextSummaryPanel } from '../src/components/chat-window/panels';
import { getAssistantSession } from '../src/lib/api-client';
import { buildProjectIndex } from '../src/lib/project-context';

vi.mock('../src/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api-client')>();
  return { ...actual, getAssistantSession: vi.fn() };
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
