import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  DEFAULT_PUBLISH_SETTINGS,
  autoAssignReadyBooks,
  bindPlaceholderToProject,
  calibrateOpened,
  canScheduleOnDate,
  canTransition,
  capacitySnapshot,
  computeReadyScore,
  createPlaceholderBook,
  dropBookFromQuota,
  emptyMonthQuota,
  findNearBlurbs,
  isAccountAssignable,
  isPlaceholderBook,
  isReadyEnough,
  isSessionStale,
  jaccardSimilarity,
  markLoginJumped,
  markOpenedInQuota,
  markSessionLoggedIn,
  remainingForAccount,
  targetGap,
  theoryCapacity,
  upsertReservation,
  type PublishAccount,
  type PublishBook,
} from '../src/features/publish/model';

function account(
  id: string,
  overrides: Partial<PublishAccount> = {},
): PublishAccount {
  return {
    id,
    penName: id,
    monthlyOpenLimit: 3,
    active: true,
    riskStatus: 'normal',
    riskNote: '',
    color: '#888',
    priority: 0,
    coldUntil: null,
    coldMaxOpensPerMonth: 1,
    sessionStatus: 'unknown',
    lastLoginJumpAt: null,
    sessionConfirmedAt: null,
    sessionNote: '',
    ...overrides,
  };
}

function book(projectKey: string, overrides: Partial<PublishBook> = {}): PublishBook {
  return {
    projectKey,
    title: projectKey,
    path: `D:/novels/${projectKey}`,
    platform: 'fanqie',
    status: 'ready',
    assignedAccountId: null,
    assignmentLocked: false,
    planOpenDate: null,
    readyScore: 80,
    readyConfirmed: false,
    forceReadyReason: null,
    openedAt: null,
    lastLocalEditAt: null,
    dropReason: null,
    updatedAt: '2026-07-13T00:00:00.000Z',
    isPlaceholder: false,
    blurb: '',
    ...overrides,
  };
}

test('状态机：ready→scheduled 须指派；止损不从 idea', () => {
  assert.equal(canTransition(book('a', { status: 'ready' }), 'scheduled').ok, false);
  assert.equal(
    canTransition(book('a', { status: 'ready', assignedAccountId: 'acc1' }), 'scheduled').ok,
    true,
  );
  assert.equal(canTransition(book('a', { status: 'idea' }), 'dropped').ok, false);
  assert.equal(canTransition(book('a', { status: 'opened' }), 'dropped').ok, true);
});

test('额度：5×3=15；校准与止损不退 opened', () => {
  const accounts = [1, 2, 3, 4, 5].map((n) => account(`a${n}`));
  assert.equal(theoryCapacity(accounts), 15);

  let quota = emptyMonthQuota('2026-07');
  quota = upsertReservation(quota, 'b1', 'a1', '2026-07-14');
  assert.equal(remainingForAccount(accounts[0], quota), 2);

  quota = markOpenedInQuota(quota, 'b1', 'a1');
  assert.equal(quota.reservations.length, 0);
  assert.equal(remainingForAccount(accounts[0], quota), 2);

  quota = upsertReservation(quota, 'b2', 'a1', '2026-07-15');
  quota = dropBookFromQuota(quota, 'b2');
  assert.equal(remainingForAccount(accounts[0], quota), 2);
  assert.equal(quota.openedByAccount.a1, 1);

  quota = calibrateOpened(quota, 'a1', 2);
  assert.equal(remainingForAccount(accounts[0], quota), 1);
});

test('目标缺口与 spare', () => {
  const accounts = [1, 2, 3, 4].map((n) => account(`a${n}`));
  const settings = { ...DEFAULT_PUBLISH_SETTINGS, monthlyOpenTarget: 15 };
  assert.equal(theoryCapacity(accounts), 12);
  const snap = capacitySnapshot(accounts, settings);
  assert.equal(snap.spare, -3);
  assert.equal(snap.fullLoad, true);

  const quota = emptyMonthQuota('2026-07');
  assert.equal(targetGap(settings, quota, accounts), 15);
});

test('存活：blocked 不可派；同日全池上限', () => {
  assert.equal(isAccountAssignable(account('x', { riskStatus: 'blocked' })), false);
  assert.equal(isAccountAssignable(account('x', { active: false })), false);

  const books = [
    book('b1', { planOpenDate: '2026-07-14', status: 'scheduled', assignedAccountId: 'a1' }),
    book('b2', { planOpenDate: '2026-07-14', status: 'scheduled', assignedAccountId: 'a2' }),
    book('b3', { planOpenDate: '2026-07-14', status: 'scheduled', assignedAccountId: 'a3' }),
  ];
  const settings = { ...DEFAULT_PUBLISH_SETTINGS, maxOpensPerDayGlobal: 3, maxOpensPerAccountPerDay: 1 };
  assert.equal(canScheduleOnDate(books, '2026-07-14', settings, 'a4').ok, false);
  assert.equal(canScheduleOnDate(books, '2026-07-15', settings, 'a1').ok, true);
});

test('Ready：无正文阻断；达标可过阈值', () => {
  const blocked = computeReadyScore(
    {
      hasTitle: false,
      chapterCount: 0,
      charCount: 0,
      checklistComplete: false,
      hasBlurbAndTags: false,
      editedInLast7Days: false,
      readyConfirmed: false,
    },
    DEFAULT_PUBLISH_SETTINGS,
  );
  assert.equal(blocked.blocked, true);

  const good = computeReadyScore(
    {
      hasTitle: true,
      chapterCount: 5,
      charCount: 12000,
      checklistComplete: true,
      hasBlurbAndTags: true,
      editedInLast7Days: true,
      readyConfirmed: false,
    },
    DEFAULT_PUBLISH_SETTINGS,
  );
  assert.equal(good.score, 100);
  assert.equal(isReadyEnough(good, DEFAULT_PUBLISH_SETTINGS, false), true);
  assert.equal(isReadyEnough(blocked, DEFAULT_PUBLISH_SETTINGS, true), true);
});

test('智能指派：不超卖、避开 blocked、遵守同日上限', () => {
  const accounts = [
    account('a1'),
    account('a2'),
    account('a3', { riskStatus: 'blocked' }),
    account('a4'),
    account('a5'),
  ];
  const books = Array.from({ length: 6 }, (_, i) => book(`book-${i}`));
  const result = autoAssignReadyBooks({
    books,
    accounts,
    quota: emptyMonthQuota('2026-07'),
    settings: {
      ...DEFAULT_PUBLISH_SETTINGS,
      maxOpensPerDayGlobal: 2,
      maxOpensPerAccountPerWeek: 3,
    },
    windowStart: '2026-07-14',
    windowDays: 14,
  });

  assert.equal(result.suggestions.length, 6);
  assert.ok(result.suggestions.every((s) => s.accountId !== 'a3'));

  const byDay = new Map<string, number>();
  for (const s of result.suggestions) {
    byDay.set(s.planOpenDate, (byDay.get(s.planOpenDate) ?? 0) + 1);
  }
  for (const count of byDay.values()) {
    assert.ok(count <= 2);
  }

  const byAccount = new Map<string, number>();
  for (const s of result.suggestions) {
    byAccount.set(s.accountId, (byAccount.get(s.accountId) ?? 0) + 1);
  }
  for (const [id, count] of byAccount) {
    const acc = accounts.find((a) => a.id === id)!;
    assert.ok(count <= acc.monthlyOpenLimit);
  }
});

test('冷号限载：观察期内 remaining 按 coldMaxOpensPerMonth', () => {
  const cold = account('cold1', {
    coldUntil: '2026-08-01',
    coldMaxOpensPerMonth: 1,
    monthlyOpenLimit: 3,
  });
  const quota = emptyMonthQuota('2026-07');
  assert.equal(remainingForAccount(cold, quota, '2026-07-15'), 1);
  assert.equal(remainingForAccount(cold, quota, '2026-08-02'), 3);
});

test('空位占坑与绑定', () => {
  const slot = createPlaceholderBook({ title: '七月坑', planOpenDate: '2026-07-20' });
  assert.equal(isPlaceholderBook(slot), true);
  assert.equal(slot.status, 'idea');
  assert.ok(slot.title.includes('空位'));
  const bound = bindPlaceholderToProject(slot, 'D:/novels/real-book', '真书');
  assert.equal(isPlaceholderBook(bound), false);
  assert.equal(bound.title, '真书');
  assert.equal(bound.status, 'writing');
});

test('简介过近检测', () => {
  const a = '都市重生后我靠系统逆袭商业帝国称霸全城';
  const b = '都市重生后我靠系统逆袭商业帝国称霸全城啊';
  assert.ok(jaccardSimilarity(a, b) > 0.7);
  const hits = findNearBlurbs(
    a,
    [
      { projectKey: 'other', title: '他书', blurb: b },
      { projectKey: 'far', title: '远', blurb: '完全不同的玄幻修仙飞升之路' },
    ],
    0.7,
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].otherProjectKey, 'other');
});

test('会话态：跳转后 pending，确认后 logged_in', () => {
  const a0 = account('a1');
  const jumped = markLoginJumped(a0, '2026-07-13T10:00:00.000Z');
  assert.equal(jumped.sessionStatus, 'pending');
  assert.equal(jumped.lastLoginJumpAt, '2026-07-13T10:00:00.000Z');
  const ok = markSessionLoggedIn(jumped, '2026-07-13T10:05:00.000Z');
  assert.equal(ok.sessionStatus, 'logged_in');
  assert.equal(ok.sessionConfirmedAt, '2026-07-13T10:05:00.000Z');
  assert.equal(
    isSessionStale(
      { sessionStatus: 'logged_in', sessionConfirmedAt: '2026-06-01T00:00:00.000Z' },
      Date.parse('2026-07-13T00:00:00.000Z'),
      14,
    ),
    true,
  );
});

test('空位不参与智能指派', () => {
  const accounts = [account('a1'), account('a2')];
  const books = [
    book('real', { status: 'ready', readyScore: 90 }),
    book('slot', {
      status: 'ready',
      isPlaceholder: true,
      path: 'placeholder://x',
      readyScore: 0,
    }),
  ];
  const result = autoAssignReadyBooks({
    books,
    accounts,
    quota: emptyMonthQuota('2026-07'),
    settings: DEFAULT_PUBLISH_SETTINGS,
    windowStart: '2026-07-14',
    windowDays: 7,
  });
  assert.ok(result.suggestions.every((s) => s.projectKey !== 'slot'));
  assert.ok(result.blockers.some((b) => b.projectKey === 'slot'));
});
