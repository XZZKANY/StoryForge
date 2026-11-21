import { invokeWebSearch } from '../host/web-search';
export type WebReadRequest = { url: string };
export type WebReadResponse = {
  requestedUrl: string;
  url: string;
  title: string;
  text: string;
  links: { title: string; url: string }[];
  truncated: boolean;
  linksTruncated: boolean;
  fetchedAt: string;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function address(v: unknown): string {
  if (typeof v !== 'string' || [...v].length > 1000) throw new Error('网页地址无效。');
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new Error('网页地址无效。');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port)
    throw new Error('网页地址无效。');
  return v;
}
/** 不保留可能包含凭据或原始响应的底层cause。 */
function readFailure(error: unknown): Error {
  const raw = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  if (/未启用/u.test(raw)) return new Error('联网搜索尚未启用，请先在设置中开启。');
  if (/超时/u.test(raw)) return new Error('网页读取超时，请稍后重试。');
  if (/本机|内网|保留地址|凭据|公开网页|跳转/u.test(raw))
    return new Error('该地址或跳转不符合公开网页读取范围。');
  if (/类型|压缩格式/u.test(raw)) return new Error('暂时只支持可直接访问的 HTML 和纯文本网页。');
  if (/上限/u.test(raw)) return new Error('网页内容超过读取上限，请选择更具体的页面。');
  return new Error('网页读取失败，页面可能需要登录、执行脚本或暂时无法访问。');
}
export async function readWebPage(request: WebReadRequest): Promise<WebReadResponse> {
  const url = address(request.url);
  let value: unknown;
  try {
    value = await invokeWebSearch('web_read_execute', { request: { url } });
  } catch (error) {
    throw readFailure(error);
  }
  if (
    !object(value) ||
    typeof value.title !== 'string' ||
    typeof value.text !== 'string' ||
    !value.text.trim() ||
    [...value.text].length > 6000 ||
    !Array.isArray(value.links) ||
    value.links.length > 20 ||
    typeof value.truncated !== 'boolean' ||
    typeof value.linksTruncated !== 'boolean' ||
    typeof value.fetchedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.fetchedAt))
  )
    throw new Error('网页读取返回格式不正确。');
  return {
    requestedUrl: address(value.requestedUrl),
    url: address(value.url),
    title: value.title.slice(0, 300),
    text: value.text,
    truncated: value.truncated,
    linksTruncated: value.linksTruncated,
    fetchedAt: value.fetchedAt,
    links: value.links.map((item) => {
      if (!object(item) || typeof item.title !== 'string') throw new Error('网页链接格式不正确。');
      return { title: item.title.slice(0, 160), url: address(item.url) };
    }),
  };
}
