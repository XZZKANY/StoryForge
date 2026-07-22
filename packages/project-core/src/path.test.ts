import { describe, expect, it } from 'vitest';

import {
  isPathInsideProject,
  relativePathInsideProject,
  resolveProjectRelativePath,
} from './path';

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
});
