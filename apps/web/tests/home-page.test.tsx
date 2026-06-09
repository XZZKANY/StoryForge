import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

test('首页入口指向 HomeShell 而非旧版导航卡片', () => {
  const page = read('app/page.tsx');
  assert.ok(page.includes("from '../components/home/HomeShell'"), '首页应导入 HomeShell');
  assert.ok(page.includes('searchParams'), '首页应读取 searchParams 驱动主工作台子页');
  assert.ok(page.includes('parseHomeView'), '首页应通过 HomeView 契约解析 view query');
  assert.ok(page.includes('activeView={activeView}'), '首页应把 activeView 传给 HomeShell');
  assert.ok(!page.includes('Studio 创作链路'), '首页不应保留旧版主入口卡片');
  assert.ok(!page.includes('治理与诊断入口'), '首页不应保留旧版治理与诊断入口区块');
});

test('HomeView 契约只允许主工作台已定义子页', () => {
  const view = read('components/home/home-view.ts');
  for (const item of ['assistant', 'projects', 'artifacts']) {
    assert.ok(view.includes(`'${item}'`), `HomeView 应包含 ${item}`);
  }
  assert.ok(!view.includes("'new-project',"), 'New project 不应再作为首页一级 view');
  assert.ok(view.includes("view === 'new-project'"), '旧 new-project query 应兼容归并到 Projects');
  assert.ok(view.includes("return 'projects'"), '旧 new-project query 应回到 Projects');
  assert.ok(!view.includes("'customize'"), 'Customize 不应再作为首页一级 view');
  assert.ok(view.includes('parseHomeView'), '应暴露 parseHomeView');
  assert.ok(view.includes(": 'assistant'"), '未知 view 应回退 assistant');
});

test('home-data 暴露 Assistant 首页的信息架构入口', () => {
  const data = read('components/home/home-data.ts');
  for (const label of ['Projects 项目', 'Artifacts 产物']) {
    assert.ok(data.includes(`'${label}'`), `导航应包含 ${label}`);
  }
  assert.ok(!data.includes("view: 'new-project'"), 'New project 不应再占用左侧一级导航');
  assert.ok(!data.includes('New project 新建项目'), 'New project 不应再作为左侧一级导航文案');
  assert.ok(!data.includes('Customize 创作偏好'), 'Customize 不应占用首页一级导航');
  for (const label of [
    'Settings 设置',
    'Provider/API Key',
    'Help 帮助',
    'Upgrade 升级',
    'Sign out 退出',
  ]) {
    assert.ok(data.includes(`'${label}'`), `账号菜单应包含 ${label}`);
  }
  for (const view of ['projects', 'artifacts']) {
    assert.ok(data.includes(`view: '${view}'`), `home-data 应映射首页子页 ${view}`);
  }
  assert.ok(!data.includes("href: '/blueprints'"), '主导航不应跳出首页到 /blueprints');
  assert.ok(!data.includes("href: '/studio'"), '主导航不应跳出首页到 /studio');
  assert.ok(!data.includes("href: '/artifacts'"), '主导航不应跳出首页到 /artifacts');
  assert.ok(data.includes('今天要锻造哪段故事？'), '应包含动态问候副标题');
  assert.ok(
    data.includes('给 StoryForge Assistant 发送消息'),
    '应包含 Assistant 输入框 placeholder',
  );
  assert.ok(data.includes('下午好'), '应包含现实时间问候映射');
});

test('HomeShell 首屏采用 Assistant 对话台，工具流程树不默认占据首屏', () => {
  const shell = read('components/home/HomeShell.tsx');
  const chrome = read('components/site-nav/Chrome.tsx');
  const conversation = read('components/home/AssistantConversation.tsx');
  const messageList = read('components/home/AssistantMessageList.tsx');
  const actionBar = read('components/home/AssistantActionBar.tsx');
  const greeting = read('components/home/HomeGreeting.tsx');
  const tree = read('components/home/AssistantToolTree.tsx');
  const data = read('components/home/home-data.ts');
  assert.ok(chrome.includes('UnifiedSidebar'), '首页应复用全局统一侧栏');
  assert.ok(!chrome.includes("pathname === '/'"), '首页不得绕过全局 Chrome 侧栏');
  assert.ok(!shell.includes('HomeSidebar'), 'HomeShell 不应再拉回旧版首页专属侧栏');
  assert.ok(!shell.includes('md:grid-cols-[288px_minmax(0,1fr)]'), '首页不应再自建旧版双栏壳');
  assert.ok(shell.includes('w-full'), '首页内容应填满全局 Chrome 右侧主区域');
  assert.ok(
    conversation.includes('w-full px-6 pb-14'),
    'Assistant 外层应与 Projects 一样由页面容器提供左右留白',
  );
  assert.ok(conversation.includes('max-w-[1040px]'), 'Assistant 主界面应恢复旧版宽输入区域');
  assert.ok(!shell.includes('-translate-y-'), 'Assistant 主界面不应再使用居中英雄位移');
  assert.ok(!shell.includes('flex-1'), 'Assistant 主界面不应再强制垂直居中为大英雄');
  assert.ok(greeting.includes('StoryForge Assistant'), '首页应使用 Assistant 命名');
  assert.ok(greeting.includes('text-left'), 'Assistant 主界面标题应左对齐');
  assert.ok(
    greeting.includes('!text-[clamp(38px,4vw,58px)]'),
    'Assistant 主界面标题应恢复旧版大问候尺度',
  );
  assert.ok(greeting.includes('晚上好'), 'Assistant 主界面问候应恢复旧版首屏文案');
  assert.ok(!greeting.includes('new Date'), 'Assistant 主界面不应在渲染期用当前时间生成问候');
  assert.ok(shell.includes('AssistantConversation'), '首页首屏应渲染 Assistant 对话台');
  assert.ok(conversation.includes('HomeComposer'), '对话台应承载 Assistant 输入框');
  assert.ok(conversation.includes('AssistantMessageList'), '对话台应承载消息流');
  assert.ok(
    conversation.includes('parseAssistantIntent'),
    '对话台应基于确定性 intent 生成确认消息',
  );
  assert.ok(
    conversation.includes('readBookRun'),
    'Assistant 对话层应复用 BookRun API helper 读取真实运行状态',
  );
  assert.ok(
    conversation.includes(['..', '..', 'app', 'book-runs', 'api'].join('/')),
    'Assistant 对话层应从 BookRun API helper 模块读取真实运行状态',
  );
  assert.ok(
    conversation.includes('mapBookRunToAssistantToolNodes'),
    'Assistant 对话层应把真实 BookRun 映射为工具树节点',
  );
  assert.ok(
    conversation.includes('await readBookRun(bookRunId)'),
    'Assistant 有 book_run_id 时应读取真实 BookRun 详情',
  );
  assert.ok(messageList.includes('toolNodes.length > 0'), '消息列表仅在真实节点存在时展示工具树');
  assert.ok(messageList.includes('AssistantToolTree'), '消息列表应复用工具树展示真实节点');
  assert.ok(actionBar.includes('/api/book-runs/'), '流程操作按钮应指向 BookRun 原生控制端点');
  assert.ok(
    actionBar.includes('action={submitAssistantBookRunCommand}'),
    '流程操作按钮应通过 Server Action 真实提交 BookRun 控制命令',
  );
  assert.ok(
    actionBar.includes('submitAssistantArtifactExport'),
    '流程操作按钮应提供真实导出 Markdown、EPUB 和审计报告的 Server Action',
  );
  assert.ok(
    actionBar.includes('submitAssistantChapterReview'),
    '流程操作按钮应提供真实读取 Judge、Repair 和批准摘要的 Server Action',
  );
  assert.ok(
    actionBar.includes('approveStudioWritebackAction'),
    '流程操作按钮应复用 Studio 批准写回 Server Action',
  );
  assert.ok(
    actionBar.includes('name="repair_patch_id"'),
    'Assistant 应用修复应把真实 repair_patch_id 提交给 Studio 写回能力',
  );
  assert.ok(actionBar.includes('应用修复'), 'Assistant 应在有 Repair Patch 时提供应用修复按钮');
  assert.ok(!actionBar.includes('批准写回'), 'Assistant 按钮文案不应让写回动作看起来像审批流程');
  assert.ok(
    conversation.includes('readPositiveInt(firstParam(searchParams.book_run_id))'),
    'Assistant 应从 URL 读取真实 book_run_id 启用控制按钮',
  );
  assert.ok(
    conversation.includes('readPositiveInt(firstParam(searchParams.book_id))'),
    'Assistant 应从 URL 读取真实 book_id 以支持章节序号定位',
  );
  assert.ok(
    conversation.includes('readPositiveInt(firstParam(searchParams.assistant_session_id))'),
    'Assistant 应从 URL 读取真实 assistant_session_id 以延续会话',
  );
  assert.ok(
    conversation.includes('readAssistantSession'),
    'Assistant 应按 assistant_session_id 读取真实会话详情以恢复历史消息',
  );
  assert.ok(
    conversation.includes('assistantSessionMessagesFor'),
    'Assistant 应把会话详情中的历史 messages 映射回消息流',
  );
  assert.ok(
    conversation.includes('assistant-session-query'),
    'Assistant 会话详情读取失败时应展示可追溯的查询消息',
  );
  assert.ok(
    conversation.includes('readPositiveInt(firstParam(searchParams.scene_packet_id))'),
    'Assistant 应从 URL 读取真实 scene_packet_id 启用章节审阅按钮',
  );
  assert.ok(
    conversation.includes('searchParams.target_chapter_ordinal'),
    'Assistant 应从 URL 读取目标章节序号以定位 Scene Packet',
  );
  assert.ok(
    conversation.includes('readPositiveInt(firstParam(searchParams.repair_patch_id))'),
    'Assistant 应从 URL 读取真实 repair_patch_id 启用批准写回按钮',
  );
  assert.ok(
    conversation.includes('firstParam(searchParams.chapter_review_status)'),
    'Assistant 应读取章节审阅状态并回写消息流',
  );
  assert.ok(
    conversation.includes('firstParam(searchParams.chapter_review_summary)'),
    'Assistant 应读取章节审阅短摘要并回写消息流',
  );
  assert.ok(
    conversation.includes('chapterReviewMessageFor'),
    'Assistant 应把章节审阅结果映射为用户可见摘要',
  );
  assert.ok(
    conversation.includes('formatChapterReviewSummary'),
    'Assistant 应把 Judge issue 与 Repair Patch 短摘要格式化进 ready/failed 消息',
  );
  assert.ok(
    conversation.includes('需要选择真实章节或 Scene Packet'),
    'Assistant 章节审阅缺少目标时应提示选择真实章节',
  );
  assert.ok(
    conversation.includes('Repair Patch'),
    'Assistant 章节审阅完成后应提示可应用 Repair Patch',
  );
  assert.ok(
    conversation.includes('证据引用'),
    'Assistant 章节审阅消息应尽量展示 Judge issue 的证据引用',
  );
  assert.ok(
    conversation.includes('firstParam(searchParams.artifact_export_status)'),
    'Assistant 应读取导出状态并回写消息流',
  );
  assert.ok(
    conversation.includes('firstParam(searchParams.artifact_export_error)'),
    'Assistant 应读取导出失败原因并回写消息流',
  );
  assert.ok(
    conversation.includes('artifactExportMessageFor'),
    'Assistant 应把导出结果映射为用户可见摘要',
  );
  assert.ok(
    conversation.includes("artifactExportStatus === 'failed'"),
    'Assistant 应把导出失败状态映射为用户可见摘要',
  );
  assert.ok(
    conversation.includes('Markdown、EPUB 和审计报告'),
    'Assistant 导出成功消息应列出 Markdown、EPUB 和审计报告',
  );
  assert.ok(
    conversation.includes('repairPatchId={repairPatchId}'),
    'Assistant 应把 repair_patch_id 传给流程操作条',
  );
  assert.ok(conversation.includes('bookId={bookId}'), 'Assistant 应把 book_id 传给流程操作条');
  assert.ok(
    conversation.includes('targetChapterOrdinal={targetChapterOrdinal}'),
    'Assistant 应把目标章节序号传给流程操作条',
  );
  assert.ok(
    conversation.includes('bookRunStatus={bookRunStatus}'),
    'Assistant 应把真实 BookRun 状态传给流程操作条',
  );
  assert.ok(
    conversation.includes('assistantSessionId={assistantSessionId}'),
    'Assistant 应把 assistant_session_id 传给流程操作条',
  );
  assert.ok(
    actionBar.includes('name="assistant_session_id"'),
    'Assistant 所有流程操作表单应携带 assistant_session_id hidden 字段',
  );
  assert.ok(
    actionBar.includes('name="book_id"'),
    '章节审阅表单应携带真实 book_id 以支持章节序号定位',
  );
  assert.ok(
    actionBar.includes('name="target_chapter_ordinal"'),
    '章节审阅表单应携带目标章节序号以支持 Scene Packet 定位',
  );
  assert.ok(actionBar.includes('disabledReason'), '无法执行的按钮应展示明确原因');
  assert.ok(actionBar.includes('bookRunStatus?: string'), '流程操作条应接收真实 BookRun 状态');
  assert.ok(
    actionBar.includes("bookRunStatus === 'completed'"),
    '导出入口只应在 completed BookRun 上可点击',
  );
  assert.ok(actionBar.includes('disabled={Boolean(exportReason)}'), '非 completed 导出入口应禁用');
  assert.ok(actionBar.includes('title={exportReason}'), '非 completed 导出入口应说明不可导出原因');
  assert.ok(!conversation.includes('completed'), '对话台初始确认消息不得伪造 completed 状态');
  assert.ok(!shell.includes('<AssistantToolTree'), '首屏不应默认渲染大号工具流程树');
  assert.ok(!shell.includes('StoryForge Assistant 已理解目标'), '首屏不应默认展示对话后的回复卡片');
  assert.ok(!data.includes('assistantToolNodes'), 'home-data 不应保留静态工具树成功节点');
  assert.ok(tree.includes('toolNodes'), '工具树应从 props 接收真实节点');
  assert.ok(tree.includes('toolNodes.length === 0'), '无真实节点时工具树应展示空状态');
  assert.ok(tree.includes('Goal.analyze'), '空状态可提示待执行 Goal.analyze，但不得标记 completed');
  assert.ok(!tree.includes('2m 45s'), '工具树顶部不应展示硬编码耗时');
  assert.ok(!tree.includes('7.7k tokens'), '工具树顶部不应展示硬编码 token');
  assert.ok(!tree.includes('thought for 8s'), '工具树顶部不应展示硬编码思考耗时');
  assert.ok(tree.includes('查看审计'), 'Assistant 流程应提供查看审计操作');
  assert.ok(shell.includes('bg-[#171715]'), '首页内容区域使用统一深色背景');
});

test('HomeShell 子页面主区域铺满右侧且移除重复状态胶囊', () => {
  const shell = read('components/home/HomeShell.tsx');
  const chrome = read('components/site-nav/Chrome.tsx');

  assert.ok(chrome.includes('UnifiedSidebar'), '左侧侧栏应统一由 Chrome 提供');
  assert.ok(shell.includes('overflow-x-hidden bg-[#171715]'), '右侧 main 背景应与左侧侧栏一致');
  assert.ok(shell.includes('max-w-none'), '非 assistant 子页面内容应铺满右侧可用宽度');
  assert.ok(
    !shell.includes('max-w-[min(1040px,calc(100vw-336px))]'),
    '非 assistant 子页面不应保留旧版窄宽度限制',
  );
  assert.ok(!shell.includes('href="/settings"'), '右侧顶部不应重复渲染 settings 状态胶囊');
  assert.ok(!shell.includes('homeWorkspaceLabel,'), 'HomeShell 不应再导入右侧状态胶囊的工作区文案');
  assert.ok(
    !shell.includes('homeProviderUncheckedLabel,'),
    'HomeShell 不应再导入右侧状态胶囊的 Provider 文案',
  );
  assert.ok(shell.includes('[&_section]:!bg-transparent'), '首页子页应重置全局 section 大卡片背景');
  assert.ok(shell.includes('[&_section]:!shadow-none'), '首页子页应重置全局 section 阴影');
  assert.ok(shell.includes('[&_section]:!rounded-none'), '首页子页应重置全局 section 圆角');
  assert.ok(shell.includes('max-w-[770px]'), 'Artifacts 应沿用 Projects 内容宽度节奏');
});

test('UnifiedSidebar 作为全站唯一主导航和账号工作区菜单', () => {
  const chrome = read('components/site-nav/Chrome.tsx');
  const sidebar = read('components/site-nav/UnifiedSidebar.tsx');
  const homeShell = read('components/home/HomeShell.tsx');

  assert.ok(chrome.includes("'use client'"), '全局 Chrome 需要客户端路径上下文');
  assert.ok(chrome.includes('UnifiedSidebar'), '全局 Chrome 应装配统一侧栏');
  assert.ok(!chrome.includes("pathname === '/'"), '首页不得跳过统一侧栏');
  assert.ok(sidebar.includes('aria-label="StoryForge 主导航"'), '统一导航应带 aria-label');
  assert.ok(sidebar.includes('助手对话'), '统一侧栏应包含 Assistant 首页入口');
  assert.ok(sidebar.includes('我的项目'), '统一侧栏应包含项目入口');
  assert.ok(sidebar.includes('运行与设置'), '统一侧栏应包含运行与设置入口');
  assert.ok(sidebar.includes('RecentItemsList'), '统一侧栏应承载最近记录区块');
  assert.ok(sidebar.includes('ThemeToggle'), '统一侧栏应承载主题切换按钮');
  assert.ok(sidebar.includes('href="/settings"'), '统一账号菜单应提供设置入口');
  assert.ok(!homeShell.includes('HomeSidebar'), '首页不应再引用旧版 HomeSidebar');
});

test('首页最近记录不得使用静态伪历史', () => {
  const page = read('app/page.tsx');
  const shell = read('components/home/HomeShell.tsx');
  const data = read('components/home/home-data.ts');
  const sidebar = read('components/site-nav/UnifiedSidebar.tsx');
  const sessionStore = read('components/home/assistant-session-store.ts');

  assert.ok(!data.includes('homeRecentItems'), 'home-data 不应导出静态最近记录数组');
  for (const fakeRecord of [
    'Planning a full day trip',
    'How compound interest works',
    'Design a learning challenge that fits',
    '最近一次真实 LLM 冒烟',
    '用于后续 Repair.suggest',
  ]) {
    assert.ok(!data.includes(fakeRecord), `home-data 不应包含伪造最近记录：${fakeRecord}`);
    assert.ok(!sidebar.includes(fakeRecord), `UnifiedSidebar 不应内置伪造最近记录：${fakeRecord}`);
  }

  const recentList = read('components/site-nav/RecentItemsList.tsx');

  const layout = read('app/layout.tsx');

  assert.ok(
    layout.includes('readRecentAssistantSessions'),
    '统一侧栏应由 layout 服务端读取真实 Assistant 最近会话',
  );
  assert.ok(
    layout.includes('initialRecentItems={recentAssistantItems}'),
    'layout 应把真实最近会话传给客户端 Chrome',
  );
  assert.ok(
    sidebar.includes('initialRecentItems') && sidebar.includes('<RecentItemsList initialItems={initialRecentItems} />'),
    'UnifiedSidebar 应把真实最近会话传给 RecentItemsList',
  );
  assert.ok(
    recentList.includes('initialItems') && recentList.includes('mergedItems'),
    'RecentItemsList 应合并真实最近会话和 localStorage 补充记录',
  );
  assert.ok(!page.includes('recentItems={[]}'), '首页不得继续硬编码空最近记录');
  assert.ok(
    sessionStore.includes("readJson<readonly AssistantSessionRead[]>('/api/assistant/sessions'"),
    '最近记录 helper 必须通过统一 API client 读取 Assistant 会话',
  );
  assert.ok(
    sessionStore.includes('mapAssistantSessionToHomeRecentItem'),
    '最近记录 helper 应把 Assistant 会话映射为 HomeRecentItem',
  );
  assert.ok(
    sessionStore.includes('book_run_id') && sessionStore.includes('artifact_id'),
    '最近记录摘要应保留 BookRun 或 Artifact 追溯信息',
  );
  assert.ok(
    sessionStore.includes('assistant_session_id') &&
      sessionStore.includes('params.set') &&
      sessionStore.includes('href:'),
    '最近记录应包含可跳转回 Assistant 会话和关联任务的 href',
  );
  assert.ok(data.includes('暂无最近记录。完成首个 Blueprint 或 BookRun 后将在此显示。'));
});

test('HomeComposer 是底部 Assistant 输入框且没有模式按钮', () => {
  const composer = read('components/home/HomeComposer.tsx');
  const conversation = read('components/home/AssistantConversation.tsx');
  assert.ok(composer.includes("'use client'"), '输入框需要客户端交互');
  assert.ok(composer.includes('useSearchParams'), '输入提交应保留当前 URL 中的真实上下文参数');
  assert.ok(composer.includes('parseAssistantIntent'), '输入提交应按任务类型决定后续工作台视图');
  assert.ok(composer.includes('action="/"'), '客户端未水合时表单也应降级提交到首页');
  assert.ok(composer.includes('name="view"'), '表单降级提交应携带 view=projects');
  assert.ok(composer.includes('value="projects"'), 'Assistant 输入应默认进入 Projects 子页');
  assert.ok(composer.includes('method="get"'), '表单降级提交应使用 GET 保留 intent 查询');
  assert.ok(
    composer.includes('aria-label="给 StoryForge Assistant 发送消息"'),
    '输入框需 Assistant aria-label',
  );
  assert.ok(
    composer.includes("parsedIntent.taskType === 'trial_generation'"),
    '生成类任务应继续切到首页 Projects 子页',
  );
  assert.ok(
    composer.includes("params.set('view', 'projects')"),
    '生成类任务应保留 Projects 创建链路',
  );
  assert.ok(composer.includes("'book_id'"), 'Assistant 输入应保留当前 book_id 以支持章节审阅定位');
  assert.ok(
    composer.includes("'target_chapter_ordinal'"),
    'Assistant 输入应保留当前 target_chapter_ordinal 以连续审阅同一章节目标',
  );
  assert.ok(
    composer.includes("'artifact_id'"),
    'Assistant 输入应保留当前 artifact_id 以延续最近产物追溯',
  );
  assert.ok(
    conversation.includes('<HomeComposer initialSearchParams={searchParams} />'),
    'Assistant 对话层应把服务端 searchParams 传给输入框以支持 GET 降级保留上下文',
  );
  assert.ok(
    composer.includes('initialSearchParams'),
    'HomeComposer 应接收初始 searchParams 以渲染 GET 降级 hidden input',
  );
  assert.ok(
    composer.includes('preservedContextQueryKeys') &&
      composer.includes('preservedContextQueryKeys.map'),
    'HomeComposer 客户端提交和 GET 降级应复用同一上下文参数白名单',
  );
  assert.ok(
    composer.includes('type="hidden"') &&
      composer.includes('name={key}') &&
      composer.includes('value={value}'),
    'HomeComposer GET 降级表单应把已有上下文渲染为 hidden input',
  );
  assert.ok(composer.includes('if (!intent) return'), '空输入不应执行假提交');
  assert.ok(
    composer.includes('router.push(`/?${params.toString()}`)'),
    '默认提交应切到首页 Projects 子页',
  );
  assert.ok(composer.includes('className="w-full"'), 'Assistant 输入框应跟随主界面 770px 内容宽度');
  assert.ok(
    composer.includes('rounded-lg border-0 bg-[#30302d] p-3'),
    'Assistant 输入框应恢复旧版灰色输入面板',
  );
  assert.ok(!composer.includes('shadow-[0_18px_50px'), 'Assistant 输入框不应保留厚重阴影');
  assert.ok(composer.includes('aria-label="附加资料"'), 'Assistant 输入框应恢复旧版附加资料按钮');
  assert.ok(composer.includes('type="file"'), '附加资料按钮应绑定真实文件输入而不是空按钮');
  assert.ok(composer.includes('fileInputRef.current?.click()'), '附加资料按钮应触发文件选择');
  assert.ok(composer.includes('disabled={!value.trim()}'), '发送按钮应在空输入时禁用');
  assert.ok(composer.includes('justify-center'), 'Assistant 快捷动作应恢复旧版居中按钮行');
  assert.ok(composer.includes('htmlFor="home-composer-input"'), '应保留可访问 label 关联');
  assert.ok(
    composer.includes('给 StoryForge Assistant 发送消息'),
    '底部输入框应使用 Assistant placeholder',
  );
  for (const action of [
    'New project 新建',
    'Current project 当前项目',
    'Review 审阅',
    'Artifacts 产物',
  ]) {
    assert.ok(composer.includes(action), `输入框下方应提供 ${action} 快捷动作`);
  }
  assert.ok(!composer.includes('创作模式'), '不应保留模式按钮');
});

test('Assistant 连续会话浏览器验证脚本覆盖真实点击和刷新恢复', () => {
  const scriptPath = 'scripts/verify-continuous-session-browser.mjs';
  const packageJson = read('package.json');
  assert.ok(
    packageJson.includes('"verify:browser-session"'),
    'Web package 应提供浏览器连续会话验证入口',
  );
  assert.ok(
    packageJson.includes('node scripts/verify-continuous-session-browser.mjs'),
    '浏览器连续会话验证入口应指向可重复脚本',
  );
  assert.ok(existsSync(join(root, scriptPath)), '应提供可重复运行的连续会话浏览器验证脚本');
  const script = read(scriptPath);
  assert.ok(script.includes("from 'playwright'"), '浏览器验证应使用 Playwright 普通 Node 库');
  assert.ok(script.includes('chromium.launch'), '浏览器验证应启动真实 Chromium 浏览器');
  assert.ok(script.includes('textarea[name="intent"]'), '浏览器验证应填入真实 Assistant 输入框');
  assert.ok(script.includes('button[type="submit"]'), '浏览器验证应点击真实发送按钮');
  assert.ok(
    script.includes('submitIntentAfterHydration'),
    '浏览器验证应在 React 水合后重试填入和点击，避免按钮状态回写导致误判',
  );
  assert.ok(
    script.includes('lastClickError'),
    '浏览器验证失败时应保留最后一次点击失败原因，便于定位真实浏览器竞态',
  );
  assert.ok(script.includes('waitForFunction'), '浏览器验证应等待 URL 查询参数完成更新');
  assert.ok(script.includes('page.reload'), '浏览器验证应覆盖刷新后的上下文保留');
  for (const key of ['assistant_session_id', 'book_id', 'target_chapter_ordinal', 'artifact_id']) {
    assert.ok(script.includes(key), `浏览器验证应覆盖上下文字段 ${key}`);
  }
});

test('HomeShell 子页承载旧页面核心功能而不是只给入口', () => {
  const shell = read('components/home/HomeShell.tsx');
  assert.ok(shell.includes('HomeProjectsPanel'), 'projects 子页应渲染真实项目面板');
  assert.ok(
    shell.includes('readHomeProjects'),
    'projects 子页应在服务端读取真实项目列表后再传给面板',
  );
  assert.ok(
    shell.includes('projectListState={projectListState}'),
    'HomeShell 应把真实项目列表状态传给 Projects 面板',
  );
  assert.ok(shell.includes('ArtifactsPageContent'), 'artifacts 子页应嵌入 Artifacts 工作台内容');
  assert.ok(shell.includes('Artifacts'), 'Artifacts 标题应与 Projects 使用同一类简洁命名');
  assert.ok(
    !shell.includes("activeView === 'new-project'"),
    'HomeShell 不应保留 New project 独立分支',
  );
  assert.ok(
    !shell.includes('BlueprintWorkspacePanel'),
    'New project 已并入 Projects，不应在 HomeShell 保留独立 Blueprint 分支',
  );
  assert.ok(!shell.includes('CreativePreferencesPanel'), '创作偏好不应由独立 New project 分支承载');
  assert.ok(!shell.includes('New project 创建向导'), 'New project 不应再呈现独立向导页');
  assert.ok(!shell.includes('StudioWorkbench'), 'Projects 首屏不应直接堆叠 Studio 大工作台');
  assert.ok(!shell.includes('Studio 创作工作台'), 'Projects 首屏不应出现 Studio 大标题');
  assert.ok(
    !shell.includes('projectWorkspaceSections.map'),
    'Projects 不应再使用卡片式分区按钮生成主结构',
  );
  assert.ok(!shell.includes('projectLifecycleRows'), 'Projects 不应用流程占位行冒充项目列表');
  assert.ok(
    !shell.includes('最近更新由真实作品列表决定'),
    'Projects 不应用说明文字冒充项目更新时间',
  );
  assert.ok(!shell.includes('演示版'), '首页工作台不应出现演示版文案');
  assert.ok(!shell.includes('演示数据'), '首页工作台不应出现演示数据说明');
  assert.ok(!shell.includes('伪装'), '首页工作台不应把防伪说明直接写到界面里');
  assert.ok(!shell.includes('未联通能力'), '首页工作台不应展示开发边界说明');
  assert.ok(
    !shell.includes('rounded-xl border border-[#3a3935] bg-[#262622]'),
    'New project 不应使用卡片式步骤块',
  );
  assert.ok(shell.includes('当前项目产物库'), 'Artifacts 应以当前项目产物库呈现');
  for (const artifactListElement of ['产物列表', '类型', '版本', '关联项目']) {
    assert.ok(
      shell.includes(artifactListElement),
      `Artifacts 应呈现列表字段：${artifactListElement}`,
    );
  }
  assert.ok(!shell.includes('未实现边界'), '首页 Artifacts 不应把未实现说明作为主内容');
  assert.ok(!shell.includes("activeView === 'customize'"), 'HomeShell 不应保留独立 Customize 分支');
  assert.ok(shell.includes("activeView === 'assistant'"), 'assistant 应保留输入优先首屏');
});

test('HomeProjectsPanel 通过 API 展示真实 Projects 而不是 localStorage 静态项目', () => {
  const panel = read('components/home/HomeProjectsPanel.tsx');
  const api = read('components/home/home-projects-api.ts');
  const actions = read('components/home/home-project-actions.ts');
  assert.ok(panel.includes("'use client'"), 'Projects 面板需要客户端搜索和排序交互');
  assert.ok(
    api.includes("readJson<readonly WorkspaceRead[]>('/api/workspaces'"),
    'Projects 应通过统一 API client 读取 /api/workspaces 列表',
  );
  assert.ok(
    api.includes('mapWorkspaceToHomeProject'),
    'Projects API helper 应把 WorkspaceRead 映射为 HomeProjectItem',
  );
  assert.ok(
    api.includes("'/?view=projects&workspace_id=${workspace.id}'") ||
      api.includes('`/?view=projects&workspace_id=${workspace.id}`'),
    'Projects API helper 应生成已有首页深链，避免跳到不存在的工作区详情路由',
  );
  assert.ok(
    panel.includes('projectListState'),
    'Projects 面板应从父组件接收真实项目列表状态',
  );
  assert.ok(
    panel.includes('projectListState.status ===') && panel.includes('projectListState.projects'),
    'Projects 面板应只从 API 状态稳定派生项目数组',
  );
  assert.ok(
    actions.includes("'use server'"),
    '新建 Project 应通过 Server Action 调用真实后端',
  );
  assert.ok(
    actions.includes("apiFetch('/api/workspaces'"),
    '新建 Project Server Action 应 POST 到 /api/workspaces',
  );
  assert.ok(
    panel.includes('action={createHomeProjectAction}'),
    'New project 表单应绑定真实创建 Server Action',
  );
  assert.ok(!panel.includes('localStorage'), 'Projects 不应再读取或写入 localStorage');
  assert.ok(!panel.includes('readLocalProjects'), 'Projects 不应再保留本地读取函数');
  assert.ok(!panel.includes('writeLocalProjects'), 'Projects 不应再保留本地写入函数');
  assert.ok(
    !panel.includes('local-'),
    'Projects 不应再生成本地伪项目 ID',
  );
  assert.ok(
    panel.includes('!m-0 !border-0 !bg-transparent !p-0 !shadow-none'),
    'Projects 外层不应继承全局 section 大卡片样式',
  );
  assert.ok(panel.includes('max-w-[770px]'), 'Projects 内容宽度应贴近参考图比例');
  assert.ok(panel.includes('Projects'), 'Projects 标题应保持参考图式简洁命名');
  assert.ok(!panel.includes('Projects 项目'), 'Projects 标题不应再放大为中英混排标题');
  assert.ok(panel.includes('Search projects...'), 'Projects 应提供参考图式搜索框');
  assert.ok(panel.includes('Sort by'), 'Projects 应提供排序控件');
  assert.ok(panel.includes('Activity'), '排序按钮应使用参考图式 Activity 文案');
  assert.ok(panel.includes('New project'), 'Projects 应提供新建按钮');
  assert.ok(panel.includes('name="title"'), '新建表单应提交真实项目标题');
  assert.ok(panel.includes('name="description"'), '新建表单应提交真实项目描述');
  assert.ok(panel.includes('setSortMode'), '排序按钮应切换排序模式');
  assert.ok(panel.includes('setSearchQuery'), '搜索框应更新过滤条件');
  assert.ok(panel.includes('href={project.href}'), '项目项应使用 API helper 生成的真实项目链接');
  assert.ok(panel.includes('filteredProjects'), '项目列表应由搜索过滤结果驱动');
  assert.ok(panel.includes("projectListState.status === 'error'"), 'API 失败时应展示错误状态');
  assert.ok(
    panel.includes('Looking to start a project?'),
    '没有项目时应显示参考图式居中空状态标题',
  );
  assert.ok(
    panel.includes(
      'Upload materials, set custom instructions, and organize conversations in one space.',
    ),
    '空状态应说明项目用途',
  );
  assert.ok(panel.includes('aria-hidden="true"'), '空状态应包含装饰性图标');
  assert.ok(panel.includes('type="submit"'), '空状态 New project 按钮应提交真实创建表单');
  assert.ok(!panel.includes('当前没有本地项目'), '空状态不应使用左对齐边框提示文案');
  assert.ok(!panel.includes('当前项目工作台'), 'Projects 列表下方不应追加解释型工作台区块');
  assert.ok(!panel.includes('setSelectedProjectId'), 'Projects 不应再用选中详情区制造额外工作台块');
  assert.ok(!panel.includes('继续 Blueprint'), 'Projects 项目列表不应追加跳转按钮区');
  assert.ok(!panel.includes('查看 Artifacts'), 'Projects 项目列表不应追加跳转按钮区');
  assert.ok(!panel.includes('VNproject'), '不得内置参考图里的假项目');
  assert.ok(!panel.includes('Updated 2 months ago'), '不得内置参考图里的假更新时间');
});

test('Chrome 客户端组件全站使用统一侧栏', () => {
  const chrome = read('components/site-nav/Chrome.tsx');
  assert.ok(chrome.includes("'use client'"));
  assert.ok(!chrome.includes('usePathname'), 'Chrome 不应再依赖路径为首页分叉布局');
  assert.ok(chrome.includes('UnifiedSidebar'), 'Chrome 应装配统一侧栏');
  assert.ok(!chrome.includes("pathname === '/'"), '首页不应跳过统一侧栏');
  assert.ok(!chrome.includes('return <>{children}</>'), '首页不应绕过 Chrome 壳层');
  const layout = read('app/layout.tsx');
  assert.ok(layout.includes("from '../components/site-nav/Chrome'"), 'layout 应使用 Chrome');
  assert.ok(!layout.includes('SiteNav '), 'layout 不应直接引用 SiteNav');
});

test('首页不残留 Claude 无关分类', () => {
  const data = read('components/home/home-data.ts');
  const shell = read('components/home/HomeShell.tsx');
  const composer = read('components/home/HomeComposer.tsx');
  for (const phrase of [
    'Code',
    'Learn',
    'Life stuff',
    'Write essays',
    '休闲生活',
    'Chats',
    '创作模式',
  ]) {
    assert.ok(!data.includes(phrase), `home-data 不应残留 Claude 分类 ${phrase}`);
    assert.ok(!shell.includes(phrase), `HomeShell 不应残留 Claude 分类 ${phrase}`);
    assert.ok(!composer.includes(phrase), `HomeComposer 不应残留已否定文案 ${phrase}`);
  }
});
