import { mkdtemp, copyFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const defaultTests = [
  'tests/e2e/phase1-closed-loop.spec.ts',
  'tests/e2e/phase2-contract.spec.ts',
  'tests/e2e/phase3-contract.spec.ts',
  'tests/e2e/phase4-contract.spec.ts',
  'tests/e2e/phase5-runtime-diagnostics.spec.ts',
  'tests/e2e/ide-shell.spec.ts',
  'tests/e2e/ide-judge-repair.spec.ts',
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
  'tests/test_retrieval_index.py',
  'tests/test_scene_packet_retrieval_upgrade.py',
  'tests/test_prompt_packs.py',
  'tests/test_model_runs.py',
  'tests/test_runtime_tools.py',
  'tests/test_artifacts.py',
  'tests/test_evaluations.py',
  'tests/test_job_runtime_bridge.py',
];
const workflowPytestTargets = [
  'tests/test_generation_graph.py',
  'tests/test_runtime_runner.py',
  'tests/test_workflow_session.py',
  'tests/test_workflow_lifecycle.py',
  'tests/test_provider_adapter.py',
  'tests/test_provider_parity_harness.py',
  'tests/test_creative_tool_registry.py',
];
const rawArgs = process.argv.slice(2).filter((value) => value.trim().length > 0);
const continueOnError = rawArgs.includes('--continue-on-error');
const requestedTests = rawArgs.filter((value) => value !== '--continue-on-error');
const testFiles = requestedTests.length > 0 ? requestedTests : defaultTests;
const openApiContractPath = 'packages/shared/src/contracts/storyforge.openapi.json';
const tempDir = await mkdtemp(join(tmpdir(), 'storyforge-e2e-'));
const openApiContractBaselinePath = join(tempDir, basename(openApiContractPath));

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

  await copyFile(openApiContractPath, openApiContractBaselinePath);

  log('INFO', '\n[1/4] Refreshing OpenAPI contract...');
  const refreshExitCode = await refreshOpenApiContract(process.cwd(), tempDir);
  if (refreshExitCode !== 0) {
    log('ERROR', `[1/4] OpenAPI contract refresh: FAILED (exit code ${refreshExitCode})`);
  } else {
    log('INFO', '[1/4] OpenAPI contract refresh: PASSED');
  }
  let shouldStop = rememberPhaseResult('OpenAPI contract refresh', refreshExitCode);
  if (!shouldStop && refreshExitCode === 0) {
    log('INFO', '[1/4] Checking OpenAPI contract drift...');
    const driftExitCode = await checkOpenApiContractDrift(
      process.cwd(),
      openApiContractBaselinePath,
    );
    if (driftExitCode !== 0) {
      log('ERROR', '[1/4] OpenAPI contract drift check: FAILED');
    } else {
      log('INFO', '[1/4] OpenAPI contract drift check: PASSED');
    }
    shouldStop = rememberPhaseResult('OpenAPI contract drift check', driftExitCode);
  }

  if (!shouldStop) {
    const runnableFiles = [];
    for (const testFile of testFiles) {
      const outputFile = join(tempDir, `${basename(testFile, '.ts')}.mjs`);
      await copyFile(testFile, outputFile);
      runnableFiles.push(outputFile);
    }

    log('INFO', `\n[2/4] Running contract tests (${runnableFiles.length} specs)...`);
    const contractExitCode = await runCommand(
      process.execPath,
      ['--test', ...runnableFiles],
      process.cwd(),
    );
    if (contractExitCode !== 0) {
      log('ERROR', `[2/4] Contract tests: FAILED (exit code ${contractExitCode})`);
    } else {
      log('INFO', '[2/4] Contract tests: PASSED');
    }

    if (!rememberPhaseResult('Contract tests', contractExitCode)) {
      log('INFO', `\n[3/4] Running API verification (${httpPytestTargets.length} targets)...`);
      const apiExitCode = await runApiVerification(join(process.cwd(), 'apps/api'));
      if (apiExitCode !== 0) {
        log('ERROR', `[3/4] API verification: FAILED (exit code ${apiExitCode})`);
      } else {
        log('INFO', '[3/4] API verification: PASSED');
      }

      if (!rememberPhaseResult('API verification', apiExitCode)) {
        log(
          'INFO',
          `\n[4/4] Running workflow verification (${workflowPytestTargets.length} targets)...`,
        );
        const workflowExitCode = await runWorkflowVerification(
          join(process.cwd(), 'apps/workflow'),
        );
        if (workflowExitCode !== 0) {
          log('ERROR', `[4/4] Workflow verification: FAILED (exit code ${workflowExitCode})`);
        } else {
          log('INFO', '[4/4] Workflow verification: PASSED');
        }
        rememberPhaseResult('Workflow verification', workflowExitCode);
      }
    }
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

async function checkOpenApiContractDrift(root, baselinePath) {
  const currentPath = join(root, openApiContractPath);
  const exitCode = await runCommand(
    'git',
    ['diff', '--no-index', '--exit-code', '--', baselinePath, currentPath],
    root,
  );
  if (exitCode !== 0) {
    log(
      'ERROR',
      "OpenAPI contract is stale. Run 'pnpm run openapi' and commit packages/shared/src/contracts/storyforge.openapi.json.",
    );
  }
  return exitCode;
}
async function refreshOpenApiContract(root, tempDir) {
  const pythonCommand = resolvePythonCommand();
  if (!pythonCommand) {
    log('ERROR', '未找到 uv、python3 或 python，无法刷新 OpenAPI 契约。');
    return 1;
  }

  const outputPath = join(root, 'packages/shared/src/contracts/storyforge.openapi.json');
  const scriptPath = join(tempDir, 'refresh-openapi.py');
  const pythonCode = `
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
from app.main import app

output_path = Path(${JSON.stringify(outputPath)})
output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(
    json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\\n",
    encoding="utf-8",
    newline="\\n",
)
print(f"已刷新 OpenAPI 契约：{output_path}")
`.trim();
  await writeFile(scriptPath, `${pythonCode}\n`, 'utf8');
  const exitCode = await runPythonScript(pythonCommand, scriptPath, join(root, 'apps/api'));
  if (exitCode !== 0) {
    log('ERROR', 'OpenAPI 契约刷新失败，已停止 e2e，避免继续使用可能陈旧的契约快照。');
  }
  return exitCode;
}

async function runApiVerification(cwd) {
  const pythonCommand = resolvePythonCommand();
  if (!pythonCommand) {
    log('ERROR', '未找到 uv、python3 或 python，无法执行 API 验证。');
    return 1;
  }

  const compileExitCode = await runPythonCommand(
    pythonCommand,
    ['-m', 'compileall', 'app', 'tests'],
    cwd,
  );
  if (compileExitCode !== 0) {
    return compileExitCode;
  }
  return runPythonCommand(pythonCommand, ['-m', 'pytest', ...httpPytestTargets, '-q'], cwd);
}
async function runWorkflowVerification(cwd) {
  const pythonCommand = resolvePythonCommand();
  if (!pythonCommand) {
    log('ERROR', '未找到 uv、python3 或 python，无法执行 workflow 验证。');
    return 1;
  }

  const compileExitCode = await runPythonCommand(
    pythonCommand,
    ['-m', 'compileall', 'storyforge_workflow', 'tests'],
    cwd,
  );
  if (compileExitCode !== 0) {
    return compileExitCode;
  }
  return runPythonCommand(pythonCommand, ['-m', 'pytest', ...workflowPytestTargets, '-q'], cwd);
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

function runPythonScript(command, scriptPath, cwd) {
  if (command === 'uv') {
    return runCommand('uv', ['run', 'python', scriptPath], cwd);
  }
  return runCommand(command, [scriptPath], cwd);
}

function hasCommand(command) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
    stdio: 'ignore',
  });
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
