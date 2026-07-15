/**
 * 连载健康 / 断更监控（纯函数，无 IO）。
 *
 * 诚实边界：番茄 chapter_list 的时间字段名未在接口文档中固化，这里防御式解析；
 * 拿不到时间就归「未知」，不猜列表顺序、不编造最近更新时间。
 * 「最近更新」取线上章节时间与本地发布动作时间戳（lastPublishedAt）的较新者。
 */
import type { PublishAccount, PublishBook } from './types';

/** 防御解析平台时间值：unix 秒 / 毫秒 / 数字字符串 / 日期字符串 → ISO；解析不了返回 null。 */
export function parseOnlineTimestamp(value: unknown): string | null {
  if (value == null) return null;
  const asNumber =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : null;
  if (asNumber != null) {
    if (!Number.isFinite(asNumber)) return null;
    // >=1e12 视为毫秒（2001+），[1e9,1e12) 视为秒（2001–33658）；更小不是现代时间戳
    const ms = asNumber >= 1e12 ? asNumber : asNumber >= 1e9 ? asNumber * 1000 : NaN;
    if (Number.isNaN(ms)) return null;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (Number.isNaN(t)) return null;
    return new Date(t).toISOString();
  }
  return null;
}

/** 章节条目里按优先级尝试的时间字段名（Playwright 实测未固化，全部防御式）。 */
const CHAPTER_TIME_KEYS = [
  'first_pass_time',
  'publish_time',
  'create_time',
  'update_time',
  'last_modify_time',
  'modify_time',
] as const;

const CHAPTER_TITLE_KEYS = ['title', 'chapter_title', 'name'] as const;

export type LatestChapter = {
  title: string;
  publishedAt: string;
};

/**
 * 从 chapter_list 原始条目里找「最近一章」：逐条取第一个可解析的时间字段，取最大者。
 * 没有任何条目带可解析时间 → 返回 null（不按列表顺序猜最新，保持诚实）。
 */
export function extractLatestChapter(rawItems: unknown[]): LatestChapter | null {
  let best: LatestChapter | null = null;
  for (const it of rawItems) {
    if (it == null || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    let publishedAt: string | null = null;
    for (const key of CHAPTER_TIME_KEYS) {
      publishedAt = parseOnlineTimestamp(o[key]);
      if (publishedAt) break;
    }
    if (!publishedAt) continue;
    let title = '';
    for (const key of CHAPTER_TITLE_KEYS) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) {
        title = v.trim();
        break;
      }
    }
    if (!best || publishedAt > best.publishedAt) {
      best = { title, publishedAt };
    }
  }
  return best;
}

export type SerialHealthKind = 'overdue' | 'due' | 'ok' | 'unknown';

export type SerialHealthStatus = {
  kind: SerialHealthKind;
  /** 距最近更新的整天数（UTC 日期差）；未知为 null */
  daysSince: number | null;
};

/** ISO 时间与 YYYY-MM-DD 的 UTC 日期差（天）。 */
function daysBetween(lastIso: string, todayYmd: string): number {
  const last = Date.parse(`${lastIso.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${todayYmd}T00:00:00Z`);
  if (Number.isNaN(last) || Number.isNaN(today)) return 0;
  return Math.floor((today - last) / 86400000);
}

/**
 * 断更分级：今天更过=ok；1..staleDays-1 天没更=due（今天该更）；
 * ≥staleDays 天没更=overdue（断更）；没有任何更新时间=unknown。
 */
export function classifySerialHealth(
  lastUpdateAt: string | null,
  today: string,
  staleDays: number,
): SerialHealthStatus {
  if (!lastUpdateAt) return { kind: 'unknown', daysSince: null };
  const days = daysBetween(lastUpdateAt, today);
  if (days <= 0) return { kind: 'ok', daysSince: Math.max(0, days) };
  if (days >= Math.max(1, staleDays)) return { kind: 'overdue', daysSince: days };
  return { kind: 'due', daysSince: days };
}

/** 一本书的「最近更新」：线上最近章时间与本地发布动作时间取较新者。 */
export function resolveLastUpdateAt(book: PublishBook): string | null {
  const online = book.onlineSnapshot?.latestChapterAt ?? null;
  const local = book.lastPublishedAt ?? null;
  if (online && local) return online > local ? online : local;
  return online ?? local;
}

export type SerialHealthEntry = {
  projectKey: string;
  title: string;
  penName: string | null;
  accountId: string | null;
  onlineBookId: string | null;
  kind: SerialHealthKind;
  daysSince: number | null;
  lastUpdateAt: string | null;
  latestChapterTitle: string | null;
  /** 未知/不可巡检的原因说明（未绑定线上作品、账号无 Cookie 等） */
  note: string | null;
};

const KIND_ORDER: Record<SerialHealthKind, number> = { overdue: 0, due: 1, unknown: 2, ok: 3 };

/**
 * 连载健康清单：opened / serializing 的非空位书，按 断更(天数降序) → 该更 → 未知 → 已更 排序。
 * 只吃已持久化的数据（快照 + 本地时间戳），线上刷新由调用方先行拉取写回。
 */
export function buildSerialHealth(input: {
  books: PublishBook[];
  accounts: PublishAccount[];
  today: string;
  staleDays: number;
}): SerialHealthEntry[] {
  const { books, accounts, today, staleDays } = input;
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const entries: SerialHealthEntry[] = [];
  for (const b of books) {
    if (b.status !== 'opened' && b.status !== 'serializing') continue;
    if (b.isPlaceholder) continue;
    const account = b.assignedAccountId ? (accountById.get(b.assignedAccountId) ?? null) : null;
    const lastUpdateAt = resolveLastUpdateAt(b);
    const status = classifySerialHealth(lastUpdateAt, today, staleDays);
    let note: string | null = null;
    if (!b.onlineBookId) note = '未绑定线上作品（先对账）';
    else if (!account) note = '未指派账号';
    else if (!account.cookieText?.trim()) note = '账号无 Cookie，无法线上巡检';
    else if (status.kind === 'unknown') note = '无更新时间（接口未给时间字段）';
    entries.push({
      projectKey: b.projectKey,
      title: b.title,
      penName: account?.penName ?? null,
      accountId: b.assignedAccountId,
      onlineBookId: b.onlineBookId,
      kind: status.kind,
      daysSince: status.daysSince,
      lastUpdateAt,
      latestChapterTitle: b.onlineSnapshot?.latestChapterTitle ?? null,
      note,
    });
  }
  entries.sort((a, b) => {
    const ko = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (ko !== 0) return ko;
    return (b.daysSince ?? 0) - (a.daysSince ?? 0);
  });
  return entries;
}

/**
 * 发布成功后本地盖章：命中 onlineBookId 的书写 lastPublishedAt + 快照最近章字段。
 * 无命中返回原数组引用（调用方可据此跳过写盘）。
 */
export function stampBooksPublished(
  books: PublishBook[],
  input: { onlineBookId: string; chapterTitle: string; at: string },
): PublishBook[] {
  const { onlineBookId, chapterTitle, at } = input;
  if (!onlineBookId) return books;
  let hit = false;
  const next = books.map((b) => {
    if (b.onlineBookId !== onlineBookId) return b;
    hit = true;
    return {
      ...b,
      lastPublishedAt: at,
      onlineSnapshot: b.onlineSnapshot
        ? { ...b.onlineSnapshot, latestChapterTitle: chapterTitle, latestChapterAt: at }
        : b.onlineSnapshot,
      updatedAt: at,
    };
  });
  return hit ? next : books;
}
