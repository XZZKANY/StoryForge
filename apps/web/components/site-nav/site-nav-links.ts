export type SiteNavLink = {
  readonly href: string;
  readonly label: string;
  readonly description?: string;
};

export const primaryNavLinks: readonly SiteNavLink[] = [
  { href: '/studio', label: 'Studio 创作工作台', description: '作品到批准回写的完整链路' },
  { href: '/retrieval', label: '检索工作台', description: '资料源、刷新任务与命中证据' },
  { href: '/jobs', label: '任务中心', description: '异步任务状态与恢复入口' },
  { href: '/artifacts', label: '工件库', description: '制品治理与检索' },
  { href: '/evaluations', label: '评测诊断', description: '生成质量评测摘要' },
  { href: '/worldbuilding', label: '世界观中心', description: '世界观图谱与连续性' },
  { href: '/refinery', label: 'Refinery 批量精修', description: '批量精修诊断与回写' },
  { href: '/runs', label: 'Runs 运行链路', description: 'JobRun 与运行时诊断' },
] as const;
