import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  applyOnlineSnapshots,
  buildBookFromOnline,
  compareLedgerToOnline,
  normalizeBookTitle,
  reconcileOnlineBooks,
  type PublishBook,
  type ReconcileOnlineBook,
} from '../src/features/publish/model';

function book(projectKey: string, overrides: Partial<PublishBook> = {}): PublishBook {
  return {
    projectKey,
    title: projectKey,
    path: `D:/novels/${projectKey}`,
    platform: 'fanqie',
    status: 'writing',
    assignedAccountId: null,
    assignmentLocked: false,
    planOpenDate: null,
    readyScore: 0,
    readyConfirmed: false,
    forceReadyReason: null,
    openedAt: null,
    lastLocalEditAt: null,
    dropReason: null,
    updatedAt: '2026-07-13T00:00:00.000Z',
    isPlaceholder: false,
    blurb: '',
    onlineBookId: null,
    onlineSnapshot: null,
    ...overrides,
  };
}

function online(bookId: string, bookName: string, extra: Partial<ReconcileOnlineBook> = {}): ReconcileOnlineBook {
  return {
    bookId,
    bookName,
    chapterNumber: 3,
    wordNumber: 9000,
    statusTag: '',
    statusMsg: '连载中',
    ...extra,
  };
}

test('对账：按 onlineBookId 优先匹配，其次按归一书名', () => {
  const books = [
    book('a', { title: '末世吞噬', onlineBookId: '111' }),
    book('b', { title: '都市 逆袭 记' }),
  ];
  const onlineBooks = [
    online('111', '改过名的末世'), // id 命中，书名已改
    online('222', '都市逆袭记'), // title 命中（去空格）
    online('333', '无人认领的书'), // 线上多出
  ];
  const r = reconcileOnlineBooks({ books, online: onlineBooks, accountId: 'acc1' });
  assert.equal(r.matched.length, 2);
  assert.equal(r.matched.find((m) => m.online.bookId === '111')?.matchedBy, 'id');
  assert.equal(r.matched.find((m) => m.online.bookId === '222')?.matchedBy, 'title');
  assert.equal(r.onlineOnly.length, 1);
  assert.equal(r.onlineOnly[0].bookId, '333');
  assert.equal(r.onlineTotal, 3);
});

test('对账：本地标已开但线上查无 → localMissing（限本号）', () => {
  const books = [
    book('a', { title: '在线书', status: 'serializing', assignedAccountId: 'acc1', onlineBookId: '111' }),
    book('b', { title: '掉线书', status: 'opened', assignedAccountId: 'acc1', openedAt: '2026-07-10T00:00:00.000Z' }),
    book('c', { title: '别号的书', status: 'opened', assignedAccountId: 'acc2', openedAt: '2026-07-10T00:00:00.000Z' }),
  ];
  const r = reconcileOnlineBooks({ books, online: [online('111', '在线书')], accountId: 'acc1' });
  assert.equal(r.matched.length, 1);
  assert.deepEqual(
    r.localMissing.map((b) => b.projectKey),
    ['b'],
  );
});

test('applyOnlineSnapshots：写 onlineBookId + 快照，只动匹配到的书', () => {
  const books = [book('a', { title: '末世吞噬' }), book('b', { title: '别的书' })];
  const r = reconcileOnlineBooks({
    books,
    online: [online('111', '末世吞噬', { chapterNumber: 12, wordNumber: 30000, statusMsg: '审核中' })],
    accountId: 'acc1',
  });
  const next = applyOnlineSnapshots(books, r.matched, '2026-07-14T00:00:00.000Z');
  const a = next.find((x) => x.projectKey === 'a')!;
  const b = next.find((x) => x.projectKey === 'b')!;
  assert.equal(a.onlineBookId, '111');
  assert.equal(a.onlineSnapshot?.chapterCount, 12);
  assert.equal(a.onlineSnapshot?.wordCount, 30000);
  assert.equal(a.onlineSnapshot?.statusMsg, '审核中');
  assert.equal(a.onlineSnapshot?.syncedAt, '2026-07-14T00:00:00.000Z');
  assert.equal(b.onlineSnapshot, null);
});

test('compareLedgerToOnline：并排台账与线上，不改月账', () => {
  const r = reconcileOnlineBooks({
    books: [book('a', { title: '末世吞噬', onlineBookId: '111' })],
    online: [online('111', '末世吞噬'), online('222', '线上多出的书')],
    accountId: 'acc1',
  });
  const cmp = compareLedgerToOnline({ ledgerOpened: 1, result: r });
  assert.equal(cmp.ledgerOpened, 1);
  assert.equal(cmp.onlineTotal, 2);
  assert.equal(cmp.matchedCount, 1);
  assert.equal(cmp.onlineOnlyCount, 1);
});

test('buildBookFromOnline：online:// 追踪书，绑定号与快照', () => {
  const nb = buildBookFromOnline({
    online: online('999', '祖传老书', { chapterNumber: 40, wordNumber: 120000 }),
    accountId: 'acc1',
    now: '2026-07-14T00:00:00.000Z',
    platform: 'fanqie',
  });
  assert.equal(nb.projectKey, 'online://999');
  assert.equal(nb.path, 'online://999');
  assert.equal(nb.status, 'serializing');
  assert.equal(nb.assignedAccountId, 'acc1');
  assert.equal(nb.onlineBookId, '999');
  assert.equal(nb.onlineSnapshot?.chapterCount, 40);
  assert.equal(nb.openedAt, '2026-07-14T00:00:00.000Z');
});

test('normalizeBookTitle：去空白与标点', () => {
  assert.equal(normalizeBookTitle('都市 逆袭·记！'), normalizeBookTitle('都市逆袭记'));
  assert.equal(normalizeBookTitle('第 1 章  觉醒'), normalizeBookTitle('第1章觉醒'));
});
