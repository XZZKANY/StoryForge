/**
 * 左栏手稿视图与 useBookContext 的行为红线。
 *
 * 这个视图存在的理由是「让作者看见模型看见的书」，所以两条红线最要紧：
 * - **截断要说人话**：骨架 / 名单被砍了几条必须写成数字，不能只留一个「已截断」的暗示；
 * - **失败不装没事**：读不到就说读不到，绝不拿空章节列表冒充「这本书是空的」。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useBookContext } from '../src/components/app/useBookContext';
import { ManuscriptView } from '../src/components/shell/ManuscriptView';
import { mapBookContextPayload } from '../src/lib/book-context';
import { executeIdeCommand } from '../src/lib/api/ide-commands';

vi.mock('../src/lib/api/ide-commands', () => ({ executeIdeCommand: vi.fn() }));
const mockedExecute = vi.mocked(executeIdeCommand);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function rawPayload(overrides: Record<string, unknown> = {}) {
  return {
    total_chapters: 2,
    total_estimated_chars: 124000,
    current_relative_path: '正文/第002章.md',
    current_ordinal: 2,
    chapters: [
      { ordinal: 1, relative_path: '正文/第001章.md', estimated_chars: 4000 },
      { ordinal: 2, relative_path: '正文/第002章.md', estimated_chars: 4100 },
    ],
    skeleton: [{ relative_path: '大纲/总纲.md', estimated_chars: 800 }],
    skeleton_total: 1,
    skeleton_limit: 12,
    roster: [
      { canonical_name: '陈默', aliases: ['守夜人'], first_chapter: 1, last_chapter: 2 },
    ],
    roster_declared_total: 1,
    roster_limit: 20,
    dossier_relative_path: null,
    previous_chapter: null,
    prompt_block: '[作品底座 · 确定性]\n· 全书 2 章正文。',
    ...overrides,
  };
}

function commandResult(overrides: Record<string, unknown> = {}) {
  return {
    command_id: 'book.context',
    status: 'accepted',
    payload: { book_context: rawPayload(overrides) },
  };
}

async function renderView(
  props: Partial<Parameters<typeof ManuscriptView>[0]> & {
    payloadOverrides?: Record<string, unknown>;
  } = {},
) {
  const { payloadOverrides, ...rest } = props;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <ManuscriptView
        snapshot={mapBookContextPayload(rawPayload(payloadOverrides))}
        availability="available"
        refreshing={false}
        onRefresh={() => {}}
        onOpenChapter={() => {}}
        onBackToExplorer={() => {}}
        {...rest}
      />,
    );
  });
  return container!;
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  vi.clearAllMocks();
});

// --- 视图 ---

test('chapters render in reading order with the open one marked current', async () => {
  const dom = await renderView();

  const rows = [...dom.querySelectorAll('[data-testid="manuscript-chapter-row"]')];
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent ?? '', /第001章\.md/);
  assert.equal(rows[0].getAttribute('data-current'), 'false');
  assert.equal(rows[1].getAttribute('data-current'), 'true');
});

test('clicking a chapter asks to open it by its project-relative path', async () => {
  const opened: string[] = [];
  const dom = await renderView({ onOpenChapter: (path) => opened.push(path) });

  const rows = [...dom.querySelectorAll('[data-testid="manuscript-chapter-row"]')];
  await act(async () => {
    (rows[0] as HTMLButtonElement).click();
  });

  assert.deepEqual(opened, ['正文/第001章.md']);
});

test('the header states the scale of the book with the same estimate the model got', async () => {
  const dom = await renderView();

  const scale = dom.querySelector('[data-testid="manuscript-scale"]');
  assert.equal(scale?.textContent, '2 章 · 约 12.4 万字');
});

test('truncation is spelled out as a number, not hinted at', async () => {
  const dom = await renderView({
    payloadOverrides: {
      skeleton: Array.from({ length: 12 }, (_, index) => ({
        relative_path: `设定/${index}.md`,
        estimated_chars: 100,
      })),
      skeleton_total: 17,
    },
  });

  await act(async () => {
    (dom.querySelector('[data-testid="manuscript-toggle-skeleton"]') as HTMLButtonElement).click();
  });

  const note = dom.querySelector('[data-testid="manuscript-dropped-note"]');
  // #235 的教训:作者要能读出「另有 5 份没进这一轮」,而不是猜。
  assert.match(note?.textContent ?? '', /另有\s*5\s*份/);
});

test('nothing is claimed as dropped when the model got everything', async () => {
  const dom = await renderView();

  await act(async () => {
    (dom.querySelector('[data-testid="manuscript-toggle-skeleton"]') as HTMLButtonElement).click();
  });

  assert.equal(dom.querySelector('[data-testid="manuscript-dropped-note"]'), null);
});

test('the exact system text the model received is shown verbatim', async () => {
  const block = '[作品底座 · 确定性]\n· 全书 30 章正文；当前打开的是第 30 章。';
  const dom = await renderView({ payloadOverrides: { prompt_block: block } });

  await act(async () => {
    (dom.querySelector('[data-testid="manuscript-toggle-prompt"]') as HTMLButtonElement).click();
  });

  assert.equal(dom.querySelector('[data-testid="manuscript-prompt-block"]')?.textContent, block);
});

test('a failed read says so instead of rendering an empty book', async () => {
  const dom = await renderView({ snapshot: null, availability: 'error' });

  assert.equal(dom.querySelector('[data-testid="manuscript-chapter-list"]'), null);
  assert.match(dom.textContent ?? '', /读取失败/);
});

// --- hook ---

type BookContextApi = ReturnType<typeof useBookContext>;
let latest: BookContextApi | null = null;

function Harness({ project, file }: { project: string | null; file: string | null }) {
  latest = useBookContext({ activeProject: project, currentFile: file });
  return null;
}

async function renderHook(project: string | null, file: string | null) {
  if (!root) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(<Harness project={project} file={file} />);
    await Promise.resolve();
  });
}

beforeEach(() => {
  latest = null;
});

test('switching the open file re-reads the context so the chapter number keeps up', async () => {
  mockedExecute.mockResolvedValue(commandResult());
  await renderHook('D:/book', 'D:/book/正文/第001章.md');
  const afterFirst = mockedExecute.mock.calls.length;

  await renderHook('D:/book', 'D:/book/正文/第002章.md');

  assert.ok(mockedExecute.mock.calls.length > afterFirst, '切文件必须重取,否则章号会长期显示错的');
  const lastArgs = mockedExecute.mock.calls.at(-1)?.[1] as Record<string, unknown>;
  assert.equal(lastArgs.current_file, 'D:/book/正文/第002章.md');
});

test('a project switch discards an in-flight response from the previous project', async () => {
  let releaseFirst: ((value: unknown) => void) | null = null;
  mockedExecute.mockImplementationOnce(
    () => new Promise((resolve) => (releaseFirst = resolve)) as Promise<never>,
  );
  await renderHook('D:/old-book', null);

  mockedExecute.mockResolvedValue(commandResult({ total_chapters: 99 }));
  await renderHook('D:/new-book', null);

  await act(async () => {
    releaseFirst?.(commandResult({ total_chapters: 1 }));
    await Promise.resolve();
  });

  // 旧项目的慢响应绝不能落进新项目的面板。
  assert.notEqual(latest?.snapshot?.totalChapters, 1);
});

test('a payload whose shape changed is reported as an error, not an empty manuscript', async () => {
  mockedExecute.mockResolvedValue({
    command_id: 'book.context',
    status: 'accepted',
    payload: { book_context: { chapters: 'not-an-array' } },
  });

  await renderHook('D:/book', null);

  assert.equal(latest?.availability, 'error');
  assert.equal(latest?.snapshot, null);
});
