/** 引擎记账回包的解码：形状不对就报错，不拿空值冒充「没有事实」。 */
import { expect, test } from 'vitest';

import { decodeChapterFactRecordPlan, FactRecordShapeError } from '../src/lib/api/facts';

const RAW = {
  status: 'ready',
  chapter_path: '正文/第002章.md',
  chapter_ordinal: 2,
  added: 1,
  superseded: 0,
  duplicates: 2,
  unverified: 0,
  conflicts: [
    {
      kind: '关系',
      subject: '陈默',
      attribute: '兄弟姐妹',
      value: '有个姐姐',
      quote: '他想起姐姐。',
      existing_id: 'fact_x',
      existing_value: '独子',
      existing_path: '正文/第001章.md',
      existing_ordinal: 1,
    },
  ],
  before: null,
  after: '{}\n',
};

test('解出写台账要用的全部字段', () => {
  expect(decodeChapterFactRecordPlan(RAW)).toEqual({
    status: 'ready',
    chapterPath: '正文/第002章.md',
    chapterOrdinal: 2,
    added: 1,
    superseded: 0,
    duplicates: 2,
    unverified: 0,
    conflicts: [
      {
        kind: '关系',
        subject: '陈默',
        attribute: '兄弟姐妹',
        value: '有个姐姐',
        quote: '他想起姐姐。',
        existingValue: '独子',
        existingPath: '正文/第001章.md',
        existingOrdinal: 1,
      },
    ],
    before: null,
    after: '{}\n',
  });
  const { before: _before, after: _after, ...unchanged } = RAW;
  expect(decodeChapterFactRecordPlan({ ...unchanged, status: 'unchanged' })).not.toHaveProperty(
    'after',
  );
  expect(decodeChapterFactRecordPlan({ status: 'skipped', reason: 'no_run' })).toEqual({
    status: 'skipped',
    reason: 'no_run',
  });
});

test.each([
  [null],
  [{ ...RAW, status: 'done' }],
  [{ ...RAW, added: -1 }],
  [{ ...RAW, chapter_ordinal: '2' }],
  [{ ...RAW, after: undefined }],
  [{ ...RAW, conflicts: [{ ...RAW.conflicts[0], existing_value: 7 }] }],
  [{ status: 'skipped' }],
])('形状不对就报错 %#', (raw) => {
  expect(() => decodeChapterFactRecordPlan(raw)).toThrow(FactRecordShapeError);
});
