import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function readComposeServiceBlock(compose: string, serviceName: string) {
  const normalizedCompose = compose.replaceAll('\r\n', '\n');
  const match = normalizedCompose.match(
    new RegExp(
      `(?:^|\\n)  ${serviceName}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n|\\nvolumes:\\n|$)`,
    ),
  );
  assert.ok(match, `docker-compose.yml 应定义 ${serviceName} 服务`);
  return match[1];
}

const activeRoutes = [
  'studio',
  'refinery',
  'retrieval',
  'runs',
  'artifacts',
  'evaluations',
  'providers',
  'worldbuilding',
] as const;
const removedRoutes = ['analytics', 'collaboration', 'commercial', 'workspace', 'quality'] as const;
const textFilesWithoutEncodingDamage = [
  '../../TODO.md',
  'app/page.tsx',
  'app/retrieval/page.tsx',
  'app/runs/page.tsx',
  'app/artifacts/page.tsx',
  'app/evaluations/page.tsx',
  'app/studio/actions.tsx',
  'app/studio/api.ts',
  'app/studio/types.ts',
  'app/studio/validators.ts',
  '../api/app/domains/artifacts/__init__.py',
  '../../scripts/run-e2e.mjs',
] as const;

test('首页只保留真实数据流入口并删除占位页', () => {
  const home = read('app/page.tsx');
  for (const route of activeRoutes) {
    assert.ok(home.includes(`/${route}`), `应展示 /${route}`);
  }
  for (const route of removedRoutes) {
    assert.ok(!home.includes(`/${route}`), `不应继续展示占位入口 /${route}`);
    assert.ok(!existsSync(join(root, 'app', route, 'page.tsx')), `已删除 ${route} 页面`);
  }
});

test('根布局具备全局样式和错误加载边界', () => {
  assert.ok(read('app/layout.tsx').includes('./globals.css'), 'layout 应导入 globals.css');
  assert.ok(read('app/globals.css').includes('--accent'));
  assert.ok(read('app/error.tsx').includes('页面暂时不可用'));
  assert.ok(read('app/loading.tsx').includes('正在加载 StoryForge 工作台'));
});

test('E2E 在刷新 OpenAPI 后检查契约漂移', () => {
  const e2eScript = read('../../scripts/run-e2e.mjs');
  assert.ok(e2eScript.includes('checkOpenApiContractDrift'), 'e2e 应在刷新 OpenAPI 后检查契约漂移');
  assert.ok(e2eScript.includes('git'), 'e2e 应调用 git');
  assert.ok(
    e2eScript.includes('diff') && e2eScript.includes('--exit-code'),
    'e2e 应使用 git diff --exit-code 检查契约快照',
  );
  assert.ok(
    e2eScript.includes('packages/shared/src/contracts/storyforge.openapi.json'),
    '漂移检查应限定 OpenAPI 契约文件',
  );
  assert.ok(e2eScript.includes('OpenAPI contract is stale'), '契约漂移时应输出明确修复提示');
});

test('Docker Compose 基础服务具备健康检查', () => {
  const compose = read('../../docker-compose.yml');
  const postgres = readComposeServiceBlock(compose, 'postgres');
  const redis = readComposeServiceBlock(compose, 'redis');
  const minio = readComposeServiceBlock(compose, 'minio');

  assert.ok(postgres.includes('healthcheck:'), 'PostgreSQL 应配置 healthcheck');
  assert.ok(postgres.includes('CMD-SHELL'), 'PostgreSQL healthcheck 应使用 shell 命令');
  assert.ok(postgres.includes('pg_isready -U storyforge'), 'PostgreSQL 应使用 pg_isready 探测');
  assert.ok(redis.includes('healthcheck:'), 'Redis 应配置 healthcheck');
  assert.ok(
    redis.includes('redis-cli') && redis.includes('ping'),
    'Redis 应使用 redis-cli ping 探测',
  );
  assert.ok(minio.includes('healthcheck:'), 'MinIO 应配置 healthcheck');
  assert.ok(
    minio.includes('http://localhost:9000/minio/health/live'),
    'MinIO 应使用官方 liveness 端点',
  );

  for (const [serviceName, serviceBlock] of Object.entries({ postgres, redis, minio })) {
    assert.ok(serviceBlock.includes('interval: 5s'), `${serviceName} healthcheck interval 应为 5s`);
    assert.ok(serviceBlock.includes('timeout: 3s'), `${serviceName} healthcheck timeout 应为 3s`);
    assert.ok(serviceBlock.includes('retries: 5'), `${serviceName} healthcheck retries 应为 5`);
  }
});

test('Web 本机构建关闭 standalone 且 Docker 构建显式开启', () => {
  const nextConfig = read('next.config.ts');
  const dockerfile = read('Dockerfile');

  assert.ok(
    nextConfig.includes('STORYFORGE_WEB_STANDALONE'),
    'Next 配置应由环境变量控制 standalone 输出',
  );
  assert.ok(
    nextConfig.includes("process.env.STORYFORGE_WEB_STANDALONE === '1'"),
    '只有容器构建显式开启 standalone',
  );
  assert.ok(
    dockerfile.includes('STORYFORGE_WEB_STANDALONE=1'),
    'Web Docker 构建必须生成 .next/standalone',
  );
  assert.ok(
    dockerfile.includes('/repo/apps/web/.next/standalone'),
    '运行镜像仍应复制 standalone 产物',
  );
});

test('Retrieval 与 Runs 不再硬编码默认 ID', () => {
  const retrieval = read('app/retrieval/page.tsx');
  const runs = read('app/runs/page.tsx');
  assert.ok(retrieval.includes('searchParams'));
  assert.ok(retrieval.includes('book_id'));
  assert.ok(!retrieval.includes('url.searchParams.set("book_id", "1")'));
  assert.ok(runs.includes('searchParams'));
  assert.ok(runs.includes('job_run_id'));
  assert.ok(!runs.includes('defaultJobRunId = 1'));
});

test('页面复用 API client 并注入 API Key', () => {
  const client = read('lib/api-client.ts');
  const studioApi = read('app/studio/api.ts');
  const studioActions = read('app/studio/actions.tsx');
  const artifacts = read('app/artifacts/page.tsx');
  const evaluations = read('app/evaluations/page.tsx');
  const retrieval = read('app/retrieval/page.tsx');
  const runs = read('app/runs/page.tsx');

  assert.ok(client.includes('X-StoryForge-API-Key'));
  assert.ok(client.includes('buildApiUrl'));
  assert.ok(client.includes('export async function apiFetch'), 'api-client 应暴露统一 apiFetch');
  assert.ok(client.includes('apiFetch(path'), 'readJson 应复用 apiFetch，避免读写两套 header 逻辑');

  assert.ok(studioApi.includes('readJson'), 'Studio GET 读取应复用 readJson');
  assert.ok(!studioApi.includes('fetch(new URL'), 'Studio GET 读取不应保留裸 fetch(new URL(...))');
  assert.ok(
    studioActions.includes('apiFetch'),
    'Studio POST Server Action 应复用 apiFetch 注入 API Key',
  );
  assert.ok(!studioActions.includes('fetch(new URL'), 'Studio POST 不应绕过统一 API client');
  assert.ok(artifacts.includes('readJson'), 'Artifacts 页面应复用 readJson');
  assert.ok(evaluations.includes('readJson'), 'Evaluations 页面应复用 readJson');
  assert.ok(!artifacts.includes('fetch(new URL'), 'Artifacts 页面不应保留裸业务 fetch');
  assert.ok(!evaluations.includes('fetch(new URL'), 'Evaluations 页面不应保留裸业务 fetch');

  assert.ok(retrieval.includes('apiFetch'), 'Retrieval 页面应复用 apiFetch 注入 API Key');
  assert.ok(runs.includes('readJson'), 'Runs 页面应复用 readJson 校验响应');
  assert.ok(runs.includes('readRuntimeTools'), 'Runs 页面应读取 runtime tools API');
  assert.ok(runs.includes("'/api/runtime-tools'"), 'Runs 页面应通过 API 获取工具事实源');
  assert.ok(runs.includes('runtimeTools.map'), 'Runs 页面应渲染 API 返回的工具列表');
  assert.ok(runs.includes('runtime_diagnostics'), 'Runs 页面应读取 JobRun API 返回的运行诊断摘要');
  assert.ok(runs.includes('运行时诊断摘要'), 'Runs 页面应展示运行时诊断摘要区域');
  assert.ok(runs.includes('workflow_lifecycle'), 'Runs 页面应展示 WorkflowLifecycle 摘要');
  assert.ok(runs.includes('failure_kind'), 'Runs 页面应展示失败分类字段');
  assert.ok(runs.includes('recoverable'), 'Runs 页面应展示可恢复性字段');
  assert.ok(
    runs.includes('runtime_diagnostics.runtime_tools.map'),
    'Runs 页面应渲染本次运行命中的工具能力',
  );
  assert.ok(!runs.includes('DEFAULT_CREATIVE_TOOL_REGISTRY'), 'Web 不应直接引用 workflow registry');
  assert.ok(!runs.includes('runtimeToolList = ['), 'Web 不应维护静态工具清单');
  assert.ok(!runs.includes('runtimeDiagnosticTools = ['), 'Web 不应维护运行诊断静态工具清单');
  assert.ok(!retrieval.includes('await fetch('), 'Retrieval 页面不应保留裸业务 fetch');
  assert.ok(!runs.includes('await fetch('), 'Runs 页面不应保留裸业务 fetch');
});

test('Studio 保留 Server Action 写回闭环且 page 保持薄入口', () => {
  const page = read('app/studio/page.tsx');
  const actions = read('app/studio/actions.tsx');
  const api = read('app/studio/api.ts');
  const types = read('app/studio/types.ts');
  const validators = read('app/studio/validators.ts');
  const pageContent = read('app/studio/page-content.tsx');

  assert.ok(page.includes('./page-content'));
  assert.ok(page.split('\n').length < 20, 'Studio page.tsx 应保持薄入口');
  assert.ok(actions.includes('approveStudioWritebackAction'));
  assert.ok(actions.includes("'use server'"));
  assert.ok(actions.includes('revalidatePath'));
  assert.ok(
    !actions.includes('function StudioPageContent'),
    'actions.tsx 不应继续承载 Studio 页面渲染',
  );
  assert.ok(!actions.includes('function isStudio'), 'actions.tsx 不应继续承载 Studio 类型守卫');
  assert.ok(api.includes('readStudioBooks'));
  assert.ok(api.includes('getStudioTarget'));
  assert.ok(
    types.includes('import type { ApiResponseSchema }'),
    'Studio 类型应通过统一 API client 复用共享生成类型',
  );
  assert.ok(
    types.includes("ApiResponseSchema<'StudioBookListItem'>"),
    'StudioBookListItem 应来自 OpenAPI 生成 schema',
  );
  assert.ok(
    types.includes("ApiResponseSchema<'StudioApprovalExecuteRead'>"),
    '批准执行结果应来自 OpenAPI 生成 schema',
  );
  assert.ok(
    !types.includes('readonly recent_chapter_ordinal: number | null;'),
    '不应继续手写 StudioBookListItem 字段',
  );
  assert.ok(
    !types.includes('export type StudioScenePacket = {'),
    '不应继续手写 StudioScenePacket 响应类型',
  );
  assert.ok(validators.includes('isStudioChapterGoal'));
  assert.ok(pageContent.includes('批准写回已提交'));
  assert.ok(pageContent.includes('form action={approveStudioWritebackAction}'));
  assert.ok(
    pageContent.includes('JudgeIssueList'),
    'Studio 应使用 JudgeIssueList 共享组件展示评审问题',
  );
  assert.ok(
    pageContent.includes('RepairDiffViewer'),
    'Studio 应使用 RepairDiffViewer 共享组件展示修订差异',
  );
  assert.ok(
    pageContent.includes('<ScenePacketPanel'),
    'Studio 应使用 ScenePacketPanel 共享组件展示场景包',
  );
  assert.ok(
    !pageContent.includes('JSON.stringify(scenePacketState.packet.budget_summary)'),
    'budget_summary 不应以 JSON.stringify 原始渲染',
  );
  assert.ok(pageContent.includes('href={`/studio?book_id='), '作品列表应渲染为可切换的链接');
  assert.ok(pageContent.includes('requestedBookId'), '应支持 URL 驱动的作品选择');
});

test('Studio 使用四步流程引导并自动滚动到下一步', () => {
  const pageContent = read('app/studio/page-content.tsx');
  const flow = read('app/studio/StudioFlow.tsx');

  for (const label of [
    'Step 1',
    'Step 2',
    'Step 3',
    'Step 4',
    '选作品',
    '设目标',
    '生成',
    '评审并批准',
  ] as const) {
    assert.ok(flow.includes(label), `步骤条应展示 ${label}`);
  }
  for (const className of ['opacity-50', 'bg-stone-100', 'ring-2', 'border-amber-700'] as const) {
    assert.ok(flow.includes(className), `步骤状态应使用 Tailwind 类 ${className}`);
  }
  assert.ok(flow.includes("'use client'"), '自动滚动必须放在 Client Component 中');
  assert.ok(flow.includes('useRef'), '步骤区块需要使用 ref 定位滚动目标');
  assert.ok(flow.includes('useEffect'), '步骤完成后需要通过 effect 触发滚动');
  assert.ok(flow.includes('scrollIntoView'), '每步完成后应自动滚动到下一步');
  assert.ok(pageContent.includes('<StudioFlow'), 'Studio 页面应由步骤流包装既有区块');
  assert.ok(pageContent.includes('studioSteps'), 'Studio 页面应从现有状态派生四步完成状态');
});

test('产品文案不应夸大未联通能力', () => {
  const files = [
    'app/page.tsx',
    'app/artifacts/page.tsx',
    'app/evaluations/page.tsx',
    '../../README.md',
    '../../PROJECT_SUMMARY.md',
    '../api/app/domains/artifacts/__init__.py',
    '../../scripts/run-e2e.mjs',
  ] as const;
  const forbiddenPhrases = ['完整中心', '实验室', '统一管理', '全家桶', '完整交互式'] as const;

  for (const file of files) {
    const content = read(file);
    for (const phrase of forbiddenPhrases) {
      assert.ok(!content.includes(phrase), `${file} 不应把未联通能力描述为“${phrase}”`);
    }
  }
});

test('文本文件不应残留连续问号编码损坏或 UTF-8 BOM', () => {
  for (const file of textFilesWithoutEncodingDamage) {
    const content = read(file);
    assert.notEqual(content.charCodeAt(0), 0xfeff, `${file} 必须使用 UTF-8 无 BOM 编码`);
    assert.ok(!content.includes('???'), `${file} 不应包含连续问号编码损坏`);
  }
});

test('README 面向公开读者，不应包含本机绝对路径', () => {
  const readme = read('../../README.md');
  const forbiddenLocalPaths = [
    'D:/StoryForge',
    'D:\\StoryForge',
    '1-renovel-ai-ai-rag-tavern',
  ] as const;

  for (const pathFragment of forbiddenLocalPaths) {
    assert.ok(!readme.includes(pathFragment), `README 不应包含本机路径片段 ${pathFragment}`);
  }
});
