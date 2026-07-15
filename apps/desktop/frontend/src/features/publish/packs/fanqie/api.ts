import type { PlatformApiEndpoint } from '../types';

export const FANQIE_API_BASE_URL = 'https://fanqienovel.com';

/** 作者接口公共 query（作者端 React 应用代号 muye）。 */
export const FANQIE_COMMON_QUERY = 'aid=2503&app_name=muye_novel';

/**
 * 番茄作者站真实接口（2026-07-13 Playwright + 真实会话实测，详见仓库 fanqie-api/ 文档）。
 * - 读端点：cookie-only，无需签名。
 * - 写端点：需 header x-secsdk-csrf-token（从 muye webview 取）+ form-urlencoded body；
 *   a_bogus / msToken 服务端不校验。body 由调用方按 form 构造（见 publish-api.ts）。
 */
export const FANQIE_API_ENDPOINTS: Record<string, PlatformApiEndpoint> = {
  // —— 读（cookie-only）——
  /** 验 cookie / 作者信息 */
  getAuthorInfo: {
    method: 'GET',
    path: `/api/author/account/info/v0/?${FANQIE_COMMON_QUERY}`,
  },
  /** 作者书单 */
  getBookList: {
    method: 'GET',
    path: `/api/author/homepage/book_list/v0/?${FANQIE_COMMON_QUERY}&page_count=30&page_index=0&image_fmt_list=396x220`,
  },
  /** 卷列表 */
  getVolumeList: {
    method: 'GET',
    path: `/api/author/volume/volume_list/v1?${FANQIE_COMMON_QUERY}&book_id=$bookId`,
  },
  /** 章节列表 */
  getChapterList: {
    method: 'GET',
    path: `/api/author/chapter/chapter_list/v1?${FANQIE_COMMON_QUERY}&book_id=$bookId`,
  },
  /** 书详情 */
  getBookDetail: {
    method: 'GET',
    path: `/api/author/book/book_detail/v0/?${FANQIE_COMMON_QUERY}&book_id=$bookId`,
  },
  /** 草稿列表（new_article 未直接回 item_id 时兜底取最新草稿） */
  getDraftList: {
    method: 'GET',
    path: `/api/author/chapter/draft_list/v1?${FANQIE_COMMON_QUERY}&book_id=$bookId`,
  },

  // —— 写（需 csrf token + form body）——
  /** 建空章节草稿：body aid&app_name&book_id&need_reuse=1 */
  newArticle: {
    method: 'POST',
    path: `/api/author/article/new_article/v0/?${FANQIE_COMMON_QUERY}`,
    contentType: 'form',
  },
  /** 存章节正文（实测真路径 cover_article；edit_article 是 GET 加载草稿，勿用于写） */
  coverArticle: {
    method: 'POST',
    path: `/api/author/article/cover_article/v0/?${FANQIE_COMMON_QUERY}`,
    contentType: 'form',
  },
  /** 发布章节（进审核）*/
  publishArticle: {
    method: 'POST',
    path: `/api/author/publish_article/v0/?${FANQIE_COMMON_QUERY}`,
    contentType: 'form',
  },
  /** 新建分卷 */
  addVolume: {
    method: 'POST',
    path: `/api/author/volume/add_volume/v0?${FANQIE_COMMON_QUERY}`,
    contentType: 'form',
  },
};
