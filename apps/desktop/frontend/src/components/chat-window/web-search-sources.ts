import type { ChatWindowAgentToolTrace } from './types';

/** 来源列表只来自成功的搜索或网页读取工具，不从模型回答中猜网址。 */
export function traceWebSources(trace: ChatWindowAgentToolTrace): { title: string; url: string }[] {
  if (!['web.search', 'web.read'].includes(trace.tool_name) || trace.status !== 'completed')
    return [];
  const raw = trace.output_summary?.sources;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, 8).flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    if (typeof item.url !== 'string' || item.url.length > 2048 || typeof item.title !== 'string')
      return [];
    try {
      const url = new URL(item.url);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        seen.has(url.href)
      )
        return [];
      seen.add(url.href);
      return [{ title: item.title.trim().slice(0, 300) || url.hostname, url: url.href }];
    } catch {
      return [];
    }
  });
}
