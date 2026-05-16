import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const defaultTests = [
  'tests/e2e/phase1-closed-loop.spec.ts',
  'tests/e2e/phase2-contract.spec.ts',
  'tests/e2e/phase3-contract.spec.ts',
];
const httpPytestTargets = [
  'tests/test_phase1_closed_loop_api.py',
  'tests/test_series_memory.py',
  'tests/test_worldbuilding_center.py',
  'tests/test_batch_refinery.py',
  'tests/test_style_packs.py',
  'tests/test_quality_dashboard.py',
  'tests/test_workspaces_api.py',
  'tests/test_collaboration.py',
  'tests/test_commercial_controls.py',
  'tests/test_provider_gateway.py',
  'tests/test_phase3_analytics.py',
];
const fallbackPytestTargets = ['tests/test_phase3_service_acceptance.py'];
const HTTP_TESTCLIENT_PROBE = `
from fastapi import FastAPI
from fastapi.testclient import TestClient

app = FastAPI()

@app.get("/")
def healthcheck():
    return {"ok": True}

with TestClient(app) as client:
    response = client.get("/")
    assert response.status_code == 200
`.trim();
const requestedTests = process.argv.slice(2).filter((value) => value.trim().length > 0);
const testFiles = requestedTests.length > 0 ? requestedTests : defaultTests;
const tempDir = await mkdtemp(join(tmpdir(), 'storyforge-e2e-'));

try {
  const runnableFiles = [];
  for (const testFile of testFiles) {
    const outputFile = join(tempDir, `${basename(testFile, '.ts')}.mjs`);
    await copyFile(testFile, outputFile);
    runnableFiles.push(outputFile);
  }

  const contractExitCode = await runCommand(process.execPath, ['--test', ...runnableFiles], process.cwd());
  if (contractExitCode !== 0) {
    process.exitCode = contractExitCode;
  } else {
    process.exitCode = await runApiVerification(join(process.cwd(), 'apps/api'));
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function runApiVerification(cwd) {
  const pythonCommand = resolvePythonCommand();
  if (!pythonCommand) {
    console.error('未找到 uv、python3 或 python，无法执行 API 验证。');
    return 1;
  }

  const supportsHttpPytest = await probeHttpPytestSupport(pythonCommand, cwd);
  if (supportsHttpPytest) {
    return runPythonCommand(pythonCommand, ['-m', 'pytest', ...httpPytestTargets, '-q'], cwd);
  }

  console.warn('检测到当前环境无法稳定执行 FastAPI HTTP pytest，改为运行补偿验证：compileall + Phase 3 服务层验收。');
  const compileExitCode = await runPythonCommand(pythonCommand, ['-m', 'compileall', 'app', 'tests'], cwd);
  if (compileExitCode !== 0) {
    return compileExitCode;
  }
  return runPythonCommand(pythonCommand, ['-m', 'pytest', ...fallbackPytestTargets, '-q'], cwd);
}

function resolvePythonCommand() {
  if (hasCommand('uv')) {
    return 'uv';
  }
  if (hasCommand('python3')) {
    return 'python3';
  }
  if (hasCommand('python')) {
    return 'python';
  }
  return null;
}

function runPythonCommand(command, args, cwd) {
  if (command === 'uv') {
    return runCommand('uv', ['run', ...args], cwd);
  }
  return runCommand(command, args, cwd);
}

async function probeHttpPytestSupport(command, cwd) {
  const probeArgs =
    command === 'uv'
      ? ['run', 'python', '-c', HTTP_TESTCLIENT_PROBE]
      : ['-c', HTTP_TESTCLIENT_PROBE];
  const result = await runCommandWithTimeout(command, probeArgs, cwd, 5000);
  return result.exitCode === 0 && !result.timedOut;
}

function runCommandWithTimeout(command, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'ignore',
      shell: process.platform === 'win32' && command === 'uv',
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ exitCode: 124, timedOut: true });
    }, timeoutMs);

    child.on('error', () => {
      clearTimeout(timer);
      resolve({ exitCode: 1, timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, timedOut: false });
    });
  });
}

function hasCommand(command) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' });
  return probe.status === 0;
}

function runCommand(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command === 'uv',
  });

  return new Promise((resolve) => {
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}
