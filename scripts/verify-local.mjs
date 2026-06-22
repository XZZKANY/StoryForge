import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const openApiContractPath = resolve(
  root,
  'packages',
  'shared',
  'src',
  'contracts',
  'storyforge.openapi.json',
);
let openApiDigestBeforeRefresh = '';

function readFileDigest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const gates = [
  {
    name: '根静态检查与格式检查',
    command: 'pnpm',
    args: ['run', 'lint'],
    cwd: root,
  },
  {
    name: 'Desktop frontend 类型检查',
    command: 'npm',
    args: ['--prefix', 'apps/desktop/frontend', 'run', 'typecheck'],
    cwd: root,
  },
  {
    name: 'Shared 契约测试',
    command: 'pnpm',
    args: ['--filter', '@storyforge/shared', 'test'],
    cwd: root,
  },
  {
    name: 'Desktop frontend 单元测试',
    command: 'npm',
    args: ['--prefix', 'apps/desktop/frontend', 'run', 'test'],
    cwd: root,
  },
  {
    name: 'API 单元测试',
    command: 'uv',
    args: ['run', 'pytest'],
    cwd: resolve(root, 'apps/api'),
  },
  {
    name: 'API Ruff 检查',
    command: 'uv',
    args: ['run', 'ruff', 'check', '.'],
    cwd: resolve(root, 'apps/api'),
  },
  {
    name: 'Workflow 单元测试',
    command: 'uv',
    args: ['run', 'pytest'],
    cwd: resolve(root, 'apps/workflow'),
  },
  {
    name: 'Workflow Ruff 检查',
    command: 'uv',
    args: ['run', 'ruff', 'check', '.'],
    cwd: resolve(root, 'apps/workflow'),
  },
  {
    name: '记录 OpenAPI 契约快照',
    run() {
      openApiDigestBeforeRefresh = readFileDigest(openApiContractPath);
    },
  },
  {
    name: '刷新 OpenAPI 契约',
    command: 'pnpm',
    args: ['openapi'],
    cwd: root,
  },
  {
    name: '检查 OpenAPI 契约漂移',
    run() {
      const openApiDigestAfterRefresh = readFileDigest(openApiContractPath);
      if (openApiDigestAfterRefresh !== openApiDigestBeforeRefresh) {
        console.error(
          "[verify:local] OpenAPI contract is stale. Run 'pnpm run openapi' and commit packages/shared/src/contracts/storyforge.openapi.json.",
        );
        process.exit(1);
      }
    },
  },
];

for (const gate of gates) {
  console.log(`\n[verify:local] ${gate.name}`);
  if ('run' in gate) {
    gate.run();
    continue;
  }

  console.log(`[verify:local] $ ${gate.command} ${gate.args.join(' ')}`);
  const result = spawnSync(gate.command, gate.args, {
    cwd: gate.cwd,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`[verify:local] ${gate.name} 启动失败：${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[verify:local] ${gate.name} 失败，退出码 ${result.status ?? 'unknown'}。`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n[verify:local] 所有本地核心门禁通过。');
