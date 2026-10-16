import { expect, test } from 'vitest';
import { decodeChapterCheckHistory } from '../src/lib/api/chapter-checks';

const request = { project_root: 'D:/novel', assistant_session_id: 7, limit: 20 };

test('a scoped empty history decodes as empty', () => {
  expect(decodeChapterCheckHistory({ ...request, entries: [], truncated: false }, request)).toEqual(
    {
      entries: [],
      truncated: false,
    },
  );
});

test('a history bound to another session or of the wrong shape is never treated as empty', () => {
  expect(() =>
    decodeChapterCheckHistory(
      { ...request, assistant_session_id: 8, entries: [], truncated: false },
      request,
    ),
  ).toThrow('归属');
  expect(() => decodeChapterCheckHistory('not-json', request)).toThrow();
});
