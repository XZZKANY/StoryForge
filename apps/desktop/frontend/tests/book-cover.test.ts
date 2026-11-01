import { beforeEach, expect, test, vi } from 'vitest';

// 只替身宿主（对话框与 invoke），book-cover 与 tauri-fs 走真代码。
const host = vi.hoisted(() => ({
  open: vi.fn<(options: unknown) => Promise<string | string[] | null>>(),
  invoke: vi.fn<(command: string, args: unknown) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: host.open }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: host.invoke, isTauri: () => true }));

import { importCoverImage } from '../src/lib/book-cover';

beforeEach(() => {
  host.open.mockReset();
  host.invoke.mockReset().mockResolvedValue(undefined);
});

test('选封面只列图片；作者取消就什么都不动', async () => {
  host.open.mockResolvedValueOnce(null);
  expect(await importCoverImage('/books/雾港', null)).toBeNull();
  expect(host.open).toHaveBeenCalledWith({
    multiple: false,
    directory: false,
    title: '选择封面图片',
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
  });
  expect(host.invoke).not.toHaveBeenCalled();
});

test('选中的图片复制成 .storyforge/cover.<扩展名>；换了扩展名删掉旧封面', async () => {
  host.open.mockResolvedValueOnce('/pictures/封面.PNG');
  expect(await importCoverImage('/books/雾港', 'cover.jpg')).toBe('cover.png');
  expect(host.invoke.mock.calls).toEqual([
    [
      'copy_into_project',
      {
        projectRoot: '/books/雾港',
        source: '/pictures/封面.PNG',
        dest: '/books/雾港/.storyforge/cover.png',
      },
    ],
    [
      'delete_path',
      { projectRoot: '/books/雾港', path: '/books/雾港/.storyforge/cover.jpg', recursive: false },
    ],
  ]);
});
