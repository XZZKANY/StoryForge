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
    // project-core 是全产品路径围栏（isPathInsideProject 等）的单一事实源；其自带
    // 围栏测试必须在门禁跑到，否则是断门禁的假安全信号。
    name: 'project-core 契约测试',
    command: 'pnpm',
    args: ['--filter', '@storyforge/project-core', 'test'],
    cwd: root,
  },
  {
    name: 'TS engine 类型检查与 golden 契约测试',
    command: 'pnpm',
    args: ['run', 'test:engine'],
    cwd: root,
  },
  {
    name: 'Desktop frontend 单元测试',
    command: 'npm',
    args: ['--prefix', 'apps/desktop/frontend', 'run', 'test'],
    cwd: root,
  },
  {
    name: 'Desktop 行间续写真实 Monaco 回归（隔离 FS/HTTP fixture）',
    command: 'npm',
    args: ['--prefix', 'apps/desktop/frontend', 'run', 'verify:inline-continuation'],
    cwd: root,
  },
  {
    // 这两条浏览器回归原先只在 apps/desktop 的 npm run verify 里，没进根门禁，P6-1a 起红了一阵才发现。
    name: 'Desktop 浏览器冒烟回归（隔离 FS/HTTP fixture）',
    command: 'npm',
    args: ['--prefix', 'apps/desktop/frontend', 'run', 'verify:smoke'],
    cwd: root,
  },
  {
    name: 'Desktop Agent 对话浏览器回归（隔离 FS/HTTP fixture）',
    command: 'npm',
    args: ['--prefix', 'apps/desktop/frontend', 'run', 'verify:agent-conversation'],
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
