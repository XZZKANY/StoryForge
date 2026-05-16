import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const defaultTests = ['tests/e2e/phase1-closed-loop.spec.ts', 'tests/e2e/phase2-contract.spec.ts'];
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
    const pytestTargets = [
      'tests/test_phase1_closed_loop_api.py',
      'tests/test_series_memory.py',
      'tests/test_worldbuilding_center.py',
      'tests/test_batch_refinery.py',
      'tests/test_style_packs.py',
      'tests/test_quality_dashboard.py',
    ];
    process.exitCode = await runPytest(pytestTargets, join(process.cwd(), 'apps/api'));
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function runPytest(pytestTargets, cwd) {
  if (hasCommand('uv')) {
    return runCommand('uv', ['run', 'pytest', ...pytestTargets, '-q'], cwd);
  }
  if (hasCommand('python3')) {
    return runCommand('python3', ['-m', 'pytest', ...pytestTargets, '-q'], cwd);
  }
  if (hasCommand('python')) {
    return runCommand('python', ['-m', 'pytest', ...pytestTargets, '-q'], cwd);
  }
  console.error('未找到 uv、python3 或 python，无法执行 API pytest。');
  return 1;
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
