import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { emitAgentWsTypes } from './lib/emit-agent-ws-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const apiRoot = join(root, 'apps', 'api');
const outputPath = join(root, 'packages', 'shared', 'src', 'contracts', 'storyforge.openapi.json');
const wsSchemaPath = join(root, 'packages', 'shared', 'src', 'contracts', 'agent-ws.schema.json');
const sharedTypesPath = join(root, 'packages', 'shared', 'src', 'generated', 'api-types.ts');
const wsTypesPath = join(
  root,
  'apps',
  'desktop',
  'frontend',
  'src',
  'lib',
  'api',
  'generated',
  'agent-ws.ts',
);

function formatTimestamp() {
  return new Date().toISOString().slice(0, 19);
}

function log(level, message) {
  const output = `[${formatTimestamp()}] [${level}] ${message}`;
  if (level === 'ERROR') {
    console.error(output);
  } else {
    console.log(output);
  }
}

function hasCommand(command) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
    stdio: 'ignore',
  });
  return probe.status === 0;
}

function resolvePythonCommand() {
  if (hasCommand('uv')) return 'uv';
  if (hasCommand('python3')) return 'python3';
  if (hasCommand('python')) return 'python';
  return null;
}

function resolvePackageManagerCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function runCommand(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return new Promise((resolve) => {
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const pythonCommand = resolvePythonCommand();
if (!pythonCommand) {
  log('ERROR', '未找到 uv、python3 或 python，无法生成 OpenAPI 契约。');
  process.exit(1);
}

log('INFO', `使用 ${pythonCommand} 生成 OpenAPI 契约。`);

await mkdir(dirname(outputPath), { recursive: true });

const pythonCode = `
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
from app.main import app
from app.domains.agent_runs.ws_schema import build_agent_ws_schema

output_path = Path(${JSON.stringify(outputPath)})
output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_bytes(
    (json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\\n").encode("utf-8")
)
print(f"已生成 OpenAPI 契约：{output_path}")

ws_schema_path = Path(${JSON.stringify(wsSchemaPath)})
ws_schema_path.write_bytes(
    (json.dumps(build_agent_ws_schema(), ensure_ascii=False, indent=2, sort_keys=True) + "\\n").encode("utf-8")
)
print(f"已生成 Agent WS 帧契约：{ws_schema_path}")
`.trim();

const tempScriptPath = join(tmpdir(), `storyforge-openapi-${Date.now()}.py`);
await writeFile(tempScriptPath, `${pythonCode}\n`, 'utf8');

try {
  const args = pythonCommand === 'uv' ? ['run', 'python', tempScriptPath] : [tempScriptPath];
  const exitCode = await runCommand(pythonCommand, args, apiRoot);
  if (exitCode !== 0) {
    log('ERROR', `OpenAPI 契约生成失败，退出码：${exitCode}`);
  }
  process.exitCode = exitCode;

  if (exitCode === 0) {
    // 前端 WS 类型从刚生成的 schema 派生（同一事实源），drift 门禁一并校验。
    const wsSchema = JSON.parse(await readFile(wsSchemaPath, 'utf8'));
    await mkdir(dirname(wsTypesPath), { recursive: true });
    await writeFile(wsTypesPath, emitAgentWsTypes(wsSchema), 'utf8');
    log('INFO', `已生成前端 WS 类型：${wsTypesPath}`);

    const packageManagerCommand = resolvePackageManagerCommand();
    const typesExitCode = await runCommand(
      packageManagerCommand,
      ['--filter', '@storyforge/shared', 'generate:types'],
      root,
    );
    if (typesExitCode !== 0) {
      log('ERROR', `OpenAPI TypeScript 类型生成失败，退出码：${typesExitCode}`);
      process.exitCode = typesExitCode;
    } else {
      log('INFO', `已生成 OpenAPI TypeScript 类型：${sharedTypesPath}`);
    }
  }
} finally {
  await rm(tempScriptPath, { force: true });
}
