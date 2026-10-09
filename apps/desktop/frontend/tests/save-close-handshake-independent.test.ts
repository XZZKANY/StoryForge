import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  flushActiveEditorToDisk,
  saveActiveEditorForClose,
  REQUEST_SAVE_ACTIVE_FILE_EVENT,
  SAVE_ACTIVE_FILE_DONE_EVENT,
  type SaveActiveFileRequestDetail,
  type SaveActiveFileDoneDetail,
} from '../src/lib/assistant-events';
const FILE = 'D:/books/a.md';
let requests: SaveActiveFileRequestDetail[];
const collect = (event: Event) =>
  requests.push((event as CustomEvent<SaveActiveFileRequestDetail>).detail);
const respond = (detail: SaveActiveFileDoneDetail) =>
  window.dispatchEvent(new CustomEvent(SAVE_ACTIVE_FILE_DONE_EVENT, { detail }));
beforeEach(() => {
  requests = [];
  window.addEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, collect);
});
afterEach(() => {
  window.removeEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, collect);
  vi.useRealTimers();
});
it('独立握手：Agent普通flush仍允许旧skipped回应', async () => {
  const promise = flushActiveEditorToDisk(FILE);
  expect(requests[0].forClose).toBeUndefined();
  respond({ filePath: FILE, status: 'skipped' });
  await expect(promise).resolves.toBeUndefined();
});
it('独立握手：严格关闭不接受skipped作为保存证明', async () => {
  const promise = saveActiveEditorForClose(FILE);
  respond({ filePath: FILE, requestId: requests[0].requestId, status: 'skipped' });
  await expect(promise).rejects.toThrow();
});
it('独立握手：普通或旧请求回应不能结算新关闭', async () => {
  let finished = false;
  const canClose = () => true;
  const promise = saveActiveEditorForClose(FILE).then((guard) => {
    finished = true;
    return guard;
  });
  const id = requests[0].requestId;
  respond({ filePath: FILE, status: 'saved', canClose });
  respond({ filePath: FILE, requestId: (id ?? 0) - 1, status: 'saved', canClose });
  await Promise.resolve();
  expect(finished).toBe(false);
  respond({ filePath: FILE, requestId: id, status: 'saved', canClose });
  expect(await promise).toBe(canClose);
});
it('独立握手：相同路径并行请求不能共用第一次完成回执', async () => {
  let secondDone = false;
  const canClose = () => true;
  const first = saveActiveEditorForClose(FILE);
  const second = saveActiveEditorForClose(FILE).then((guard) => {
    secondDone = true;
    return guard;
  });
  expect(requests[0].requestId).not.toBe(requests[1].requestId);
  respond({ filePath: FILE, requestId: requests[0].requestId, status: 'saved', canClose });
  await first;
  await Promise.resolve();
  expect(secondDone).toBe(false);
  respond({ filePath: FILE, requestId: requests[1].requestId, status: 'saved', canClose });
  await second;
});
it('独立握手：已超时请求迟到回执不影响下一次关闭', async () => {
  vi.useFakeTimers();
  const first = saveActiveEditorForClose(FILE, 10);
  const failure = expect(first).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(11);
  await failure;
  let finished = false;
  const second = saveActiveEditorForClose(FILE, 50).then((guard) => {
    finished = true;
    return guard;
  });
  const canClose = () => true;
  respond({ filePath: FILE, requestId: requests[0].requestId, status: 'saved', canClose });
  await Promise.resolve();
  expect(finished).toBe(false);
  respond({ filePath: FILE, requestId: requests[1].requestId, status: 'saved', canClose });
  await second;
});
it('独立握手：关闭能力在返回后仍反映最新有效性', async () => {
  let current = true;
  const canClose = () => current;
  const promise = saveActiveEditorForClose(FILE);
  respond({ filePath: FILE, requestId: requests[0].requestId, status: 'saved', canClose });
  const guard = await promise;
  expect(guard()).toBe(true);
  current = false;
  expect(guard()).toBe(false);
});
it('独立握手：严格关闭不接受空目标路径通配', async () => {
  vi.useFakeTimers();
  const promise = saveActiveEditorForClose(FILE, 10);
  const failure = expect(promise).rejects.toThrow();
  respond({
    filePath: null,
    requestId: requests[0].requestId,
    status: 'saved',
    canClose: () => true,
  });
  await vi.advanceTimersByTimeAsync(11);
  await failure;
});
