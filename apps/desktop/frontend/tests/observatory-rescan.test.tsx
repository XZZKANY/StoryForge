/**
 * useObservatory 行为红线：打开项目即首扫、写盘后防抖重扫、失败态诚实、
 * 已处理态跨扫描保留、切项目清空并使在途响应过期。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useObservatory } from '../src/components/app/useObservatory';
import { executeIdeCommand } from '../src/lib/api/ide-commands';
import { FS_MUTATION_EVENT } from '../src/lib/tauri-fs';

vi.mock('../src/lib/api/ide-commands', () => ({
  executeIdeCommand: vi.fn(),
}));

const mockedExecute = vi.mocked(executeIdeCommand);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ObservatoryApi = ReturnType<typeof useObservatory>;

let latest: ObservatoryApi | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness({ project }: { project: string | null }) {
  latest = useObservatory({ activeProject: project });
  return null;
}

async function render(project: string | null) {
  if (!root) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(<Harness project={project} />);
    await Promise.resolve();
  });
}

function scanResult(observations: unknown[]) {
  return {
    command_id: 'observatory.scan',
    status: 'accepted',
    payload: {
      observatory: {
        version: 1,
        generated_at: '2026-07-17T00:00:00+00:00',
        observations,
        checkers: [{ key: 'canon', tool: 'project.canon', status: 'ran' }],
      },
    },
  };
}

const OBSERVATION = {
  id: 'canon_abc123',
  severity: 'error',
  title: '「铜灯」唯一持有冲突',
  source: 'canon·single_holder',
  location: { path: '.storyforge/canon/canon.json' },
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  latest = null;
  mockedExecute.mockReset();
  vi.useRealTimers();
});

test('打开项目即首扫：observations 填充、availability 变 available', async () => {
  mockedExecute.mockResolvedValue(scanResult([OBSERVATION]));

  await render('D:\\demo\\雪夜斩');

  assert.equal(mockedExecute.mock.calls.length, 1);
  assert.deepEqual(mockedExecute.mock.calls[0], [
    'observatory.scan',
    { project_root: 'D:\\demo\\雪夜斩' },
  ]);
  assert.equal(latest?.availability, 'available');
  assert.equal(latest?.observations.length, 1);
  assert.equal(latest?.observations[0]?.id, 'canon_abc123');
  assert.equal(latest?.checkers.length, 1);
});

test('写盘事件防抖重扫：连续多次 fs-mutation 只触发一次新扫描', async () => {
  mockedExecute.mockResolvedValue(scanResult([OBSERVATION]));
  await render('D:\\demo\\雪夜斩');
  assert.equal(mockedExecute.mock.calls.length, 1);

  await act(async () => {
    window.dispatchEvent(new CustomEvent(FS_MUTATION_EVENT));
    window.dispatchEvent(new CustomEvent(FS_MUTATION_EVENT));
    vi.advanceTimersByTime(1100);
    window.dispatchEvent(new CustomEvent(FS_MUTATION_EVENT));
    vi.advanceTimersByTime(1200);
    await Promise.resolve();
  });

  assert.equal(mockedExecute.mock.calls.length, 2);
});

test('首扫失败显示 error；已有数据后刷新失败保持 available 不藏旧观测', async () => {
  mockedExecute.mockRejectedValueOnce(new Error('sidecar 未就绪'));
  await render('D:\\demo\\雪夜斩');
  assert.equal(latest?.availability, 'error');

  mockedExecute.mockResolvedValueOnce(scanResult([OBSERVATION]));
  await act(async () => {
    await latest!.runScan();
  });
  assert.equal(latest?.availability, 'available');

  mockedExecute.mockRejectedValueOnce(new Error('临时故障'));
  await act(async () => {
    await latest!.runScan();
  });
  assert.equal(latest?.availability, 'available');
  assert.equal(latest?.observations.length, 1);
});

test('已处理态按稳定 id 跨扫描保留', async () => {
  mockedExecute.mockResolvedValue(scanResult([OBSERVATION]));
  await render('D:\\demo\\雪夜斩');

  await act(async () => {
    latest!.resolveObservation('canon_abc123');
  });
  assert.equal(latest?.observations[0]?.resolved, true);

  await act(async () => {
    await latest!.runScan();
  });
  assert.equal(latest?.observations[0]?.resolved, true);
});

test('切项目清空观测与已处理记忆，关项目回 unavailable', async () => {
  mockedExecute.mockResolvedValue(scanResult([OBSERVATION]));
  await render('D:\\demo\\雪夜斩');
  await act(async () => {
    latest!.resolveObservation('canon_abc123');
  });

  await render('D:\\demo\\另一本');
  assert.equal(latest?.observations[0]?.resolved, false);

  await render(null);
  assert.equal(latest?.availability, 'unavailable');
  assert.deepEqual(latest?.observations, []);
});
