import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  buildSerialHealth,
  classifySerialHealth,
  extractLatestChapter,
  parseOnlineTimestamp,
  resolveLastUpdateAt,
  stampBooksPublished,
  type PublishAccount,
  type PublishBook,
} from '../src/features/publish/model';

function book(projectKey: string, overrides: Partial<PublishBook> = {}): PublishBook {
  return {
    projectKey,
    title: projectKey,
    path: `D:/novels/${projectKey}`,
    platform: 'fanqie',
    status: 'serializing',
    assignedAccountId: null,
    assignmentLocked: false,
    planOpenDate: null,
    readyScore: 0,
    readyConfirmed: false,
    forceReadyReason: null,
    openedAt: null,
    lastLocalEditAt: null,
    dropReason: null,
    updatedAt: '2026-07-14T00:00:00.000Z',
    isPlaceholder: false,
    blurb: '',
    onlineBookId: null,
    onlineSnapshot: null,
    ...overrides,
  };
}

function account(id: string, overrides: Partial<PublishAccount> = {}): PublishAccount {
  return {
    id,
    penName: `笔名${id}`,
    monthlyOpenLimit: 3,
    active: true,
    riskStatus: 'normal',
    riskNote: '',
    color: '#6b8afd',
    priority: 0,
    coldUntil: null,
    coldMaxOpensPerMonth: 1,
    sessionStatus: 'logged_in',
    lastLoginJumpAt: null,
    sessionConfirmedAt: null,
    sessionNote: '',
    cookieText: 'sid=abc',
    ...overrides,
  };
}

const TODAY = '2026-07-15';

test('parseOnlineTimestamp：秒/毫秒/数字字符串/日期字符串，垃圾值归 null', () => {
  // 2026-07-15T08:00:00Z
  assert.equal(parseOnlineTimestamp(1784102400), '2026-07-15T08:00:00.000Z');
  assert.equal(parseOnlineTimestamp(1784102400000), '2026-07-15T08:00:00.000Z');
  assert.equal(parseOnlineTimestamp('1784102400'), '2026-07-15T08:00:00.000Z');
  assert.equal(parseOnlineTimestamp('2026-07-15T08:00:00.000Z'), '2026-07-15T08:00:00.000Z');
  assert.equal(parseOnlineTimestamp(null), null);
  assert.equal(parseOnlineTimestamp(undefined), null);
  assert.equal(parseOnlineTimestamp(0), null);
  assert.equal(parseOnlineTimestamp(123), null); // 太小，不是现代时间戳
  assert.equal(parseOnlineTimestamp('不是时间'), null);
  assert.equal(parseOnlineTimestamp({}), null);
});

test('extractLatestChapter：跨字段名取最大时间；全无时间字段则返回 null 不猜顺序', () => {
  const latest = extractLatestChapter([
    { title: '第1章', create_time: 1784016000 }, // 07-14
    { chapter_title: '第2章', first_pass_time: 1784102400 }, // 07-15（字段名不同）
    { name: '第0章', update_time: 1783929600 }, // 07-13
  ]);
  assert.ok(latest);
  assert.equal(latest.title, '第2章');
  assert.equal(latest.publishedAt, '2026-07-15T08:00:00.000Z');

  // 无任何可解析时间：不按列表顺序猜「最新」
  assert.equal(extractLatestChapter([{ title: 'a' }, { title: 'b' }]), null);
  assert.equal(extractLatestChapter([]), null);
  assert.equal(extractLatestChapter([null, 'garbage', 42]), null);
});

test('classifySerialHealth：今日已更/该更/断更/未知', () => {
  assert.deepEqual(classifySerialHealth(null, TODAY, 2), { kind: 'unknown', daysSince: null });
  assert.deepEqual(classifySerialHealth('2026-07-15T01:00:00Z', TODAY, 2), {
    kind: 'ok',
    daysSince: 0,
  });
  assert.deepEqual(classifySerialHealth('2026-07-14T23:00:00Z', TODAY, 2), {
    kind: 'due',
    daysSince: 1,
  });
  assert.deepEqual(classifySerialHealth('2026-07-13T00:00:00Z', TODAY, 2), {
    kind: 'overdue',
    daysSince: 2,
  });
  assert.deepEqual(classifySerialHealth('2026-07-01T00:00:00Z', TODAY, 2), {
    kind: 'overdue',
    daysSince: 14,
  });
  // staleDays=1：隔天即断更
  assert.deepEqual(classifySerialHealth('2026-07-14T00:00:00Z', TODAY, 1), {
    kind: 'overdue',
    daysSince: 1,
  });
});

test('resolveLastUpdateAt：线上最近章时间与本地发布盖章取较新者', () => {
  const snapshotOnly = book('a', {
    onlineSnapshot: {
      chapterCount: 3,
      wordCount: 9000,
      statusTag: '',
      statusMsg: '',
      syncedAt: TODAY,
      latestChapterAt: '2026-07-14T00:00:00.000Z',
    },
  });
  assert.equal(resolveLastUpdateAt(snapshotOnly), '2026-07-14T00:00:00.000Z');

  const localNewer = book('b', {
    lastPublishedAt: '2026-07-15T02:00:00.000Z',
    onlineSnapshot: {
      chapterCount: 3,
      wordCount: 9000,
      statusTag: '',
      statusMsg: '',
      syncedAt: TODAY,
      latestChapterAt: '2026-07-14T00:00:00.000Z',
    },
  });
  assert.equal(resolveLastUpdateAt(localNewer), '2026-07-15T02:00:00.000Z');

  assert.equal(resolveLastUpdateAt(book('c')), null);
});

test('buildSerialHealth：只收连载/已开的非空位书，断更在前，未绑定/无 Cookie 出说明', () => {
  const accounts = [account('acc1'), account('acc2', { cookieText: '' })];
  const books = [
    book('writing', { status: 'writing' }), // 不进清单
    book('placeholder', { isPlaceholder: true }), // 不进清单
    book('ok', {
      assignedAccountId: 'acc1',
      onlineBookId: '1',
      lastPublishedAt: `${TODAY}T01:00:00.000Z`,
    }),
    book('overdue', {
      assignedAccountId: 'acc1',
      onlineBookId: '2',
      onlineSnapshot: {
        chapterCount: 5,
        wordCount: 10000,
        statusTag: '',
        statusMsg: '',
        syncedAt: TODAY,
        latestChapterTitle: '第5章',
        latestChapterAt: '2026-07-10T00:00:00.000Z',
      },
    }),
    book('due', {
      assignedAccountId: 'acc1',
      onlineBookId: '3',
      lastPublishedAt: '2026-07-14T20:00:00.000Z',
    }),
    book('unbound', { status: 'opened', assignedAccountId: 'acc1' }),
    book('no-cookie', { assignedAccountId: 'acc2', onlineBookId: '4' }),
  ];
  const entries = buildSerialHealth({ books, accounts, today: TODAY, staleDays: 2 });
  assert.deepEqual(
    entries.map((e) => e.projectKey),
    ['overdue', 'due', 'unbound', 'no-cookie', 'ok'],
  );
  const overdue = entries[0];
  assert.equal(overdue.kind, 'overdue');
  assert.equal(overdue.daysSince, 5);
  assert.equal(overdue.penName, '笔名acc1');
  assert.equal(overdue.latestChapterTitle, '第5章');
  assert.equal(entries.find((e) => e.projectKey === 'unbound')?.note, '未绑定线上作品（先对账）');
  assert.equal(
    entries.find((e) => e.projectKey === 'no-cookie')?.note,
    '账号无 Cookie，无法线上巡检',
  );
  assert.equal(entries.find((e) => e.projectKey === 'ok')?.kind, 'ok');
});

test('stampBooksPublished：命中 onlineBookId 盖章并更新快照；无命中返回原数组引用', () => {
  const at = '2026-07-15T03:00:00.000Z';
  const books = [
    book('a', {
      onlineBookId: '111',
      onlineSnapshot: {
        chapterCount: 3,
        wordCount: 9000,
        statusTag: '',
        statusMsg: '',
        syncedAt: '2026-07-14T00:00:00.000Z',
        latestChapterTitle: '第3章',
        latestChapterAt: '2026-07-14T00:00:00.000Z',
      },
    }),
    book('b', { onlineBookId: '222' }),
  ];
  const next = stampBooksPublished(books, { onlineBookId: '111', chapterTitle: '第4章', at });
  assert.notEqual(next, books);
  const a = next.find((x) => x.projectKey === 'a');
  assert.equal(a?.lastPublishedAt, at);
  assert.equal(a?.onlineSnapshot?.latestChapterTitle, '第4章');
  assert.equal(a?.onlineSnapshot?.latestChapterAt, at);
  assert.equal(a?.updatedAt, at);
  // 未命中的书不动
  assert.equal(next.find((x) => x.projectKey === 'b'), books[1]);
  // 无快照的书只盖 lastPublishedAt，不伪造快照
  const noSnap = stampBooksPublished([book('c', { onlineBookId: '333' })], {
    onlineBookId: '333',
    chapterTitle: '第1章',
    at,
  });
  assert.equal(noSnap[0].lastPublishedAt, at);
  assert.equal(noSnap[0].onlineSnapshot, null);
  // 全无命中：原数组引用
  const untouched = stampBooksPublished(books, { onlineBookId: '999', chapterTitle: 'x', at });
  assert.equal(untouched, books);
});
