/**
 * live API 面的契约闸。
 *
 * 2026-10 卸掉 16 个桌面端零调用的 router 后，phase1-5 的阶段契约断言随其对象一并退役
 * （见 app/domains/DOMAINS.md）。这里保留原 Phase 7 那条检查的机制——仓库快照与运行时
 * app.openapi() 必须逐字节一致——但把对象换成桌面端真正调用的三个前缀，顺便把「/api 下
 * 不得冒出第四个前缀」钉死在契约层（后端侧同一不变量见 tests/test_api_surface.py）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const openapi = JSON.parse(
  readFileSync('packages/shared/src/contracts/storyforge.openapi.json', 'utf8'),
);

const LIVE_PREFIXES = ['/api/agent-runs', '/api/assistant', '/api/ide'];

function runApiPythonJson(script) {
  const tempDir = mkdtempSync(join(tmpdir(), 'storyforge-live-surface-'));
  const scriptPath = join(tempDir, 'dump-live-openapi.py');
  try {
    writeFileSync(
      scriptPath,
      `import sys\nfrom pathlib import Path\nsys.path.insert(0, str(Path.cwd()))\n${script.trim()}\n`,
      'utf8',
    );
    const result = spawnSync('uv', ['run', 'python', scriptPath], {
      cwd: 'apps/api',
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(readLastJsonLine(result.stdout));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function readLastJsonLine(stdout) {
  const lines = stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastJson = [...lines].reverse().find((line) => line.startsWith('{'));
  assert.ok(lastJson, `未从 stdout 取到 JSON：${stdout}`);
  return lastJson;
}

function apiPrefixes(spec) {
  return [
    ...new Set(
      Object.keys(spec.paths)
        .filter((path) => path.startsWith('/api/'))
        .map((path) => `/api/${path.slice('/api/'.length).split('/')[0]}`),
    ),
  ].sort();
}

test('契约快照只暴露桌面端调用的三个 /api 前缀', () => {
  assert.deepEqual(apiPrefixes(openapi), [...LIVE_PREFIXES].sort());
});

test('运行时 app 的 /api 面与契约快照逐路径一致', () => {
  const live = runApiPythonJson(`
import json
from app.main import app
print(json.dumps(app.openapi(), ensure_ascii=False, sort_keys=True))
`);

  assert.deepEqual(apiPrefixes(live), [...LIVE_PREFIXES].sort());

  const livePaths = Object.keys(live.paths)
    .filter((path) => path.startsWith('/api/'))
    .sort();
  const snapshotPaths = Object.keys(openapi.paths)
    .filter((path) => path.startsWith('/api/'))
    .sort();
  assert.deepEqual(livePaths, snapshotPaths, '运行时路由与契约快照路径集合不一致');

  for (const path of livePaths) {
    assert.deepEqual(live.paths[path], openapi.paths[path], `${path} 的契约与快照不一致`);
  }
});
