import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';

const defaultTests = [
  'tests/e2e/phase1-closed-loop.spec.ts',
  'tests/e2e/phase2-contract.spec.ts',
  'tests/e2e/phase3-contract.spec.ts',
  'tests/e2e/phase4-contract.spec.ts',
  'tests/e2e/phase5-runtime-diagnostics.spec.ts',
  'tests/e2e/ide-judge-repair.spec.ts',
];
const rawArgs = process.argv.slice(2).filter((value) => value.trim().length > 0);
const continueOnError = rawArgs.includes('--continue-on-error');
const requestedTests = rawArgs.filter((value) => value !== '--continue-on-error');
const testFiles = requestedTests.length > 0 ? requestedTests : defaultTests;
const tempDir = await mkdtemp(join(tmpdir(), 'storyforge-e2e-'));

function formatTimestamp() {
  return new Date().toISOString().slice(0, 19);
}

function log(level, message) {
  const leadingNewline = message.startsWith('\n') ? '\n' : '';
  const normalizedMessage = message.replace(/^\n+/, '');
  const output = `${leadingNewline}[${formatTimestamp()}] [${level}] ${normalizedMessage}`;
  if (level === 'ERROR') {
    console.error(output);
  } else {
    console.log(output);
  }
}

try {
  let finalExitCode = 0;
  const phaseResults = [];
  const rememberPhaseResult = (phase, exitCode) => {
    phaseResults.push({ phase, exitCode });
    if (exitCode !== 0 && finalExitCode === 0) {
      finalExitCode = exitCode;
    }
    return exitCode !== 0 && !continueOnError;
  };

  log('INFO', '\n[1/2] Refreshing OpenAPI contract and checking drift...');
  // drift 校验单实现：复用 scripts/check-openapi-drift.mjs（刷新 + 漂移检查一步完成）
  const driftExitCode = await runCommand(
    process.execPath,
    ['scripts/check-openapi-drift.mjs'],
    process.cwd(),
  );
  if (driftExitCode !== 0) {
    log('ERROR', `[1/2] OpenAPI refresh + drift check: FAILED (exit code ${driftExitCode})`);
  } else {
    log('INFO', '[1/2] OpenAPI refresh + drift check: PASSED');
  }
  const shouldStop = rememberPhaseResult('OpenAPI refresh + drift check', driftExitCode);

  if (!shouldStop) {
    const runnableFiles = [];
    for (const testFile of testFiles) {
      const outputFile = join(tempDir, `${basename(testFile, '.ts')}.mjs`);
      await copyFile(testFile, outputFile);
      runnableFiles.push(outputFile);
    }

    log('INFO', `\n[2/2] Running contract tests (${runnableFiles.length} specs)...`);
    const contractExitCode = await runCommand(
      process.execPath,
      ['--test', ...runnableFiles],
      process.cwd(),
    );
    if (contractExitCode !== 0) {
      log('ERROR', `[2/2] Contract tests: FAILED (exit code ${contractExitCode})`);
    } else {
      log('INFO', '[2/2] Contract tests: PASSED');
    }
    rememberPhaseResult('Contract tests', contractExitCode);
  }

  if (continueOnError) {
    printPhaseSummary(phaseResults);
  }
  process.exitCode = finalExitCode;
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function printPhaseSummary(phaseResults) {
  log('INFO', '\nE2E phase summary:');
  log('INFO', '| Phase | Result | Exit code |');
  log('INFO', '| --- | --- | --- |');
  for (const { phase, exitCode } of phaseResults) {
    const result = exitCode === 0 ? 'PASSED' : 'FAILED';
    log('INFO', `| ${phase} | ${result} | ${exitCode} |`);
  }
}

function runCommand(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
  });

  return new Promise((resolve) => {
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}
