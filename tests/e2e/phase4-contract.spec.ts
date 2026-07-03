import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const openapi = JSON.parse(
  readFileSync('packages/shared/src/contracts/storyforge.openapi.json', 'utf8'),
);

function assertOperation(path, method, tag) {
  const operation = openapi.paths?.[path]?.[method];
  assert.ok(operation, `缺少 ${method.toUpperCase()} ${path}`);
  assert.ok(operation.tags?.includes(tag), `${path} 未归入 ${tag} 标签`);
}

function runApiPythonJson(script) {
  const tempDir = mkdtempSync(join(tmpdir(), 'storyforge-phase4-python-'));
  const scriptPath = join(tempDir, 'dump-runtime-tools.py');
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
  const jsonLine = lines.findLast((line) => line.startsWith('{') || line.startsWith('['));
  assert.ok(jsonLine, `Python 输出缺少 JSON 行：${stdout}`);
  return jsonLine;
}

test('Phase 4 OpenAPI 暴露检索、Prompt Packs、模型运行日志、制品中心和评测端点', () => {
  assertOperation('/api/retrieval/sources', 'post', '检索中心');
  assertOperation('/api/retrieval/refresh-runs', 'post', '检索中心');
  assertOperation('/api/retrieval/search', 'post', '检索中心');
  assertOperation('/api/prompt-packs', 'post', 'Prompt Packs');
  assertOperation('/api/prompt-packs/{pack_id}/history', 'get', 'Prompt Packs');
  assertOperation('/api/model-runs', 'post', '模型运行日志');
  assertOperation('/api/artifacts', 'post', '制品中心');
  assertOperation('/api/artifacts/{artifact_id}/download', 'get', '制品中心');
  assertOperation('/api/evaluations/cases', 'post', '评测系统');
  assertOperation('/api/evaluations/runs', 'post', '评测系统');
  assertOperation('/api/runtime-tools', 'get', '运行时工具');
});

test('Phase 4 契约保留检索、模型运行与制品关键字段', () => {
  const retrievalSource = openapi.components.schemas.RetrievalSourceRead;
  assert.ok(retrievalSource.properties.chunk_count, '检索源响应必须包含 chunk_count');

  const retrievalHit = openapi.components.schemas.RetrievalHitRead;
  assert.ok(retrievalHit.properties.source_ref, '检索命中必须包含 source_ref');
  assert.ok(retrievalHit.properties.score, '检索命中必须包含 score');

  const scenePacketCreate = openapi.components.schemas.ScenePacketCreate;
  assert.ok(
    scenePacketCreate.properties.retrieval_snippets,
    'Scene Packet 请求必须允许注入检索片段',
  );

  const modelRun = openapi.components.schemas.ModelRunRead;
  assert.ok(modelRun.properties.provider_name, '模型运行响应必须包含 provider_name');
  assert.ok(modelRun.properties.token_usage, '模型运行响应必须包含 token_usage');
  assert.ok(modelRun.properties.prompt_pack_id, '模型运行响应必须包含 prompt_pack_id');

  const artifact = openapi.components.schemas.ArtifactRead;
  assert.ok(artifact.properties.artifact_type, '制品响应必须包含 artifact_type');
  assert.ok(artifact.properties.storage_uri, '制品响应必须包含 storage_uri');

  const evaluationRun = openapi.components.schemas.EvaluationRunRead;
  assert.ok(evaluationRun.properties.metrics, '评测运行响应必须包含 metrics');
});

test('Phase 4 runtime tools API 与 CreativeToolRegistry 保持一致', () => {
  const apiTools = runApiPythonJson(`
import json
import os
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app, headers={"X-StoryForge-API-Key": os.getenv("STORYFORGE_API_KEY", "local-dev-key")})
response = client.get("/api/runtime-tools")
response.raise_for_status()
print(json.dumps(response.json(), ensure_ascii=False, sort_keys=True))
`);
  const registryTools = runApiPythonJson(`
import importlib.util
import json
import sys
from collections.abc import Mapping, Sequence, Set
from pathlib import Path

registry_path = Path.cwd().parent / "workflow" / "storyforge_workflow" / "tools" / "registry.py"
spec = importlib.util.spec_from_file_location("storyforge_phase4_registry", registry_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

def to_jsonable(value):
    if isinstance(value, Mapping):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, Set):
        return [to_jsonable(item) for item in sorted(value, key=str)]
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [to_jsonable(item) for item in value]
    return value

print(json.dumps([
    {
        "name": tool.name,
        "domain": tool.domain,
        "input_schema": to_jsonable(tool.input_schema),
        "output_schema": to_jsonable(tool.output_schema),
        "required_capabilities": list(tool.required_capabilities),
        "evidence_fields": list(tool.evidence_fields),
        "references": {
            "page_refs": list(tool.references.page_refs),
            "api_paths": list(tool.references.api_paths),
            "workflow_nodes": list(tool.references.workflow_nodes),
        },
    }
    for tool in module.list_creative_tools()
], ensure_ascii=False, sort_keys=True))
`);

  // /api/runtime-tools 现为 agent_runtime + internal(CreativeToolRegistry) + mcp 三源合并；
  // registry 事实源对应 origin="internal" 子集，比较时投影掉 API 侧派生的权限/风险字段。
  const internalApiTools = apiTools
    .filter((tool) => tool.origin === 'internal')
    .map((tool) => ({
      name: tool.name,
      domain: tool.domain,
      input_schema: tool.input_schema,
      output_schema: tool.output_schema,
      required_capabilities: tool.required_capabilities,
      evidence_fields: tool.evidence_fields,
      references: tool.references,
    }));
  assert.deepEqual(internalApiTools, registryTools);
  for (const origin of ['agent_runtime', 'internal', 'mcp']) {
    assert.ok(
      apiTools.some((tool) => tool.origin === origin),
      `runtime tools API 缺少 origin=${origin} 工具`,
    );
  }
  assertOperation('/api/runtime-tools', 'get', '运行时工具');
  assert.ok(
    openapi.components.schemas.RuntimeToolRead,
    'OpenAPI 必须保留 runtime tools 读取契约',
  );
});
