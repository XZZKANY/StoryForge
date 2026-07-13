import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_PUBLISH_SETTINGS,
  autoAssignReadyBooks,
  bindPlaceholderToProject,
  calibrateOpened,
  canScheduleOnDate,
  canTransition,
  capacitySnapshot,
  createPlaceholderBook,
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
  type MonthQuota,
  type PublishAccount,
  type PublishBook,
  type PublishSettings,
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
  startPublishChapter,
  onChapterPublished,
  apiPublishBook as callApiPublishBook,
  openLoginWebview,
  onCookieCaptured,
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
  const [onlineBooks, setOnlineBooks] = useState<FanqieOnlineBook[]>([]);
  const [projectChapters, setProjectChapters] = useState<ProjectChapter[]>([]);
  const flashTimerRef = useRef<number | null>(null);

  const accountsRef = useRef(accounts);

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

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
      setOnlineBooks(res.books);
      flash(`${check.authorName ?? '作者'}：线上 ${res.books.length} 本`);
    },
    [accounts, flash, settings.defaultPlatform],
  );

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
      flash('正在发布（隐藏 webview）…');
      await startPublishChapter({
        bookId: input.onlineBookId,
        volumeId: v.volumeId,
        volumeName: v.volumeName,
        title,
        contentHtml: ch.contentHtml,
      });
    },
    [accounts, flash, settings.defaultPlatform],
  );

  useEffect(() => {
    return onChapterPublished((r) => {
      if (r.ok) flash(`发布成功（章节 ${r.item_id ?? ''}）`);
      else flash(`发布失败：${r.msg}${r.code ? ` (${r.code})` : ''}`);
    });
  }, [flash]);

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
    projectChapters,
    loadProjectChapters,
    publishProjectChapter,
    apiPublishForBook,
    loginViaWebView,
  };
}

export type PublishCockpitApi = ReturnType<typeof usePublishCockpit>;
