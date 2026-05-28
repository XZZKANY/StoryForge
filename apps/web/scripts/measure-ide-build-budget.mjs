#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const bundleTargetGzipBytes = 600 * 1024;
const bundleBlockingGzipBytes = 900 * 1024;
const ttiTargetMs = 1500;
const ttiBlockingMs = 2500;

function parseArgs(argv) {
  const args = {
    nextDir: resolve(process.cwd(), '.next'),
    out: resolve(process.cwd(), '../../.codex/ide-build-baseline.json'),
    route: '/ide/page',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--next-dir' && value) {
      args.nextDir = resolve(value);
      index += 1;
      continue;
    }
    if (name === '--out' && value) {
      args.out = resolve(value);
      index += 1;
      continue;
    }
    if (name === '--route' && value) {
      args.route = value;
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${name}`);
  }
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assertManifestRoute(manifest, route) {
  const pages = manifest.pages;
  if (!pages || typeof pages !== 'object') {
    throw new Error('app-build-manifest.json 缺少 pages 字段');
  }
  const chunks = pages[route];
  if (!Array.isArray(chunks)) {
    const available = Object.keys(pages).sort().join(', ') || '无';
    throw new Error(`app-build-manifest.json 缺少 ${route}，可用路由：${available}`);
  }
  return chunks;
}

function classifyBudget(value, target, blocking) {
  if (value > blocking) return 'block';
  if (value > target) return 'warn';
  return 'pass';
}

function measureChunk(nextDir, chunkPath) {
  const absolutePath = join(nextDir, chunkPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`manifest 引用的 chunk 不存在：${chunkPath}`);
  }
  const content = readFileSync(absolutePath);
  return {
    path: chunkPath,
    bytes: content.byteLength,
    gzipBytes: gzipSync(content).byteLength,
  };
}

function measureBuildBudget({ nextDir, route }) {
  const manifestPath = join(nextDir, 'app-build-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`缺少 Next 构建清单：${manifestPath}`);
  }

  const start = performance.now();
  const manifest = readJson(manifestPath);
  const chunkPaths = assertManifestRoute(manifest, route);
  const chunks = chunkPaths.map((chunkPath) => measureChunk(nextDir, chunkPath));
  const totalGzipBytes = chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0);
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
  const manifestReadMs = performance.now() - start;

  return {
    generatedAt: new Date().toISOString(),
    route,
    method:
      'Next app-build-manifest 首屏 chunk gzip；TTI 为本地构建清单读取代理指标，不等同真实浏览器 TTI。',
    bundle: {
      totalBytes,
      totalGzipBytes,
      totalGzipKb: Number((totalGzipBytes / 1024).toFixed(2)),
      targetGzipBytes: bundleTargetGzipBytes,
      blockingGzipBytes: bundleBlockingGzipBytes,
      status: classifyBudget(totalGzipBytes, bundleTargetGzipBytes, bundleBlockingGzipBytes),
      chunks,
    },
    ttiProxy: {
      name: '/ide build manifest read proxy',
      durationMs: Number(manifestReadMs.toFixed(3)),
      targetMs: ttiTargetMs,
      blockingMs: ttiBlockingMs,
      status: classifyBudget(manifestReadMs, ttiTargetMs, ttiBlockingMs),
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = measureBuildBudget(args);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `IDE 构建预算：${report.route} gzip ${report.bundle.totalGzipKb}KB，状态 ${report.bundle.status}，报告 ${args.out}`,
  );
  if (report.bundle.status === 'block' || report.ttiProxy.status === 'block') {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`IDE 构建预算测量失败：${message}`);
  process.exitCode = 1;
}
