import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  bookToProjectPublish,
  mergeProjectIntoBook,
} from '../src/features/publish/storage/project-publish';
import type { PublishBook } from '../src/features/publish/model';

function book(overrides: Partial<PublishBook> = {}): PublishBook {
  return {
    projectKey: 'd:/novels/demo',
    title: 'Demo',
    path: 'D:/novels/demo',
    platform: 'fanqie',
    status: 'writing',
    assignedAccountId: null,
    assignmentLocked: false,
    planOpenDate: null,
    readyScore: 10,
    readyConfirmed: false,
    forceReadyReason: null,
    openedAt: null,
    lastLocalEditAt: null,
    dropReason: null,
    updatedAt: '2026-07-13T10:00:00.000Z',
    isPlaceholder: false,
    blurb: '',
    ...overrides,
  };
}

test('bookToProjectPublish 写出关键字段', () => {
  const b = book({
    status: 'scheduled',
    assignedAccountId: 'acc1',
    planOpenDate: '2026-07-20',
    readyScore: 80,
  });
  const p = bookToProjectPublish(b, { penNameSnapshot: '笔名A' });
  assert.equal(p.version, 1);
  assert.equal(p.title, 'Demo');
  assert.equal(p.assignedAccountId, 'acc1');
  assert.equal(p.planOpenDate, '2026-07-20');
  assert.equal(p.penNameSnapshot, '笔名A');
  assert.equal(p.status, 'scheduled');
});

test('mergeProjectIntoBook：项目更新则覆盖 library', () => {
  const lib = book({
    title: '旧标题',
    readyScore: 10,
    updatedAt: '2026-07-13T10:00:00.000Z',
  });
  const project = bookToProjectPublish(
    book({
      title: '新标题',
      status: 'ready',
      readyScore: 90,
      readyConfirmed: true,
      updatedAt: '2026-07-13T12:00:00.000Z',
    }),
  );
  const merged = mergeProjectIntoBook(lib, project);
  assert.equal(merged.title, '新标题');
  assert.equal(merged.status, 'ready');
  assert.equal(merged.readyScore, 90);
  assert.equal(merged.readyConfirmed, true);
});

test('mergeProjectIntoBook：library 更新则保留 library', () => {
  const lib = book({
    title: '库侧新',
    readyScore: 50,
    updatedAt: '2026-07-13T14:00:00.000Z',
  });
  const project = bookToProjectPublish(
    book({
      title: '项目旧',
      readyScore: 99,
      updatedAt: '2026-07-13T12:00:00.000Z',
    }),
  );
  const merged = mergeProjectIntoBook(lib, project);
  assert.equal(merged.title, '库侧新');
  assert.equal(merged.readyScore, 50);
});
