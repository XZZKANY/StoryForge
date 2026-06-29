import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = resolve(
  root,
  'packages',
  'shared',
  'src',
  'contracts',
  'storyforge.openapi.json',
);

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const before = digest(contractPath);

console.log('[check:drift] 刷新 OpenAPI 契约...');
const result = spawnSync('pnpm', ['openapi'], {
  cwd: root,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error) {
  console.error(`[check:drift] 刷新启动失败：${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`[check:drift] OpenAPI 刷新失败，退出码 ${result.status ?? 'unknown'}。`);
  process.exit(result.status ?? 1);
}

const after = digest(contractPath);
if (before !== after) {
  console.error(
    '[check:drift] OpenAPI 契约已漂移。请提交刷新后的 packages/shared/src/contracts/storyforge.openapi.json。',
  );
  process.exit(1);
}

console.log('[check:drift] OpenAPI 契约无漂移。');
