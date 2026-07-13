export type PlatformId = 'fanqie' | string;

export type PipelineStatus =
  | 'idea'
  | 'writing'
  | 'polish'
  | 'ready'
  | 'scheduled'
  | 'opened'
  | 'serializing'
  | 'dropped';

export type RiskStatus = 'normal' | 'watch' | 'blocked';

export type DropReason = 'data_poor' | 'cant_write' | 'policy_risk' | 'strategic' | 'other';

/**
 * 平台会话态（经营镜像，非浏览器 Cookie / OAuth token）。
 * 番茄不向第三方桌面端下发可回调 token，故采用：跳转登录 → 用户确认已登录。
 */
export type PlatformSessionStatus = 'unknown' | 'pending' | 'logged_in' | 'logged_out' | 'expired';

export type PublishAccount = {
  id: string;
  penName: string;
  monthlyOpenLimit: number;
  active: boolean;
  riskStatus: RiskStatus;
  riskNote: string;
  color: string;
  priority: number;
  /** 冷号观察截止日 YYYY-MM-DD；空=非冷号 */
  coldUntil: string | null;
  /** 观察期内月开上限（默认 1） */
  coldMaxOpensPerMonth: number;
  /** 会话态：仅本地台账 */
  sessionStatus: PlatformSessionStatus;
  /** 上次点「跳转登录」时间 */
  lastLoginJumpAt: string | null;
  /** 用户确认已登录时间 */
  sessionConfirmedAt: string | null;
  /** 会话备注（如笔名在站内显示名） */
  sessionNote: string;
  /** 用户手动粘贴的 Cookie 字符串（浏览器 DevTools → Application → Cookies 复制） */
  cookieText: string;
};

export type PublishBook = {
  projectKey: string;
  title: string;
  path: string;
  platform: PlatformId;
  status: PipelineStatus;
  assignedAccountId: string | null;
  assignmentLocked: boolean;
  planOpenDate: string | null;
  readyScore: number;
  readyConfirmed: boolean;
  forceReadyReason: string | null;
  openedAt: string | null;
  lastLocalEditAt: string | null;
  dropReason: DropReason | null;
  updatedAt: string;
  /** 空位占坑：尚无真实项目目录 */
  isPlaceholder: boolean;
  blurb: string;
};

export type PublishSettings = {
  monthlyOpenTarget: number;
  defaultPlatform: PlatformId;
  defaultMonthlyOpenLimit: number;
  quotaResetTimezone: string;
  preferWeekdaysOnly: boolean;
  maxOpensPerAccountPerWeek: number;
  maxOpensPerDayGlobal: number;
  maxOpensPerAccountPerDay: number;
  readyScoreThreshold: number;
  staleSerializingDays: number;
  minChaptersForReady: number;
  minCharsForReady: number;
  spareWarnIfBelow: number;
  /** 冷号默认月开上限 */
  defaultColdMaxOpensPerMonth: number;
  /** 简介相似度告警阈值 0–1 */
  blurbSimilarityWarnAt: number;
};

export type QuotaReservation = {
  projectKey: string;
  accountId: string;
  planOpenDate: string | null;
};

export type MonthQuota = {
  yearMonth: string;
  openedByAccount: Record<string, number>;
  calibratedOpenedByAccount: Record<string, number>;
  reservations: QuotaReservation[];
};

export type ReadySignals = {
  hasTitle: boolean;
  chapterCount: number;
  charCount: number;
  checklistComplete: boolean;
  hasBlurbAndTags: boolean;
  editedInLast7Days: boolean;
  readyConfirmed: boolean;
};

export type ReadyBreakdown = {
  score: number;
  blocked: boolean;
  blockReasons: string[];
  parts: {
    volume: number;
    checklist: number;
    meta: number;
    activity: number;
  };
};

export type AssignSuggestion = {
  projectKey: string;
  accountId: string;
  planOpenDate: string;
};

export type AssignBlocker = {
  projectKey: string;
  reason: string;
};

export type AutoAssignResult = {
  suggestions: AssignSuggestion[];
  blockers: AssignBlocker[];
};

export const DEFAULT_PUBLISH_SETTINGS: PublishSettings = {
  monthlyOpenTarget: 15,
  defaultPlatform: 'fanqie',
  defaultMonthlyOpenLimit: 3,
  quotaResetTimezone: 'Asia/Shanghai',
  preferWeekdaysOnly: false,
  maxOpensPerAccountPerWeek: 2,
  maxOpensPerDayGlobal: 3,
  maxOpensPerAccountPerDay: 1,
  readyScoreThreshold: 70,
  staleSerializingDays: 2,
  minChaptersForReady: 3,
  minCharsForReady: 10000,
  spareWarnIfBelow: 3,
  defaultColdMaxOpensPerMonth: 1,
  blurbSimilarityWarnAt: 0.72,
};

export const PIPELINE_STATUSES: PipelineStatus[] = [
  'idea',
  'writing',
  'polish',
  'ready',
  'scheduled',
  'opened',
  'serializing',
  'dropped',
];
