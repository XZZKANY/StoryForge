import type { RegexCompiler, RegexScan } from '@storyforge/engine';
import type { RegexScanReply, RegexScanRequest } from './regexWorkerCore';

/**
 * 看门狗余量（秒）：Worker 起步与传行不算进 Python 的 2 秒正则预算。跑飞的那一行要等到
 * 「剩余预算 + 余量」才被掐掉，报的仍是「正则搜索超时」，与 Python 同一条文案。
 */
const WATCHDOG_GRACE_SECONDS = 1;

export type RegexWorkerPort = {
  postMessage(message: RegexScanRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export type RegexWorkerOptions = {
  readonly createWorker?: () => RegexWorkerPort;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
};

const defaultWorker = (): RegexWorkerPort =>
  new Worker(new URL('./regex.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as RegexWorkerPort;

function validReply(
  value: unknown,
  request: RegexScanRequest,
): value is Exclude<RegexScanReply, { error: string }> {
  if (value === null || typeof value !== 'object') return false;
  const reply = value as Record<string, unknown>;
  const { hits, remainingSeconds, failure } = reply;
  return (
    reply.id === request.id &&
    Array.isArray(hits) &&
    hits.length <= request.limit &&
    hits.every(
      (hit, index) =>
        Number.isSafeInteger(hit) &&
        hit >= 0 &&
        hit < request.lines.length &&
        (index === 0 || hit > hits[index - 1]),
    ) &&
    typeof remainingSeconds === 'number' &&
    Number.isFinite(remainingSeconds) &&
    remainingSeconds <= request.remainingSeconds &&
    (failure === null || failure === 'timeout' || failure === 'budget')
  );
}

/**
 * fs.search / 知识检索的正则放进 Worker 跑：主线程不被单次匹配卡住，跑飞了就整个 Worker 掐掉。
 * 方言仍是 JS RegExp（u 标志），与进程内实现一致；一次扫描独占一个 Worker，空闲时留一个复用。
 */
export function workerRegexCompiler(options: RegexWorkerOptions = {}): RegexCompiler {
  const createWorker = options.createWorker ?? defaultWorker;
  const setTimer = options.setTimer ?? ((callback, ms) => window.setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer) => window.clearTimeout(timer as number));
  let idle: RegexWorkerPort | null = null;
  let nextId = 0;

  const release = (worker: RegexWorkerPort) => {
    worker.onmessage = null;
    worker.onerror = null;
    if (idle === null) idle = worker;
    else worker.terminate();
  };

  const scan = (request: RegexScanRequest) =>
    new Promise<RegexScan>((resolve, reject) => {
      const worker = idle ?? createWorker();
      idle = null;
      let settled = false;
      const settle = (finish: () => void) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        finish();
      };
      const timer = setTimer(
        () =>
          settle(() => {
            worker.onmessage = null;
            worker.onerror = null;
            worker.terminate();
            resolve({ hits: [], remainingSeconds: 0, failure: 'timeout' });
          }),
        (request.remainingSeconds + WATCHDOG_GRACE_SECONDS) * 1000,
      );
      worker.onmessage = (event) =>
        settle(() => {
          const reply = event.data;
          if (validReply(reply, request)) {
            release(worker);
            resolve({
              hits: reply.hits,
              remainingSeconds: reply.remainingSeconds,
              failure: reply.failure,
            });
            return;
          }
          worker.terminate();
          const error =
            reply !== null &&
            typeof reply === 'object' &&
            (reply as { id?: unknown }).id === request.id &&
            typeof (reply as { error?: unknown }).error === 'string'
              ? new Error((reply as { error: string }).error)
              : new TypeError('Invalid regex worker reply');
          reject(error);
        });
      worker.onerror = (event) =>
        settle(() => {
          worker.terminate();
          reject(new Error(event.message || '正则 Worker 运行失败'));
        });
      worker.postMessage(request);
    });

  return (query) => {
    // 语法错误在主线程就报（编译是线性的），文案接在「正则表达式无效：」后面。
    new RegExp(query, 'u');
    return {
      scan: (lines, limit, remainingSeconds) =>
        scan({ id: ++nextId, source: query, lines, limit, remainingSeconds }),
    };
  };
}
