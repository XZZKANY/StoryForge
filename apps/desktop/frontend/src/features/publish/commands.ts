/** 发行面板命令总线（命令面板 → Cockpit） */

export const PUBLISH_COMMAND_EVENT = 'storyforge:publish-command';

export type PublishCommandType =
  | 'open'
  | 'add-current'
  | 'auto-assign'
  | 'generate-pack'
  | 'mark-opened-today'
  | 'mark-dropped'
  | 'monthly-review'
  | 'refresh-ready'
  | 'serial-health'
  | 'reschedule-focus'
  | 'open-assist'
  | 'platform-login'
  | 'open-author-home';

export type PublishCommandDetail = {
  type: PublishCommandType;
};

export function emitPublishCommand(type: PublishCommandType): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<PublishCommandDetail>(PUBLISH_COMMAND_EVENT, {
      detail: { type },
    }),
  );
}

export function onPublishCommand(handler: (type: PublishCommandType) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PublishCommandDetail>).detail;
    if (detail?.type) handler(detail.type);
  };
  window.addEventListener(PUBLISH_COMMAND_EVENT, listener);
  return () => window.removeEventListener(PUBLISH_COMMAND_EVENT, listener);
}

export const PUBLISH_COMMAND_TITLES: { type: PublishCommandType; title: string; hint?: string }[] =
  [
    { type: 'open', title: 'Publish: 打开发行管理面板', hint: 'Cockpit' },
    { type: 'add-current', title: 'Publish: 将当前项目加入发布库' },
    { type: 'auto-assign', title: 'Publish: 智能指派 ready 书' },
    { type: 'generate-pack', title: 'Publish: 生成开书作业包' },
    { type: 'mark-opened-today', title: 'Publish: 确认今日已开' },
    { type: 'reschedule-focus', title: 'Publish: 改期（打开日历）' },
    { type: 'mark-dropped', title: 'Publish: 标记止损' },
    { type: 'monthly-review', title: 'Publish: 月度复盘' },
    { type: 'refresh-ready', title: 'Publish: 刷新 Ready 扫描' },
    { type: 'serial-health', title: 'Publish: 连载健康巡检（断更）' },
    { type: 'open-assist', title: 'Publish: 开书辅助向导（L2）' },
    { type: 'platform-login', title: 'Publish: 跳转平台登录' },
    { type: 'open-author-home', title: 'Publish: 打开作者后台' },
  ];

/** 供命令面板一次性注册；壳层不要再手写 Publish 命令列表。 */
export function buildPublishPaletteCommands(handlers: {
  onOpenPublish?: () => void;
  onPublishCommand?: (type: string) => void;
}): { id: string; title: string; hint?: string; run: () => void }[] {
  const list: { id: string; title: string; hint?: string; run: () => void }[] = [];
  if (handlers.onOpenPublish) {
    list.push({
      id: 'open-publish-cockpit',
      title: 'Publish: 打开发行管理面板',
      hint: '左侧发行',
      run: handlers.onOpenPublish,
    });
  }
  if (handlers.onPublishCommand) {
    for (const item of PUBLISH_COMMAND_TITLES) {
      if (item.type === 'open') continue;
      list.push({
        id: `publish-${item.type}`,
        title: item.title,
        hint: item.hint,
        run: () => handlers.onPublishCommand?.(item.type),
      });
    }
  }
  return list;
}
