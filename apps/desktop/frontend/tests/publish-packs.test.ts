import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  getPlatformPack,
  listPlatformPacks,
  listReadyPlatformPacks,
  resolvePlatformPack,
} from '../src/features/publish/packs';

test('registry 含 fanqie 与 qidian 骨架', () => {
  const all = listPlatformPacks();
  assert.ok(all.some((p) => p.id === 'fanqie' && p.ready));
  assert.ok(all.some((p) => p.id === 'qidian' && !p.ready));
  assert.equal(listReadyPlatformPacks().every((p) => p.ready), true);
});

test('resolve：未知 id 回退 fanqie；骨架默认不启用', () => {
  assert.equal(resolvePlatformPack('missing').id, 'fanqie');
  assert.equal(resolvePlatformPack('qidian').id, 'fanqie');
  assert.equal(resolvePlatformPack('qidian', { allowSkeleton: true }).id, 'qidian');
  assert.equal(resolvePlatformPack('fanqie').id, 'fanqie');
});

test('fanqie 白名单经 pack 接口', () => {
  const pack = getPlatformPack('fanqie')!;
  assert.equal(pack.isAllowedOpenUrl('https://fanqienovel.com/main/writer'), true);
  assert.equal(pack.isAllowedOpenUrl('https://evil.example/'), false);
  assert.ok(pack.authorHomeUrl.startsWith('https://'));
  assert.ok(pack.openPackReadme.includes('开书'));
});
