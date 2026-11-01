import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('../src/lib/api/chapter-checks', () => ({
  queryChapterCheckHistory: vi.fn().mockResolvedValue({ entries: [], truncated: false }),
}));
vi.mock('../src/lib/api/author-instructions', () => ({
  loadAuthorInstructions: vi.fn(async () => ({ status: 'missing', filePath: 'x' })),
}));
vi.mock('../src/lib/api/conversation-skills', () => ({
  loadConversationSkills: vi.fn(async () => []),
}));
vi.mock('../src/lib/host/plugin-library', () => ({
  pluginLibraryDir: vi.fn(async () => 'C:\\库'),
}));
vi.mock('../src/lib/api/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/plugins')>()),
  listPlugins: vi.fn(async () => []),
  readEnabledPlugins: vi.fn(async () => ({ enabled: [], problem: null })),
}));

import { ChatWindowView } from '../src/components/chat-window/ChatWindowView';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import type { WriteBatchScheduler } from '../src/components/chat-window/useWriteBatchScheduler';
import type { WriteBatchProgress } from '../src/components/chat-window/write-batch-run';
import { CHAT_SIDE_RAIL_MIN_WIDTH } from '../src/components/chat-window/useChatSideRail';
import { REQUEST_OPEN_FILE_EVENT } from '../src/lib/assistant-events';
import type { LayoutMode } from '../src/components/shell/useShellState';
import type { ContextBundle, SemanticFile } from '../src/lib/project-context';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement;
let chatWidth = 1300;
const stop = vi.fn();

class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: chatWidth } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  disconnect() {}
  unobserve() {}
}

const progress: WriteBatchProgress = {
  ordinal: 12,
  index: 2,
  total: 3,
  used: '5.4 万',
  cap: '62.2 万',
  stopping: false,
  chapters: [
    { ordinal: 11, title: '雾港', state: 'written', targetPath: '正文/第011章.md', chars: 3200 },
    { ordinal: 12, title: null, state: 'pending', targetPath: '正文/第012章.md', chars: null },
    { ordinal: 13, title: null, state: 'pending', targetPath: '正文/第013章.md', chars: null },
  ],
};
const candidates: SemanticFile[] = ['规则', '人物'].map((name) => ({
  name: `${name}.md`,
  path: `D:/book/资料/${name}.md`,
  relativePath: `资料/${name}.md`,
  kind: 'knowledge',
  size: 100,
  modified: 1,
}));
const bundle = {
  projectRoot: 'D:/book',
  currentFile: null,
  files: [
    {
      path: 'D:/book/大纲/总纲.md',
      relativePath: '大纲/总纲.md',
      kind: 'outline',
      title: '',
      excerpt: '',
    },
  ],
  summary: { hasStoryStructure: true, counts: {} },
  budget: {
    fileCount: 1,
    charCount: 120,
    maxFiles: 8,
    maxExcerptChars: 1200,
    truncated: true,
    overflowCount: 6,
    unreadableCount: 0,
    pinnedFileCount: 0,
    missingPinnedFiles: [],
  },
} as unknown as ContextBundle;

const scheduler = {
  phase: { kind: 'running', progress },
  occupied: true,
  stop,
} as unknown as WriteBatchScheduler;

function Harness({
  layoutMode,
  lastBundle = null,
}: {
  layoutMode: LayoutMode;
  lastBundle?: ContextBundle | null;
}) {
  const state = useChatWindowState({ projectPath: 'D:/book', currentFile: null });
  return (
    <ChatWindowView
      state={{
        ...state,
        contextCandidates: candidates,
        lastContextBundle: lastBundle,
        messages: [],
        agentRun: null,
      }}
      projectPath="D:/book"
      assistantSessionId={null}
      layoutMode={layoutMode}
      onSetLayoutMode={() => {}}
      onOpenObservatory={() => {}}
      observatoryAttention={false}
      agentPermissionProfile="ask"
      onAgentPermissionProfileChange={() => {}}
      handleSelectSession={() => {}}
      handleNewSession={() => {}}
      retryAssistantSessionLoad={() => {}}
      retryContextCandidates={() => {}}
      addExplicitContext={() => state.setContextPickerOpen((open) => !open)}
      togglePinnedContext={(path) =>
        state.setExplicitContextPaths((paths) =>
          paths.includes(path) ? paths.filter((entry) => entry !== path) : [...paths, path],
        )
      }
      handleSubmit={async () => {}}
      handleComposerSubmit={async () => {}}
      userMessageHistory={[]}
      retryLastFailedRun={() => {}}
      agentRunControls={{
        onApprovePermission: () => {},
        onDenyPermission: () => {},
        onPauseRun: () => {},
        onResumeRun: () => {},
        onStopRun: () => {},
      }}
      writeBatchScheduler={scheduler}
    />
  );
}

async function render(layoutMode: LayoutMode, lastBundle: ContextBundle | null = null) {
  await act(async () => root!.render(<Harness layoutMode={layoutMode} lastBundle={lastBundle} />));
}
const q = (testid: string) => host.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  localStorage.clear();
  chatWidth = 1300;
  stop.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
  root = undefined;
  vi.unstubAllGlobals();
});

test('对话占满且够宽：批量写章与上下文进右边侧栏，输入框顶边小条和对话头浮窗不再重复放', async () => {
  await render('chat');
  const rail = q('chat-side-rail');
  expect(rail).not.toBeNull();
  expect(rail!.contains(q('write-batch-progress'))).toBe(true);
  expect(rail!.contains(q('context-panel'))).toBe(true);
  expect(q('composer-dock')!.childElementCount).toBe(0);
  expect(q('conversation-context-toggle')).toBeNull();
  expect(q('conversation-side-rail-toggle')!.getAttribute('aria-pressed')).toBe('true');

  const rows = [...host.querySelectorAll<HTMLElement>('[data-testid="side-rail-chapter"]')];
  expect(rows.map((row) => row.dataset.state)).toEqual(['written', 'writing', 'pending']);
  expect(rows.map((row) => row.textContent)).toEqual([
    '✓第 11 章《雾港》3200 字',
    '第 12 章正在写',
    '○第 13 章待写',
  ]);
  expect(q('side-rail-write-batch-position')!.textContent).toBe('第 12 章（2 / 3）');

  const opened: string[] = [];
  const onOpen = (event: Event) =>
    opened.push((event as CustomEvent<{ filePath: string }>).detail.filePath);
  window.addEventListener(REQUEST_OPEN_FILE_EVENT, onOpen);
  await act(async () => rows[0].querySelector('button')!.click());
  window.removeEventListener(REQUEST_OPEN_FILE_EVENT, onOpen);
  expect(opened).toHaveLength(1);
  expect(opened[0].replaceAll('\\', '/')).toBe('D:/book/正文/第011章.md');
  // 没写进的章不给点开。
  expect(rows[1].querySelector('button')).toBeNull();

  await act(async () => q('write-batch-stop')!.click());
  expect(stop).toHaveBeenCalledOnce();
});

test('收起侧栏：进度回到输入框顶边小条，收起记在本机', async () => {
  await render('chat');
  await act(async () => q('conversation-side-rail-toggle')!.click());
  expect(q('chat-side-rail')).toBeNull();
  expect(q('composer-dock')!.contains(q('write-batch-progress'))).toBe(true);
  expect(localStorage.getItem('storyforge:chat-side-rail')).toBe('closed');

  await act(async () => root!.unmount());
  root = createRoot(host);
  await render('chat');
  expect(q('chat-side-rail')).toBeNull();
  expect(q('conversation-side-rail-toggle')!.getAttribute('aria-pressed')).toBe('false');
});

test('从对话占满切回平衡（Ctrl 2）侧栏就收走，进度回到小条', async () => {
  await render('chat');
  expect(q('chat-side-rail')).not.toBeNull();
  await render('balanced');
  expect(q('chat-side-rail')).toBeNull();
  expect(q('composer-dock')!.contains(q('write-batch-progress'))).toBe(true);
  expect(q('conversation-context-toggle')).not.toBeNull();
});

test.each([
  { layoutMode: 'balanced' as const, width: 1300 },
  { layoutMode: 'chat' as const, width: CHAT_SIDE_RAIL_MIN_WIDTH - 1 },
])('不是对话占满或不够宽（%j）就没有侧栏，照旧用小条和浮窗', async ({ layoutMode, width }) => {
  chatWidth = width;
  await render(layoutMode);
  expect(q('chat-side-rail')).toBeNull();
  expect(q('composer-dock')!.contains(q('write-batch-progress'))).toBe(true);
  expect(q('conversation-context-toggle')).not.toBeNull();
  expect(q('conversation-side-rail-toggle')).toBeNull();
});

test('侧栏里列这一轮的参考资料；点输入框的「+」选资料，列表出在输入框上方而不是侧栏里', async () => {
  await render('chat', bundle);
  const rail = q('chat-side-rail')!;
  const references = q('side-rail-references')!;
  expect(rail.contains(references)).toBe(true);
  expect(references.textContent).toContain('这一轮带了 1 份参考资料');
  expect(references.textContent).toContain('另有 6 份没带上');
  expect(host.querySelector('li[title="大纲/总纲.md"]')!.textContent).toBe('总纲');
  // 有警告也不在输入框顶边再挂一行：说明都在侧栏里。
  expect(q('context-summary')).toBeNull();

  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="添加上下文"]')!.click(),
  );
  const picker = q('context-picker')!;
  expect(q('composer-dock')!.contains(picker)).toBe(true);
  expect(rail.contains(picker)).toBe(false);
  expect(q('side-rail-references-add')!.textContent).toBe('完成');

  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-context-path="资料/规则.md"]')!.click(),
  );
  expect(q('pinned-context-list')!.textContent).toContain('资料/规则.md');
  expect(references.contains(q('pinned-context-list'))).toBe(true);

  await act(async () => q('context-picker-toggle')!.click());
  expect(q('context-picker')).toBeNull();
});
