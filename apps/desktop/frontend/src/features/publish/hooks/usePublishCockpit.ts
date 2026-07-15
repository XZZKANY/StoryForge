import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_PUBLISH_SETTINGS,
  autoAssignReadyBooks,
  bindPlaceholderToProject,
  calibrateOpened,
  canPublishDirect,
  canScheduleOnDate,
  canTransition,
  capacitySnapshot,
  createPlaceholderBook,
  markCsrfCaptured,
  emptyMonthQuota,
  findNearBlurbs,
  isPlaceholderBook,
  markLoginJumped,
  markOpenedInQuota,
  markSessionExpired,
  markSessionLoggedIn,
  markSessionLoggedOut,
  remainingForAccount,
  scheduleReadyWarning,
  targetGap,
  upsertReservation,
  applyOnlineSnapshots,
  buildBookFromOnline,
  buildSerialHealth,
  compareLedgerToOnline,
  effectiveOpened,
  extractLatestChapter,
  planBatchPublish,
  reconcileOnlineBooks,
  stampBooksPublished,
  type BatchChapterInput,
  type BatchPlanItem,
  type MonthQuota,
  type PublishAccount,
  type PublishBook,
  type PublishSettings,
  type QuotaLedgerCompare,
  type ReconcileResult,
} from '../model';
import {
  buildBookFromProject,
  currentYearMonth,
  loadAccounts,
  loadLibraryMerged,
  loadMonthQuota,
  loadPublishSettings,
  saveAccounts,
  saveLibrary,
  saveMonthQuota,
  savePublishSettings,
  upsertBookInLibrary,
} from '../storage/publish-repository';
import { copyText, generateOpenPack } from '../storage/open-pack';
import { scanProjectReady } from '../storage/ready-scan';
import { onPublishCommand, type PublishCommandType } from '../commands';
import { openAuthorHome, openPlatformLogin } from '../assist/open-external';
import { resolvePlatformPack } from '../packs';
import { projectBasename } from '../../../lib/project-context';
import type { PublishTabId } from '../views/types';
import {
  testCookie,
  fetchAuthorBooks,
  fetchVolumes,
  fetchChapterList,
  startPublishChapter,
  publishChapterOnce,
  publishChapterViaApi,
  onChapterPublished,
  apiPublishBook as callApiPublishBook,
  openLoginWebview,
  onCookieCaptured,
  onCsrfCaptured,
  type FanqieOnlineBook,
} from '../storage/publish-api';
import {
  listProjectChapters,
  readChapterForPublish,
  type ProjectChapter,
} from '../storage/project-chapters';
import { isTauriRuntime } from '../../../lib/tauri-env';

function normalizeKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export type BatchItemProgress = BatchPlanItem & {
  status: 'pending' | 'skip' | 'publishing' | 'ok' | 'fail';
  code?: number | null;
  resultMsg?: string;
};

export type BatchState = {
  bookId: string;
  accountId: string;
  penName: string;
  items: BatchItemProgress[];
  running: boolean;
  stopRequested: boolean;
  publishCount: number;
};

export type ReconcileState = {
  accountId: string;
  penName: string;
  result: ReconcileResult;
  ledger: QuotaLedgerCompare;
};

const BATCH_STEP_TIMEOUT_MS = 150000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function usePublishCockpit(projectPath: string | null) {
  const [tab, setTab] = useState<PublishTabId>('daily');
  const [settings, setSettings] = useState<PublishSettings>(DEFAULT_PUBLISH_SETTINGS);
  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [books, setBooks] = useState<PublishBook[]>([]);
  const [quota, setQuota] = useState<MonthQuota>(() => emptyMonthQuota(currentYearMonth()));
  const [yearMonth] = useState(() => currentYearMonth());
  const [message, setMessage] = useState<string | null>(null);
  const [assignPreview, setAssignPreview] = useState('');
  const [newPenName, setNewPenName] = useState('');
  const [slotTitle, setSlotTitle] = useState('');
  const [slotDate, setSlotDate] = useState('');
  const [assistBookKey, setAssistBookKey] = useState<string | null>(null);
  const [onlineBooksByAccount, setOnlineBooksByAccount] = useState<
    Record<string, FanqieOnlineBook[]>
  >({});
  const [projectChapters, setProjectChapters] = useState<ProjectChapter[]>([]);
  const [reconcile, setReconcile] = useState<ReconcileState | null>(null);
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [serialSweeping, setSerialSweeping] = useState(false);
  const flashTimerRef = useRef<number | null>(null);
  const batchRunningRef = useRef(false);
  const batchStopRef = useRef(false);
  const singlePublishRef = useRef<{ bookId: string; title: string } | null>(null);

  // 各账号线上书扁平去重（保留最后拉取的），供发布下拉与旧 UI 复用
  const onlineBooks = useMemo(() => {
    const byId = new Map<string, FanqieOnlineBook>();
    for (const list of Object.values(onlineBooksByAccount)) {
      for (const b of list) byId.set(b.bookId, b);
    }
    return Array.from(byId.values());
  }, [onlineBooksByAccount]);

  const accountsRef = useRef(accounts);

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  const booksRef = useRef(books);

  useEffect(() => {
    booksRef.current = books;
  }, [books]);

  const dismissFlash = useCallback(() => {
    if (flashTimerRef.current != null) {
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    setMessage(null);
  }, []);

  /** 失败类提示停留更久，可手动关闭；成功/普通 3.2s 自动消失。 */
  const flash = useCallback((text: string) => {
    if (flashTimerRef.current != null) {
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    setMessage(text);
    const sticky = /失败|错误|阻断|须|请先|无法|不是|无效/.test(text);
    const ms = sticky ? 8000 : 3200;
    flashTimerRef.current = window.setTimeout(() => {
      setMessage(null);
      flashTimerRef.current = null;
    }, ms);
  }, []);

  const reload = useCallback(async () => {
    const [s, a, b, q] = await Promise.all([
      loadPublishSettings(),
      loadAccounts(),
      loadLibraryMerged(),
      loadMonthQuota(yearMonth),
    ]);
    setSettings(s);
    setAccounts(a);
    setBooks(b);
    setQuota(q);
  }, [yearMonth]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始加载：reload 为异步，setState 在 await 之后触发
    void reload();
  }, [reload]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const capacity = useMemo(() => capacitySnapshot(accounts, settings), [accounts, settings]);
  const gap = useMemo(() => targetGap(settings, quota, accounts), [settings, quota, accounts]);

  const todayBooks = useMemo(
    () =>
      books.filter(
        (b) => b.planOpenDate === today && (b.status === 'scheduled' || b.status === 'ready'),
      ),
    [books, today],
  );
  const overdueBooks = useMemo(
    () =>
      books.filter(
        (b) =>
          b.planOpenDate &&
          b.planOpenDate < today &&
          (b.status === 'scheduled' || b.status === 'ready') &&
          !b.openedAt,
      ),
    [books, today],
  );
  const assistBook = assistBookKey
    ? (books.find((b) => b.projectKey === assistBookKey) ?? null)
    : null;

  /** 连载健康清单：从已持久化数据（快照+本地盖章）即时推导；线上刷新走 refreshSerialHealth。 */
  const serialHealth = useMemo(
    () =>
      buildSerialHealth({
        books,
        accounts,
        today,
        staleDays: settings.staleSerializingDays,
      }),
    [accounts, books, settings.staleSerializingDays, today],
  );

  const handleAddCurrentProject = useCallback(async () => {
    if (!projectPath) {
      flash('请先打开一个小说项目');
      return;
    }
    const title = projectBasename(projectPath) || '未命名';
    const book = buildBookFromProject({ path: projectPath, title });
    const next = await upsertBookInLibrary(book);
    setBooks(next);
    flash(`已加入发布库：${title}`);
  }, [flash, projectPath]);

  const handleCreateSlot = useCallback(async () => {
    const title = slotTitle.trim() || `坑位 ${today}`;
    const slot = createPlaceholderBook({ title, planOpenDate: slotDate || null });
    const next = await upsertBookInLibrary(slot);
    setBooks(next);
    setSlotTitle('');
    flash(`已占坑：${slot.title}`);
  }, [flash, slotDate, slotTitle, today]);

  const handleBindSlot = useCallback(
    async (projectKey: string) => {
      if (!projectPath) {
        flash('请先打开要绑定的项目');
        return;
      }
      const b = books.find((x) => x.projectKey === projectKey);
      if (!b || !isPlaceholderBook(b)) {
        flash('不是空位');
        return;
      }
      const bound = bindPlaceholderToProject(
        b,
        projectPath,
        projectBasename(projectPath) || undefined,
      );
      const next = [...books.filter((x) => x.projectKey !== projectKey), bound];
      await saveLibrary(next);
      setBooks(next);
      flash(`空位已绑定：${bound.title}`);
    },
    [books, flash, projectPath],
  );

  const warnBlurbIfNear = useCallback(
    (book: PublishBook): string | null => {
      const text = book.blurb?.trim();
      if (!text) return null;
      const hits = findNearBlurbs(
        text,
        books.map((b) => ({
          projectKey: b.projectKey,
          title: b.title,
          blurb: b.blurb || '',
        })),
        settings.blurbSimilarityWarnAt,
        book.projectKey,
      );
      if (hits.length === 0) return null;
      return `简介与「${hits[0].otherTitle}」过近（${Math.round(hits[0].score * 100)}%）`;
    },
    [books, settings.blurbSimilarityWarnAt],
  );

  const refreshReadyScores = useCallback(async () => {
    if (books.length === 0) {
      flash('发布库为空');
      return;
    }
    flash('正在扫描 Ready…');
    const next: PublishBook[] = [];
    for (const b of books) {
      if (isPlaceholderBook(b)) {
        next.push(b);
        continue;
      }
      try {
        const scan = await scanProjectReady(b.path, b, settings);
        next.push({
          ...b,
          readyScore: scan.score,
          lastLocalEditAt: scan.lastLocalEditAt ?? b.lastLocalEditAt,
          updatedAt: new Date().toISOString(),
        });
      } catch {
        next.push(b);
      }
    }
    await saveLibrary(next);
    setBooks(next);
    flash(`Ready 扫描完成（${next.length} 本）`);
  }, [books, flash, settings]);

  const handleAddAccount = useCallback(async () => {
    const name = newPenName.trim();
    if (!name) return;
    const acc: PublishAccount = {
      id: `acc_${Date.now().toString(36)}`,
      penName: name,
      monthlyOpenLimit: settings.defaultMonthlyOpenLimit,
      active: true,
      riskStatus: 'normal',
      riskNote: '',
      color: '#6b8afd',
      priority: 0,
      coldUntil: null,
      coldMaxOpensPerMonth: settings.defaultColdMaxOpensPerMonth,
      sessionStatus: 'unknown',
      lastLoginJumpAt: null,
      sessionConfirmedAt: null,
      sessionNote: '',
      cookieText: '',
      csrfToken: '',
      csrfCapturedAt: null,
    };
    const next = [...accounts, acc];
    await saveAccounts(next);
    setAccounts(next);
    setNewPenName('');
    flash(`已添加笔名：${name}`);
  }, [
    accounts,
    flash,
    newPenName,
    settings.defaultColdMaxOpensPerMonth,
    settings.defaultMonthlyOpenLimit,
  ]);

  const toggleBlock = useCallback(
    async (id: string) => {
      const next = accounts.map((a) =>
        a.id === id
          ? {
              ...a,
              riskStatus: (a.riskStatus === 'blocked'
                ? 'normal'
                : 'blocked') as PublishAccount['riskStatus'],
            }
          : a,
      );
      await saveAccounts(next);
      setAccounts(next);
    },
    [accounts],
  );

  const toggleCold = useCallback(
    async (id: string) => {
      const until = new Date();
      until.setUTCDate(until.getUTCDate() + 30);
      const coldUntil = until.toISOString().slice(0, 10);
      const next = accounts.map((a) => {
        if (a.id !== id) return a;
        if (a.coldUntil && a.coldUntil >= today) return { ...a, coldUntil: null };
        return {
          ...a,
          coldUntil,
          coldMaxOpensPerMonth: a.coldMaxOpensPerMonth || settings.defaultColdMaxOpensPerMonth,
        };
      });
      await saveAccounts(next);
      setAccounts(next);
      flash('已更新冷号状态');
    },
    [accounts, flash, settings.defaultColdMaxOpensPerMonth, today],
  );

  const runAutoAssign = useCallback(() => {
    const result = autoAssignReadyBooks({
      books,
      accounts,
      quota,
      settings,
      windowStart: today,
      windowDays: 28,
    });
    setAssignPreview(
      [
        `建议 ${result.suggestions.length} 本，阻塞 ${result.blockers.length} 本`,
        ...result.suggestions.map((s) => `· ${s.projectKey} → ${s.accountId} @ ${s.planOpenDate}`),
        ...result.blockers.map((b) => `× ${b.projectKey}: ${b.reason}`),
      ].join('\n'),
    );
    return result;
  }, [accounts, books, quota, settings, today]);

  const applyAutoAssign = useCallback(async () => {
    const result = runAutoAssign();
    if (result.suggestions.length === 0) {
      flash('没有可应用的指派');
      return;
    }
    const lowReady = result.suggestions.filter((s) => {
      const b = books.find((x) => x.projectKey === s.projectKey);
      if (!b) return false;
      return scheduleReadyWarning(b, settings.readyScoreThreshold).warn;
    });
    if (lowReady.length > 0) {
      const ok = window.confirm(`${lowReady.length} 本 Ready 偏低或为空位，仍强制应用指派？`);
      if (!ok) return;
    }
    let nextQuota = quota;
    const nextBooks = books.map((b) => {
      const s = result.suggestions.find((x) => x.projectKey === b.projectKey);
      if (!s) return b;
      nextQuota = upsertReservation(nextQuota, s.projectKey, s.accountId, s.planOpenDate);
      return {
        ...b,
        assignedAccountId: s.accountId,
        planOpenDate: s.planOpenDate,
        status: 'scheduled' as const,
        updatedAt: new Date().toISOString(),
      };
    });
    await saveLibrary(nextBooks);
    await saveMonthQuota(nextQuota);
    setBooks(nextBooks);
    setQuota(nextQuota);
    flash(`已应用 ${result.suggestions.length} 条指派（预留已占额度）`);
  }, [books, flash, quota, runAutoAssign, settings.readyScoreThreshold]);

  const markOpened = useCallback(
    async (projectKey: string) => {
      const b = books.find((x) => x.projectKey === projectKey);
      if (!b?.assignedAccountId) {
        flash('未指派账号，无法确认已开');
        return;
      }
      const account = accounts.find((a) => a.id === b.assignedAccountId);
      const pen = account?.penName ?? b.assignedAccountId;
      const asOf = new Date().toISOString().slice(0, 10);
      const remainBefore = account ? remainingForAccount(account, quota, asOf) : 0;
      const nextBooks = books.map((x) =>
        x.projectKey === projectKey
          ? {
              ...x,
              status: 'opened' as const,
              openedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : x,
      );
      const nextQuota = markOpenedInQuota(quota, projectKey, b.assignedAccountId);
      await saveLibrary(nextBooks);
      await saveMonthQuota(nextQuota);
      setBooks(nextBooks);
      setQuota(nextQuota);
      const remainAfter = account ? remainingForAccount(account, nextQuota, asOf) : 0;
      flash(
        `已确认开书「${b.title}」· 笔名 ${pen} · 额度 ${remainBefore} → ${remainAfter}（止损不退）`,
      );
    },
    [accounts, books, flash, quota],
  );

  const markDropped = useCallback(
    async (projectKey: string) => {
      const nextBooks = books.map((x) =>
        x.projectKey === projectKey
          ? {
              ...x,
              status: 'dropped' as const,
              dropReason: 'strategic' as const,
              updatedAt: new Date().toISOString(),
            }
          : x,
      );
      await saveLibrary(nextBooks);
      setBooks(nextBooks);
      flash('已止损（已开额度不退回）');
    },
    [books, flash],
  );

  const handleGeneratePack = useCallback(
    async (projectKey: string) => {
      const b = books.find((x) => x.projectKey === projectKey);
      if (!b) return;
      if (isPlaceholderBook(b)) {
        flash('空位请先绑定真实项目再生成作业包');
        return;
      }
      const near = warnBlurbIfNear(b);
      if (near && !window.confirm(`${near}\n仍生成作业包？`)) return;
      const root = projectPath && normalizeKey(projectPath) === b.projectKey ? projectPath : b.path;
      try {
        const pen = accounts.find((a) => a.id === b.assignedAccountId)?.penName ?? '未指派';
        const dir = await generateOpenPack({
          projectRoot: root,
          book: b,
          penName: pen,
          blurb: b.blurb || '',
          tags: [],
        });
        flash(`作业包已生成：${dir}`);
      } catch (e) {
        flash(`生成失败：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [accounts, books, flash, projectPath, warnBlurbIfNear],
  );

  const handleCopyTitle = useCallback(
    async (title: string) => {
      const ok = await copyText(title);
      flash(ok ? '书名已复制' : '复制失败，请手动选择');
    },
    [flash],
  );

  const saveTarget = useCallback(
    async (value: number) => {
      const next = { ...settings, monthlyOpenTarget: value };
      await savePublishSettings(next);
      setSettings(next);
    },
    [settings],
  );

  const saveDefaultPlatform = useCallback(
    async (platformId: string) => {
      const pack = resolvePlatformPack(platformId, { allowSkeleton: true });
      if (!pack.ready && pack.id !== 'fanqie') {
        flash(`${pack.label} 仍为骨架，默认回退番茄规则；已记录 platform 偏好`);
      }
      const next = {
        ...settings,
        defaultPlatform: platformId,
        defaultMonthlyOpenLimit: pack.ready
          ? pack.defaultMonthlyOpenLimit || settings.defaultMonthlyOpenLimit
          : settings.defaultMonthlyOpenLimit,
      };
      await savePublishSettings(next);
      setSettings(next);
    },
    [flash, settings],
  );

  const jumpPlatformLogin = useCallback(
    async (accountId?: string) => {
      const pack = resolvePlatformPack(settings.defaultPlatform);
      const result = await openPlatformLogin(pack);
      if (!result.ok) {
        flash(result.reason);
        return;
      }
      if (accountId) {
        const next = accounts.map((a) => (a.id === accountId ? markLoginJumped(a) : a));
        await saveAccounts(next);
        setAccounts(next);
        flash(`已跳转${pack.label}（${result.method}）。浏览器登录后，回本号点「确认已登录」。`);
        return;
      }
      if (accounts.length === 1) {
        const next = accounts.map((a) => markLoginJumped(a));
        await saveAccounts(next);
        setAccounts(next);
        flash(`已跳转${pack.label}（${result.method}）。登录后点「确认已登录」写入会话态。`);
        return;
      }
      flash(
        `已跳转${pack.label}（${result.method}）。请在账号列表对该笔名点「去登录」再「确认已登录」。`,
      );
    },
    [accounts, flash, settings.defaultPlatform],
  );

  const confirmAccountSession = useCallback(
    async (accountId: string) => {
      const next = accounts.map((a) => (a.id === accountId ? markSessionLoggedIn(a) : a));
      await saveAccounts(next);
      setAccounts(next);
      flash('已记录登录态（本地台账，非平台 token）');
    },
    [accounts, flash],
  );

  const clearAccountSession = useCallback(
    async (accountId: string) => {
      const next = accounts.map((a) => (a.id === accountId ? markSessionLoggedOut(a) : a));
      await saveAccounts(next);
      setAccounts(next);
      flash('已标记为退出/未登录');
    },
    [accounts, flash],
  );

  const expireAccountSession = useCallback(
    async (accountId: string) => {
      const next = accounts.map((a) => (a.id === accountId ? markSessionExpired(a) : a));
      await saveAccounts(next);
      setAccounts(next);
      flash('已标记会话可能失效');
    },
    [accounts, flash],
  );

  const saveAccountCookie = useCallback(
    async (accountId: string, cookieText: string) => {
      const next = accounts.map((a) => (a.id === accountId ? { ...a, cookieText } : a));
      await saveAccounts(next);
      setAccounts(next);
      flash('Cookie 已保存（本地加密存储）');
    },
    [accounts, flash],
  );

  const loginViaWebView = useCallback(
    async (accountId?: string) => {
      const pack = resolvePlatformPack(settings.defaultPlatform);
      const url = pack.loginUrl || pack.authorHomeUrl;
      if (!url) {
        flash(`${pack.label} 未配置登录 URL`);
        return;
      }
      if (!isTauriRuntime()) {
        flash('WebView 登录仅支持桌面端，已改为系统浏览器跳转');
        void jumpPlatformLogin(accountId);
        return;
      }
      try {
        await openLoginWebview(url, accountId ?? null);
        flash(`已打开 ${pack.label} 登录窗口，请在窗口中完成登录，Cookie 将自动提取`);
      } catch (e) {
        flash(`打开登录窗口失败: ${e instanceof Error ? e.message : String(e)}，回退系统浏览器`);
        void jumpPlatformLogin(accountId);
      }
    },
    [flash, jumpPlatformLogin, settings.defaultPlatform],
  );

  // 监听 WebView 登录窗口回传的 Cookie

  const testAccountCookie = useCallback(
    async (accountId: string) => {
      if (!isTauriRuntime()) {
        flash('Cookie 验证仅支持桌面端（需 Rust 后端代理请求）');
        return;
      }
      const acc = accounts.find((a) => a.id === accountId);
      if (!acc?.cookieText?.trim()) {
        flash('请先填入 Cookie');
        return;
      }
      flash('正在验证 Cookie...');
      const pack = resolvePlatformPack(settings.defaultPlatform);
      const result = await testCookie(pack, acc.cookieText);
      flash(result.message);
      if (result.ok) {
        const next = accounts.map((a) =>
          a.id === accountId ? { ...a, sessionStatus: 'logged_in' as const } : a,
        );
        await saveAccounts(next);
        setAccounts(next);
      }
    },
    [accounts, flash, settings.defaultPlatform],
  );

  const syncOnlineStatus = useCallback(
    async (accountId: string) => {
      if (!isTauriRuntime()) {
        flash('拉取线上状态仅支持桌面端');
        return;
      }
      const acc = accounts.find((a) => a.id === accountId);
      if (!acc?.cookieText?.trim()) {
        flash('请先填入该账号 Cookie');
        return;
      }
      flash('正在拉取线上作品...');
      const pack = resolvePlatformPack(settings.defaultPlatform);
      const check = await testCookie(pack, acc.cookieText);
      if (!check.ok) {
        flash(`Cookie 无效：${check.message}`);
        return;
      }
      const res = await fetchAuthorBooks(pack, acc.cookieText);
      if (!res.ok) {
        flash(`拉取失败：${res.message}`);
        return;
      }
      setOnlineBooksByAccount((prev) => ({ ...prev, [accountId]: res.books }));
      flash(`${check.authorName ?? '作者'}：线上 ${res.books.length} 本`);
    },
    [accounts, flash, settings.defaultPlatform],
  );

  /** 对账：拉某号线上书 → 匹配 library → 写线上快照 → 暴露差异（不自动改月账）。 */
  const reconcileAccount = useCallback(
    async (accountId: string) => {
      if (!isTauriRuntime()) {
        flash('对账仅支持桌面端（需 Rust 后端代理请求）');
        return;
      }
      const acc = accounts.find((a) => a.id === accountId);
      if (!acc?.cookieText?.trim()) {
        flash('请先填入该账号 Cookie');
        return;
      }
      flash('正在对账线上作品…');
      const pack = resolvePlatformPack(settings.defaultPlatform);
      const check = await testCookie(pack, acc.cookieText);
      if (!check.ok) {
        flash(`Cookie 无效：${check.message}`);
        return;
      }
      const res = await fetchAuthorBooks(pack, acc.cookieText);
      if (!res.ok) {
        flash(`拉取失败：${res.message}`);
        return;
      }
      setOnlineBooksByAccount((prev) => ({ ...prev, [accountId]: res.books }));
      const result = reconcileOnlineBooks({ books, online: res.books, accountId });
      if (result.matched.length > 0) {
        const now = new Date().toISOString();
        const next = applyOnlineSnapshots(books, result.matched, now);
        await saveLibrary(next);
        setBooks(next);
      }
      const ledger = compareLedgerToOnline({
        ledgerOpened: effectiveOpened(quota, accountId),
        result,
      });
      setReconcile({ accountId, penName: acc.penName, result, ledger });
      flash(
        `对账完成：匹配 ${result.matched.length} · 线上多出 ${result.onlineOnly.length} · 本地查无 ${result.localMissing.length}`,
      );
    },
    [accounts, books, flash, quota, settings.defaultPlatform],
  );

  /** 手动把某本 library 书绑定到线上 book_id（对账未自动匹配时用）。 */
  const bindOnlineBook = useCallback(
    async (projectKey: string, onlineBookId: string) => {
      if (!onlineBookId) return;
      const now = new Date().toISOString();
      const online = onlineBooks.find((b) => b.bookId === onlineBookId);
      const next = books.map((b) => {
        if (b.projectKey !== projectKey) return b;
        return {
          ...b,
          onlineBookId,
          onlineSnapshot: online
            ? {
                chapterCount: online.chapterNumber,
                wordCount: online.wordNumber,
                statusTag: online.statusTag,
                statusMsg: online.statusMsg,
                syncedAt: now,
              }
            : b.onlineSnapshot,
          updatedAt: now,
        };
      });
      await saveLibrary(next);
      setBooks(next);
      flash('已绑定线上作品');
    },
    [books, flash, onlineBooks],
  );

  /** 线上多出的书「纳入台账」：建一条 online:// 追踪书。 */
  const importOnlineBook = useCallback(
    async (accountId: string, onlineBookId: string) => {
      const online = onlineBooks.find((b) => b.bookId === onlineBookId);
      if (!online) {
        flash('未找到该线上作品');
        return;
      }
      if (books.some((b) => b.onlineBookId === onlineBookId)) {
        flash('该线上作品已在台账');
        return;
      }
      const now = new Date().toISOString();
      const newBook = buildBookFromOnline({
        online,
        accountId,
        now,
        platform: settings.defaultPlatform,
      });
      const next = [...books, newBook];
      await saveLibrary(next);
      setBooks(next);
      flash(`已纳入台账：${newBook.title}`);
    },
    [books, flash, onlineBooks, settings.defaultPlatform],
  );

  /** 发布成功本地盖章（lastPublishedAt + 快照最近章），供断更监控在线上无时间字段时兜底。 */
  const stampPublished = useCallback(async (onlineBookId: string, chapterTitle: string) => {
    const now = new Date().toISOString();
    const next = stampBooksPublished(booksRef.current, { onlineBookId, chapterTitle, at: now });
    if (next === booksRef.current) return;
    await saveLibrary(next);
    setBooks(next);
  }, []);

  /** 连载巡检：逐本拉已绑定书的线上章节列表，写回最近章时间/标题（拿不到时间不猜）。 */
  const refreshSerialHealth = useCallback(async () => {
    if (!isTauriRuntime()) {
      flash('连载巡检仅支持桌面端（需 Rust 后端代理请求）');
      return;
    }
    if (serialSweeping) return;
    const targets = books.filter(
      (b) =>
        (b.status === 'opened' || b.status === 'serializing') && !b.isPlaceholder && b.onlineBookId,
    );
    if (targets.length === 0) {
      flash('无已绑定线上作品的连载书（先在账号行「对账」绑定）');
      return;
    }
    setSerialSweeping(true);
    try {
      const pack = resolvePlatformPack(settings.defaultPlatform);
      const now = new Date().toISOString();
      let nextBooks = books;
      let checked = 0;
      let skippedNoCookie = 0;
      let failed = 0;
      for (const b of targets) {
        const acc = accounts.find((a) => a.id === b.assignedAccountId);
        if (!acc?.cookieText?.trim()) {
          skippedNoCookie += 1;
          continue;
        }
        const res = await fetchChapterList(pack, acc.cookieText, b.onlineBookId as string);
        if (!res.ok) {
          failed += 1;
          continue;
        }
        const latest = extractLatestChapter(res.items);
        nextBooks = nextBooks.map((x) => {
          if (x.projectKey !== b.projectKey) return x;
          const base = x.onlineSnapshot ?? {
            chapterCount: 0,
            wordCount: 0,
            statusTag: '',
            statusMsg: '',
            syncedAt: now,
          };
          return {
            ...x,
            onlineSnapshot: {
              ...base,
              chapterCount: res.items.length,
              latestChapterTitle: latest?.title ?? base.latestChapterTitle ?? null,
              latestChapterAt: latest?.publishedAt ?? base.latestChapterAt ?? null,
              syncedAt: now,
            },
            updatedAt: now,
          };
        });
        checked += 1;
        // 读端点轻节流，避免连拍
        await sleep(300);
      }
      if (checked > 0) {
        await saveLibrary(nextBooks);
        setBooks(nextBooks);
      }
      const parts = [`已巡检 ${checked}/${targets.length} 本`];
      if (skippedNoCookie > 0) parts.push(`无 Cookie 跳过 ${skippedNoCookie}`);
      if (failed > 0) parts.push(`拉取失败 ${failed}`);
      flash(`连载巡检完成：${parts.join(' · ')}`);
    } finally {
      setSerialSweeping(false);
    }
  }, [accounts, books, flash, serialSweeping, settings.defaultPlatform]);

  const loadProjectChapters = useCallback(async () => {
    if (!projectPath) {
      flash('请先打开项目');
      return;
    }
    try {
      const list = await listProjectChapters(projectPath);
      setProjectChapters(list);
      flash(`找到 ${list.length} 个章节文件`);
    } catch (e) {
      flash(`列章节失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [flash, projectPath]);

  const publishProjectChapter = useCallback(
    async (input: {
      accountId: string;
      onlineBookId: string;
      chapterPath: string;
      titleOverride?: string;
    }) => {
      if (!isTauriRuntime()) {
        flash('API 发布仅支持桌面端');
        return;
      }
      const acc = accounts.find((a) => a.id === input.accountId);
      if (!acc?.cookieText?.trim()) {
        flash('请先填入该账号 Cookie');
        return;
      }
      if (!input.onlineBookId) {
        flash('请选择线上作品');
        return;
      }
      if (!input.chapterPath) {
        flash('请选择章节文件');
        return;
      }
      flash('取卷中…');
      const pack = resolvePlatformPack(settings.defaultPlatform);
      const vol = await fetchVolumes(pack, acc.cookieText, input.onlineBookId);
      if (!vol.ok || vol.volumes.length === 0) {
        flash(`取卷失败：${vol.message}`);
        return;
      }
      const v = vol.volumes[0];
      const fallback =
        input.chapterPath
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.(md|txt|markdown)$/i, '') ?? '章节';
      const ch = await readChapterForPublish(input.chapterPath, fallback);
      const title = (input.titleOverride?.trim() || ch.title).slice(0, 30);
      if (
        ch.charCount < 1000 &&
        !window.confirm(`正文约 ${ch.charCount} 字，番茄要求≥1000 字，仍发布？`)
      ) {
        return;
      }
      const params = {
        bookId: input.onlineBookId,
        volumeId: v.volumeId,
        volumeName: v.volumeName,
        title,
        contentHtml: ch.contentHtml,
      };
      // 有 csrf 令牌走写侧直连（按号隔离，不占 webview）；否则回落隐藏 webview
      if (canPublishDirect(acc)) {
        flash(`正在发布（${acc.penName} 直连）…`);
        const r = await publishChapterViaApi(pack, acc.cookieText, acc.csrfToken as string, params);
        if (r.ok) {
          flash(`发布成功（章节 ${r.item_id ?? ''}）`);
          await stampPublished(input.onlineBookId, title);
        } else {
          flash(`发布失败：${r.msg}${r.code ? ` (${r.code})` : ''}（令牌失效可重新 WebView 登录）`);
        }
        return;
      }
      flash('正在发布（隐藏 webview）…');
      singlePublishRef.current = { bookId: input.onlineBookId, title };
      await startPublishChapter(params);
    },
    [accounts, flash, settings.defaultPlatform, stampPublished],
  );

  /** 批量发章：复用单章流程顺序驱动，按线上已发去重 + 字数下限跳过 + 间隔节流。 */
  const startBatchPublish = useCallback(
    async (input: { accountId: string; onlineBookId: string; chapterPaths?: string[] }) => {
      if (!isTauriRuntime()) {
        flash('批量发布仅支持桌面端');
        return;
      }
      if (batchRunningRef.current) {
        flash('已有批量任务在跑，请先停止');
        return;
      }
      const acc = accounts.find((a) => a.id === input.accountId);
      if (!acc?.cookieText?.trim()) {
        flash('请先填入该账号 Cookie');
        return;
      }
      if (!input.onlineBookId) {
        flash('请选择线上作品');
        return;
      }
      const sourcePaths = input.chapterPaths?.length
        ? input.chapterPaths
        : projectChapters.map((c) => c.path);
      if (sourcePaths.length === 0) {
        flash('无章节文件，请先「刷新章节」');
        return;
      }
      const pack = resolvePlatformPack(settings.defaultPlatform);
      flash('批量发布：取卷中…');
      const vol = await fetchVolumes(pack, acc.cookieText, input.onlineBookId);
      if (!vol.ok || vol.volumes.length === 0) {
        flash(`取卷失败：${vol.message}`);
        return;
      }
      const v = vol.volumes[0];
      const online = await fetchChapterList(pack, acc.cookieText, input.onlineBookId);

      const htmlByPath = new Map<string, string>();
      const inputs: BatchChapterInput[] = [];
      for (const path of sourcePaths) {
        const name = path.split(/[\\/]/).pop() ?? path;
        const fallback = name.replace(/\.(md|txt|markdown)$/i, '');
        try {
          const ch = await readChapterForPublish(path, fallback);
          htmlByPath.set(path, ch.contentHtml);
          inputs.push({ path, name, title: ch.title, charCount: ch.charCount });
        } catch {
          htmlByPath.set(path, '');
          inputs.push({ path, name, title: fallback, charCount: 0 });
        }
      }

      const plan = planBatchPublish({
        chapters: inputs,
        onlineTitles: online.titles,
        minChars: 1000,
      });
      const items: BatchItemProgress[] = plan.items.map((it) => ({
        ...it,
        status: it.skip ? 'skip' : 'pending',
      }));
      batchRunningRef.current = true;
      batchStopRef.current = false;
      setBatch({
        bookId: input.onlineBookId,
        accountId: input.accountId,
        penName: acc.penName,
        items,
        running: true,
        stopRequested: false,
        publishCount: plan.publishCount,
      });

      if (plan.publishCount === 0) {
        batchRunningRef.current = false;
        setBatch((prev) => (prev ? { ...prev, running: false } : prev));
        flash(`无可发章节（已在线 ${plan.skipOnlineCount} · 不足字数 ${plan.skipShortCount}）`);
        return;
      }

      const intervalMs = Math.max(0, (settings.batchPublishIntervalSec ?? 45) * 1000);
      const publishable = items.filter((it) => !it.skip);
      const direct = canPublishDirect(acc);
      let ok = 0;
      let fail = 0;
      let lastOkTitle = '';
      for (let i = 0; i < publishable.length; i += 1) {
        if (batchStopRef.current) break;
        const item = publishable[i];
        setBatch((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((x) =>
                  x.path === item.path ? { ...x, status: 'publishing' } : x,
                ),
              }
            : prev,
        );
        const params = {
          bookId: input.onlineBookId,
          volumeId: v.volumeId,
          volumeName: v.volumeName,
          title: item.title,
          contentHtml: htmlByPath.get(item.path) ?? '',
        };
        // 有 csrf 令牌走写侧直连（按号隔离，多号可各自批量）；否则回落隐藏 webview
        const r = direct
          ? await publishChapterViaApi(pack, acc.cookieText, acc.csrfToken as string, params)
          : await publishChapterOnce(params, BATCH_STEP_TIMEOUT_MS);
        if (r.ok) {
          ok += 1;
          lastOkTitle = item.title;
        } else {
          fail += 1;
        }
        setBatch((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((x) =>
                  x.path === item.path
                    ? {
                        ...x,
                        status: r.ok ? 'ok' : 'fail',
                        code: r.code ?? null,
                        resultMsg: r.ok ? (r.item_id ?? '') : r.msg,
                      }
                    : x,
                ),
              }
            : prev,
        );
        const isLast = i === publishable.length - 1;
        if (!isLast && !batchStopRef.current && intervalMs > 0) {
          await sleep(intervalMs);
        }
      }
      batchRunningRef.current = false;
      setBatch((prev) => (prev ? { ...prev, running: false } : prev));
      if (ok > 0) {
        await stampPublished(input.onlineBookId, lastOkTitle);
      }
      const stopped = batchStopRef.current;
      flash(
        `${stopped ? '已停止' : '批量完成'}：成功 ${ok} · 失败 ${fail} · 跳过 ${
          plan.skipOnlineCount + plan.skipShortCount
        }`,
      );
    },
    [
      accounts,
      flash,
      projectChapters,
      settings.batchPublishIntervalSec,
      settings.defaultPlatform,
      stampPublished,
    ],
  );

  const stopBatch = useCallback(() => {
    if (!batchRunningRef.current) return;
    batchStopRef.current = true;
    setBatch((prev) => (prev ? { ...prev, stopRequested: true } : prev));
    flash('已请求停止（当前章发完即停）');
  }, [flash]);

  useEffect(() => {
    return onChapterPublished((r) => {
      if (batchRunningRef.current) return; // 批量任务自带进度，避免双提示
      if (r.ok) {
        flash(`发布成功（章节 ${r.item_id ?? ''}）`);
        const pending = singlePublishRef.current;
        singlePublishRef.current = null;
        if (pending) void stampPublished(pending.bookId, pending.title);
      } else {
        singlePublishRef.current = null;
        flash(`发布失败：${r.msg}${r.code ? ` (${r.code})` : ''}`);
      }
    });
  }, [flash, stampPublished]);

  const apiPublishForBook = useCallback(
    async (projectKey: string) => {
      if (!isTauriRuntime()) {
        flash('API 开书仅支持桌面端');
        return;
      }
      const book = books.find((b) => b.projectKey === projectKey);
      if (!book) {
        flash('未找到书籍');
        return;
      }
      const acc = accounts.find((a) => a.id === book.assignedAccountId);
      if (!acc?.cookieText?.trim()) {
        flash('请先在账号管理填入 Cookie');
        return;
      }
      if (!book.blurb?.trim()) {
        flash('请先在项目 publish.json 中填写简介（blurb）');
        return;
      }
      flash('正在通过 API 开书...');
      const pack = resolvePlatformPack(String(book.platform));
      const result = await callApiPublishBook(pack, acc.cookieText, {
        title: book.title,
        blurb: book.blurb,
        tags: '',
        categoryId: '0',
      });
      if (result.ok) {
        flash(`开书成功！${result.status}`);
        setBooks((prev) =>
          prev.map((x) =>
            x.projectKey === projectKey
              ? {
                  ...x,
                  status: 'opened' as const,
                  openedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }
              : x,
          ),
        );
      } else {
        flash(`开书失败: ${result.message}`);
      }
    },
    [accounts, books, flash],
  );

  const jumpAuthorHome = useCallback(async () => {
    const pack = resolvePlatformPack(settings.defaultPlatform);
    const result = await openAuthorHome(pack);
    if (result.ok) flash(`已打开${pack.label}作者后台（${result.method}）`);
    else flash(result.reason);
  }, [flash, settings.defaultPlatform]);

  const markOpenedTodayBatch = useCallback(async () => {
    const targets = todayBooks.filter((b) => b.assignedAccountId);
    if (targets.length === 0) {
      flash('今日无已指派待开书');
      return;
    }
    let nextQuota = quota;
    let nextBooks = books;
    for (const t of targets) {
      if (!t.assignedAccountId) continue;
      nextBooks = nextBooks.map((x) =>
        x.projectKey === t.projectKey
          ? {
              ...x,
              status: 'opened' as const,
              openedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : x,
      );
      nextQuota = markOpenedInQuota(nextQuota, t.projectKey, t.assignedAccountId);
    }
    await saveLibrary(nextBooks);
    await saveMonthQuota(nextQuota);
    setBooks(nextBooks);
    setQuota(nextQuota);
    flash(`已确认今日开书 ${targets.length} 本`);
  }, [books, flash, quota, todayBooks]);

  const markDroppedFocus = useCallback(async () => {
    const target =
      todayBooks[0] ||
      overdueBooks[0] ||
      books.find((b) => b.status === 'scheduled' || b.status === 'opened');
    if (!target) {
      flash('没有可止损的书');
      return;
    }
    await markDropped(target.projectKey);
  }, [books, flash, markDropped, overdueBooks, todayBooks]);

  const handleGeneratePackFocus = useCallback(async () => {
    const target =
      (projectPath && books.find((b) => normalizeKey(b.path) === normalizeKey(projectPath))) ||
      todayBooks[0] ||
      books[0];
    if (!target) {
      flash('没有可生成作业包的书');
      return;
    }
    await handleGeneratePack(target.projectKey);
  }, [books, flash, handleGeneratePack, projectPath, todayBooks]);

  const forceReady = useCallback(
    async (projectKey: string) => {
      const b = books.find((x) => x.projectKey === projectKey);
      const reason = window.prompt('强制 Ready 原因（必填）', b?.forceReadyReason ?? '');
      if (reason === null) return;
      if (!reason.trim()) {
        flash('强制放行须填写原因');
        return;
      }
      const next = books.map((x) =>
        x.projectKey === projectKey
          ? {
              ...x,
              readyConfirmed: true,
              forceReadyReason: reason.trim(),
              readyScore: Math.max(x.readyScore, settings.readyScoreThreshold),
              status:
                x.status === 'writing' || x.status === 'polish' || x.status === 'idea'
                  ? ('ready' as const)
                  : x.status,
              updatedAt: new Date().toISOString(),
            }
          : x,
      );
      await saveLibrary(next);
      setBooks(next);
      flash('已强制 Ready');
    },
    [books, flash, settings.readyScoreThreshold],
  );

  const changeStatus = useCallback(
    async (projectKey: string, status: PublishBook['status']) => {
      const b = books.find((x) => x.projectKey === projectKey);
      if (!b) return;
      const check = canTransition(b, status);
      if (!check.ok) {
        flash(check.reason);
        return;
      }
      const next = books.map((x) =>
        x.projectKey === projectKey ? { ...x, status, updatedAt: new Date().toISOString() } : x,
      );
      await saveLibrary(next);
      setBooks(next);
    },
    [books, flash],
  );

  const changePlanDate = useCallback(
    async (projectKey: string, date: string | null) => {
      const b = books.find((x) => x.projectKey === projectKey);
      if (!b) return;
      if (date) {
        const check = canScheduleOnDate(books, date, settings, b.assignedAccountId, b.projectKey);
        if (!check.ok) {
          flash(check.reason);
          return;
        }
      }
      const next = books.map((x) =>
        x.projectKey === projectKey
          ? { ...x, planOpenDate: date, updatedAt: new Date().toISOString() }
          : x,
      );
      await saveLibrary(next);
      setBooks(next);
      flash(date ? `已改期 ${date}` : '已清除计划日');
    },
    [books, flash, settings],
  );

  const calibrateAccountOpened = useCallback(
    async (accountId: string, n: number) => {
      const next = calibrateOpened(quota, accountId, n);
      await saveMonthQuota(next);
      setQuota(next);
      const pen = accounts.find((a) => a.id === accountId)?.penName ?? accountId;
      flash(`${pen} 本月已开校准为 ${n}`);
    },
    [accounts, flash, quota],
  );

  useEffect(() => {
    return onPublishCommand((type: PublishCommandType) => {
      switch (type) {
        case 'add-current':
          void handleAddCurrentProject();
          break;
        case 'auto-assign':
          setTab('assign');
          void applyAutoAssign();
          break;
        case 'generate-pack':
          void handleGeneratePackFocus();
          break;
        case 'mark-opened-today':
          void markOpenedTodayBatch();
          break;
        case 'mark-dropped':
          void markDroppedFocus();
          break;
        case 'monthly-review':
          setTab('review');
          flash('已打开月度复盘');
          break;
        case 'refresh-ready':
          void refreshReadyScores();
          break;
        case 'serial-health':
          setTab('daily');
          void refreshSerialHealth();
          break;
        case 'reschedule-focus':
          setTab('calendar');
          flash('请在日历中改 planOpenDate');
          break;
        case 'open-assist': {
          const target =
            todayBooks[0] || overdueBooks[0] || books.find((b) => b.status === 'scheduled');
          if (!target) {
            flash('没有可开书辅助的书');
            break;
          }
          setTab('daily');
          setAssistBookKey(target.projectKey);
          break;
        }
        case 'platform-login':
          void jumpPlatformLogin();
          break;
        case 'open-author-home':
          void jumpAuthorHome();
          break;
        default:
          break;
      }
    });
  }, [
    applyAutoAssign,
    books,
    flash,
    handleAddCurrentProject,
    handleGeneratePackFocus,
    jumpAuthorHome,
    jumpPlatformLogin,
    markDroppedFocus,
    markOpenedTodayBatch,
    overdueBooks,
    refreshReadyScores,
    refreshSerialHealth,
    todayBooks,
  ]);

  useEffect(() => {
    return onCookieCaptured((payload) => {
      const cookies = payload.cookies;
      if (!cookies) return;
      const targetId = payload.account_id;
      const current = accountsRef.current;
      const next = current.map((a) => {
        if (targetId && a.id !== targetId) return a;
        if (!targetId && a !== current[0]) return a;
        return { ...a, cookieText: cookies, sessionStatus: 'logged_in' as const };
      });
      if (next === current) return;
      saveAccounts(next)
        .then(() => {
          setAccounts(next);
          flash('Cookie 已自动提取并保存，会话标记为已登录');
        })
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return onCsrfCaptured((payload) => {
      const token = payload.token;
      if (!token) return;
      const targetId = payload.account_id;
      const current = accountsRef.current;
      const next = current.map((a) => {
        if (targetId && a.id !== targetId) return a;
        if (!targetId && a !== current[0]) return a;
        return markCsrfCaptured(a, token);
      });
      if (next === current) return;
      saveAccounts(next)
        .then(() => {
          setAccounts(next);
          flash('写侧令牌已捕获，该号可直连发章（不必让 webview 登着它）');
        })
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    tab,
    setTab,
    settings,
    accounts,
    books,
    quota,
    yearMonth,
    message,
    dismissFlash,
    assignPreview,
    newPenName,
    setNewPenName,
    slotTitle,
    setSlotTitle,
    slotDate,
    setSlotDate,
    assistBook,
    setAssistBookKey,
    today,
    capacity,
    gap,
    todayBooks,
    overdueBooks,
    flash,
    handleAddCurrentProject,
    handleCreateSlot,
    handleBindSlot,
    refreshReadyScores,
    handleAddAccount,
    toggleBlock,
    toggleCold,
    runAutoAssign,
    applyAutoAssign,
    markOpened,
    markDropped,
    handleGeneratePack,
    handleCopyTitle,
    saveTarget,
    saveDefaultPlatform,
    jumpPlatformLogin,
    confirmAccountSession,
    clearAccountSession,
    expireAccountSession,
    jumpAuthorHome,
    forceReady,
    changeStatus,
    changePlanDate,
    calibrateAccountOpened,
    saveAccountCookie,
    testAccountCookie,
    syncOnlineStatus,
    onlineBooks,
    onlineBooksByAccount,
    projectChapters,
    loadProjectChapters,
    publishProjectChapter,
    apiPublishForBook,
    loginViaWebView,
    reconcile,
    reconcileAccount,
    bindOnlineBook,
    importOnlineBook,
    batch,
    startBatchPublish,
    stopBatch,
    serialHealth,
    serialSweeping,
    refreshSerialHealth,
  };
}

export type PublishCockpitApi = ReturnType<typeof usePublishCockpit>;
