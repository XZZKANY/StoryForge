export type LocalConversationAction = 'agent' | 'file.export' | 'file.writeback';

export function detectLocalConversationAction(text: string): LocalConversationAction {
  const normalized = text.trim().toLowerCase();
  if (
    normalized.includes('accept this') ||
    normalized.includes('apply this') ||
    normalized.includes('confirm writeback') ||
    /确认写回|接受这版|就这版写回|应用这版|确认应用/.test(text) ||
    (/(确认|接受)/.test(text) && /(当前补丁|当前修订)/.test(text)) ||
    ((text.includes('写回') || text.includes('应用')) &&
      /确认|接受|这版|当前补丁|当前修订/.test(text))
  ) {
    return 'file.writeback';
  }
  if (/导出|交付|发布/.test(text) && !/修|改|审|润|检查|问题|一致|节奏|结构/.test(text)) {
    return 'file.export';
  }
  return 'agent';
}
