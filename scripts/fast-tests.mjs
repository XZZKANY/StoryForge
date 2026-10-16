/**
 * pre-push 快测集：前端单测 + TS 引擎类型检查与 golden 契约测试，只拦「主产品路径被改坏还被 push」；
 * 全量覆盖仍由 pnpm verify 承担。
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const gates = [
  {
    name: 'Desktop frontend 单元测试',
    command: 'npm',
    args: ['--prefix', 'apps/desktop/frontend', 'run', 'test'],
    cwd: root,
  },
  {
    name: 'TS engine 类型检查与 golden 契约测试',
    command: 'pnpm',
    args: ['run', 'test:engine'],
    cwd: root,
  },
];

for (const gate of gates) {
  console.log(`\n[fast-tests] ${gate.name}`);
  const result = spawnSync(gate.command, gate.args, {
    cwd: gate.cwd,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`[fast-tests] ${gate.name} 启动失败:${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[fast-tests] ${gate.name} 失败,退出码 ${result.status ?? 'unknown'}。`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n[fast-tests] 活路径快测集通过。');
