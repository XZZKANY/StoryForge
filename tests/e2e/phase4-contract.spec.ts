import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const openapi = JSON.parse(
  readFileSync('packages/shared/src/contracts/storyforge.openapi.json', 'utf8'),
);
const apiTests = {
  retrieval: readFileSync('apps/api/tests/test_retrieval_index.py', 'utf8'),
  scenePacketUpgrade: readFileSync('apps/api/tests/test_scene_packet_retrieval_upgrade.py', 'utf8'),
  promptPacks: readFileSync('apps/api/tests/test_prompt_packs.py', 'utf8'),
  modelRuns: readFileSync('apps/api/tests/test_model_runs.py', 'utf8'),
  artifacts: readFileSync('apps/api/tests/test_artifacts.py', 'utf8'),
  evaluations: readFileSync('apps/api/tests/test_evaluations.py', 'utf8'),
};
const webSources = {
  home: readFileSync('apps/web/app/page.tsx', 'utf8'),
  editorArea: readFileSync('apps/web/components/ide/shell/EditorArea.tsx', 'utf8'),
  retrieval: readFileSync('apps/web/app/retrieval/page.tsx', 'utf8'),
  runs:
    readFileSync('apps/web/components/ide/views/BookRunPanel.tsx', 'utf8') +
    '\n' +
    readFileSync('apps/web/components/ide/views/BookRunEventsPanel.tsx', 'utf8') +
    '\n' +
    readFileSync('apps/web/components/ide/shell/BottomPanel.tsx', 'utf8') +
    '\n' +
    readFileSync('apps/web/app/ide/page.tsx', 'utf8'),
  artifacts:
    readFileSync('apps/web/app/artifacts/page-content.tsx', 'utf8') +
    '\n' +
    readFileSync('apps/web/app/artifacts/api.ts', 'utf8'),
  evaluations:
    readFileSync('apps/web/next.config.ts', 'utf8') +
    '\n' +
    readFileSync('apps/web/components/ide/shell/EditorArea.tsx', 'utf8') +
    '\n' +
    readFileSync('apps/web/components/ide/shell/BottomPanel.tsx', 'utf8') +
    '\n' +
    readFileSync('apps/web/components/ide/url/ide-url-state.ts', 'utf8'),
};

function assertOperation(path, method, tag) {
  const operation = openapi.paths?.[path]?.[method];
  assert.ok(operation, `缺少 ${method.toUpperCase()} ${path}`);
  assert.ok(operation.tags?.includes(tag), `${path} 未归入 ${tag} 标签`);
}

function assertSourceEvidence(source, markers) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `缺少 Phase 4 证据：${marker}`);
  }
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
  assertOperation('/api/model-runs', 'post', '模型运行日志');
  assertOperation('/api/artifacts', 'post', '制品中心');
  assertOperation('/api/evaluations/runs', 'post', '评测系统');
  assertOperation('/api/runtime-tools', 'get', '运行时工具');
});

test('Phase 4 后端测试源码保留关键业务证据', () => {
  assertSourceEvidence(apiTests.retrieval, [
    '"/api/retrieval/sources"',
    '"/api/retrieval/search"',
    'chunk_count',
    'source_ref',
  ]);
  assertSourceEvidence(apiTests.scenePacketUpgrade, [
    '"/api/scene-packets"',
    'retrieval_hit',
    '检索命中',
  ]);
  assertSourceEvidence(apiTests.promptPacks, ['"/api/prompt-packs"', 'forbidden', 'history']);
  assertSourceEvidence(apiTests.modelRuns, [
    '"/api/model-runs"',
    'provider_name',
    'token_usage',
    'prompt_pack_id',
  ]);
  assertSourceEvidence(apiTests.artifacts, ['"/api/artifacts"', 'artifact_type', 'upload']);
  assertSourceEvidence(apiTests.evaluations, [
    '"/api/evaluations/cases"',
    '"/api/evaluations/runs"',
    'consistency_error_rate',
  ]);
});

test('Phase 4 前端入口包含检索、运行日志、制品中心和评测面板', () => {
  assertSourceEvidence(webSources.editorArea, [
    '/retrieval',
    '/runs',
    '/artifacts',
    '/evaluations',
    'Retrieval 证据检索',
    'Evaluations 评测系统',
  ]);
  assertSourceEvidence(webSources.retrieval, [
    '资料库',
    'Embedding 刷新任务',
    '检索命中与重排',
    'Scene Packet 检索证据',
  ]);
  assertSourceEvidence(webSources.runs, [
    'BookRun Run Panel',
    'checkpoint',
    'data-event-source="sse"',
    '/api/ide/runs/',
    '/api/book-runs/',
  ]);
  assertSourceEvidence(webSources.artifacts, [
    '导出物',
    '制品详情',
    'payload 下载摘要',
    'ArtifactsWorkbench',
  ]);
  assertSourceEvidence(webSources.evaluations, [
    "source: '/evaluations'",
    "destination: '/ide?panel.bottom=evaluation'",
    'Evaluations 评测系统',
    "'evaluation'",
  ]);
});

test('Phase 4 runtime tools API 与 CreativeToolRegistry 和 Runs 页面保持一致', () => {
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

  assert.deepEqual(apiTools, registryTools);
  assertOperation('/api/runtime-tools', 'get', '运行时工具');
  assert.ok(
    openapi.components.schemas.RuntimeToolRead,
    'OpenAPI 必须保留 runtime tools 读取契约',
  );
  assert.ok(
    !webSources.runs.includes('DEFAULT_CREATIVE_TOOL_REGISTRY'),
    'IDE Runs 面板不应直接引用 workflow registry',
  );
  assert.ok(!webSources.runs.includes('runtimeToolList = ['), 'IDE Runs 面板不应维护静态工具清单');
});
