import { describe, expect, it } from 'vitest';

import {
  ensureMarkdownName,
  entryName,
  joinPath,
  parentDir,
  sanitizeEntryName,
  siblingPath,
  withProjectSeparator,
} from '../../src/lib/fs-path-ops';

// 换成 joinPath 之前，前端 17 个文件里各自手拼的两种写法（按 base 认分隔符；去不去 base 末尾的分隔符各有）。
const oldSeparator = (base: string) => (base.includes('\\') ? '\\' : '/');
const oldTrimmedJoin = (base: string, ...parts: string[]) =>
  [
    base.replace(/[\\/]+$/, ''),
    ...parts.map((part) => part.split('/').join(oldSeparator(base))),
  ].join(oldSeparator(base));
const oldUntrimmedJoin = (base: string, ...parts: string[]) =>
  [base, ...parts].join(oldSeparator(base));

const BASES = [
  'D:\\StoryForge\\Books\\雾港回声',
  'D:\\StoryForge\\Books\\雾港回声\\',
  'D:\\StoryForge\\Books\\雾港回声\\\\',
  'D:\\StoryForge/Books\\雾港回声',
  'D:/StoryForge/Books\\雾港回声',
  'D:/StoryForge/Books/雾港回声',
  'D:/StoryForge/Books/雾港回声/',
  '/home/author/雾港回声',
  '/home/author/雾港回声//',
  '\\\\server\\books\\雾港回声\\',
  'D:\\',
  '/',
];
const PART_LISTS = [
  ['灵感.md'],
  ['.storyforge', 'book.json'],
  ['.storyforge', 'author-loop', `${'a'.repeat(64)}.md`],
  ['大纲/项目说明.md'],
  ['.storyforge/versions', '正文/第001章.md'],
];

describe('joinPath', () => {
  it('反斜杠路径接着用反斜杠，正斜杠路径用正斜杠', () => {
    expect(joinPath('D:\\proj', '.storyforge', 'book.json')).toBe(
      'D:\\proj\\.storyforge\\book.json',
    );
    expect(joinPath('/proj', '.storyforge', 'book.json')).toBe('/proj/.storyforge/book.json');
    expect(joinPath('\\\\server\\books', '第一本')).toBe('\\\\server\\books\\第一本');
  });

  it('base 末尾的分隔符去掉，不出现重复分隔符', () => {
    expect(joinPath('D:\\proj\\', '灵感.md')).toBe('D:\\proj\\灵感.md');
    expect(joinPath('D:\\proj\\\\', '灵感.md')).toBe('D:\\proj\\灵感.md');
    expect(joinPath('/proj//', '灵感.md')).toBe('/proj/灵感.md');
    expect(joinPath('D:\\', '第一本')).toBe('D:\\第一本');
    expect(joinPath('/', 'books')).toBe('/books');
    expect(joinPath('D:\\proj\\')).toBe('D:\\proj');
  });

  it('段里的分隔符换成 base 的那一种，空段与段首尾的分隔符丢掉', () => {
    expect(joinPath('D:\\proj', '大纲/项目说明.md')).toBe('D:\\proj\\大纲\\项目说明.md');
    expect(joinPath('/proj', '大纲\\项目说明.md')).toBe('/proj/大纲/项目说明.md');
    expect(joinPath('D:\\proj', '', '灵感.md', '')).toBe('D:\\proj\\灵感.md');
    expect(joinPath('/proj', '/正文//第001章.md/')).toBe('/proj/正文/第001章.md');
  });

  it('base 中间的分隔符原样保留（混合分隔符时按 base 里有没有反斜杠定）', () => {
    expect(joinPath('D:/StoryForge\\雾港回声', '灵感.md')).toBe('D:/StoryForge\\雾港回声\\灵感.md');
    expect(joinPath('D:\\StoryForge/雾港回声/', '灵感.md')).toBe(
      'D:\\StoryForge/雾港回声\\灵感.md',
    );
  });

  it('换掉的旧写法：段里没有空段时，与「去掉 base 末尾分隔符再拼」逐字一致', () => {
    for (const base of BASES)
      for (const parts of PART_LISTS)
        expect(joinPath(base, ...parts), `${base} + ${parts.join(' + ')}`).toBe(
          oldTrimmedJoin(base, ...parts),
        );
  });

  it('换掉的旧写法：base 末尾没有分隔符时，与「不去末尾直接拼」逐字一致', () => {
    const bases = BASES.filter((base) => !/[\\/]$/.test(base));
    expect(bases.length).toBeGreaterThan(4);
    for (const base of bases)
      for (const parts of PART_LISTS.filter((list) => list.every((part) => !part.includes('/'))))
        expect(joinPath(base, ...parts), `${base} + ${parts.join(' + ')}`).toBe(
          oldUntrimmedJoin(base, ...parts),
        );
  });
});

describe('withProjectSeparator', () => {
  const BOOK = 'D:\\连载\\末世吞噬';

  it('旧版文件树存下的混合写法换成作品根的分隔符，与宿主列出的条目逐字一致', () => {
    expect(withProjectSeparator(BOOK, 'D:\\连载\\末世吞噬/正文\\第001章.md')).toBe(
      'D:\\连载\\末世吞噬\\正文\\第001章.md',
    );
    expect(withProjectSeparator(BOOK, 'D:\\连载\\末世吞噬/正文/卷一\\第001章.md')).toBe(
      'D:\\连载\\末世吞噬\\正文\\卷一\\第001章.md',
    );
    expect(withProjectSeparator(`${BOOK}\\`, `${BOOK}/正文`)).toBe(`${BOOK}\\正文`);
    expect(withProjectSeparator('/home/a/书', '/home/a/书\\正文\\第001章.md')).toBe(
      '/home/a/书/正文/第001章.md',
    );
  });

  it('已经是作品根写法的原样不动', () => {
    for (const path of [BOOK, `${BOOK}\\正文`, `${BOOK}\\正文\\第001章.md`])
      expect(withProjectSeparator(BOOK, path)).toBe(path);
    expect(withProjectSeparator('/home/a/书', '/home/a/书/正文/第001章.md')).toBe(
      '/home/a/书/正文/第001章.md',
    );
  });

  it('盘符根、UNC、posix 根都跟着作品根走', () => {
    expect(withProjectSeparator('D:\\', 'D:/正文/第001章.md')).toBe('D:\\正文\\第001章.md');
    expect(withProjectSeparator('\\\\nas\\书', '\\\\nas\\书/正文\\a.md')).toBe(
      '\\\\nas\\书\\正文\\a.md',
    );
    expect(withProjectSeparator('/', '/正文\\a.md')).toBe('/正文/a.md');
  });

  it('作品外的路径、只是前缀相同的兄弟目录、相对路径原样返回', () => {
    expect(withProjectSeparator(BOOK, 'D:\\连载\\别的书/正文\\a.md')).toBe(
      'D:\\连载\\别的书/正文\\a.md',
    );
    expect(withProjectSeparator(BOOK, `${BOOK}2/正文\\a.md`)).toBe(`${BOOK}2/正文\\a.md`);
    expect(withProjectSeparator(BOOK, '正文/a.md')).toBe('正文/a.md');
    expect(withProjectSeparator(BOOK, 'D:')).toBe('D:');
  });

  it('只换分隔符，不改大小写', () => {
    expect(withProjectSeparator('D:\\Book', 'D:\\Book/Draft\\A.md')).toBe('D:\\Book\\Draft\\A.md');
    expect(withProjectSeparator('D:\\Book', 'd:\\book/Draft\\A.md')).toBe('d:\\book/Draft\\A.md');
  });
});

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

  it('joinPath / siblingPath 沿用分隔符风格', () => {
    expect(joinPath('D:\\proj\\正文', '第002章.md')).toBe('D:\\proj\\正文\\第002章.md');
    expect(joinPath('/proj/正文', '第002章.md')).toBe('/proj/正文/第002章.md');
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
