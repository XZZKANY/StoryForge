import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { readWebPage } from '../src/lib/api/web-read';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
beforeEach(() => {
  vi.mocked(invoke).mockReset();
});
const page = {
  requestedUrl: 'https://example.com/',
  url: 'https://example.com/',
  title: '资料',
  text: '正文',
  links: [{ title: '章节', url: 'https://example.com/chapter' }],
  truncated: false,
  linksTruncated: false,
  fetchedAt: '2026-11-21T00:00:00Z',
};
it('reads page text through native IPC and returns only declared evidence', async () => {
  vi.mocked(invoke).mockResolvedValue({ ...page, apiKey: 'must-not-return' });
  expect(await readWebPage({ url: page.url })).toEqual(page);
  expect(invoke).toHaveBeenCalledWith('web_read_execute', { request: { url: page.url } });
});
it.each([
  'file:///private',
  'javascript:alert(1)',
  'https://user:pw@example.com',
  'https://example.com:4000/',
])('rejects unsafe address %s', async (url) => {
  await expect(readWebPage({ url })).rejects.toThrow('网页地址无效');
  expect(invoke).not.toHaveBeenCalled();
});
it.each([
  null,
  { ...page, text: '' },
  { ...page, fetchedAt: 'invalid' },
  { ...page, links: [{ title: 'x', url: 'javascript:alert(1)' }] },
  { ...page, text: '字'.repeat(6001) },
])('rejects invalid native result', async (value) => {
  vi.mocked(invoke).mockResolvedValue(value);
  await expect(readWebPage({ url: page.url })).rejects.toThrow();
});
it.each([
  '未启用 private-secret',
  '网页读取失败HTTP403 private-secret',
  '内网 private-secret',
  '超时 private-secret',
])('does not leak transport error %s', async (error) => {
  vi.mocked(invoke).mockRejectedValue(error);
  await expect(readWebPage({ url: page.url })).rejects.not.toThrow('private-secret');
});
