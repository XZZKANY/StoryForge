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
    // project-core 是全产品路径围栏（isPathInsideProject 等）的单一事实源；其自带
    // 围栏测试必须在门禁跑到，否则是断门禁的假安全信号。
    name: 'project-core 契约测试',
    command: 'pnpm',
    args: ['--filter', '@storyforge/project-core', 'test'],
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
    name: 'Sidecar 交付形态冒烟(daily 档)',
    command: 'node',
    args: ['scripts/sidecar-smoke.mjs'],
    cwd: root,
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
    // drift 校验单实现：scripts/check-openapi-drift.mjs（刷新 + 漂移检查）
    name: 'OpenAPI 契约刷新与漂移检查',
    command: 'node',
    args: ['scripts/check-openapi-drift.mjs'],
    cwd: root,
  },
];

for (const gate of gates) {
  console.log(`\n[verify:local] ${gate.name}`);
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
