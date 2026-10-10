/**
 * 新会话开场「接着写」：伙伴先开口、事实只来自后端投影、点之前不进会话、旧会话不插话。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';

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
  return { ...actual, buildProjectIndex: vi.fn() };
});

import { ChatWindow } from '../src/components/ChatWindow';
import { PartnerOpening } from '../src/components/chat-window/PartnerOpening';
import { useChapterHandoff } from '../src/components/app/useChapterHandoff';
import { executeIdeCommand } from '../src/lib/api/ide-commands';
import { getAssistantSession } from '../src/lib/api-client';
import { buildProjectIndex } from '../src/lib/project-context';
import { buildChapterHandoff, type ChapterHandoff } from '../src/lib/chapter-handoff';
import type { ObservatoryPromises } from '../src/lib/observations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockedExecute = vi.mocked(executeIdeCommand);
const mockedGetSession = vi.mocked(getAssistantSession);
const mockedBuildIndex = vi.mocked(buildProjectIndex);

const projectPath = 'D:/Books/末世';
const chapters = [1, 2, 3, 4, 5].map((ordinal) => ({
  ordinal,
  relativePath: `正文/第00${ordinal}章.md`,
  estimatedChars: 3000,
}));
const promises: ObservatoryPromises = {
  currentChapter: 5,
  ledger: [
    {
      id: 'survivors',
      title: '十七楼幸存者目击线',
      status: 'planted',
      kind: 'foreshadow',
      plantedChapter: 1,
      dueChapter: null,
      resolvedChapter: null,
      lastTouchChapter: 1,
      issues: [],
    },
  ],
};
const TAIL =
  '窗外的雾还没散。三声之后，再也没有别的声响。陈默把最后一块面饼塞进嘴里，嚼碎，咽下去。';

function bookContextResult(previous: { relative_path: string; tail: string } | null) {
  return {
    command_id: 'book.context',
    status: 'accepted',
    payload: { book_context: { chapters: [], previous_chapter: previous } },
  } as unknown as Awaited<ReturnType<typeof executeIdeCommand>>;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  return container;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container?.remove();
  container = null;
  mockedExecute.mockReset();
  mockedGetSession.mockReset();
  mockedBuildIndex.mockReset();
  window.localStorage.clear();
});

function handoffWithTail(): ChapterHandoff {
  return buildChapterHandoff({
    chapters,
    previousChapter: { relativePath: '正文/第005章.md', tail: TAIL },
    promises,
  });
}

test('开场引用上一章结尾与久未推进的伏笔，三个下一步各自把对的东西交出去', async () => {
  const host = mount();
  const onDraft = vi.fn();
  const onAsk = vi.fn();
  const handoff = handoffWithTail();
  await act(async () =>
    root!.render(<PartnerOpening handoff={handoff} onDraft={onDraft} onAsk={onAsk} />),
  );
  const text = host.textContent ?? '';
  expect(text).toContain('第 5 章停在这里');
  expect(text).toContain('陈默把最后一块面饼塞进嘴里');
  expect(text).toContain('「十七楼幸存者目击线」第 1 章埋下，之后 4 章没再碰');
  expect(text).toContain('第 6 章从哪儿接？');
  expect(text).toContain('依据：正文/第005章.md 结尾 · 观测镜伏笔账');

  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="partner-opening-draft"]')!.click(),
  );
  expect(onDraft).toHaveBeenCalledWith(handoff.next);
  expect(handoff.next.targetPath).toBe('正文/第006章.md');

  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="partner-opening-discuss"]')!.click(),
  );
  expect(onAsk.mock.calls.at(-1)?.[0]).toContain('第 6 章还没动笔。先别写正文');

  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="partner-opening-promise"]')!.click(),
  );
  expect(onAsk.mock.calls.at(-1)?.[0]).toContain('第 6 章想接上「十七楼幸存者目击线」');
});

test('空手稿开场只问开篇，不编上一章，也没有接伏笔的按钮', async () => {
  const host = mount();
  const handoff = buildChapterHandoff({ chapters: [], previousChapter: null, promises: null });
  await act(async () =>
    root!.render(<PartnerOpening handoff={handoff} onDraft={vi.fn()} onAsk={vi.fn()} />),
  );
  expect(host.textContent).toContain('这本书还没有正文');
  expect(host.textContent).toContain('起草第 1 章');
  expect(host.textContent).toContain('先聊聊开篇');
  expect(host.textContent).not.toContain('停在这里');
  expect(host.querySelector('[data-testid="partner-opening-promise"]')).toBeNull();
  expect(host.textContent).not.toContain('依据');
});

let latest: ChapterHandoff | null = null;
function HandoffHarness({ project, enabled = true }: { project: string; enabled?: boolean }) {
  latest = useChapterHandoff({ projectPath: project, chapters, promises: null, enabled });
  return null;
}

test('按下一章向 book.context 要上一章结尾；切项目后旧响应作废', async () => {
  let resolveFirst: (value: Awaited<ReturnType<typeof executeIdeCommand>>) => void = () => {};
  mockedExecute
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValueOnce(
      bookContextResult({ relative_path: '正文/第005章.md', tail: '第二个项目的结尾。' }),
    );
  mount();
  await act(async () => root!.render(<HandoffHarness project="D:/A" />));
  expect(mockedExecute).toHaveBeenCalledWith('book.context', {
    project_root: 'D:/A',
    current_file: '正文/第006章.md',
  });
  await act(async () => root!.render(<HandoffHarness project="D:/B" />));
  await act(async () => {
    resolveFirst(bookContextResult({ relative_path: '正文/第005章.md', tail: '旧项目的结尾。' }));
    await Promise.resolve();
  });
  assert.deepEqual(latest?.excerpt, ['第二个项目的结尾。']);
});

test('未启用时不发请求，交接仍给出章号与伏笔', async () => {
  mount();
  await act(async () => root!.render(<HandoffHarness project="D:/A" enabled={false} />));
  expect(mockedExecute).not.toHaveBeenCalled();
  expect(latest?.next.chapterOrdinal).toBe(6);
  expect(latest?.excerpt).toBeNull();
});

function emptyIndex() {
  return {
    projectPath,
    files: [],
    summary: {
      hasStoryStructure: false,
      counts: {
        outline: 0,
        character: 0,
        setting: 0,
        timeline: 0,
        foreshadowing: 0,
        knowledge: 0,
        draft: 0,
        quality: 0,
        export: 0,
        other: 0,
      },
    },
  } as unknown as Awaited<ReturnType<typeof buildProjectIndex>>;
}

test('新会话里伙伴先开口；打开旧会话不插话，历史还没读回来时也不闪', async () => {
  mockedBuildIndex.mockResolvedValue(emptyIndex());
  mockedExecute.mockResolvedValue(
    bookContextResult({ relative_path: '正文/第005章.md', tail: TAIL }),
  );
  // 旧会话的历史一直没读回来：消息列表此刻是空的，开场也不能趁机冒出来。
  mockedGetSession.mockImplementation(() => new Promise(() => {})) as typeof mockedGetSession;
  const host = mount();
  await act(async () => {
    root!.render(
      <ChatWindow
        projectPath={projectPath}
        currentFile={null}
        assistantSessionId={null}
        bookChapters={chapters}
        bookPromises={promises}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  const opening = host.querySelector('[data-testid="partner-opening"]');
  assert.ok(opening, '新会话应当显示开场');
  expect(opening.textContent).toContain('陈默把最后一块面饼塞进嘴里');
  expect(opening.textContent).toContain('十七楼幸存者目击线');

  await act(async () => {
    root!.render(
      <ChatWindow
        projectPath={projectPath}
        currentFile={null}
        assistantSessionId={7}
        bookChapters={chapters}
        bookPromises={promises}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(host.querySelector('[data-testid="partner-opening"]')).toBeNull();
});

test('不给作品事实时对话区保持原样空白', async () => {
  mockedBuildIndex.mockResolvedValue(emptyIndex());
  const host = mount();
  await act(async () => {
    root!.render(<ChatWindow projectPath={projectPath} currentFile={null} />);
    await Promise.resolve();
  });
  expect(host.querySelector('[data-testid="partner-opening"]')).toBeNull();
  expect(mockedExecute).not.toHaveBeenCalledWith('book.context', expect.anything());
});
