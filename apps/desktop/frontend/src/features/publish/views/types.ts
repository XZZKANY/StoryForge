export type PublishTabId =
  | 'daily'
  | 'pipeline'
  | 'calendar'
  | 'accounts'
  | 'assign'
  | 'review'
  | 'settings';

export const PUBLISH_TABS: { id: PublishTabId; label: string }[] = [
  { id: 'daily', label: '今日作战' },
  { id: 'pipeline', label: '流水线' },
  { id: 'calendar', label: '日历' },
  { id: 'accounts', label: '账号额度' },
  { id: 'assign', label: '智能指派' },
  { id: 'review', label: '复盘' },
  { id: 'settings', label: '设置' },
];
