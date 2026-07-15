import { invoke } from '@tauri-apps/api/core';
import { assertTauriRuntime } from '../../../lib/tauri-env';
import type { PlatformApiEndpoint, PlatformPack } from '../packs/types';
import { listen } from '@tauri-apps/api/event';
import {
  buildCoverArticleBody,
  buildNewArticleBody,
  buildPublishArticleBody,
  parseDraftListItemId,
  parseNewArticleItemId,
  parseStepResult,
  type FanqiePublishParams,
} from '../packs/fanqie/publish-flow';

export type PublishApiResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type PublishApiCallInput = {
  endpoint: PlatformApiEndpoint;
  baseUrl: string;
  /** 附加 header，如 Cookie */
  extraHeaders: Record<string, string>;
  /** $key -> value 路径与请求体占位替换 */
  vars?: Record<string, string>;
  /** 直传请求体（已编码的 form/json 串）；与 bodyTemplate 互斥，优先生效 */
  rawBody?: string;
};

export type PublishCookieCapturedPayload = {
  cookies: string;
  url: string;
  account_id?: string | null;
};

export type PublishCsrfCapturedPayload = {
  token: string;
  url: string;
  account_id?: string | null;
};

/** 线上作品（book_list 投影） */
export type FanqieOnlineBook = {
  bookId: string;
  bookName: string;
  chapterNumber: number;
  wordNumber: number;
  statusTag: string;
  statusMsg: string;
};

export async function openLoginWebview(loginUrl: string, accountId?: string | null): Promise<void> {
  assertTauriRuntime('publish_open_login_webview');
  await invoke('publish_open_login_webview', {
    loginUrl,
    accountId: accountId ?? null,
  });
}

export function onCookieCaptured(
  handler: (payload: PublishCookieCapturedPayload) => void,
): () => void {
  const unlisten = listen<PublishCookieCapturedPayload>('publish:cookie-captured', (event) => {
    handler(event.payload);
  });
  return () => {
    unlisten.then((fn) => fn());
  };
}

/** 监听登录窗捕获的 x-secsdk-csrf-token（写侧直连令牌）。 */
export function onCsrfCaptured(handler: (payload: PublishCsrfCapturedPayload) => void): () => void {
  const unlisten = listen<PublishCsrfCapturedPayload>('publish:csrf-captured', (event) => {
    handler(event.payload);
  });
  return () => {
    unlisten.then((fn) => fn());
  };
}

/**
 * 通过 Rust 后端代理发 HTTP 请求到平台 API（绕过 CORS / CSP）。
 */
export async function callPlatformApi(input: PublishApiCallInput): Promise<PublishApiResponse> {
  assertTauriRuntime('publish_api_request');

  const url = `${input.baseUrl}${input.endpoint.path}`.replace(/\$(\w+)/g, (_, key) =>
    encodeURIComponent(input.vars?.[key] ?? `$${key}`),
  );

  const headers: Record<string, string> = { ...input.extraHeaders };
  if (input.endpoint.contentType === 'json' && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  if (input.endpoint.contentType === 'form') {
    headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
  }

  let body: string | null = input.rawBody ?? null;
  if (body == null && input.endpoint.bodyTemplate && input.vars) {
    body = input.endpoint.bodyTemplate.replace(
      /\$(\w+)/g,
      (_, key) => input.vars?.[key] ?? `$${key}`,
    );
  }

  return invoke<PublishApiResponse>('publish_api_request', {
    request: {
      url,
      method: input.endpoint.method,
      headers,
      body,
      timeoutSecs: 15,
    },
  });
}

/**
 * 验证 Cookie 有效性：调 account_info，认 code:0 + author_name。
 */
export async function testCookie(
  pack: PlatformPack,
  cookieText: string,
): Promise<{ ok: boolean; message: string; authorName?: string }> {
  const profileEndpoint = pack.apiEndpoints['getAuthorInfo'];
  if (!profileEndpoint) {
    return { ok: false, message: `${pack.label} 未配置作者信息接口，无法验证 Cookie` };
  }
  try {
    const result = await callPlatformApi({
      endpoint: profileEndpoint,
      baseUrl: pack.apiBaseUrl,
      extraHeaders: { Cookie: cookieText.trim() },
    });
    if (result.status === 401 || result.status === 403) {
      return { ok: false, message: 'Cookie 已过期或被拒绝，请重新获取' };
    }
    if (result.status !== 200) {
      return { ok: false, message: `${pack.label} 返回 HTTP ${result.status}` };
    }
    let json: { code?: number; message?: string; data?: { author_name?: string } };
    try {
      json = JSON.parse(result.body);
    } catch {
      return { ok: false, message: 'Cookie 无效（返回非 JSON，可能未登录）' };
    }
    if (json.code === 0 && json.data?.author_name) {
      return {
        ok: true,
        message: `Cookie 有效：${json.data.author_name}`,
        authorName: String(json.data.author_name),
      };
    }
    return { ok: false, message: `Cookie 无效：${json.message ?? `code ${json.code}`}` };
  } catch (e) {
    return { ok: false, message: `请求失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * 拉取作者线上书单（book_list），投影为 FanqieOnlineBook[]。
 */
export async function fetchAuthorBooks(
  pack: PlatformPack,
  cookieText: string,
): Promise<{ ok: boolean; message: string; books: FanqieOnlineBook[] }> {
  const endpoint = pack.apiEndpoints['getBookList'];
  if (!endpoint) {
    return { ok: false, message: `${pack.label} 未配置书单接口`, books: [] };
  }
  try {
    const result = await callPlatformApi({
      endpoint,
      baseUrl: pack.apiBaseUrl,
      extraHeaders: { Cookie: cookieText.trim() },
    });
    if (result.status !== 200) {
      return { ok: false, message: `HTTP ${result.status}`, books: [] };
    }
    const json = JSON.parse(result.body) as {
      code?: number;
      message?: string;
      data?: { book_list?: Array<Record<string, unknown>> };
    };
    if (json.code !== 0) {
      return { ok: false, message: json.message ?? `code ${json.code}`, books: [] };
    }
    const raw = json.data?.book_list ?? [];
    const books: FanqieOnlineBook[] = raw.map((b) => {
      const intro = (b.book_intro ?? {}) as { tag?: string; message?: string };
      return {
        bookId: String(b.book_id ?? ''),
        bookName: String(b.book_name ?? ''),
        chapterNumber: Number(b.chapter_number ?? 0),
        wordNumber: Number(b.content_word_number ?? 0),
        statusTag: String(intro.tag ?? ''),
        statusMsg: String(intro.message ?? ''),
      };
    });
    return { ok: true, message: `拉取 ${books.length} 本`, books };
  } catch (e) {
    return {
      ok: false,
      message: `请求失败: ${e instanceof Error ? e.message : String(e)}`,
      books: [],
    };
  }
}

/**
 * 旧的单步开书（依赖已删除的 createBook 端点）：现优雅降级。
 * 真实开书是多步流程（new_article -> edit_article -> publish_article）+ csrf token，见 fanqie-api 文档与写侧实现。
 */
export async function apiPublishBook(
  pack: PlatformPack,
  cookieText: string,
  vars: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: string; message: string }> {
  const endpoint = pack.apiEndpoints['createBook'];
  if (!endpoint) {
    return {
      ok: false,
      status: 0,
      body: '',
      message: `${pack.label} 单步开书接口已下线（改走多步发布流程）`,
    };
  }
  try {
    const result = await callPlatformApi({
      endpoint,
      baseUrl: pack.apiBaseUrl,
      extraHeaders: { Cookie: cookieText.trim() },
      vars,
    });
    const ok = result.status >= 200 && result.status < 300;
    return {
      ok,
      status: result.status,
      body: result.body,
      message: ok ? '请求成功' : `返回 HTTP ${result.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: '',
      message: `请求失败: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** 番茄 API 发布结果（publish:chapter-result 事件 payload） */
export type FanqiePublishResult = {
  ok: boolean;
  code?: number;
  msg: string;
  item_id?: string;
  step?: string;
  status?: number;
};

/**
 * 触发番茄 API 发布：Rust 起隐藏 webview，用 muye 页面自身 fetch 走
 * new_article -> cover_article -> publish_article（csrf 由 secsdk 自动补，无需 a_bogus）。
 * 结果异步经 onChapterPublished 回传。需 webview 已登录（cookie 在 webview jar，先走 WebView 登录）。
 * content 必须是 HTML（<p>段落</p>），≥1000 字且不与本书已发章节重复（见 fanqie-api/章节发布.md）。
 */
export async function startPublishChapter(input: {
  bookId: string;
  volumeId: string;
  volumeName: string;
  title: string;
  contentHtml: string;
}): Promise<void> {
  assertTauriRuntime('publish_fanqie_chapter');
  await invoke('publish_fanqie_chapter', {
    bookId: input.bookId,
    volumeId: input.volumeId,
    volumeName: input.volumeName,
    title: input.title,
    contentHtml: input.contentHtml,
  });
}

/** 监听番茄 API 发布结果。返回取消监听的 cleanup 函数。 */
export function onChapterPublished(handler: (r: FanqiePublishResult) => void): () => void {
  const unlisten = listen<FanqiePublishResult>('publish:chapter-result', (event) => {
    handler(event.payload);
  });
  return () => {
    unlisten.then((fn) => fn());
  };
}

/**
 * 单章发布 + 等回执（Promise 化 startPublishChapter）。
 * 复用现有 Rust `publish_fanqie_chapter` 命令，供批量发章顺序驱动。
 * 一次性监听 publish:chapter-result；超时（默认 120s，webview 无回执）按失败收敛。
 */
export async function publishChapterOnce(
  input: {
    bookId: string;
    volumeId: string;
    volumeName: string;
    title: string;
    contentHtml: string;
  },
  timeoutMs = 120000,
): Promise<FanqiePublishResult> {
  return new Promise<FanqiePublishResult>((resolve) => {
    let settled = false;
    let off = () => {};
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      off();
      resolve({ ok: false, msg: '发布超时（webview 无回执）', step: 'timeout' });
    }, timeoutMs);
    off = onChapterPublished((r) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      off();
      resolve(r);
    });
    startPublishChapter(input).catch((e) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      off();
      resolve({
        ok: false,
        msg: `发布启动失败: ${e instanceof Error ? e.message : String(e)}`,
        step: 'start',
      });
    });
  });
}

/**
 * 写侧直连发章（不经 webview）：Rust 代理带「账号 Cookie + 登录时捕获的 x-secsdk-csrf-token」
 * 走 new_article → cover_article → publish_article。多号并存的关键：会话按账号显式传入，
 * 不依赖 webview jar 当前登着哪个号。csrf 失效表现为写步骤失败，需重新 WebView 登录刷新令牌。
 */
export async function publishChapterViaApi(
  pack: PlatformPack,
  cookieText: string,
  csrfToken: string,
  input: FanqiePublishParams,
): Promise<FanqiePublishResult> {
  const newArticle = pack.apiEndpoints['newArticle'];
  const coverArticle = pack.apiEndpoints['coverArticle'];
  const publishArticle = pack.apiEndpoints['publishArticle'];
  if (!newArticle || !coverArticle || !publishArticle) {
    return { ok: false, msg: `${pack.label} 未配置写侧端点`, step: 'config' };
  }
  const headers: Record<string, string> = {
    Cookie: cookieText.trim(),
    'x-secsdk-csrf-token': csrfToken.trim(),
    // 对齐浏览器请求形状（写端点在浏览器上下文实测；Rust 代理默认 UA/无 referer 未实测）
    Origin: pack.apiBaseUrl,
    Referer: `${pack.apiBaseUrl}/main/writer/book-manage`,
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  };
  const call = (endpoint: PlatformApiEndpoint, rawBody?: string, vars?: Record<string, string>) =>
    callPlatformApi({ endpoint, baseUrl: pack.apiBaseUrl, extraHeaders: headers, rawBody, vars });

  try {
    // 1. 建空章节草稿
    const na = await call(newArticle, buildNewArticleBody(input.bookId));
    const naResult = parseStepResult(na.status, na.body);
    if (!naResult.ok) {
      return {
        ok: false,
        code: naResult.code ?? undefined,
        msg: `建章失败：${naResult.message}`,
        step: 'new_article',
        status: na.status,
      };
    }
    let itemId = parseNewArticleItemId(na.body);
    if (!itemId) {
      const draftList = pack.apiEndpoints['getDraftList'];
      if (draftList) {
        const dl = await call(draftList, undefined, { bookId: input.bookId });
        itemId = parseDraftListItemId(dl.body);
      }
    }
    if (!itemId) {
      return { ok: false, msg: '拿不到 item_id', step: 'new_article' };
    }

    // 2. 存正文
    const ca = await call(coverArticle, buildCoverArticleBody(input, itemId));
    const caResult = parseStepResult(ca.status, ca.body);
    if (!caResult.ok) {
      return {
        ok: false,
        code: caResult.code ?? undefined,
        msg: `存正文失败：${caResult.message}`,
        step: 'cover_article',
        status: ca.status,
      };
    }

    // 3. 发布（进审核）
    const pa = await call(publishArticle, buildPublishArticleBody(input, itemId));
    const paResult = parseStepResult(pa.status, pa.body);
    return {
      ok: paResult.ok,
      code: paResult.code ?? undefined,
      msg: paResult.message,
      item_id: itemId,
      step: paResult.ok ? undefined : 'publish_article',
      status: pa.status,
    };
  } catch (e) {
    return {
      ok: false,
      msg: `直连请求失败: ${e instanceof Error ? e.message : String(e)}`,
      step: 'transport',
    };
  }
}

/** 卷（volume_list 投影） */
export type FanqieVolume = { volumeId: string; volumeName: string };

/** 拉某书的卷列表（发布时取默认卷 volume_id/name）。 */
export async function fetchVolumes(
  pack: PlatformPack,
  cookieText: string,
  bookId: string,
): Promise<{ ok: boolean; message: string; volumes: FanqieVolume[] }> {
  const endpoint = pack.apiEndpoints['getVolumeList'];
  if (!endpoint) {
    return { ok: false, message: `${pack.label} 未配置卷列表接口`, volumes: [] };
  }
  try {
    const result = await callPlatformApi({
      endpoint,
      baseUrl: pack.apiBaseUrl,
      extraHeaders: { Cookie: cookieText.trim() },
      vars: { bookId },
    });
    if (result.status !== 200) {
      return { ok: false, message: `HTTP ${result.status}`, volumes: [] };
    }
    const json = JSON.parse(result.body) as {
      code?: number;
      message?: string;
      data?: { volume_list?: Array<Record<string, unknown>> };
    };
    if (json.code !== 0) {
      return { ok: false, message: json.message ?? `code ${json.code}`, volumes: [] };
    }
    const volumes = (json.data?.volume_list ?? []).map((v) => ({
      volumeId: String(v.volume_id ?? ''),
      volumeName: String(v.volume_name ?? ''),
    }));
    return { ok: true, message: `${volumes.length} 卷`, volumes };
  } catch (e) {
    return {
      ok: false,
      message: `请求失败: ${e instanceof Error ? e.message : String(e)}`,
      volumes: [],
    };
  }
}

/**
 * 拉某书线上章节列表：titles 供批量发章去重；items 为原始条目（连载巡检从中提时间字段）。
 * chapter_list 字段随平台版本浮动，这里尽力投影 title；拿不到就返回空（不去重，非致命）。
 */
export async function fetchChapterList(
  pack: PlatformPack,
  cookieText: string,
  bookId: string,
): Promise<{ ok: boolean; message: string; titles: string[]; items: unknown[] }> {
  const endpoint = pack.apiEndpoints['getChapterList'];
  if (!endpoint) {
    return { ok: false, message: `${pack.label} 未配置章节列表接口`, titles: [], items: [] };
  }
  try {
    const result = await callPlatformApi({
      endpoint,
      baseUrl: pack.apiBaseUrl,
      extraHeaders: { Cookie: cookieText.trim() },
      vars: { bookId },
    });
    if (result.status !== 200) {
      return { ok: false, message: `HTTP ${result.status}`, titles: [], items: [] };
    }
    const json = JSON.parse(result.body) as {
      code?: number;
      message?: string;
      data?: Record<string, unknown>;
    };
    if (json.code !== 0) {
      return { ok: false, message: json.message ?? `code ${json.code}`, titles: [], items: [] };
    }
    const data = json.data ?? {};
    const rawList = (data['chapter_list'] ?? data['item_list'] ?? data['list'] ?? []) as unknown;
    const items = Array.isArray(rawList) ? rawList : [];
    const titles = items
      .map((it) => {
        const o = (it ?? {}) as Record<string, unknown>;
        return String(o.title ?? o.chapter_title ?? o.name ?? '');
      })
      .filter((t) => t.length > 0);
    return { ok: true, message: `${titles.length} 章`, titles, items };
  } catch (e) {
    return {
      ok: false,
      message: `请求失败: ${e instanceof Error ? e.message : String(e)}`,
      titles: [],
      items: [],
    };
  }
}
