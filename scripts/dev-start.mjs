#!/usr/bin/env node
// StoryForge 本地开发一键启动脚本。
//
// 用法：
//   node scripts/dev-start.mjs              启动基础服务 + API + Web
//   node scripts/dev-start.mjs --api-only   只启动基础服务 + API
//   node scripts/dev-start.mjs --web-only   只启动基础服务 + Web
//   node scripts/dev-start.mjs --skip-docker 跳过 docker compose，假设服务已起
//   node scripts/dev-start.mjs --skip-migrate 跳过 alembic 迁移
//
// 退出条件：Ctrl+C 触发后向所有子进程发送 SIGINT，等待优雅退出。

import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const apiRoot = join(root, 'apps', 'api');

const args = new Set(process.argv.slice(2));
const flags = {
  apiOnly: args.has('--api-only'),
  webOnly: args.has('--web-only'),
  skipDocker: args.has('--skip-docker'),
  skipMigrate: args.has('--skip-migrate'),
  help: args.has('-h') || args.has('--help'),
};

if (flags.help) {
  console.log(`Usage: node scripts/dev-start.mjs [options]

Options:
  --api-only       仅启动基础服务和 API（不启 Web dev server）
  --web-only       仅启动基础服务和 Web（不启 API dev server）
  --skip-docker    跳过 docker compose 启动（前提：postgres/redis 已就绪）
  --skip-migrate   跳过 alembic upgrade head
  -h, --help       显示本帮助
`);
  process.exit(0);
}

if (flags.apiOnly && flags.webOnly) {
  console.error('[dev-start] --api-only 与 --web-only 互斥。');
  process.exit(1);
}

const launched = [];
let shuttingDown = false;

function ts() {
  return new Date().toISOString().slice(11, 19);
}

function info(msg) {
  console.log(`[${ts()}] [dev-start] ${msg}`);
}

function warn(msg) {
  console.warn(`[${ts()}] [dev-start] WARN ${msg}`);
}

function fail(msg) {
  console.error(`[${ts()}] [dev-start] ERROR ${msg}`);
}

function commandExists(cmd) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
    stdio: 'ignore',
  });
  return probe.status === 0;
}

function runForeground(command, cmdArgs, cwd, label) {
  const result = spawnSync(command, cmdArgs, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${label} 执行失败（退出码 ${result.status ?? 'unknown'}）。`);
  }
}

function spawnBackground(command, cmdArgs, cwd, label) {
  const child = spawn(command, cmdArgs, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const why = signal ? `信号 ${signal}` : `退出码 ${code}`;
    warn(`${label} 已退出（${why}）。`);
    if (code && code !== 0) {
      shutdown(code);
    }
  });
  launched.push({ child, label });
  return child;
}

async function waitForTcp(host, port, label, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolveProbe) => {
      const socket = net.createConnection({ host, port });
      socket.setTimeout(1000);
      socket.once('connect', () => {
        socket.destroy();
        resolveProbe(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolveProbe(false);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolveProbe(false);
      });
    });
    if (ok) return true;
    await delay(1000);
  }
  throw new Error(`${label} 未在 ${timeoutMs / 1000}s 内可达（${host}:${port}）。`);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (launched.length === 0) {
    process.exit(code);
  }
  info('正在停止子进程…');
  for (const { child, label } of launched) {
    try {
      if (!child.killed) {
        child.kill(process.platform === 'win32' ? 'SIGTERM' : 'SIGINT');
        info(`已向 ${label} 发送停止信号。`);
      }
    } catch (err) {
      warn(`停止 ${label} 时出错：${err.message}`);
    }
  }
  setTimeout(() => process.exit(code), 5000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  info(`项目根目录：${root}`);

  if (!commandExists('uv')) {
    fail('未找到 uv（Python 依赖管理器），请参考 https://github.com/astral-sh/uv 安装。');
    process.exit(1);
  }
  if (!commandExists('pnpm')) {
    fail('未找到 pnpm，请先安装 pnpm 9.x。');
    process.exit(1);
  }

  if (!flags.skipDocker) {
    if (!commandExists('docker')) {
      fail('未找到 docker，请安装 Docker 或使用 --skip-docker 跳过基础服务启动。');
      process.exit(1);
    }
    info('启动基础服务：postgres、redis、minio…');
    runForeground(
      'docker',
      ['compose', 'up', '-d', 'postgres', 'redis', 'minio'],
      root,
      'docker compose up',
    );
    info('等待 postgres 5432 端口可达…');
    await waitForTcp('127.0.0.1', 55432, 'postgres');
    info('等待 redis 6379 端口可达…');
    await waitForTcp('127.0.0.1', 6379, 'redis');
    info('基础服务已就绪。');
  } else {
    info('已跳过 docker compose（--skip-docker）。');
  }

  if (!flags.skipMigrate && !flags.webOnly) {
    info('执行 alembic upgrade head…');
    runForeground('uv', ['run', 'alembic', 'upgrade', 'head'], apiRoot, 'alembic upgrade head');
  } else if (flags.skipMigrate) {
    info('已跳过数据库迁移（--skip-migrate）。');
  }

  if (!flags.webOnly) {
    info('启动 API dev server（uvicorn :8000）…');
    spawnBackground(
      'uv',
      ['run', 'uvicorn', 'app.main:app', '--reload', '--host', '127.0.0.1', '--port', '8000'],
      apiRoot,
      'api',
    );
  }

  if (!flags.apiOnly) {
    info('启动 Web dev server（next dev :3000）…');
    spawnBackground('pnpm', ['--filter', '@storyforge/web', 'dev'], root, 'web');
  }

  if (launched.length === 0) {
    info('未启动任何长进程，任务结束。');
    return;
  }

  info('全部进程已启动，按 Ctrl+C 退出。');
}

try {
  await main();
} catch (err) {
  fail(err.message);
  shutdown(1);
}
