/**
 * 活路径快测集(pre-push 防线,修 F12):agent_runs / assistant / ide 命令 / llm 配置
 * 的 pytest 子集 + desktop 前端单测。目标总耗时 ~90s + 前端 ~15s;
 * 全量覆盖仍由 pnpm verify 承担,这里只拦「主产品路径被改坏还被 push」。
 * test_ide_agent_orchestrator(facade 兼容套件)不在此集,由 verify 全量覆盖。
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LIVE_PATH_PYTESTS = [
  'tests/test_agent_consistency_scan.py',
  'tests/test_agent_deep_consistency.py',
  'tests/test_agent_fs_tools.py',
  'tests/test_agent_llm_context.py',
  'tests/test_agent_loop_runtime.py',
  'tests/test_agent_runs.py',
  'tests/test_assistant_provider_health.py',
  'tests/test_assistant_revise.py',
  'tests/test_assistant_sessions.py',
  'tests/test_assistant_sessions_migration.py',
  'tests/test_assistant_tool_calls.py',
  'tests/test_ide_commands.py',
  'tests/test_ide_run_events.py',
  'tests/test_llm_config_file_override.py',
];

const gates = [
  {
    name: '活路径 pytest 快测集',
    command: 'uv',
    args: ['run', 'pytest', ...LIVE_PATH_PYTESTS, '-q'],
    cwd: resolve(root, 'apps/api'),
  },
  {
    name: 'Desktop frontend 单元测试',
    command: 'npm',
    args: ['--prefix', 'apps/desktop/frontend', 'run', 'test'],
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
