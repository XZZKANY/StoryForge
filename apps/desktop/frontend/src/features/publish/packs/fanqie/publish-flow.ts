/**
 * 番茄写侧直连流程的纯函数件（form body 构造 + 响应解析，无 IO）。
 *
 * 三步流程 new_article → cover_article → publish_article 的字段与隐藏 webview 内
 * fetch 版本（src-tauri publish_api.rs build_publish_js）逐字段对齐；
 * 差别仅在传输：直连走 Rust 代理带「账号 Cookie + 登录时捕获的 x-secsdk-csrf-token」，
 * 不再依赖 webview 当前登着哪个号。
 */

export type FanqiePublishParams = {
  bookId: string;
  volumeId: string;
  volumeName: string;
  title: string;
  contentHtml: string;
};

const COMMON_FORM = { aid: '2503', app_name: 'muye_novel' } as const;

function toForm(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

export function buildNewArticleBody(bookId: string): string {
  return toForm({ ...COMMON_FORM, book_id: bookId, need_reuse: '1' });
}

export function buildCoverArticleBody(p: FanqiePublishParams, itemId: string): string {
  return toForm({
    ...COMMON_FORM,
    book_id: p.bookId,
    item_id: itemId,
    title: p.title,
    content: p.contentHtml,
    volume_name: p.volumeName,
    volume_id: p.volumeId,
  });
}

export function buildPublishArticleBody(p: FanqiePublishParams, itemId: string): string {
  return toForm({
    ...COMMON_FORM,
    item_id: itemId,
    book_id: p.bookId,
    content: p.contentHtml,
    title: p.title,
    volume_id: p.volumeId,
    volume_name: p.volumeName,
    publish_status: '1',
    timer_status: '0',
    timer_time: '',
    need_pay: '0',
    device_platform: 'pc',
    speak_type: '0',
    use_ai: '2',
    timer_chapter_preview: '[]',
    has_chapter_ad: 'false',
    chapter_ad_types: '',
  });
}

type JsonRecord = Record<string, unknown>;

function parseJson(body: string): JsonRecord | null {
  try {
    const v: unknown = JSON.parse(body);
    return v && typeof v === 'object' ? (v as JsonRecord) : null;
  } catch {
    return null;
  }
}

/** new_article 响应取 item_id（data.item_id 或 data.column_data.item_id）。 */
export function parseNewArticleItemId(body: string): string {
  const json = parseJson(body);
  const data = (json?.data ?? {}) as JsonRecord;
  const direct = data.item_id;
  if (direct != null && String(direct)) return String(direct);
  const column = (data.column_data ?? {}) as JsonRecord;
  return column.item_id != null ? String(column.item_id) : '';
}

/** draft_list 响应兜底取最新草稿 item_id（new_article 未直接回 id 时）。 */
export function parseDraftListItemId(body: string): string {
  const json = parseJson(body);
  const data = (json?.data ?? {}) as JsonRecord;
  const list = (data.draft_list ?? data.list ?? data.item_list ?? []) as unknown;
  if (!Array.isArray(list) || list.length === 0) return '';
  const first = (list[0] ?? {}) as JsonRecord;
  const id = first.item_id ?? first.chapter_id;
  return id != null ? String(id) : '';
}

export type FanqieStepResult = {
  ok: boolean;
  code: number | null;
  message: string;
};

/** 通用 {code, message} 响应解析；非 JSON 或缺 code 视为失败。 */
export function parseStepResult(status: number, body: string): FanqieStepResult {
  if (status !== 200) {
    return { ok: false, code: null, message: `HTTP ${status}` };
  }
  const json = parseJson(body);
  if (!json || typeof json.code !== 'number') {
    return { ok: false, code: null, message: '返回非预期 JSON' };
  }
  return {
    ok: json.code === 0,
    code: json.code,
    message: typeof json.message === 'string' ? json.message : '',
  };
}
