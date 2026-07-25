import { describe, expect, it } from 'vitest';

import {
  ensureMarkdownName,
  entryName,
  joinChild,
  parentDir,
  sanitizeEntryName,
  siblingPath,
} from '../../src/lib/fs-path-ops';

// #10/#17 文件树右键操作的纯路径工具。
describe('fs-path-ops', () => {
  it('entryName 取最后一段（兼容两种分隔符）', () => {
    expect(entryName('D:\\proj\\正文\\第001章.md')).toBe('第001章.md');
    expect(entryName('/proj/正文/第001章.md')).toBe('第001章.md');
    expect(entryName('D:\\proj\\正文\\')).toBe('正文');
  });

  it('parentDir 取父目录', () => {
    expect(parentDir('D:\\proj\\正文\\第001章.md')).toBe('D:\\proj\\正文');
    expect(parentDir('/proj/正文/第001章.md')).toBe('/proj/正文');
  });

  it('joinChild / siblingPath 沿用分隔符风格', () => {
    expect(joinChild('D:\\proj\\正文', '第002章.md')).toBe('D:\\proj\\正文\\第002章.md');
    expect(joinChild('/proj/正文', '第002章.md')).toBe('/proj/正文/第002章.md');
    expect(siblingPath('D:\\proj\\正文\\第001章.md', '楔子.md')).toBe('D:\\proj\\正文\\楔子.md');
  });

  it('sanitizeEntryName 拒绝空 / . / .. / 含分隔符', () => {
    expect(sanitizeEntryName('  第003章.md ')).toBe('第003章.md');
    expect(sanitizeEntryName('')).toBeNull();
    expect(sanitizeEntryName('.')).toBeNull();
    expect(sanitizeEntryName('..')).toBeNull();
    expect(sanitizeEntryName('a/b')).toBeNull();
    expect(sanitizeEntryName('a\\b')).toBeNull();
  });

  it('ensureMarkdownName 补 .md、保留已有扩展', () => {
    expect(ensureMarkdownName('楔子')).toBe('楔子.md');
    expect(ensureMarkdownName('楔子.md')).toBe('楔子.md');
    expect(ensureMarkdownName('note.markdown')).toBe('note.markdown');
    expect(ensureMarkdownName('  ')).toBeNull();
    expect(ensureMarkdownName('a/b')).toBeNull();
  });
});
