import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { ChapterCheckHistoryPanel } from '../src/components/chat-window/ChapterCheckHistoryPanel';
import { useChapterCheckHistory } from '../src/components/chat-window/useChapterCheckHistory';
import {
  decodeChapterCheckHistory,
  queryChapterCheckHistory,
  type ChapterCheckHistory,
} from '../src/lib/api/chapter-checks';
import { writableFilePatch } from '../src/components/chat-window/agent-result';
import type { AgentResultMessage } from '../src/lib/api-client';

vi.mock('../src/lib/api/chapter-checks', async (load) => ({
  ...(await load<typeof import('../src/lib/api/chapter-checks')>()),
  queryChapterCheckHistory: vi.fn(),
}));

const request = { project_root: 'D:/novel', assistant_session_id: 7, limit: 20 };
const hash = 'a'.repeat(64);
function wire(id = 1, execution = 'failed', candidate: string | null = '候选稿_SENTINEL') {
  return {
    ...request,
    truncated: false,
    entries: [
      {
        run_id: `run-${id}`,
        check_artifact_id: id,
        created_at: '2026-10-05T00:00:00',
        target_path: '正文/第001章.md',
        check: {
          protocol_version: 2,
          content_sha256: hash,
          brief_sha256: hash,
          execution_status: execution,
          manuscript_status: execution === 'completed' ? 'pass' : 'unknown',
          manuscript_hard_failure_count: 0,
          advisory_count: 0,
          coverage: {
            supplied_content_chars: 1800,
            source_verified: execution === 'completed',
            findings_received: execution === 'completed' ? 0 : null,
            findings_validated: 0,
            findings_limit: 100,
            result_complete: execution === 'completed',
          },
          findings: [],
        },
        candidate:
          candidate === null
            ? null
            : {
                read_only: true,
                content: candidate,
                content_sha256: hash,
                brief_sha256: hash,
                target_path: '正文/第001章.md',
              },
        candidate_artifact_id: candidate === null ? null : id + 100,
        candidate_error: null,
      },
    ],
  };
}
const query = vi.mocked(queryChapterCheckHistory);
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  query.mockReset();
  vi.useRealTimers();
});

async function render(
  project = request.project_root,
  session: number | null = 7,
  refresh = 'cold',
) {
  // Keep one component identity while its scope/refresh props change.
  if (!container) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () =>
    root?.render(<Panel project={project} session={session} refresh={refresh} />),
  );
}

function Panel({
  project,
  session,
  refresh,
}: {
  project: string;
  session: number | null;
  refresh: string;
}) {
  return <ChapterCheckHistoryPanel history={useChapterCheckHistory(project, session, refresh)} />;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('failed/incomplete execution is not a manuscript failure; legacy pass is not upgraded', () => {
  for (const execution of ['failed', 'incomplete', 'completed']) {
    const decoded = decodeChapterCheckHistory(wire(1, execution), request).entries[0];
    expect(decoded.check?.executionStatus).toBe(execution);
    expect(decoded.check?.manuscriptHardCount).toBe(0);
    expect(decoded.check?.manuscriptStatus).toBe(execution === 'completed' ? 'pass' : 'unknown');
  }
  const old = wire();
  old.entries[0].check.execution_status = 'legacy-pass';
  const decoded = decodeChapterCheckHistory(old, request).entries[0];
  expect(decoded.check).toBeNull();
  expect(decoded.checkError).toContain('不能当作检查通过');
});

test('decoder rejects wrong scope, duplicate records and candidate write authority', () => {
  const other = wire();
  other.assistant_session_id = 9;
  expect(() => decodeChapterCheckHistory(other, request)).toThrow('归属');
  const duplicate = wire();
  duplicate.entries.push(duplicate.entries[0]);
  expect(() => decodeChapterCheckHistory(duplicate, request)).toThrow('重复');
  const unsafe = wire();
  Object.assign(unsafe.entries[0].candidate!, { after: '非法补丁', approval_action: 'apply' });
  expect(() => decodeChapterCheckHistory(unsafe, request)).toThrow('只读');
  expect(
    writableFilePatch({
      proposed_patch: null,
      agent_result: { chapter_candidate: wire().entries[0].candidate },
    } as unknown as AgentResultMessage),
  ).toBeNull();
});

test('cold mount reads persisted evidence, shows a read-only candidate and only read retry', async () => {
  query.mockResolvedValue(decodeChapterCheckHistory(wire(), request));
  await render();
  expect(query).toHaveBeenCalledWith(
    request,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(container?.textContent).toContain('检查执行失败');
  expect(container?.textContent).toContain('稿件判断未知');
  expect(container?.textContent).toContain('稿件硬问题 0');
  const text = container?.querySelector('textarea');
  expect(text?.value).toBe('候选稿_SENTINEL');
  expect(text?.readOnly).toBe(true);
  expect(
    Array.from(container?.querySelectorAll('button') ?? []).map((button) => button.textContent),
  ).toEqual(['重新读取记录']);
  expect(container?.textContent).not.toContain('接受补丁');
  await act(async () => container?.querySelector('button')?.click());
  expect(query).toHaveBeenCalledTimes(2);
});

test('A to B to A creates a new owner; late success cannot repopulate the returned session', async () => {
  const first = deferred<ChapterCheckHistory>();
  const second = deferred<ChapterCheckHistory>();
  const returned = deferred<ChapterCheckHistory>();
  query
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(returned.promise);
  await render();
  const signal = query.mock.calls[0][1]?.signal;
  await render('D:/other', 9);
  expect(signal?.aborted).toBe(true);
  await render();
  await act(async () =>
    first.resolve(decodeChapterCheckHistory(wire(1, 'failed', '旧 A 候选'), request)),
  );
  expect(container?.textContent).not.toContain('旧 A 候选');
  expect(container?.querySelector('textarea')).toBeNull();
  await act(async () =>
    returned.resolve(decodeChapterCheckHistory(wire(3, 'failed', '新 A 候选'), request)),
  );
  expect(container?.querySelector('textarea')?.value).toBe('新 A 候选');
  await act(async () =>
    second.resolve(decodeChapterCheckHistory(wire(2, 'failed', '旧 B 候选'), request)),
  );
  expect(container?.querySelector('textarea')?.value).toBe('新 A 候选');
});

test('a new settled run refreshes history; an old pending read cannot overwrite it', async () => {
  const old = deferred<ChapterCheckHistory>();
  const fresh = deferred<ChapterCheckHistory>();
  query.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  await render();
  await render(request.project_root, 7, 'run-2:completed');
  await act(async () =>
    fresh.resolve(decodeChapterCheckHistory(wire(2, 'incomplete', '最新候选'), request)),
  );
  expect(container?.textContent).toContain('检查未完整执行');
  await act(async () =>
    old.resolve(decodeChapterCheckHistory(wire(1, 'failed', '旧候选'), request)),
  );
  expect(container?.querySelector('textarea')?.value).toBe('最新候选');
});

test('read failure is explicit, keeps same-scope last evidence, and retry never executes models', async () => {
  query
    .mockResolvedValueOnce(decodeChapterCheckHistory(wire(), request))
    .mockRejectedValueOnce(new Error('read offline'))
    .mockResolvedValueOnce({ entries: [], truncated: false });
  await render();
  await render(request.project_root, 7, 'updated');
  expect(container?.querySelector('[role="alert"]')?.textContent).toContain('read offline');
  expect(container?.querySelector('textarea')?.value).toBe('候选稿_SENTINEL');
  await act(async () => container?.querySelector('button')?.click());
  expect(container?.querySelector('[data-testid="chapter-check-history"]')).toBeNull();
  expect(query).toHaveBeenCalledTimes(3);
});

test('no session and unmount cannot resurrect a late candidate', async () => {
  const pending = deferred<ChapterCheckHistory>();
  query.mockReturnValueOnce(pending.promise);
  await render();
  await render(request.project_root, null);
  await act(async () => pending.resolve(decodeChapterCheckHistory(wire(), request)));
  expect(container?.querySelector('textarea')).toBeNull();
  expect(query).toHaveBeenCalledTimes(1);
});

test('StrictMode replay and final unmount abort the obsolete reads', async () => {
  const old = deferred<ChapterCheckHistory>();
  const fresh = deferred<ChapterCheckHistory>();
  query.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <StrictMode>
        <Panel project={request.project_root} session={7} refresh="strict" />
      </StrictMode>,
    ),
  );
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () =>
    old.resolve(decodeChapterCheckHistory(wire(1, 'failed', '旧回放'), request)),
  );
  expect(container.querySelector('textarea')).toBeNull();
  await act(async () =>
    fresh.resolve(decodeChapterCheckHistory(wire(2, 'failed', '有效回放'), request)),
  );
  expect(container.querySelector('textarea')?.value).toBe('有效回放');
  const lastSignal = query.mock.calls[1][1]?.signal;
  await act(async () => root?.unmount());
  root = null;
  expect(lastSignal?.aborted).toBe(true);
  expect(container.childNodes.length).toBe(0);
});

test('a transport ignoring abort times out visibly; a late body cannot replace the read retry', async () => {
  vi.useFakeTimers();
  const pending = deferred<ChapterCheckHistory>();
  query
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(decodeChapterCheckHistory(wire(2, 'failed', '重读正文'), request));
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(container?.querySelector('[role="alert"]')?.textContent).toContain('超时');
  expect(query.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () => container?.querySelector('button')?.click());
  await act(async () =>
    pending.resolve(decodeChapterCheckHistory(wire(1, 'failed', '迟到正文'), request)),
  );
  expect(container?.querySelector('textarea')?.value).toBe('重读正文');
  expect(query).toHaveBeenCalledTimes(2);
});
