import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const openapi = JSON.parse(
  readFileSync('packages/shared/src/contracts/storyforge.openapi.json', 'utf8'),
);
const webSources = {
  runs: readFileSync('apps/web/app/runs/page.tsx', 'utf8'),
};
const gateSources = {
  e2e: readFileSync('scripts/run-e2e.mjs', 'utf8'),
  verify: readFileSync('scripts/verify-local.ps1', 'utf8'),
};
const contractSources = {
  packageJson: readFileSync('package.json', 'utf8'),
  generateOpenApi: readFileSync('scripts/generate-openapi.ps1', 'utf8'),
};
const sharedOpenApiPath = 'packages/shared/src/contracts/storyforge.openapi.json';

function assertSourceEvidence(source, markers) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `缺少 Phase 5 证据：${marker}`);
  }
}

function assertNoSourceEvidence(source, markers) {
  for (const marker of markers) {
    assert.ok(!source.includes(marker), `Phase 5 不应包含硬编码证据：${marker}`);
  }
}

function assertSchemaFields(schemaName, expectedFields, schemaSource = openapi) {
  const schema = schemaSource.components.schemas[schemaName];
  assert.ok(schema, `OpenAPI 缺少 schema：${schemaName}`);
  const fields = Object.keys(schema.properties ?? {}).sort();
  assert.deepEqual(fields, [...expectedFields].sort(), `${schemaName} 关键字段与治理清单不一致`);
}

const runtimeToolReadFields = [
  'domain',
  'evidence_fields',
  'input_schema',
  'name',
  'output_schema',
  'references',
  'required_capabilities',
];
const runtimeToolReferencesFields = ['api_paths', 'page_refs', 'workflow_nodes'];
const modelRunReadFields = [
  'book_id',
  'capability',
  'created_at',
  'error_message',
  'id',
  'input_summary',
  'job_run_id',
  'latency_ms',
  'model_name',
  'output_summary',
  'payload',
  'prompt_pack_id',
  'provider_name',
  'scene_id',
  'status',
  'token_usage',
  'updated_at',
  'workspace_id',
];
const runsJobRunReadFields = [
  'checkpoint',
  'created_at',
  'error_message',
  'id',
  'job_type',
  'model_runs',
  'progress',
  'runtime_diagnostics',
  'status',
  'updated_at',
];
const runsRuntimeDiagnosticsFields = [
  'model_usage',
  'provider',
  'runtime_tools',
  'workflow_lifecycle',
  'workflow_session',
];
const runsWorkflowSessionFields = [
  'approval_status',
  'current_node',
  'job_run_id',
  'last_heartbeat_ms',
  'prompt_count',
  'session_id',
  'status',
  'thread_id',
];
const runsWorkflowLifecycleFields = [
  'current_node',
  'failure_kind',
  'message',
  'recoverable',
  'status',
];
const runsProviderFields = [
  'capability',
  'error_message',
  'latency_ms',
  'model_name',
  'provider_name',
  'status',
  'token_usage',
];
const runsModelUsageFields = [
  'failed_model_run_count',
  'max_latency_ms',
  'model_run_count',
  'total_token_usage',
];
const runsRuntimeToolSummaryFields = [
  'domain',
  'evidence_fields',
  'name',
  'required_capabilities',
  'workflow_nodes',
];

function runApiPythonJson(script) {
  const tempDir = mkdtempSync(join(tmpdir(), 'storyforge-phase5-python-'));
  const scriptPath = join(tempDir, 'dump-runtime-diagnostics.py');
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

test('Phase 5 OpenAPI 记录 Runs runtime diagnostics 响应契约', () => {
  const operation = openapi.paths?.['/api/model-runs/job-runs/{job_run_id}']?.get;
  assert.ok(operation, '缺少 GET /api/model-runs/job-runs/{job_run_id}');
  const responseSchema = operation.responses['200'].content['application/json'].schema;
  assert.ok(
    responseSchema.$ref.endsWith('RunsJobRunRead'),
    'Runs JobRun 响应必须引用 RunsJobRunRead',
  );

  const runsSchema = openapi.components.schemas.RunsJobRunRead;
  assert.ok(
    runsSchema.properties.runtime_diagnostics,
    'RunsJobRunRead 必须包含 runtime_diagnostics',
  );
  const diagnosticsSchema = openapi.components.schemas.RunsRuntimeDiagnosticsRead;
  for (const field of [
    'workflow_session',
    'workflow_lifecycle',
    'provider',
    'model_usage',
    'runtime_tools',
  ]) {
    assert.ok(diagnosticsSchema.properties[field], `runtime diagnostics 缺少 ${field}`);
  }
});

test('Phase 5 API 从真实 JobRun、ModelRun 和 Runtime Tools 派生运行诊断', () => {
  const payload = runApiPythonJson(`
import json
import os
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.books.models import Book
from app.domains.jobs.models import JobRun
from app.domains.model_runs.service import record_runtime_model_run
from app.main import app

engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Base.metadata.create_all(engine)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

def override_get_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
app.dependency_overrides[get_session] = override_get_session
with SessionLocal() as session:
    book = Book(title="Phase5 灯塔", status="draft", premise="林岚追查信号。")
    session.add(book)
    session.flush()
    job = JobRun(
        book_id=book.id,
        job_type="generation_runtime",
        status="failed",
        error_message="provider timeout after 30s",
        progress={
            "thread_id": "phase5-e2e-thread",
            "current_node": "provider_execution",
            "approval_status": "failed",
            "failure_kind": "provider_timeout",
            "recoverable": True,
            "lifecycle_status": "recoverable_failed",
            "lifecycle_message": "provider 超时，等待恢复。",
            "provider_execution": {
                "provider_name": "mock-provider",
                "model_name": "storyforge-writer",
                "capability": "llm",
                "status": "failed",
                "latency_ms": 450,
                "token_usage": 120,
                "error_message": "provider timeout after 30s",
            },
        },
    )
    session.add(job)
    session.commit()
    job_id = job.id
    record_runtime_model_run(
        session,
        job_run_id=job_id,
        provider_name="mock-provider",
        model_name="storyforge-writer",
        capability="llm",
        latency_ms=210,
        token_usage=88,
        input_summary="Phase5 输入摘要",
        output_summary="Phase5 输出摘要",
    )

client = TestClient(app, headers={"X-StoryForge-API-Key": os.getenv("STORYFORGE_API_KEY", "local-dev-key")})
response = client.get(f"/api/model-runs/job-runs/{job_id}")
response.raise_for_status()
print(json.dumps(response.json()["runtime_diagnostics"], ensure_ascii=False, sort_keys=True))
app.dependency_overrides.clear()
`);

  assert.equal(payload.workflow_session.session_id, 'phase5-e2e-thread:1');
  assert.equal(payload.workflow_lifecycle.failure_kind, 'provider_timeout');
  assert.equal(payload.workflow_lifecycle.recoverable, true);
  assert.equal(payload.provider.provider_name, 'mock-provider');
  assert.equal(payload.provider.model_name, 'storyforge-writer');
  assert.equal(payload.provider.latency_ms, 450);
  assert.equal(payload.model_usage.total_token_usage, 88);
  assert.equal(payload.model_usage.max_latency_ms, 210);
  assert.ok(
    payload.runtime_tools.some((tool) => tool.name === 'provider_gateway.resolve'),
    '运行诊断工具能力必须由 Runtime Tools API/CreativeToolRegistry 派生',
  );
});

test('Phase 5 Runs 页面消费 API 诊断摘要且不维护静态工具清单', () => {
  assertSourceEvidence(webSources.runs, [
    'runtime_diagnostics',
    '运行时诊断摘要',
    'workflow_lifecycle',
    'failure_kind',
    'recoverable',
    'runtime_diagnostics.runtime_tools.map',
  ]);
  assertNoSourceEvidence(webSources.runs, [
    'DEFAULT_CREATIVE_TOOL_REGISTRY',
    'runtimeToolList = [',
    'runtimeDiagnosticTools = [',
  ]);
});

test('Phase 6 发布前门禁覆盖 Runtime 诊断链路', () => {
  const requiredE2eTargets = [
    'tests/e2e/phase5-runtime-diagnostics.spec.ts',
    'tests/test_model_runs.py',
    'tests/test_runtime_tools.py',
    'tests/test_workflow_session.py',
    'tests/test_workflow_lifecycle.py',
    'tests/test_provider_adapter.py',
    'tests/test_provider_parity_harness.py',
    'tests/test_creative_tool_registry.py',
  ];
  for (const target of requiredE2eTargets) {
    assert.ok(gateSources.e2e.includes(target), `pnpm e2e 未纳入 Runtime 诊断门禁目标：${target}`);
  }

  assertSourceEvidence(gateSources.verify, [
    'Test-RuntimeDiagnosticsGate',
    'scripts/run-e2e.mjs',
    'tests/e2e/phase5-runtime-diagnostics.spec.ts',
    'tests/test_model_runs.py',
    'tests/test_runtime_tools.py',
    'tests/test_workflow_session.py',
    'tests/test_workflow_lifecycle.py',
    'tests/test_provider_adapter.py',
    'tests/test_provider_parity_harness.py',
    'tests/test_creative_tool_registry.py',
  ]);
});

test('Phase 9 本地 E2E API verification 覆盖 Alembic 迁移预检', () => {
  const requiredApiTarget = 'tests/test_alembic_heads.py';
  const apiTargetsStart = gateSources.e2e.indexOf('const httpPytestTargets = [');
  const workflowTargetsStart = gateSources.e2e.indexOf('const workflowPytestTargets = [');
  const alembicTargetIndex = gateSources.e2e.indexOf(requiredApiTarget);

  assert.notEqual(apiTargetsStart, -1, 'pnpm e2e 应声明 API pytest 目标清单');
  assert.notEqual(workflowTargetsStart, -1, 'pnpm e2e 应声明 workflow pytest 目标清单');
  assert.ok(
    alembicTargetIndex > apiTargetsStart && alembicTargetIndex < workflowTargetsStart,
    `pnpm e2e API verification 未纳入 Alembic 迁移预检目标：${requiredApiTarget}`,
  );
  assertSourceEvidence(gateSources.e2e, [
    'Running API verification',
    "['-m', 'pytest', ...httpPytestTargets, '-q']",
  ]);
});

test('Phase 7 Runtime OpenAPI、API schema、Web 字段与 e2e 声明保持一致', () => {
  const liveOpenApi = runApiPythonJson(`
import json
from app.main import app
print(json.dumps(app.openapi(), ensure_ascii=False, sort_keys=True))
`);

  assertSourceEvidence(contractSources.packageJson, [
    '"openapi": "node scripts/generate-openapi.mjs"',
    '"e2e": "node scripts/run-e2e.mjs"',
    '"verify": "pnpm run verify:ci"',
    '"verify:ci": "node scripts/verify-ci.mjs"',
    '"verify:infra": "powershell -ExecutionPolicy Bypass -File ./scripts/verify-local.ps1"',
  ]);
  assertSourceEvidence(contractSources.generateOpenApi, ['app.openapi()', sharedOpenApiPath]);
  assertSourceEvidence(gateSources.e2e, [
    'refreshOpenApiContract',
    sharedOpenApiPath,
    'app.openapi()',
  ]);
  assertSourceEvidence(gateSources.verify, ['Test-OpenApiRuntimeContractGate', sharedOpenApiPath]);

  for (const schemaSource of [openapi, liveOpenApi]) {
    assertSchemaFields('RuntimeToolRead', runtimeToolReadFields, schemaSource);
    assertSchemaFields('RuntimeToolReferencesRead', runtimeToolReferencesFields, schemaSource);
    assertSchemaFields('ModelRunRead', modelRunReadFields, schemaSource);
    assertSchemaFields('RunsJobRunRead', runsJobRunReadFields, schemaSource);
    assertSchemaFields('RunsRuntimeDiagnosticsRead', runsRuntimeDiagnosticsFields, schemaSource);
    assertSchemaFields('RunsWorkflowSessionSummary', runsWorkflowSessionFields, schemaSource);
    assertSchemaFields('RunsWorkflowLifecycleSummary', runsWorkflowLifecycleFields, schemaSource);
    assertSchemaFields('RunsProviderSummary', runsProviderFields, schemaSource);
    assertSchemaFields('RunsModelUsageSummary', runsModelUsageFields, schemaSource);
    assertSchemaFields('RunsRuntimeToolSummary', runsRuntimeToolSummaryFields, schemaSource);
  }

  assert.deepEqual(
    liveOpenApi.paths['/api/runtime-tools'].get.responses['200'],
    openapi.paths['/api/runtime-tools'].get.responses['200'],
  );
  assert.deepEqual(
    liveOpenApi.paths['/api/model-runs/job-runs/{job_run_id}'].get.responses['200'],
    openapi.paths['/api/model-runs/job-runs/{job_run_id}'].get.responses['200'],
  );
  assert.deepEqual(
    liveOpenApi.paths['/api/model-runs'].get.responses['200'],
    openapi.paths['/api/model-runs'].get.responses['200'],
  );
  assert.deepEqual(
    liveOpenApi.paths['/api/model-runs'].post.responses['201'],
    openapi.paths['/api/model-runs'].post.responses['201'],
  );

  assertSourceEvidence(webSources.runs, [
    ...runtimeToolReadFields,
    ...runtimeToolReferencesFields,
    ...runsRuntimeDiagnosticsFields,
    ...runsWorkflowSessionFields,
    ...runsWorkflowLifecycleFields,
    ...runsProviderFields,
    ...runsModelUsageFields,
    ...runsRuntimeToolSummaryFields,
    'runsJobRunEndpoint',
    'runtimeToolsEndpoint',
    'isRunsRuntimeDiagnostics',
    'isRuntimeTool',
  ]);
});
