import { describe, expect, it } from 'vitest';
import { workerRegexCompiler, type RegexWorkerPort } from '../src/lib/engine/regex';
import { answerRegexScan, type RegexScanRequest } from '../src/lib/engine/regexWorkerCore';

type Behavior = 'answer' | 'hang' | 'crash' | 'error' | ((message: RegexScanRequest) => unknown);

/** 假 Worker：异步回包，行为按次序脚本化；记下创建与掐掉的次数。 */
function fakeWorkers(behaviors: Behavior[], clock: () => number = () => 0) {
  const created: FakeWorker[] = [];
  class FakeWorker implements RegexWorkerPort {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;
    received: RegexScanRequest[] = [];
    postMessage(message: RegexScanRequest) {
      this.received.push(message);
      const behavior = behaviors.shift() ?? 'answer';
      if (behavior === 'hang') return;
      queueMicrotask(() => {
        if (this.terminated) return;
        if (behavior === 'crash') this.onerror?.({ message: 'boom' } as ErrorEvent);
        else
          this.onmessage?.({
            data:
              typeof behavior === 'function'
                ? behavior(message)
                : behavior === 'error'
                  ? { id: message.id, error: 'Invalid regular expression' }
                  : answerRegexScan(message, clock),
          } as MessageEvent<unknown>);
      });
    }
    terminate() {
      this.terminated = true;
    }
  }
  const timers: { callback: () => void; ms: number; cleared: boolean }[] = [];
  const compiler = workerRegexCompiler({
    createWorker: () => {
      const worker = new FakeWorker();
      created.push(worker);
      return worker;
    },
    setTimer: (callback, ms) => {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as { cleared: boolean }).cleared = true;
    },
  });
  return { compiler, created, timers };
}

const LINES = ['第一章 风起', '林舟推开门。', '沈禾问路。', '林舟回头。'];

describe('answerRegexScan', () => {
  it('scans with the shared budget semantics and reuses the compiled pattern', () => {
    expect(
      answerRegexScan({ id: 1, source: '林.', lines: LINES, limit: 5, remainingSeconds: 2 }, () => 0),
    ).toEqual({ id: 1, hits: [1, 3], remainingSeconds: 2, failure: null });
    expect(
      answerRegexScan({ id: 2, source: '林.', lines: LINES, limit: 1, remainingSeconds: 2 }, () => 0),
    ).toEqual({ id: 2, hits: [1], remainingSeconds: 2, failure: null });
  });

  it('reports a line that ran past the per-line timeout', () => {
    let now = 0;
    const clock = () => (now += 0.06);
    expect(
      answerRegexScan({ id: 3, source: '沈', lines: LINES, limit: 5, remainingSeconds: 2 }, clock),
    ).toMatchObject({ id: 3, failure: 'timeout' });
  });

  it('answers a compile failure as an error reply', () => {
    expect(
      answerRegexScan({ id: 4, source: '(', lines: LINES, limit: 5, remainingSeconds: 2 }, () => 0),
    ).toMatchObject({ id: 4, error: expect.any(String) });
  });
});

describe('workerRegexCompiler', () => {
  it('rejects a bad pattern on the main thread before any worker starts', () => {
    const { compiler, created } = fakeWorkers([]);
    expect(() => compiler('(')).toThrow(SyntaxError);
    expect(created).toHaveLength(0);
  });

  it('runs scans in a worker and keeps one idle worker for the next file', async () => {
    const { compiler, created, timers } = fakeWorkers(['answer', 'answer']);
    const pattern = compiler('林.');
    expect(await pattern.scan(LINES, 5, 2)).toEqual({
      hits: [1, 3],
      remainingSeconds: 2,
      failure: null,
    });
    expect(await pattern.scan(LINES.slice(2), 5, 1.5)).toEqual({
      hits: [1],
      remainingSeconds: 1.5,
      failure: null,
    });
    expect(created).toHaveLength(1);
    expect(created[0].terminated).toBe(false);
    expect(created[0].received.map((item) => item.remainingSeconds)).toEqual([2, 1.5]);
    expect(timers.map((timer) => [timer.ms, timer.cleared])).toEqual([
      [3000, true],
      [2500, true],
    ]);
  });

  it('gives concurrent scans their own workers and keeps only one afterwards', async () => {
    const { compiler, created } = fakeWorkers(['answer', 'answer']);
    const pattern = compiler('林.');
    await Promise.all([pattern.scan(LINES, 5, 2), pattern.scan(LINES, 5, 2)]);
    expect(created).toHaveLength(2);
    expect(created.filter((worker) => worker.terminated)).toHaveLength(1);
  });

  it('terminates a hung worker at the watchdog and reports a timeout', async () => {
    const { compiler, created, timers } = fakeWorkers(['hang', 'answer']);
    const pattern = compiler('(a+)+$');
    const pending = pattern.scan(['a'.repeat(40) + 'b'], 5, 0.5);
    expect(timers[0].ms).toBe(1500);
    timers[0].callback();
    expect(await pending).toEqual({ hits: [], remainingSeconds: 0, failure: 'timeout' });
    expect(created[0].terminated).toBe(true);
    // 下一次扫描换一个新 Worker。
    expect(await pattern.scan(LINES, 5, 2)).toMatchObject({ failure: null });
    expect(created).toHaveLength(2);
  });

  const ok = (message: RegexScanRequest) => ({
    id: message.id,
    hits: [1],
    remainingSeconds: 1,
    failure: null,
  });
  it.each([
    ['another request', (m: RegexScanRequest) => ({ ...ok(m), id: m.id + 1 })],
    ['more hits than the limit', (m: RegexScanRequest) => ({ ...ok(m), hits: [0, 1, 2] })],
    ['a hit past the last line', (m: RegexScanRequest) => ({ ...ok(m), hits: [4] })],
    ['hits out of order', (m: RegexScanRequest) => ({ ...ok(m), hits: [2, 1] })],
    ['a repeated hit', (m: RegexScanRequest) => ({ ...ok(m), hits: [1, 1] })],
    ['a negative hit', (m: RegexScanRequest) => ({ ...ok(m), hits: [-1] })],
    ['budget that grew', (m: RegexScanRequest) => ({ ...ok(m), remainingSeconds: 2.5 })],
    ['a non-finite budget', (m: RegexScanRequest) => ({ ...ok(m), remainingSeconds: NaN })],
    ['an unknown failure', (m: RegexScanRequest) => ({ ...ok(m), failure: 'slow' })],
  ])('refuses a reply with %s and drops that worker', async (_name, reply) => {
    const { compiler, created } = fakeWorkers([reply]);
    await expect(compiler('林').scan(LINES, 2, 2)).rejects.toThrow(TypeError);
    expect(created[0].terminated).toBe(true);
  });

  it('accepts the well-formed variant of those replies', async () => {
    const { compiler, created } = fakeWorkers([ok]);
    expect(await compiler('林').scan(LINES, 2, 2)).toEqual({
      hits: [1],
      remainingSeconds: 1,
      failure: null,
    });
    expect(created[0].terminated).toBe(false);
  });

  it('surfaces a worker crash and an error reply', async () => {
    const crashed = fakeWorkers(['crash']);
    await expect(crashed.compiler('林').scan(LINES, 5, 2)).rejects.toThrow('boom');
    expect(crashed.created[0].terminated).toBe(true);

    const failed = fakeWorkers(['error']);
    await expect(failed.compiler('林').scan(LINES, 5, 2)).rejects.toThrow(
      'Invalid regular expression',
    );
    expect(failed.created[0].terminated).toBe(true);
  });
});
