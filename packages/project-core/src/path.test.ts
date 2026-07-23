import { describe, expect, it } from 'vitest';

import { isPathInsideProject, relativePathInsideProject, resolveProjectRelativePath } from './path';

describe('project path boundary', () => {
  it('rejects traversal and sibling-prefix paths', () => {
    expect(resolveProjectRelativePath('D:\\book', '..\\secret.md')).toBeNull();
    expect(isPathInsideProject('D:\\book', 'D:\\book2\\secret.md')).toBe(false);
  });

  it('resolves project-relative Windows paths', () => {
    expect(resolveProjectRelativePath('D:\\book', '正文\\第01章.md')).toBe(
      'D:\\book\\正文\\第01章.md',
    );
    expect(relativePathInsideProject('D:\\book', 'D:\\book\\正文\\第01章.md')).toBe(
      '正文\\第01章.md',
    );
  });

  // E4-001：isPathInsideProject 是三层写回守卫（agent 建议/Ctrl+S/上下文 bundle）共用的
  // 单一 containment 实现，且靠 parsePath 对 .. 的「解析」而非「全拒」把关。以下矩阵把它自身的
  // 主逃逸向量（路径内 .. 逃逸 / 跨盘 / 大小写）锁死——此前只测到 sibling-prefix 与
  // resolveProjectRelativePath 的 traversal，重构 parsePath 的 escaped 逻辑不会让测试变红。
  it('rejects in-path .. escapes that resolve outside the project', () => {
    expect(isPathInsideProject('D:\\book', 'D:\\book\\..\\secret.md')).toBe(false);
    expect(isPathInsideProject('D:\\book', 'D:\\book\\..\\..\\secret.md')).toBe(false);
    expect(isPathInsideProject('D:\\book', 'D:\\book\\sub\\..\\..\\secret.md')).toBe(false);
  });

  it('keeps in-path .. that stays inside the project', () => {
    expect(isPathInsideProject('D:\\book', 'D:\\book\\a\\..\\b\\c.md')).toBe(true);
    expect(relativePathInsideProject('D:\\book', 'D:\\book\\a\\..\\b\\c.md')).toBe('b\\c.md');
  });

  it('rejects cross-drive and cross-root paths', () => {
    expect(isPathInsideProject('D:\\book', 'C:\\book\\x.md')).toBe(false);
    expect(isPathInsideProject('D:\\book', '/book/x.md')).toBe(false);
    expect(isPathInsideProject('/srv/book', 'D:\\book\\x.md')).toBe(false);
  });

  it('treats Windows drive and segments case-insensitively', () => {
    expect(isPathInsideProject('D:\\book', 'd:\\BOOK\\正文\\第01章.md')).toBe(true);
    expect(isPathInsideProject('D:\\Book', 'd:\\book\\x.md')).toBe(true);
  });

  it('handles posix roots: keeps inside paths, rejects escapes and sibling-prefix', () => {
    expect(isPathInsideProject('/srv/book', '/srv/book/ch/1.md')).toBe(true);
    expect(isPathInsideProject('/srv/book', '/srv/book/../secret.md')).toBe(false);
    expect(isPathInsideProject('/srv/book', '/srv/book2/x.md')).toBe(false);
  });
});
