#!/usr/bin/env node

/**
 * dev-start.mjs
 *
 * 启动 StoryForge API sidecar（用于单独测试 API）
 *
 * 注意：正常开发使用 `pnpm dev` 或 `pnpm desktop:dev`，
 * Tauri 会自动启动 sidecar。此脚本仅用于需要单独运行 API 的场景。
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

console.log('📦 启动 StoryForge API sidecar...\n');

// 检查是否在 Windows 上
const isWindows = process.platform === 'win32';

// 启动 API sidecar
const pythonCmd = isWindows ? 'python' : 'python3';
const apiProcess = spawn(pythonCmd, ['apps/api/scripts/run_windows.py'], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    // 使用 sqlite，不需要外部数据库
    STORYFORGE_DATABASE_URL: 'sqlite:///./storyforge_dev.db',
  },
});

apiProcess.on('error', (error) => {
  console.error('❌ 启动 API 失败:', error);
  process.exit(1);
});

apiProcess.on('exit', (code) => {
  if (code !== 0) {
    console.error(`❌ API 进程退出，代码: ${code}`);
    process.exit(code || 1);
  }
});

// 处理 Ctrl+C
process.on('SIGINT', () => {
  console.log('\n📦 正在停止 API...');
  apiProcess.kill();
  process.exit(0);
});

console.log('✅ API sidecar 已启动');
console.log('📝 API 文档: http://localhost:8000/docs');
console.log('🔍 健康检查: http://localhost:8000/health/ready');
console.log('\n按 Ctrl+C 停止服务\n');
