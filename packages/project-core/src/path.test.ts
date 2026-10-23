import { describe, expect, it } from 'vitest';

import {
  compareChapterPaths,
  compareManuscriptPaths,
  isPathInsideProject,
  relativePathInsideProject,
  resolveProjectRelativePath,
} from './path';

describe('chapter code-point order', () => {
  it('keeps BMP before supplementary characters, without normalizing Unicode', () => {
    expect(
      ['正文/𠀀.md', '正文/\ue000.md', '正文/é.md', '正文/é.md'].sort(compareChapterPaths),
    ).toEqual(['正文/é.md', '正文/é.md', '正文/\ue000.md', '正文/𠀀.md']);
  });

  it('compares equal strings and strict prefixes', () => {
    expect(compareChapterPaths('正文/A', '正文/A')).toBe(0);
    expect(compareChapterPaths('正文/A', '正文/A.md')).toBeLessThan(0);
    expect(compareChapterPaths('正文/A.md', '正文/A')).toBeGreaterThan(0);
  });
});

describe('manuscript reading order', () => {
  it('orders decimal runs by value without changing the generic code-point comparator', () => {
    const paths = ['正文/第10章.md', '正文/第002章.md', '正文/第1章 旧馆.md'];
    expect([...paths].sort(compareManuscriptPaths)).toEqual([
      '正文/第1章 旧馆.md',
      '正文/第002章.md',
      '正文/第10章.md',
    ]);
    expect([...paths].sort(compareChapterPaths)).toEqual([
      '正文/第002章.md',
      '正文/第10章.md',
      '正文/第1章 旧馆.md',
    ]);
  });

  it('keeps volumes grouped, including equal numbers with different padding', () => {
    expect(
      [
        '卷10/第1章.md',
        '卷2/第10章.md',
        '卷2/第2章.md',
        '卷1/第3章.md',
        '卷01/第2章.md',
        '卷1/第1章.md',
      ].sort(compareManuscriptPaths),
    ).toEqual([
      '卷01/第2章.md',
      '卷1/第1章.md',
      '卷1/第3章.md',
      '卷2/第2章.md',
      '卷2/第10章.md',
      '卷10/第1章.md',
    ]);
  });

  it('handles Unicode decimals, equal numbers and huge values without precision loss', () => {
    expect(
      ['第１０章.md', '第٢章.md', '第1章.md', '第01章.md', '第１章.md'].sort(
        compareManuscriptPaths,
      ),
    ).toEqual(['第01章.md', '第1章.md', '第１章.md', '第٢章.md', '第１０章.md']);
    expect(
      compareManuscriptPaths('第9007199254740993章.md', '第9007199254740992章.md'),
    ).toBeGreaterThan(0);
    expect(
      compareManuscriptPaths('第' + '9'.repeat(100) + '章', '第1' + '0'.repeat(100) + '章'),
    ).toBeLessThan(0);
  });

  it('retains code-point order when there are no digits and does not infer prologue semantics', () => {
    const paths = [
      '正文/𠀀.md',
      '正文/\ue000.md',
      '正文/序章.md',
      '正文/尾声.md',
      '正文/é.md',
      '正文/é.md',
      'A.md',
      'A/正文.md',
    ];
    expect([...paths].sort(compareManuscriptPaths)).toEqual([...paths].sort(compareChapterPaths));
  });

  it('is a deterministic total order across mixed names and separator spellings', () => {
    const paths = [
      '第1章',
      '第01章',
      '第1章 乙',
      '第1章 甲',
      '第!章',
      '第٠章',
      '第１章',
      '第一章',
      '卷01/第2章',
      '卷1/第1章',
      '卷1/第3章',
      '卷1\\第3章',
      'A.md',
      'A/正文.md',
    ];
    const ordered = [...paths].sort(compareManuscriptPaths);
    expect([...paths].reverse().sort(compareManuscriptPaths)).toEqual(ordered);
    for (const a of paths)
      for (const b of paths) {
        expect(compareManuscriptPaths(a, a)).toBe(0);
        expect(
          Math.sign(compareManuscriptPaths(a, b)) + Math.sign(compareManuscriptPaths(b, a)),
        ).toBe(0);
        for (const c of paths)
          if (compareManuscriptPaths(a, b) <= 0 && compareManuscriptPaths(b, c) <= 0)
            expect(compareManuscriptPaths(a, c)).toBeLessThanOrEqual(0);
      }
  });
});

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
