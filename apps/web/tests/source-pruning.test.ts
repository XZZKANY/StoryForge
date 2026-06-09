import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

test('已下线的 Phase 6 数据源 registry 不应继续留在 Web lib', () => {
  const staleRegistryPath = join(root, 'lib', 'phase6-data-sources.ts');

  assert.ok(
    !existsSync(staleRegistryPath),
    'phase6-data-sources.ts 已无生产或测试引用，应删除以避免阶段性 registry 回归',
  );
});

test('未接入运行链路的 Assistant 工作流规划模块不应继续保留', () => {
  const staleWorkflowPath = join(root, 'components', 'home', 'assistant-workflows.ts');

  assert.ok(
    !existsSync(staleWorkflowPath),
    'assistant-workflows.ts 仅由专属测试覆盖且未接入首页运行链路，应删除以减少规划式死代码',
  );
});

test('测试转译脚本不应保留已下线 Assistant 工作流规划模块引用', () => {
  const testRunnerSource = read('scripts/phase1-contract-test.mjs');

  for (const forbidden of [
    'components/home/assistant-workflows.ts',
    'components/home/assistant-workflows.mjs',
    '../components/home/assistant-workflows',
    './assistant-workflows',
  ] as const) {
    assert.ok(
      !testRunnerSource.includes(forbidden),
      `phase1-contract-test.mjs 不应继续引用已下线模块 ${forbidden}`,
    );
  }
});

test('未接入事件源的 Assistant 工具事件解析模块不应继续保留', () => {
  const staleEventsPath = join(root, 'components', 'home', 'assistant-tool-events.ts');

  assert.ok(
    !existsSync(staleEventsPath),
    'assistant-tool-events.ts 未被生产链路导入，应删除以避免未来事件解析规划代码滞留',
  );
});

test('测试转译脚本不应保留已下线 Assistant 工具事件解析模块引用', () => {
  const testRunnerSource = read('scripts/phase1-contract-test.mjs');

  for (const forbidden of [
    'components/home/assistant-tool-events.ts',
    'components/home/assistant-tool-events.mjs',
    '../components/home/assistant-tool-events',
    './assistant-tool-events',
  ] as const) {
    assert.ok(
      !testRunnerSource.includes(forbidden),
      `phase1-contract-test.mjs 不应继续引用已下线模块 ${forbidden}`,
    );
  }
});

test('Provider Gateway 静态占位页不应继续作为 Web 入口保留', () => {
  const staleProvidersPage = join(root, 'app', 'providers', 'page.tsx');
  const navSource = read('components/site-nav/site-nav-links.ts');
  const registrySource = read('../../apps/workflow/storyforge_workflow/tools/registry.py');

  assert.ok(
    !existsSync(staleProvidersPage),
    '/providers 仅是静态能力说明页，真实 Provider 设置入口已迁移到 /settings',
  );
  assert.ok(!navSource.includes("href: '/providers'"), '全局导航不应重新接入 /providers');
  assert.ok(
    !registrySource.includes('apps/web/app/providers/page.tsx'),
    'Workflow runtime tools 不应继续引用已下线的 providers 静态页',
  );
  assert.ok(
    registrySource.includes('apps/web/app/settings/page.tsx'),
    'Provider Gateway 运行时工具应指向真实 Provider 设置入口',
  );
});

test('未接入生产链路的 Assistant 工具 catalog 不应继续保留', () => {
  const staleCatalogPath = join(root, 'components', 'home', 'assistant-tool-catalog.ts');

  assert.ok(
    !existsSync(staleCatalogPath),
    'assistant-tool-catalog.ts 仅由专属测试和转译脚本引用，应删除以减少未接入规划代码',
  );
});

test('测试转译脚本不应保留已下线 Assistant 工具 catalog 引用', () => {
  const testRunnerSource = read('scripts/phase1-contract-test.mjs');

  for (const forbidden of [
    'components/home/assistant-tool-catalog.ts',
    'components/home/assistant-tool-catalog.mjs',
    '../components/home/assistant-tool-catalog',
    './assistant-tool-catalog',
  ] as const) {
    assert.ok(
      !testRunnerSource.includes(forbidden),
      `phase1-contract-test.mjs 不应继续引用已下线模块 ${forbidden}`,
    );
  }
});

test('未接入生产链路的 ErrorCard 不应继续保留', () => {
  const staleErrorCardPath = join(root, 'components', 'ui', 'ErrorCard.tsx');

  assert.ok(
    !existsSync(staleErrorCardPath),
    'ErrorCard.tsx 仅由组件测试和转译脚本引用，应删除以避免未接入 UI 死代码滞留',
  );
});

test('测试转译脚本不应保留已下线 ErrorCard 引用', () => {
  const testRunnerSource = read('scripts/phase1-contract-test.mjs');

  for (const forbidden of [
    'components/ui/ErrorCard.tsx',
    'components/ui/ErrorCard.mjs',
    '../components/ui/ErrorCard',
  ] as const) {
    assert.ok(
      !testRunnerSource.includes(forbidden),
      `phase1-contract-test.mjs 不应继续引用已下线模块 ${forbidden}`,
    );
  }
});

test('未接入生产链路的 IDE CommandPalette 与 keymap 辅助模块不应继续保留', () => {
  const stalePalettePath = join(root, 'components', 'ide', 'commands', 'palette.tsx');
  const staleKeymapPath = join(root, 'components', 'ide', 'keymap', 'index.ts');

  assert.ok(
    !existsSync(stalePalettePath),
    'palette.tsx 仅由测试、性能预算和转译脚本引用，应删除以避免未接入命令面板滞留',
  );
  assert.ok(
    !existsSync(staleKeymapPath),
    'keymap/index.ts 未接入运行时快捷键解析入口，应删除以避免未接入快捷键执行链路滞留',
  );
});

test('测试转译脚本不应保留已下线 IDE CommandPalette 与 keymap 引用', () => {
  const testRunnerSource = read('scripts/phase1-contract-test.mjs');

  for (const forbidden of [
    'components/ide/commands/palette.tsx',
    'components/ide/commands/palette.mjs',
    '../components/ide/commands/palette',
    'components/ide/keymap/index.ts',
    'components/ide/keymap/index.mjs',
    '../components/ide/keymap/index',
  ] as const) {
    assert.ok(
      !testRunnerSource.includes(forbidden),
      `phase1-contract-test.mjs 不应继续引用已下线模块 ${forbidden}`,
    );
  }
});

test('JobStatusPoller 不应默认轮询无后端契约的旧 jobs API', () => {
  const pollerSource = read('components/job-status/JobStatusPoller.tsx');
  const staleJobsApi = ['/api/v1', 'jobs'].join('/');

  assert.ok(
    !pollerSource.includes(staleJobsApi),
    'JobStatusPoller 默认端点不应指向无 API 路由和 OpenAPI 契约的旧 jobs API',
  );
  assert.ok(
    pollerSource.includes('/api/model-runs/job-runs'),
    'JobStatusPoller 默认端点应复用真实 JobRun 状态 API 前缀',
  );
});

test('Web 静态 jobs 页面不应继续作为任务中心主入口保留', () => {
  const staleJobsPagePath = join(root, 'app', 'jobs', 'page.tsx');
  const siteNavSource = read('components/site-nav/site-nav-links.ts');
  const staleJobsRoute = ['/jobs'].join('');

  assert.ok(
    !existsSync(staleJobsPagePath),
    'app/jobs/page.tsx 仅维护硬编码任务清单，应下线并让深链进入真实 Runs 面板',
  );
  assert.ok(
    !siteNavSource.includes(`href: '${staleJobsRoute}'`),
    'primaryNavLinks 不应继续把 /jobs 静态壳作为主导航入口',
  );
});

test('Web 静态 refinery 演示页不应继续作为批量精修主入口保留', () => {
  const staleRefineryPagePath = join(root, 'app', 'refinery', 'page.tsx');
  const siteNavSource = read('components/site-nav/site-nav-links.ts');
  const staleRefineryRoute = ['/refinery'].join('');

  assert.ok(
    !existsSync(staleRefineryPagePath),
    'app/refinery/page.tsx 仅维护硬编码评审和修订差异演示，应下线并让深链进入真实 Studio 链路',
  );
  assert.ok(
    !siteNavSource.includes(`href: '${staleRefineryRoute}'`),
    'primaryNavLinks 不应继续把 /refinery 静态演示壳作为主导航入口',
  );
});

test('Web 静态 assets 页面不应继续作为素材中心入口保留', () => {
  const staleAssetsPagePath = join(root, 'app', 'assets', 'page.tsx');
  const siteNavSource = read('components/site-nav/site-nav-links.ts');
  const staleAssetsRoute = ['/assets'].join('');

  assert.ok(
    !existsSync(staleAssetsPagePath),
    'app/assets/page.tsx 仅维护硬编码素材清单，未接入真实 /api/assets 契约，应删除',
  );
  assert.ok(
    !siteNavSource.includes(`href: '${staleAssetsRoute}'`),
    'primaryNavLinks 不应重新把 /assets 孤儿静态页作为主导航入口',
  );
});

test('Web artifacts redirect 页面壳不应继续保留', () => {
  const staleArtifactsPagePath = join(root, 'app', 'artifacts', 'page.tsx');
  const nextConfigSource = read('next.config.ts');
  const pageContentSource = read('app/artifacts/page-content.tsx');
  const artifactsApiSource = read('app/artifacts/api.ts');

  assert.ok(
    !existsSync(staleArtifactsPagePath),
    'app/artifacts/page.tsx 已被 next.config.ts 的 /artifacts 308 重定向遮蔽，应删除页面薄壳',
  );
  assert.ok(
    nextConfigSource.includes("source: '/artifacts'"),
    '/artifacts 深链必须继续由 redirect 承接',
  );
  assert.ok(
    nextConfigSource.includes("destination: '/ide?panel.bottom=artifacts'"),
    '/artifacts redirect 必须进入 IDE artifacts 面板',
  );
  assert.ok(
    pageContentSource.includes('ArtifactsPageContent'),
    '首页复用的 ArtifactsPageContent 必须保留',
  );
  assert.ok(pageContentSource.includes('ArtifactsWorkbench'), 'Artifacts 真实工作台内容必须保留');
  assert.ok(artifactsApiSource.includes('readJson'), 'Artifacts API 读取必须继续复用 readJson');
  assert.ok(
    artifactsApiSource.includes("artifactsEndpoint = '/api/artifacts'"),
    'Artifacts 工作台必须继续读取真实 /api/artifacts 契约',
  );
});

test('Web runs redirect 页面壳不应继续保留', () => {
  const staleRunsPagePath = join(root, 'app', 'runs', 'page.tsx');
  const nextConfigSource = read('next.config.ts');
  const bookRunPanelSource = read('components/ide/views/BookRunPanel.tsx');
  const bookRunEventsPanelSource = read('components/ide/views/BookRunEventsPanel.tsx');
  const bottomPanelSource = read('components/ide/shell/BottomPanel.tsx');
  const idePageSource = read('app/ide/page.tsx');
  const openApi = JSON.parse(
    read('../../packages/shared/src/contracts/storyforge.openapi.json'),
  ) as {
    readonly paths?: Record<string, unknown>;
    readonly components?: { readonly schemas?: Record<string, unknown> };
  };

  assert.ok(
    !existsSync(staleRunsPagePath),
    'app/runs/page.tsx 已被 next.config.ts 的 /runs 308 重定向遮蔽，应删除旧运行诊断页面壳',
  );
  assert.ok(nextConfigSource.includes("source: '/runs'"), '/runs 深链必须继续由 redirect 承接');
  assert.ok(
    nextConfigSource.includes("destination: '/ide?panel.bottom=runs'"),
    '/runs redirect 必须进入 IDE runs 面板',
  );
  assert.ok(bookRunPanelSource.includes('BookRunPanel'), 'IDE BookRunPanel 必须保留');
  assert.ok(bookRunPanelSource.includes('checkpoint'), 'IDE runs 面板必须继续展示 checkpoint');
  assert.ok(
    bookRunPanelSource.includes('modelRunHref'),
    'IDE runs 面板必须继续提供 ModelRun 追溯链接',
  );
  assert.ok(
    bookRunEventsPanelSource.includes('BookRunEventsPanel'),
    'IDE BookRunEventsPanel 必须保留',
  );
  assert.ok(
    bookRunEventsPanelSource.includes('/api/book-runs/${run.id}/events'),
    'IDE runs 面板必须通过 Web 同源代理暴露浏览器 SSE 事件',
  );
  assert.ok(
    bottomPanelSource.includes("activePanel === 'runs'"),
    'BottomPanel 必须继续装配 runs 面板',
  );
  assert.ok(idePageSource.includes('/api/book-runs/'), 'IDE runs 页面必须继续读取 BookRun API');
  assert.ok(idePageSource.includes('/api/ide/runs/'), 'IDE runs 页面必须继续读取 runs SSE API');
  assert.ok(
    openApi.paths?.['/api/model-runs/job-runs/{job_run_id}'],
    'OpenAPI 必须保留 JobRun runtime diagnostics 读侧端点',
  );
  assert.ok(openApi.paths?.['/api/runtime-tools'], 'OpenAPI 必须保留 runtime tools 端点');
  assert.ok(
    openApi.components?.schemas?.RunsRuntimeDiagnosticsRead,
    'OpenAPI 必须保留 RunsRuntimeDiagnosticsRead 契约',
  );
});

test('Web evaluations redirect 旧页面不应继续保留', () => {
  const staleEvaluationsPagePath = join(root, 'app', 'evaluations', 'page.tsx');
  const nextConfigSource = read('next.config.ts');
  const editorAreaSource = read('components/ide/shell/EditorArea.tsx');
  const bottomPanelSource = read('components/ide/shell/BottomPanel.tsx');
  const ideUrlStateSource = read('components/ide/url/ide-url-state.ts');
  const registrySource = read('../../apps/workflow/storyforge_workflow/tools/registry.py');
  const openApi = JSON.parse(
    read('../../packages/shared/src/contracts/storyforge.openapi.json'),
  ) as {
    readonly paths?: Record<string, unknown>;
    readonly components?: { readonly schemas?: Record<string, unknown> };
  };

  assert.ok(
    !existsSync(staleEvaluationsPagePath),
    'app/evaluations/page.tsx 已被 next.config.ts 的 /evaluations 308 重定向遮蔽，应删除旧评测页面',
  );
  assert.ok(
    nextConfigSource.includes("source: '/evaluations'"),
    '/evaluations 深链必须继续由 redirect 承接',
  );
  assert.ok(
    nextConfigSource.includes("destination: '/ide?panel.bottom=evaluation'"),
    '/evaluations redirect 必须进入 IDE evaluation 面板',
  );
  assert.ok(
    editorAreaSource.includes("'legacy:evaluations'"),
    'EditorArea 必须保留 legacy:evaluations 入口元数据',
  );
  assert.ok(
    editorAreaSource.includes('Evaluations 评测系统'),
    'EditorArea 必须保留 Evaluations 评测系统标题',
  );
  assert.ok(bottomPanelSource.includes("'evaluation'"), 'BottomPanel 必须保留 evaluation 面板槽位');
  assert.ok(
    ideUrlStateSource.includes("| 'evaluation'"),
    'IDE URL 状态必须继续识别 evaluation 面板',
  );
  assert.ok(
    !registrySource.includes('apps/web/app/evaluations/page.tsx'),
    'Workflow runtime tools 不应继续引用已删除的 evaluations 旧页面',
  );
  for (const path of [
    '/api/evaluations/cases',
    '/api/evaluations/runs',
    '/api/evaluations/runs/{run_id}',
    '/api/evaluations/runs/{run_id}/failed-samples',
  ] as const) {
    assert.ok(openApi.paths?.[path], `OpenAPI 必须保留 ${path} 评测契约`);
  }
  for (const schema of [
    'EvaluationRunRead',
    'EvaluationRunDetailRead',
    'EvaluationFailedSampleRead',
  ] as const) {
    assert.ok(openApi.components?.schemas?.[schema], `OpenAPI 必须保留 ${schema} schema`);
  }
});
