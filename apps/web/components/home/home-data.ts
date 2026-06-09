import type { HomeView } from './home-view';

export type HomeNavItem = {
  readonly href: string;
  readonly view: HomeView;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
};

export type HomeAccountMenuItem = {
  readonly href: string;
  readonly label: string;
  readonly description: string;
};

export type HomeRecentItem = {
  readonly title: string;
  readonly summary: string;
  readonly href: string;
  readonly updatedAt?: string;
};

export const homeNavItems: readonly HomeNavItem[] = [
  {
    href: '/?view=projects',
    view: 'projects',
    label: 'Projects 项目',
    description: '管理作品、章节、审阅和批准写回',
    icon: 'P',
  },
  {
    href: '/?view=artifacts',
    view: 'artifacts',
    label: 'Artifacts 产物',
    description: '查看正文、导出文件、审计报告和版本追溯',
    icon: 'A',
  },
] as const;

export const homeAccountMenuItems: readonly HomeAccountMenuItem[] = [
  {
    href: '/settings',
    label: 'Settings 设置',
    description: '模型、Provider、运行环境和语言',
  },
  {
    href: '/settings#provider',
    label: 'Provider/API Key',
    description: 'Provider 状态、配置指引和凭据来源说明',
  },
  {
    href: '/docs',
    label: 'Help 帮助',
    description: '使用说明和故障排查',
  },
  {
    href: '/settings#upgrade',
    label: 'Upgrade 升级',
    description: '工作区能力与商业化入口',
  },
  {
    href: '/settings#sign-out',
    label: 'Sign out 退出',
    description: '断开账号或本地工作区',
  },
] as const;

export const homeComposerPlaceholder = '给 StoryForge Assistant 发送消息';

export const homeMainTitle = '今天要锻造哪段故事？';

export const homeWorkspaceLabel = '本地工作区';

export const homeProviderUncheckedLabel = 'Provider 待检查';

export const homeUserFallbackName = '创作者';

export const homeGreetingSegments = [
  { startHour: 5, endHour: 8, label: '早上好' },
  { startHour: 9, endHour: 11, label: '上午好' },
  { startHour: 11.5, endHour: 13, label: '中午好' },
  { startHour: 13.5, endHour: 17, label: '下午好' },
  { startHour: 18, endHour: 28, label: '晚上好' },
] as const;

export const homeRecentEmpty = '暂无最近记录。完成首个 Blueprint 或 BookRun 后将在此显示。';
