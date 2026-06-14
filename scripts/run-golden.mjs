import { spawnSync } from 'node:child_process';

// Golden 回测包装器：在 apps/api 下用 uv 跑确定性回测模块。
// 无回归退出 0，有回归退出 1，便于 CI 卡回归阈值。
const args = process.argv.slice(2);
const result = spawnSync(
  'uv',
  ['run', 'python', '-m', 'app.domains.book_runs.golden_regression', ...args],
  { cwd: 'apps/api', stdio: 'inherit', shell: process.platform === 'win32' },
);

process.exit(result.status ?? 1);
