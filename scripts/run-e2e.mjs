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

  const child = spawn(process.execPath, ['--test', ...runnableFiles], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
  });

  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
  });

  process.exitCode = exitCode ?? 1;
} finally {
  await rm(tempDir, { recursive: true, force: true });
}