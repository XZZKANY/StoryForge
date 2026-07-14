/**
 * 线上作品 ↔ library 对账（纯函数，无 IO）。
 *
 * 诚实边界：番茄 book_list 不带可靠开书日期，故对账**不**推算「本月已开」月账，
 * 只做：匹配、写线上快照、暴露差异（匹配/线上多出/本地查无），供人工「校准已开」决策。
 */
import type { OnlineSnapshot, PublishBook } from './types';

/** reconcile 只依赖线上书的这几个字段（与 storage 的 FanqieOnlineBook 结构兼容） */
export type ReconcileOnlineBook = {
  bookId: string;
  bookName: string;
  chapterNumber: number;
  wordNumber: number;
  statusTag: string;
  statusMsg: string;
};

/** 归一书名/章节标题用于匹配：去空白与常见标点、转小写。 */
export function normalizeBookTitle(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：""''（）【】《》〈〉·\-_.,!?;:'"`~()[\]]/g, '');
}

export type ReconcileMatched = {
  book: PublishBook;
  online: ReconcileOnlineBook;
  matchedBy: 'id' | 'title';
};

export type ReconcileResult = {
  accountId: string;
  matched: ReconcileMatched[];
  /** 线上有、library 无 */
  onlineOnly: ReconcileOnlineBook[];
  /** 本地标已开（opened/serializing 或有 openedAt）但线上查无——可能改名/号不对 */
  localMissing: PublishBook[];
  /** 该号线上总本数 */
  onlineTotal: number;
};

export function reconcileOnlineBooks(input: {
  books: PublishBook[];
  online: ReconcileOnlineBook[];
  accountId: string;
}): ReconcileResult {
  const { books, online, accountId } = input;
  const byId = new Map<string, PublishBook>();
  const byTitle = new Map<string, PublishBook>();
  for (const b of books) {
    if (b.onlineBookId) byId.set(b.onlineBookId, b);
    const nt = normalizeBookTitle(b.title);
    if (nt && !byTitle.has(nt)) byTitle.set(nt, b);
  }

  const matched: ReconcileMatched[] = [];
  const matchedKeys = new Set<string>();
  const onlineOnly: ReconcileOnlineBook[] = [];
  for (const o of online) {
    let hit = o.bookId ? byId.get(o.bookId) : undefined;
    let matchedBy: 'id' | 'title' = 'id';
    if (!hit) {
      const nt = normalizeBookTitle(o.bookName);
      hit = nt ? byTitle.get(nt) : undefined;
      matchedBy = 'title';
    }
    if (hit && !matchedKeys.has(hit.projectKey)) {
      matched.push({ book: hit, online: o, matchedBy });
      matchedKeys.add(hit.projectKey);
    } else if (!hit) {
      onlineOnly.push(o);
    }
  }

  const localMissing = books.filter(
    (b) =>
      b.assignedAccountId === accountId &&
      (b.status === 'opened' || b.status === 'serializing' || Boolean(b.openedAt)) &&
      !matchedKeys.has(b.projectKey),
  );

  return { accountId, matched, onlineOnly, localMissing, onlineTotal: online.length };
}

/** 把匹配到的线上快照写回 library 书（onlineBookId + onlineSnapshot），纯函数返回新数组。 */
export function applyOnlineSnapshots(
  books: PublishBook[],
  matched: ReconcileMatched[],
  syncedAt: string,
): PublishBook[] {
  if (matched.length === 0) return books;
  const byKey = new Map(matched.map((m) => [m.book.projectKey, m.online]));
  return books.map((b) => {
    const o = byKey.get(b.projectKey);
    if (!o) return b;
    const snapshot: OnlineSnapshot = {
      chapterCount: o.chapterNumber,
      wordCount: o.wordNumber,
      statusTag: o.statusTag,
      statusMsg: o.statusMsg,
      syncedAt,
    };
    return { ...b, onlineBookId: o.bookId, onlineSnapshot: snapshot, updatedAt: syncedAt };
  });
}

export type QuotaLedgerCompare = {
  /** 台账口径本月已开（effectiveOpened） */
  ledgerOpened: number;
  onlineTotal: number;
  matchedCount: number;
  missingCount: number;
  onlineOnlyCount: number;
};

/** 把台账已开数与对账结果并排，供 UI 展示差异——不自动改月账。 */
export function compareLedgerToOnline(input: {
  ledgerOpened: number;
  result: ReconcileResult;
}): QuotaLedgerCompare {
  const { ledgerOpened, result } = input;
  return {
    ledgerOpened,
    onlineTotal: result.onlineTotal,
    matchedCount: result.matched.length,
    missingCount: result.localMissing.length,
    onlineOnlyCount: result.onlineOnly.length,
  };
}

/** 线上多出的书「纳入台账」：建一条 online:// 追踪书（无本地手稿路径）。 */
export function buildBookFromOnline(input: {
  online: ReconcileOnlineBook;
  accountId: string;
  now: string;
  platform?: string;
}): PublishBook {
  const { online, accountId, now, platform } = input;
  return {
    projectKey: `online://${online.bookId}`,
    title: online.bookName || `线上作品 ${online.bookId}`,
    path: `online://${online.bookId}`,
    platform: platform ?? 'fanqie',
    status: 'serializing',
    assignedAccountId: accountId,
    assignmentLocked: false,
    planOpenDate: null,
    readyScore: 0,
    readyConfirmed: false,
    forceReadyReason: null,
    openedAt: now,
    lastLocalEditAt: null,
    dropReason: null,
    updatedAt: now,
    isPlaceholder: false,
    blurb: '',
    onlineBookId: online.bookId,
    onlineSnapshot: {
      chapterCount: online.chapterNumber,
      wordCount: online.wordNumber,
      statusTag: online.statusTag,
      statusMsg: online.statusMsg,
      syncedAt: now,
    },
  };
}
