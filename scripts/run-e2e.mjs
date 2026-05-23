import { mkdtemp, copyFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const defaultTests = [
  'tests/e2e/phase1-closed-loop.spec.ts',
  'tests/e2e/phase2-contract.spec.ts',
  'tests/e2e/phase3-contract.spec.ts',
  'tests/e2e/phase4-contract.spec.ts',
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
  'tests/test_artifacts.py',
  'tests/test_evaluations.py',
  'tests/test_job_runtime_bridge.py',
];
const requestedTests = process.argv.slice(2).filter((value) => value.trim().length > 0);
const testFiles = requestedTests.length > 0 ? requestedTests : defaultTests;
const tempDir = await mkdtemp(join(tmpdir(), 'storyforge-e2e-'));

try {
  const refreshExitCode = await refreshOpenApiContract(process.cwd(), tempDir);
  if (refreshExitCode !== 0) {
    process.exitCode = refreshExitCode;
  } else {
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
      const apiExitCode = await runApiVerification(join(process.cwd(), 'apps/api'));
      if (apiExitCode !== 0) {
        process.exitCode = apiExitCode;
      } else {
        process.exitCode = await runWorkflowVerification(join(process.cwd(), 'apps/workflow'));
      }
    }
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function refreshOpenApiContract(root, tempDir) {
  const pythonCommand = resolvePythonCommand();
  if (!pythonCommand) {
    console.error('未找到 uv、python3 或 python，无法刷新 OpenAPI 契约。');
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
)
print(f"已刷新 OpenAPI 契约：{output_path}")
`.trim();
  await writeFile(scriptPath, `${pythonCode}\n`, 'utf8');
  const exitCode = await runPythonScript(pythonCommand, scriptPath, join(root, 'apps/api'));
  if (exitCode !== 0) {
    console.error('OpenAPI 契约刷新失败，已停止 e2e，避免继续使用可能陈旧的契约快照。');
  }
  return exitCode;
}

async function runApiVerification(cwd) {
  const pythonCommand = resolvePythonCommand();
  if (!pythonCommand) {
    console.error('未找到 uv、python3 或 python，无法执行 API 验证。');
    return 1;
  }

  const compileExitCode = await runPythonCommand(pythonCommand, ['-m', 'compileall', 'app', 'tests'], cwd);
  if (compileExitCode !== 0) {
    return compileExitCode;
  }
  return runPythonCommand(pythonCommand, ['-m', 'pytest', ...httpPytestTargets, '-q'], cwd);
}
async function runWorkflowVerification(cwd) {
  const pythonCommand = resolvePythonCommand();
  if (!pythonCommand) {
    console.error('未找到 uv、python3 或 python，无法执行 workflow 验证。');
    return 1;
  }

  const compileExitCode = await runPythonCommand(pythonCommand, ['-m', 'compileall', 'storyforge_workflow', 'tests'], cwd);
  if (compileExitCode !== 0) {
    return compileExitCode;
  }
  return runPythonCommand(pythonCommand, ['-m', 'pytest', 'tests/test_generation_graph.py', 'tests/test_runtime_runner.py', '-q'], cwd);
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
