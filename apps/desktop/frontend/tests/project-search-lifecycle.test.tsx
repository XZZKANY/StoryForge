import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, test, vi } from 'vitest';
import { useProjectSearch } from '../src/components/app/useProjectSearch';
import { MAX_TOTAL_HITS, MAX_HITS_PER_FILE } from '../src/lib/project-search';
import { SearchView } from '../src/components/shell/SearchView';
import { FS_MUTATION_EVENT, TauriFileSystem } from '../src/lib/tauri-fs';
vi.mock('../src/lib/tauri-fs', () => ({
  FS_MUTATION_EVENT: 'storyforge:fs-mutation',
  TauriFileSystem: { listDir: vi.fn(), readProjectFile: vi.fn() },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let latest: ReturnType<typeof useProjectSearch>;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function Harness({ project }: { project: string | null }) {
  latest = useProjectSearch(project);
  return (
    <SearchView search={latest} projectOpen={Boolean(project)} active onOpenHit={() => undefined} />
  );
}
function render(project: string | null = 'D:/A') {
  act(() => root.render(<Harness project={project} />));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(TauriFileSystem.listDir).mockImplementation(async (project) => [
    {
      path: `${project}/章.md`,
      name: '章.md',
      isDir: false,
      size: 10,
      modified: 0,
      extension: 'md',
    },
  ]);
  vi.mocked(TauriFileSystem.readProjectFile).mockResolvedValue('新词 旧词');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  render();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.useRealTimers();
});
for (const change of ['query', 'clear', 'case', 'project', 'close']) {
  test(`搜索变更后防抖期间不能显示旧读取：${change}`, async () => {
    let resolve!: (value: string) => void;
    vi.mocked(TauriFileSystem.readProjectFile).mockReturnValueOnce(
      new Promise<string>((done) => {
        resolve = done;
      }),
    );
    act(() => latest.setQuery('旧词'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });
    if (change === 'query') act(() => latest.setQuery('新词'));
    if (change === 'clear') act(() => latest.setQuery(''));
    if (change === 'case') act(() => latest.setCaseSensitive(true));
    if (change === 'project') render('D:/B');
    if (change === 'close') render(null);
    await act(async () => {
      resolve('旧词');
    });
    assert.equal(latest.results.length, 0);
    assert.equal(latest.status, change === 'clear' || change === 'close' ? 'idle' : 'searching');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });
    if (change !== 'clear' && change !== 'close') {
      assert.equal(latest.status, 'done');
      assert.equal(latest.totalHits, 1);
    }
  });
}
for (const change of ['query', 'project', 'unmount']) {
  test(`旧 rerun 回调失去读取资格：${change}`, async () => {
    act(() => latest.setQuery('旧词'));
    const old = latest;
    if (change === 'query') act(() => latest.setQuery('新词'));
    if (change === 'project') {
      render('D:/B');
      render('D:/A');
    }
    if (change === 'unmount') act(() => root.unmount());
    const calls = vi.mocked(TauriFileSystem.listDir).mock.calls.length;
    await act(async () => {
      old.rerun();
    });
    assert.equal(vi.mocked(TauriFileSystem.listDir).mock.calls.length, calls);
  });
}

for (const allFail of [false, true]) {
  test(`搜索读失败明确提示且重试恢复：全部失败=${allFail}`, async () => {
    vi.mocked(TauriFileSystem.listDir).mockResolvedValue(
      ['一', '二'].map((name) => ({
        name: `${name}.md`,
        path: `D:/A/${name}.md`,
        isDir: false,
        size: 10,
        modified: 0,
        extension: 'md',
      })),
    );
    vi.mocked(TauriFileSystem.readProjectFile).mockImplementation(async (_root, path) => {
      if (allFail || path.endsWith('二.md')) throw new Error('读取暂时失败');
      return '新词';
    });
    act(() => latest.setQuery('新词'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });
    assert.equal(latest.unreadableCount, allFail ? 2 : 1);
    assert.equal(latest.totalHits, allFail ? 0 : 1);
    assert.match(container.textContent ?? '', /结果可能不完整/);
    if (allFail) assert.doesNotMatch(container.textContent ?? '', /没有匹配的内容/);
    const retry = container.querySelector<HTMLButtonElement>(
      '[data-testid="search-partial-retry"]',
    );
    assert.ok(retry);
    retry.focus();
    vi.mocked(TauriFileSystem.readProjectFile).mockResolvedValue('新词');
    await act(async () => {
      retry.click();
    });
    assert.equal(latest.unreadableCount, 0);
    assert.equal(latest.totalHits, 2);
    assert.equal(container.querySelector('[data-testid="search-partial-warning"]') === null, true);
    assert.equal(
      document.activeElement === container.querySelector('input[type="text"],input:not([type])'),
      true,
    );
  });
}

test('批次内多个高命中文件不能突破全局 400 条显示上限', async () => {
  vi.mocked(TauriFileSystem.listDir).mockResolvedValue(
    Array.from({ length: 16 }, (_, i) => ({
      name: `章${i}.md`,
      path: `D:/A/章${i}.md`,
      isDir: false,
      size: 1000,
      modified: 0,
      extension: 'md',
    })),
  );
  vi.mocked(TauriFileSystem.readProjectFile).mockResolvedValue('新词 '.repeat(MAX_HITS_PER_FILE));
  act(() => latest.setQuery('新词'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(220);
  });
  assert.equal(latest.totalHits, MAX_TOTAL_HITS);
  assert.equal(latest.capped, true);
  assert.equal(container.querySelectorAll('[data-testid="search-hit"]').length, MAX_TOTAL_HITS);
  assert.match(container.textContent ?? '', /仅显示前 400 处/);
});

test('剩余全局预算不足单文件上限时保留精确数量并标记截断', async () => {
  vi.mocked(TauriFileSystem.listDir).mockResolvedValue(
    Array.from({ length: 12 }, (_, i) => ({
      name: `章${i}.md`,
      path: `D:/A/章${i}.md`,
      isDir: false,
      size: 1000,
      modified: 0,
      extension: 'md',
    })),
  );
  vi.mocked(TauriFileSystem.readProjectFile).mockImplementation(async (_root, path) =>
    '新词 '.repeat(path.endsWith('章0.md') ? 35 : 40),
  );
  act(() => latest.setQuery('新词'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(220);
  });
  assert.equal(latest.totalHits, 400);
  assert.equal(latest.results.at(-1)?.hits.length, 5);
  assert.equal(latest.results.at(-1)?.truncated, true);
});

test('文件变更后自动刷新搜索，连续通知只触发一次防抖读取', async () => {
  act(() => latest.setQuery('新词'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(220);
  });
  assert.equal(latest.totalHits, 1);
  vi.mocked(TauriFileSystem.readProjectFile).mockResolvedValue('已经删除命中');
  const before = vi.mocked(TauriFileSystem.listDir).mock.calls.length;
  act(() => {
    for (let i = 0; i < 5; i++) window.dispatchEvent(new CustomEvent(FS_MUTATION_EVENT));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(219);
  });
  assert.equal(vi.mocked(TauriFileSystem.listDir).mock.calls.length, before);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  assert.equal(vi.mocked(TauriFileSystem.listDir).mock.calls.length, before + 1);
  assert.equal(latest.totalHits, 0);
  assert.equal(latest.status, 'done');
});

test('文件变更使在途旧内容失效，不回填过期命中', async () => {
  let resolve!: (value: string) => void;
  vi.mocked(TauriFileSystem.readProjectFile).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  act(() => latest.setQuery('新词'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(220);
  });
  act(() => {
    window.dispatchEvent(new CustomEvent(FS_MUTATION_EVENT));
  });
  await act(async () => {
    resolve('新词');
  });
  assert.equal(latest.results.length, 0);
  assert.equal(latest.status, 'searching');
});

test('空查询或卸载后的文件变更不发起文件读取', async () => {
  act(() => {
    window.dispatchEvent(new CustomEvent(FS_MUTATION_EVENT));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  assert.equal(vi.mocked(TauriFileSystem.listDir).mock.calls.length, 0);
  act(() => latest.setQuery('新词'));
  act(() => root.unmount());
  act(() => {
    window.dispatchEvent(new CustomEvent(FS_MUTATION_EVENT));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  assert.equal(vi.mocked(TauriFileSystem.listDir).mock.calls.length, 0);
});

test('真实搜索结果高亮使用原文位置而非小写文本位置', async () => {
  vi.mocked(TauriFileSystem.readProjectFile).mockResolvedValue('İ😀 目标尾声\nİX后');
  act(() => latest.setQuery('目标'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(220);
  });
  assert.equal(container.querySelector('mark')?.textContent, '目标');
  act(() => latest.setQuery('i\u0307x'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(220);
  });
  assert.equal(container.querySelector('mark')?.textContent, 'İX');
  assert.equal(latest.results[0].hits[0].line, 2);
});

for (const failsAgain of [false, true]) {
  test(`整体搜索失败重试保留焦点且晚返回不抢焦点：再次失败=${failsAgain}`, async () => {
    vi.mocked(TauriFileSystem.listDir).mockRejectedValueOnce(new Error('目录读取失败'));
    act(() => latest.setQuery('新词'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });
    assert.equal(latest.status, 'error');
    const retry = container.querySelector<HTMLButtonElement>('[role="alert"] button');
    assert.ok(retry);
    const input = container.querySelector('[data-testid="search-input"]');
    let finish!: () => void;
    vi.mocked(TauriFileSystem.listDir).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      if (failsAgain) throw new Error('目录仍不可读');
      return [];
    });
    retry.focus();
    act(() => retry.click());
    assert.equal(latest.status, 'searching');
    assert.equal(document.activeElement === input, true);
    assert.equal(container.querySelector('[role="alert"]') === null, true);
    const outside = document.createElement('button');
    container.appendChild(outside);
    if (failsAgain) outside.focus();
    await act(async () => {
      finish();
    });
    assert.equal(latest.status, failsAgain ? 'error' : 'done');
    assert.equal(document.activeElement === (failsAgain ? outside : input), true);
    assert.equal(latest.query, '新词');
    outside.remove();
  });
}
