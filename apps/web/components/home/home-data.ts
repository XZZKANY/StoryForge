export type HomeNavItem = {
  readonly href: string;
  readonly label: string;
  readonly description: string;
};

export type HomeQuickAction = {
  readonly href: string;
  readonly label: string;
  readonly hint: string;
};

export const homeNavItems: readonly HomeNavItem[] = [
  {
    href: '/blueprints',
    label: '新建作品',
    description: '从蓝图入口开始新作品或新全书计划',
  },
  {
    href: '/retrieval',
    label: '搜索作品与证据',
    description: '查找资料源、命中、证据锚点',
  },
  {
    href: '/studio',
    label: '作品库',
    description: '复用 Studio 作品列表能力',
  },
  {
    href: '/studio',
    label: 'Studio 审阅',
    description: '审阅 Scene Packet、Judge、Repair、批准写回',
  },
  {
    href: '/book-runs',
    label: 'BookRun 整书运行',
    description: '查看整书运行状态和章节进度',
  },
  {
    href: '/retrieval',
    label: 'Retrieval 证据',
    description: '核对检索证据链',
  },
  {
    href: '/artifacts',
    label: '工件与导出',
    description: '查看导出与制品治理',
  },
  {
    href: '/runs',
    label: '运行诊断',
    description: '查看 JobRun、ModelRun、Checkpoint',
  },
] as const;

export const homeQuickActions: readonly HomeQuickAction[] = [
  { href: '/blueprints', label: '创建 Blueprint', hint: '跳转到蓝图页面' },
  { href: '/book-runs', label: '启动 BookRun', hint: '跳转到整书运行页面' },
  { href: '/studio', label: '审阅并批准', hint: '跳转到 Studio 审阅链路' },
  { href: '/retrieval', label: '核对证据', hint: '跳转到检索证据页' },
  { href: '/artifacts', label: '导出审计', hint: '跳转到工件与导出页' },
] as const;

export const homeComposerPlaceholder =
  '输入故事想法、章节目标或修订要求，StoryForge 会选择对应创作流程。';

export const homeMainTitle = '今天要锻造哪段故事？';

export const homeWorkspaceLabel = 'Local workspace';

export const homeProviderUncheckedLabel = 'Provider 待检查';

export const homeContextEmpty = {
  currentBook: '当前暂无作品，请先创建 Blueprint。',
  bookRun: '尚未启动 BookRun。完成蓝图后可在 BookRun 页面发起整书运行。',
  nextStep: '建议先在“创建 Blueprint”进入蓝图入口，定义全书目标。',
} as const;

export const homeRecentEmpty = '暂无最近记录。完成首个 Blueprint 或 BookRun 后将在此显示。';
