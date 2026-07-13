import type { PublishSettings } from '../model/types';

export type PlatformApiEndpoint = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** Content-Type header 自动推断（json 体设 application/json，FormData 设 multipart） */
  contentType?: 'json' | 'form';
  /** 请求体模板：$title/$blurb/$tags 等占位替换 */
  bodyTemplate?: string;
};

/** 平台规则包：主程序只依赖此接口，不硬编码番茄细节。 */
export type PlatformPack = {
  id: string;
  label: string;
  /** 是否完整可用（skeleton=false 仅占位） */
  ready: boolean;
  defaultMonthlyOpenLimit: number;
  settingsDefaults: Partial<PublishSettings>;
  checklistLabels: Record<string, string>;
  openPackReadme: string;
  authorHomeUrl: string;
  /** 登录页：仅系统浏览器跳转，不接 OAuth token / 不存密码 */
  loginUrl: string;
  openUrlAllowlist: readonly string[];
  isAllowedOpenUrl: (url: string) => boolean;
  /** API 基地址：通过 Rust 后端代理发请求，绕过 CORS */
  apiBaseUrl: string;
  /** 平台 API 端点映射（key 语义：createBook / updateBook / getBookInfo 等） */
  apiEndpoints: Record<string, PlatformApiEndpoint>;
};
