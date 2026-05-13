import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';

const defaultTests = ['tests/e2e/phase1-closed-loop.spec.ts'];
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
    process.exitCode = await runCommand(
      'uv',
      ['run', 'pytest', 'tests/test_phase1_closed_loop_api.py', '-q'],
      join(process.cwd(), 'apps/api'),
    );
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
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
