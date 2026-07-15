import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  buildCoverArticleBody,
  buildNewArticleBody,
  buildPublishArticleBody,
  parseDraftListItemId,
  parseNewArticleItemId,
  parseStepResult,
  type FanqiePublishParams,
} from '../src/features/publish/packs/fanqie/publish-flow';
import {
  canPublishDirect,
  isCsrfStale,
  markCsrfCaptured,
  type PublishAccount,
} from '../src/features/publish/model';

const PARAMS: FanqiePublishParams = {
  bookId: '7659694677754399769',
  volumeId: 'v1',
  volumeName: '第一卷',
  title: '第1章 觉醒',
  contentHtml: '<p>正文</p>',
};

function decode(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

test('buildNewArticleBody：公共字段 + need_reuse', () => {
  const f = decode(buildNewArticleBody(PARAMS.bookId));
  assert.equal(f.aid, '2503');
  assert.equal(f.app_name, 'muye_novel');
  assert.equal(f.book_id, PARAMS.bookId);
  assert.equal(f.need_reuse, '1');
});

test('buildCoverArticleBody：带 item_id/title/content/卷信息', () => {
  const f = decode(buildCoverArticleBody(PARAMS, 'item123'));
  assert.equal(f.item_id, 'item123');
  assert.equal(f.title, PARAMS.title);
  assert.equal(f.content, PARAMS.contentHtml);
  assert.equal(f.volume_id, 'v1');
  assert.equal(f.volume_name, '第一卷');
  assert.equal(f.book_id, PARAMS.bookId);
});

test('buildPublishArticleBody：发布态字段对齐 webview 版本', () => {
  const f = decode(buildPublishArticleBody(PARAMS, 'item123'));
  assert.equal(f.item_id, 'item123');
  assert.equal(f.publish_status, '1');
  assert.equal(f.timer_status, '0');
  assert.equal(f.need_pay, '0');
  assert.equal(f.device_platform, 'pc');
  assert.equal(f.use_ai, '2');
  assert.equal(f.timer_chapter_preview, '[]');
  assert.equal(f.has_chapter_ad, 'false');
});

test('中文/HTML 内容 form 编码正确（round-trip 不丢字符）', () => {
  const params: FanqiePublishParams = {
    ...PARAMS,
    title: '第2章 「引号」& 符号',
    contentHtml: '<p>中文段落，含 & = ? 特殊字符</p>',
  };
  const f = decode(buildCoverArticleBody(params, 'x'));
  assert.equal(f.title, '第2章 「引号」& 符号');
  assert.equal(f.content, '<p>中文段落，含 & = ? 特殊字符</p>');
});

test('parseNewArticleItemId：直取 data.item_id 或 data.column_data.item_id', () => {
  assert.equal(parseNewArticleItemId('{"code":0,"data":{"item_id":"111"}}'), '111');
  assert.equal(
    parseNewArticleItemId('{"code":0,"data":{"column_data":{"item_id":"222"}}}'),
    '222',
  );
  assert.equal(parseNewArticleItemId('{"code":0,"data":{}}'), '');
  assert.equal(parseNewArticleItemId('not json'), '');
});

test('parseDraftListItemId：取列表首条 item_id/chapter_id，空列表返回空', () => {
  assert.equal(
    parseDraftListItemId('{"code":0,"data":{"draft_list":[{"item_id":"333"}]}}'),
    '333',
  );
  assert.equal(parseDraftListItemId('{"code":0,"data":{"list":[{"chapter_id":"444"}]}}'), '444');
  assert.equal(parseDraftListItemId('{"code":0,"data":{"draft_list":[]}}'), '');
  assert.equal(parseDraftListItemId('garbage'), '');
});

test('parseStepResult：仅 HTTP200 + code:0 为成功，其它诚实失败', () => {
  assert.deepEqual(parseStepResult(200, '{"code":0,"message":"ok"}'), {
    ok: true,
    code: 0,
    message: 'ok',
  });
  assert.deepEqual(parseStepResult(200, '{"code":3010,"message":"重复章节"}'), {
    ok: false,
    code: 3010,
    message: '重复章节',
  });
  assert.deepEqual(parseStepResult(403, ''), { ok: false, code: null, message: 'HTTP 403' });
  assert.deepEqual(parseStepResult(200, '<html>登录</html>'), {
    ok: false,
    code: null,
    message: '返回非预期 JSON',
  });
});

function account(overrides: Partial<PublishAccount> = {}): PublishAccount {
  return {
    id: 'acc1',
    penName: '笔名1',
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
    csrfToken: '',
    csrfCapturedAt: null,
    ...overrides,
  };
}

test('canPublishDirect：需 Cookie + csrf 令牌俱全', () => {
  assert.equal(canPublishDirect(account({ csrfToken: 'tok' })), true);
  assert.equal(canPublishDirect(account({ csrfToken: '' })), false);
  assert.equal(canPublishDirect(account({ cookieText: '', csrfToken: 'tok' })), false);
  assert.equal(canPublishDirect(account({ cookieText: '  ', csrfToken: 'tok' })), false);
});

test('markCsrfCaptured：写入令牌与时间戳', () => {
  const at = '2026-07-15T04:00:00.000Z';
  const next = markCsrfCaptured(account(), 'tok-xyz', at);
  assert.equal(next.csrfToken, 'tok-xyz');
  assert.equal(next.csrfCapturedAt, at);
});

test('isCsrfStale：超 3 天判偏旧；无令牌不判旧', () => {
  const now = Date.parse('2026-07-15T00:00:00.000Z');
  assert.equal(
    isCsrfStale(account({ csrfToken: 'tok', csrfCapturedAt: '2026-07-10T00:00:00.000Z' }), now),
    true,
  );
  assert.equal(
    isCsrfStale(account({ csrfToken: 'tok', csrfCapturedAt: '2026-07-14T00:00:00.000Z' }), now),
    false,
  );
  assert.equal(isCsrfStale(account({ csrfToken: '', csrfCapturedAt: null }), now), false);
});
