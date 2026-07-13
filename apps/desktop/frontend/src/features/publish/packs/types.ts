import type { PublishSettings } from '../model/types';

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
};
