import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { WritingDeskEmptyState } from '../src/components/app/WritingDeskEmptyState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div');
document.body.appendChild(host);
let root: ReturnType<typeof createRoot> | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host.innerHTML = '';
});
async function render(props: Parameters<typeof WritingDeskEmptyState>[0]) {
  root ??= createRoot(host);
  await act(async () => root!.render(<WritingDeskEmptyState {...props} />));
}
const byId = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

test('有停下的章就给「接着写第 N 章」，点了交给调用方打开', async () => {
  const resume = vi.fn();
  await render({ resumeOrdinal: 5, bookEmpty: false, loading: false, onResume: resume });
  expect(byId('writing-desk-resume-chapter')?.textContent).toBe('接着写第 5 章');
  await act(async () => byId('writing-desk-resume-chapter')!.click());
  expect(resume).toHaveBeenCalledOnce();
  expect(byId('writing-desk-discuss-book')).toBeNull();
});

test('空书先引去和 AI 聊，不推写第 1 章', async () => {
  const discuss = vi.fn();
  await render({ resumeOrdinal: null, bookEmpty: true, loading: false, onDiscussBook: discuss });
  expect(byId('writing-desk-empty-book')?.textContent).toContain('这本书还没有正文');
  expect(host.textContent).not.toContain('第 1 章');
  await act(async () => byId('writing-desk-discuss-book')!.click());
  expect(discuss).toHaveBeenCalledOnce();
});

test('章节没读出来时不下「空书」的结论；读完但没有可接的章也不假装有', async () => {
  await render({ resumeOrdinal: null, bookEmpty: false, loading: true, onDiscussBook: vi.fn() });
  expect(byId('writing-desk-pending')?.textContent).toContain('正在读取章节');
  expect(byId('writing-desk-empty-book')).toBeNull();
  await render({ resumeOrdinal: null, bookEmpty: false, loading: false });
  expect(byId('writing-desk-pending')?.textContent).toContain('在左边的手稿或文件里打开一章');
  // 有序号但没给打开的去处，也不画一个点了没反应的按钮。
  await render({ resumeOrdinal: 3, bookEmpty: false, loading: false });
  expect(byId('writing-desk-resume-chapter')).toBeNull();
});
