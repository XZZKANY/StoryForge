import assert from 'node:assert/strict';
import { test } from 'vitest';

import { checkForUpdate, compareVersions, parseVersionTag } from '../src/lib/update-check';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

test('版本 tag 解析：只认 vX.Y.Z，其余（预发布/乱名）跳过', () => {
  assert.deepEqual(parseVersionTag('v0.1.3'), [0, 1, 3]);
  assert.deepEqual(parseVersionTag('v10.2.0'), [10, 2, 0]);
  assert.equal(parseVersionTag('v0.1'), null);
  assert.equal(parseVersionTag('0.1.3-beta'), null);
  assert.equal(parseVersionTag('release-1'), null);
  assert.equal(compareVersions([0, 2, 0], [0, 1, 9]) > 0, true);
  assert.equal(compareVersions([1, 0, 0], [1, 0, 0]), 0);
});

test('有更高 tag 时报告 update-available，取数值最大而非列表首位', async () => {
  const result = await checkForUpdate(
    '0.1.3',
    fakeFetch(200, [{ name: 'v0.1.2' }, { name: 'v0.2.0' }, { name: 'v0.1.4' }, { name: 'junk' }]),
  );
  assert.deepEqual(result, { kind: 'update-available', current: 'v0.1.3', latest: 'v0.2.0' });
});

test('当前即最新 → up-to-date；接口非 2xx / 网络异常 → error 降级不抛', async () => {
  assert.deepEqual(await checkForUpdate('0.2.0', fakeFetch(200, [{ name: 'v0.2.0' }])), {
    kind: 'up-to-date',
    current: 'v0.2.0',
  });

  const rateLimited = await checkForUpdate('0.1.3', fakeFetch(403, { message: 'rate limit' }));
  assert.equal(rateLimited.kind, 'error');

  const offline = await checkForUpdate('0.1.3', (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch);
  assert.equal(offline.kind, 'error');

  const noTags = await checkForUpdate('0.1.3', fakeFetch(200, [{ name: 'nightly' }]));
  assert.equal(noTags.kind, 'error');
});
