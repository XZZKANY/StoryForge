import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const scriptPath = resolve(process.cwd(), 'scripts/measure-ide-build-budget.mjs');

function writeFixtureFile(root: string, relativePath: string, content: string): void {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

test('IDE 构建预算脚本按 /ide/page manifest 统计首屏 chunk gzip 并写入报告', () => {
  const tempRoot = mkdtempSync(join(process.cwd(), '.tmp-ide-build-budget-'));
  try {
    const nextDir = join(tempRoot, '.next');
    const reportPath = join(tempRoot, 'ide-build-baseline.json');
    const chunks = [
      'static/chunks/webpack-test.js',
      'static/chunks/main-app-test.js',
      'static/chunks/app/ide/page-test.js',
      'static/css/ide-test.css',
    ];
    writeFixtureFile(
      nextDir,
      'app-build-manifest.json',
      JSON.stringify({
        pages: { '/ide/page': chunks, '/studio/page': ['static/chunks/app/studio/page.js'] },
      }),
    );
    writeFixtureFile(nextDir, chunks[0], 'const runtime = "webpack";'.repeat(80));
    writeFixtureFile(nextDir, chunks[1], 'const main = "app";'.repeat(90));
    writeFixtureFile(nextDir, chunks[2], 'export const ide = "shell";'.repeat(110));
    writeFixtureFile(nextDir, chunks[3], '.ide{color:#fff;}'.repeat(70));

    const expectedGzipBytes = chunks.reduce((total, chunk) => {
      const content = readFileSync(join(nextDir, chunk));
      return total + gzipSync(content).byteLength;
    }, 0);

    const result = spawnSync(
      process.execPath,
      [scriptPath, '--next-dir', nextDir, '--out', reportPath, '--route', '/ide/page'],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(existsSync(reportPath), '脚本必须写入 JSON 基线报告');
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      route: string;
      bundle: {
        totalGzipBytes: number;
        targetGzipBytes: number;
        blockingGzipBytes: number;
        status: string;
        chunks: readonly { readonly path: string; readonly gzipBytes: number }[];
      };
    };

    assert.equal(report.route, '/ide/page');
    assert.equal(report.bundle.targetGzipBytes, 600 * 1024);
    assert.equal(report.bundle.blockingGzipBytes, 900 * 1024);
    assert.equal(report.bundle.totalGzipBytes, expectedGzipBytes);
    assert.equal(report.bundle.status, 'pass');
    assert.deepEqual(
      report.bundle.chunks.map((chunk) => chunk.path),
      chunks,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('IDE 构建预算脚本在 manifest 缺少 /ide/page 时明确失败', () => {
  const tempRoot = mkdtempSync(join(process.cwd(), '.tmp-ide-build-budget-missing-'));
  try {
    const nextDir = join(tempRoot, '.next');
    mkdirSync(nextDir, { recursive: true });
    writeFileSync(join(nextDir, 'app-build-manifest.json'), JSON.stringify({ pages: {} }), 'utf8');

    const result = spawnSync(
      process.execPath,
      [scriptPath, '--next-dir', nextDir, '--route', '/ide/page'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /缺少 \/ide\/page/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
