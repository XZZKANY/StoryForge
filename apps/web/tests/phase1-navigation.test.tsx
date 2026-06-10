import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { storyforgeLegacyRedirects } from '../next.config';

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

const homeAssistantViews = ['projects', 'artifacts'] as const;
const removedRoutes = ['analytics', 'collaboration', 'commercial', 'workspace', 'quality'] as const;
const textFilesWithoutEncodingDamage = [
  '../../TODO.md',
  'app/page.tsx',
  'components/home/home-data.ts',
  'app/retrieval/page.tsx',
  'app/artifacts/page-content.tsx',
  'app/artifacts/api.ts',
  'app/ide/page.tsx',
  'components/ide/views/BookRunPanel.tsx',
  'components/ide/views/BookRunEventsPanel.tsx',
  'app/studio/actions.tsx',
  'app/studio/api.ts',
  'app/studio/types.ts',
  'app/studio/validators.ts',
  '../api/app/domains/artifacts/__init__.py',
  '../../scripts/run-e2e.mjs',
] as const;

test('首页只保留 Assistant 入口并删除占位页', () => {
  const home =
    read('app/page.tsx') +
    '\n' +
    read('components/home/home-data.ts') +
    '\n' +
    read('components/home/HomeShell.tsx');
  for (const view of homeAssistantViews) {
    assert.ok(
      home.includes(`view: '${view}'`) || home.includes(`'${view}'`),
      `应展示首页子页 ${view}`,
    );
  }
  assert.ok(home.includes('StoryForge Assistant'), '首页应呈现 Assistant 对话式入口');
  assert.ok(home.includes('StoryForge Assistant'), '首页数据应保留 Assistant 对话入口事实源');
  const assistantMapping =
    read('components/home/assistant-tool-node-mapper.ts') +
    '\n' +
    read('components/home/assistant-types.ts') +
    '\n' +
    read('components/home/AssistantToolTree.tsx');
  assert.ok(assistantMapping.includes('Goal.analyze'), 'Assistant 映射层应保留工具流程事实源');
  for (const route of removedRoutes) {
    assert.ok(!home.includes(`/${route}`), `不应继续展示占位入口 /${route}`);
    assert.ok(!existsSync(join(root, 'app', route, 'page.tsx')), `已删除 ${route} 页面`);
  }
});

test('首页采用 Assistant 对话式深色入口并保留 StoryForge 业务动作', () => {
  const home =
    read('components/home/HomeShell.tsx') +
    '\n' +
    read('components/home/HomeSidebar.tsx') +
    '\n' +
    read('components/home/HomeComposer.tsx') +
    '\n' +
    read('components/home/HomeProjectsPanel.tsx') +
    '\n' +
    read('components/home/AssistantToolTree.tsx') +
    '\n' +
    read('components/home/home-data.ts');

  for (const required of [
    'md:grid-cols-[288px_minmax(0,1fr)]',
    'max-w-[770px]',
    'bg-[#171715]',
    'max-w-none',
    'font-serif',
    'StoryForge Assistant',
    '今天要锻造哪段故事？',
    '给 StoryForge Assistant 发送消息',
    "label: 'Projects 项目'",
    'Artifacts 产物',
    'Provider/API Key',
    'Goal.analyze',
    'Blueprint.create',
    'Chapter.generate',
    'Judge.review',
    'Repair.suggest',
    '查看审计',
  ] as const) {
    assert.ok(home.includes(required), `首页应包含 Assistant StoryForge 元素：${required}`);
  }

  assert.ok(!home.includes('Customize 创作偏好'), 'Customize 不应作为首页一级导航');
  assert.ok(!home.includes('当前项目工作台</h2>'), 'Projects 不应默认追加解释型工作台区块');
  assert.ok(home.includes('HomeProjectsPanel'), 'Projects 应使用本地可交互项目面板');
  assert.ok(home.includes('Search projects'), 'Projects 应提供搜索入口');
  assert.ok(home.includes('Sort by'), 'Projects 应提供排序入口');
  assert.ok(home.includes('产物列表'), 'Artifacts 应使用列表式产物管理结构');
  assert.ok(!home.includes('StudioWorkbench'), 'Projects 首屏不应直接堆叠 Studio 大工作台');
  assert.ok(!home.includes('Studio 创作工作台'), 'Projects 首屏不应出现 Studio 大标题');
  assert.ok(
    !home.includes('projectWorkspaceSections.map'),
    'Projects 不应使用卡片式分区按钮主结构',
  );
  assert.ok(!home.includes('未联通能力'), '首页工作台不应展示开发边界说明');
  assert.ok(!home.includes('伪装'), '首页工作台不应展示防伪解释文案');

  for (const forbidden of ['Code', 'Learn', 'Life stuff', "Claude's choice", '创作模式'] as const) {
    assert.ok(!home.includes(forbidden), `首页不应残留无关 Claude 分类：${forbidden}`);
  }
});
test('根布局具备全局样式和错误加载边界', () => {
  const layout = read('app/layout.tsx');
  const errorBoundary = read('app/error.tsx');
  assert.ok(layout.includes('./globals.css'), 'layout 应导入 globals.css');
  assert.ok(
    layout.includes('suppressHydrationWarning'),
    '主题脚本会预水合修改 html 属性，根 html 应抑制水合警告',
  );
  assert.ok(read('app/globals.css').includes('--accent'));
  assert.ok(errorBoundary.includes('页面暂时不可用'));
  assert.ok(!errorBoundary.includes('<html'), 'app/error.tsx 是段级错误边界，不应返回 html');
  assert.ok(!errorBoundary.includes('<body'), 'app/error.tsx 是段级错误边界，不应返回 body');
  assert.ok(read('app/loading.tsx').includes('正在加载 StoryForge 工作台'));
});

test('统一侧边栏导航的明暗主题颜色契约', () => {
  const globals = read('app/globals.css');
  const sidebarSources = [
    'components/site-nav/UnifiedSidebar.tsx',
    'components/site-nav/CollapsibleNavItem.tsx',
    'components/site-nav/StudioProjectsList.tsx',
    'components/site-nav/RecentItemsList.tsx',
    'components/site-nav/ThemeToggle.tsx',
  ] as const;
  const sidebar = sidebarSources.map((sourcePath) => read(sourcePath)).join('\n');

  for (const forbidden of ['bg-nav-active', 'bg-nav-hover', 'text-accent'] as const) {
    assert.ok(!sidebar.includes(forbidden), `侧边栏不应继续使用独立暖色导航 token：${forbidden}`);
  }

  assert.ok(sidebar.includes('text-muted-foreground'), '普通侧边栏文字应使用 muted foreground');
  assert.ok(sidebar.includes('text-foreground'), '标题与激活侧边栏文字应使用 foreground');
  assert.ok(sidebar.includes('bg-muted'), '侧边栏 hover/active 背景应跟随 muted 语义 token');
  assert.ok(!sidebar.includes('dark:bg-foreground'), '白天模式不应复用黑夜反向色块');
  assert.ok(globals.includes('.bg-background { background-color: var(--bg) !important; }'), '语义背景类应读取运行时主题变量');
  assert.ok(globals.includes('.text-foreground { color: var(--text) !important; }'), '语义前景类应读取运行时主题变量');
  assert.ok(globals.includes('.text-muted-foreground { color: var(--muted) !important; }'), '普通导航文字应读取 muted 运行时变量');
  assert.ok(!globals.includes('--color-nav-active'), '全局主题不应保留侧栏专属 active 颜色 token');
  assert.ok(!globals.includes('--color-nav-hover'), '全局主题不应保留侧栏专属 hover 颜色 token');
  assert.ok(!globals.includes('a { color: var(--accent);'), '全局链接颜色不应覆盖侧边栏文字 token');
  assert.ok(!globals.includes('a { font-weight: 700;'), '全局链接字重不应覆盖侧边栏字重 token');

  for (const retiredWarmColor of ['#f5f3ee', '#fffaf2', '#211a16', '#6e6259', '#dfd4c5', '#8a4b2a'] as const) {
    assert.ok(!globals.includes(retiredWarmColor), `全局主题不应保留旧暖棕色值：${retiredWarmColor}`);
  }
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

test('verify:local 使用刷新前后内容对比检查 OpenAPI 契约漂移', () => {
  const verifyScript = read('../../scripts/verify-local.mjs');
  assert.ok(
    verifyScript.includes('openApiDigestBeforeRefresh'),
    'verify:local 应记录刷新前契约摘要',
  );
  assert.ok(verifyScript.includes('readFileDigest'), 'verify:local 应使用文件内容摘要判断漂移');
  assert.ok(
    verifyScript.includes('openApiDigestAfterRefresh !== openApiDigestBeforeRefresh'),
    'verify:local 应比较刷新前后内容，而不是比较未提交状态',
  );
  assert.ok(
    !verifyScript.includes("args: ['diff', '--exit-code'"),
    'verify:local 不应在本地未提交功能分支中用 git diff 误判已同步契约',
  );
});

test('OpenAPI 生成脚本固定使用 LF 行尾写入契约文件', () => {
  const openApiScript = read('../../scripts/generate-openapi.mjs');
  const e2eScript = read('../../scripts/run-e2e.mjs');

  for (const [name, script] of [
    ['generate-openapi.mjs', openApiScript],
    ['run-e2e.mjs', e2eScript],
  ] as const) {
    assert.ok(script.includes('write_bytes'), `${name} 应使用二进制写入避免 Windows newline 翻译`);
    assert.ok(script.includes('.encode("utf-8")'), `${name} 应显式以 UTF-8 字节写入契约`);
    assert.ok(
      !script.includes('output_path.write_text('),
      `${name} 不应使用会转换行尾的 write_text`,
    );
  }
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

test('旧页面路由通过 308 重定向进入 IDE 壳层', async () => {
  const expectedRedirects = [
    { source: '/studio', destination: '/ide?tab=legacy%3Astudio&active=legacy%3Astudio' },
    { source: '/retrieval', destination: '/ide?panel.left=search' },
    { source: '/refinery', destination: '/ide?tab=legacy%3Astudio&active=legacy%3Astudio' },
    { source: '/jobs', destination: '/ide?panel.bottom=runs' },
    { source: '/runs', destination: '/ide?panel.bottom=runs' },
    { source: '/artifacts', destination: '/ide?panel.bottom=artifacts' },
    { source: '/evaluations', destination: '/ide?panel.bottom=evaluation' },
  ] as const;

  const redirects = await storyforgeLegacyRedirects();
  assert.deepEqual(
    redirects,
    expectedRedirects.map((redirect) => ({ ...redirect, permanent: true })),
  );
  assert.equal(redirects.length, 7, '七个旧页面都应声明重定向');
  assert.ok(
    redirects.every((redirect) => redirect.permanent === true),
    'permanent: true 对应 Next HTTP 308',
  );
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

test('Web 开发模式允许 Next 客户端水合且生产不放开 unsafe-eval', () => {
  const nextConfig = read('next.config.ts');
  assert.ok(
    nextConfig.includes("process.env.NODE_ENV === 'development'"),
    'CSP 应只在开发模式识别 Next 客户端水合需求',
  );
  assert.ok(
    nextConfig.includes("\"script-src 'self' 'unsafe-inline' 'unsafe-eval'\""),
    '开发模式需要 unsafe-eval 支持 Next dev runtime',
  );
  assert.ok(
    nextConfig.includes(": \"script-src 'self' 'unsafe-inline'\""),
    '非开发模式不应放开 unsafe-eval',
  );
});

test('Web 开发模式不长缓存 Next 静态资源，避免热更新后加载旧 chunk', () => {
  const nextConfig = read('next.config.ts');
  assert.ok(nextConfig.includes('devStaticCacheHeader'), 'Next 配置应声明开发态静态资源缓存策略');
  assert.ok(
    nextConfig.includes("value: 'no-store, must-revalidate'"),
    '开发态 _next/static 不应使用 immutable 长缓存',
  );
  assert.ok(
    nextConfig.includes(
      "process.env.NODE_ENV === 'development' ? devStaticCacheHeader : immutableCacheHeader",
    ),
    '开发态应使用 no-store，非开发态继续使用 immutable',
  );
});

test('Retrieval 不再硬编码默认 ID，Runs 深链进入 IDE 面板', () => {
  const retrieval = read('app/retrieval/page.tsx');
  const idePage = read('app/ide/page.tsx');
  const bookRunPanel = read('components/ide/views/BookRunPanel.tsx');
  const bookRunEventsPanel = read('components/ide/views/BookRunEventsPanel.tsx');
  assert.ok(retrieval.includes('searchParams'));
  assert.ok(retrieval.includes('book_id'));
  assert.ok(!retrieval.includes('url.searchParams.set("book_id", "1")'));
  assert.ok(idePage.includes("state.bottomPanel === 'runs'"));
  assert.ok(idePage.includes('state.bookRunId !== undefined'));
  assert.ok(idePage.includes('/api/book-runs/'));
  assert.ok(idePage.includes('/api/ide/runs/'));
  assert.ok(bookRunPanel.includes('BookRunPanel'));
  assert.ok(bookRunEventsPanel.includes('BookRunEventsPanel'));
});

test('页面复用 API client 并注入 API Key', () => {
  const client = read('lib/api-client.ts');
  const studioApi = read('app/studio/api.ts');
  const studioActions = read('app/studio/actions.tsx');
  const artifactsApi = read('app/artifacts/api.ts');
  const nextConfig = read('next.config.ts');
  const editorArea = read('components/ide/shell/EditorArea.tsx');
  const bottomPanel = read('components/ide/shell/BottomPanel.tsx');
  const ideUrlState = read('components/ide/url/ide-url-state.ts');
  const retrieval = read('app/retrieval/page.tsx');
  const idePage = read('app/ide/page.tsx');
  const bookRunEventsRoute = read('app/api/book-runs/[bookRunId]/events/route.ts');
  const bookRunPanel = read('components/ide/views/BookRunPanel.tsx');
  const bookRunEventsPanel = read('components/ide/views/BookRunEventsPanel.tsx');

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
  assert.ok(artifactsApi.includes('readJson'), 'Artifacts 数据读取应复用 readJson');
  assert.ok(!artifactsApi.includes('fetch(new URL'), 'Artifacts 数据读取不应保留裸业务 fetch');

  assert.ok(retrieval.includes('apiFetch'), 'Retrieval 页面应复用 apiFetch 注入 API Key');
  assert.ok(
    idePage.includes('readJson<BookRunPanelRun>'),
    'IDE Runs 面板应复用 readJson 校验 BookRun 响应',
  );
  assert.ok(idePage.includes('readSseSnapshot'), 'IDE Runs 面板应通过统一 apiFetch 读取 SSE 快照');
  assert.ok(idePage.includes('/api/book-runs/'), 'IDE Runs 面板应读取真实 BookRun API');
  assert.ok(idePage.includes('/api/ide/runs/'), 'IDE Runs 面板应读取真实 runs SSE API');
  assert.ok(
    bookRunEventsPanel.includes('/api/book-runs/${run.id}/events'),
    '浏览器 EventSource 应连接 Web 同源代理，不能直接连接受保护 FastAPI SSE 路由',
  );
  assert.ok(
    bookRunEventsRoute.includes('apiFetch(`/api/ide/runs/${bookRunId}/events`)'),
    'Web SSE 代理应在服务端复用 apiFetch 注入 API Key 后转发 FastAPI SSE',
  );
  assert.ok(
    bookRunEventsRoute.includes("'Content-Type': 'text/event-stream'"),
    'Web SSE 代理应保留 text/event-stream 响应类型',
  );
  assert.ok(bookRunPanel.includes('modelRunHref'), 'IDE Runs 面板应保留 ModelRun 追溯链接');
  assert.ok(
    bookRunEventsPanel.includes('data-event-source="sse"'),
    'IDE Runs 面板应暴露 SSE 事件源',
  );
  assert.ok(
    nextConfig.includes("source: '/evaluations'"),
    '/evaluations 深链应继续由 redirect 承接',
  );
  assert.ok(
    nextConfig.includes("destination: '/ide?panel.bottom=evaluation'"),
    '/evaluations redirect 应进入 IDE evaluation 面板',
  );
  assert.ok(
    editorArea.includes("'legacy:evaluations'"),
    'IDE 应保留 evaluations legacy tab 元数据',
  );
  assert.ok(bottomPanel.includes("'evaluation'"), 'IDE 底部面板应保留 evaluation 槽位');
  assert.ok(ideUrlState.includes("| 'evaluation'"), 'IDE URL 状态应保留 evaluation 面板类型');
  assert.ok(
    !bookRunPanel.includes('DEFAULT_CREATIVE_TOOL_REGISTRY') &&
      !bookRunEventsPanel.includes('DEFAULT_CREATIVE_TOOL_REGISTRY'),
    'Web 不应直接引用 workflow registry',
  );
  assert.ok(!bookRunPanel.includes('runtimeToolList = ['), 'Web 不应维护静态工具清单');
  assert.ok(
    !bookRunPanel.includes('runtimeDiagnosticTools = ['),
    'Web 不应维护运行诊断静态工具清单',
  );
  assert.ok(!retrieval.includes('await fetch('), 'Retrieval 页面不应保留裸业务 fetch');
  assert.ok(!idePage.includes('await fetch('), 'IDE Runs 页面不应保留裸业务 fetch');
});

test('Studio 保留 Server Action 写回闭环且 page 保持薄入口', () => {
  const page = read('app/studio/page.tsx');
  const actions = read('app/studio/actions.tsx');
  const api = read('app/studio/api.ts');
  const types = read('app/studio/types.ts');
  const validators = read('app/studio/validators.ts');
  const pageContent = read('app/studio/page-content.tsx');

  assert.ok(page.includes('page-content'));
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
  assert.ok(pageContent.includes('/studio?book_id='), '作品列表应渲染为可切换的链接');
  assert.ok(pageContent.includes('/?view=projects&book_id='), '首页 Projects 应保留作品切换链接');
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
    'app/artifacts/page-content.tsx',
    'app/artifacts/api.ts',
    'components/ide/shell/EditorArea.tsx',
    'components/ide/shell/BottomPanel.tsx',
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
