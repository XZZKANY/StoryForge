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

export type PublishAccount = {
  id: string;
  penName: string;
  monthlyOpenLimit: number;
  active: boolean;
  riskStatus: RiskStatus;
  riskNote: string;
  color: string;
  priority: number;
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
