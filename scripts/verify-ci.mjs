import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const gates = [
  {
    name: '根静态检查与格式检查',
    command: 'pnpm',
    args: ['run', 'lint'],
    cwd: root,
  },
  {
    name: 'Web 类型检查',
    command: 'pnpm',
    args: ['--filter', '@storyforge/web', 'lint'],
    cwd: root,
  },
  {
    name: 'Shared 契约测试',
    command: 'pnpm',
    args: ['--filter', '@storyforge/shared', 'test'],
    cwd: root,
  },
  {
    name: 'Web 契约测试',
    command: 'pnpm',
    args: ['--filter', '@storyforge/web', 'test'],
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
    name: '刷新 OpenAPI 契约',
    command: 'pnpm',
    args: ['openapi'],
    cwd: root,
  },
  {
    name: '检查 OpenAPI 契约漂移',
    command: 'git',
    args: ['diff', '--exit-code', '--', 'packages/shared/src/contracts/storyforge.openapi.json'],
    cwd: root,
  },
];

for (const gate of gates) {
  console.log(`\n[verify:ci] ${gate.name}`);
  console.log(`[verify:ci] $ ${gate.command} ${gate.args.join(' ')}`);
  const result = spawnSync(gate.command, gate.args, {
    cwd: gate.cwd,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`[verify:ci] ${gate.name} 启动失败：${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[verify:ci] ${gate.name} 失败，退出码 ${result.status ?? 'unknown'}。`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n[verify:ci] 所有核心门禁通过。');
