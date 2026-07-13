import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
  isSessionStale,
  markLoginJumped,
  markOpenedInQuota,
  markSessionExpired,
  markSessionLoggedIn,
  markSessionLoggedOut,
  remainingForAccount,
  scheduleReadyWarning,
  sessionStatusLabel,
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
import { OpenAssistWizard } from '../assist/OpenAssistWizard';
import { openAuthorHome, openPlatformLogin } from '../assist/open-external';
import { listPlatformPacks, resolvePlatformPack } from '../packs';
import { projectBasename } from '../../../lib/project-context';

type TabId = 'daily' | 'pipeline' | 'calendar' | 'accounts' | 'assign' | 'review' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'daily', label: '今日作战' },
  { id: 'pipeline', label: '流水线' },
  { id: 'calendar', label: '日历' },
  { id: 'accounts', label: '账号额度' },
  { id: 'assign', label: '智能指派' },
  { id: 'review', label: '复盘' },
  { id: 'settings', label: '设置' },
];

export type PublishCockpitProps = {
  projectPath: string | null;
  /** sidebar=左栏功能块（默认）；page=旧中栏整页（兼容） */
  variant?: 'sidebar' | 'page';
  onClose?: () => void;
};

export function PublishCockpit({
  projectPath,
  variant = 'sidebar',
  onClose,
}: PublishCockpitProps) {
  const [tab, setTab] = useState<TabId>('daily');
  const [settings, setSettings] = useState<PublishSettings>(DEFAULT_PUBLISH_SETTINGS);
  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [books, setBooks] = useState<PublishBook[]>([]);
  const [quota, setQuota] = useState<MonthQuota>(() => emptyMonthQuota(currentYearMonth()));
  const [yearMonth] = useState(() => currentYearMonth());
  const [message, setMessage] = useState<string | null>(null);
  const [assignPreview, setAssignPreview] = useState<string>('');
  const [newPenName, setNewPenName] = useState('');
  const [slotTitle, setSlotTitle] = useState('');
  const [slotDate, setSlotDate] = useState('');
  const [assistBookKey, setAssistBookKey] = useState<string | null>(null);

  const flash = useCallback((text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 3200);
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
    void reload();
  }, [reload]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const capacity = useMemo(() => capacitySnapshot(accounts, settings), [accounts, settings]);
  const gap = useMemo(() => targetGap(settings, quota, accounts), [settings, quota, accounts]);

  const todayBooks = books.filter(
    (b) => b.planOpenDate === today && (b.status === 'scheduled' || b.status === 'ready'),
  );
  const overdueBooks = books.filter(
    (b) =>
      b.planOpenDate &&
      b.planOpenDate < today &&
      (b.status === 'scheduled' || b.status === 'ready') &&
      !b.openedAt,
  );
  const assistBook = assistBookKey
    ? books.find((b) => b.projectKey === assistBookKey) ?? null
    : null;

  const handleAddCurrentProject = async () => {
    if (!projectPath) {
      flash('请先打开一个小说项目');
      return;
    }
    const title = projectBasename(projectPath) || '未命名';
    const book = buildBookFromProject({ path: projectPath, title });
    const next = await upsertBookInLibrary(book);
    setBooks(next);
    flash(`已加入发布库：${title}`);
  };

  const handleCreateSlot = async () => {
    const title = slotTitle.trim() || `坑位 ${today}`;
    const slot = createPlaceholderBook({
      title,
      planOpenDate: slotDate || null,
    });
    const next = await upsertBookInLibrary(slot);
    setBooks(next);
    setSlotTitle('');
    flash(`已占坑：${slot.title}`);
  };

  const handleBindSlot = async (projectKey: string) => {
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
    const without = books.filter((x) => x.projectKey !== projectKey);
    const next = [...without, bound];
    await saveLibrary(next);
    setBooks(next);
    flash(`空位已绑定：${bound.title}`);
  };

  const warnBlurbIfNear = (book: PublishBook): string | null => {
    const text = book.blurb?.trim();
    if (!text) return null;
    const hits = findNearBlurbs(
      text,
      books.map((b) => ({ projectKey: b.projectKey, title: b.title, blurb: b.blurb || '' })),
      settings.blurbSimilarityWarnAt,
      book.projectKey,
    );
    if (hits.length === 0) return null;
    const top = hits[0];
    return `简介与「${top.otherTitle}」过近（${Math.round(top.score * 100)}%）`;
  };

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

  const handleAddAccount = async () => {
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
    };
    const next = [...accounts, acc];
    await saveAccounts(next);
    setAccounts(next);
    setNewPenName('');
    flash(`已添加笔名：${name}`);
  };

  const toggleBlock = async (id: string) => {
    const next = accounts.map((a) =>
      a.id === id
        ? {
            ...a,
            riskStatus: (a.riskStatus === 'blocked' ? 'normal' : 'blocked') as PublishAccount['riskStatus'],
          }
        : a,
    );
    await saveAccounts(next);
    setAccounts(next);
  };

  const toggleCold = async (id: string) => {
    const until = new Date();
    until.setUTCDate(until.getUTCDate() + 30);
    const coldUntil = until.toISOString().slice(0, 10);
    const next = accounts.map((a) => {
      if (a.id !== id) return a;
      if (a.coldUntil && a.coldUntil >= today) {
        return { ...a, coldUntil: null };
      }
      return {
        ...a,
        coldUntil,
        coldMaxOpensPerMonth: a.coldMaxOpensPerMonth || settings.defaultColdMaxOpensPerMonth,
      };
    });
    await saveAccounts(next);
    setAccounts(next);
    flash('已更新冷号状态');
  };

  const runAutoAssign = () => {
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
        ...result.suggestions.map(
          (s) => `· ${s.projectKey} → ${s.accountId} @ ${s.planOpenDate}`,
        ),
        ...result.blockers.map((b) => `× ${b.projectKey}: ${b.reason}`),
      ].join('\n'),
    );
    return result;
  };

  const applyAutoAssign = async () => {
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
      const ok = window.confirm(
        `${lowReady.length} 本 Ready 偏低或为空位，仍强制应用指派？`,
      );
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
  };

  const markOpened = async (projectKey: string) => {
    const b = books.find((x) => x.projectKey === projectKey);
    if (!b?.assignedAccountId) {
      flash('未指派账号，无法确认已开');
      return;
    }
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
    flash('已确认开书（额度已占用，止损不退）');
  };

  const markDropped = async (projectKey: string) => {
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
  };

  const handleGeneratePack = async (projectKey: string) => {
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
      const pen =
        accounts.find((a) => a.id === b.assignedAccountId)?.penName ?? '未指派';
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
  };

  const handleCopyTitle = async (title: string) => {
    const ok = await copyText(title);
    flash(ok ? '书名已复制' : '复制失败，请手动选择');
  };

  const saveTarget = async (value: number) => {
    const next = { ...settings, monthlyOpenTarget: value };
    await savePublishSettings(next);
    setSettings(next);
  };

  const saveDefaultPlatform = async (platformId: string) => {
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
  };

  const jumpPlatformLogin = async (accountId?: string) => {
    const pack = resolvePlatformPack(settings.defaultPlatform);
    const result = await openPlatformLogin(pack);
    if (!result.ok) {
      flash(result.reason);
      return;
    }
    // 无法从浏览器拿 Cookie：跳转后把对应号标成 pending，等用户回写「已登录」
    if (accountId) {
      const next = accounts.map((a) =>
        a.id === accountId ? markLoginJumped(a) : a,
      );
      await saveAccounts(next);
      setAccounts(next);
      flash(
        `已跳转${pack.label}（${result.method}）。浏览器登录后，回本号点「确认已登录」。`,
      );
      return;
    }
    // 未指定号：若只有一个号则挂到它；否则提示先选号
    if (accounts.length === 1) {
      const next = accounts.map((a) => markLoginJumped(a));
      await saveAccounts(next);
      setAccounts(next);
      flash(
        `已跳转${pack.label}（${result.method}）。登录后点「确认已登录」写入会话态。`,
      );
      return;
    }
    flash(
      `已跳转${pack.label}（${result.method}）。请在账号列表对该笔名点「去登录」再「确认已登录」。`,
    );
  };

  const confirmAccountSession = async (accountId: string) => {
    const next = accounts.map((a) =>
      a.id === accountId ? markSessionLoggedIn(a) : a,
    );
    await saveAccounts(next);
    setAccounts(next);
    flash('已记录登录态（本地台账，非平台 token）');
  };

  const clearAccountSession = async (accountId: string) => {
    const next = accounts.map((a) =>
      a.id === accountId ? markSessionLoggedOut(a) : a,
    );
    await saveAccounts(next);
    setAccounts(next);
    flash('已标记为退出/未登录');
  };

  const expireAccountSession = async (accountId: string) => {
    const next = accounts.map((a) =>
      a.id === accountId ? markSessionExpired(a) : a,
    );
    await saveAccounts(next);
    setAccounts(next);
    flash('已标记会话可能失效');
  };

  const jumpAuthorHome = async () => {
    const pack = resolvePlatformPack(settings.defaultPlatform);
    const result = await openAuthorHome(pack);
    if (result.ok) {
      flash(`已打开${pack.label}作者后台（${result.method}）`);
    } else {
      flash(result.reason);
    }
  };

  const markOpenedTodayBatch = async () => {
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
  };

  const markDroppedFocus = async () => {
    const target =
      todayBooks[0] ||
      overdueBooks[0] ||
      books.find((b) => b.status === 'scheduled' || b.status === 'opened');
    if (!target) {
      flash('没有可止损的书');
      return;
    }
    await markDropped(target.projectKey);
  };

  const handleGeneratePackFocus = async () => {
    const target =
      (projectPath && books.find((b) => normalizeKey(b.path) === normalizeKey(projectPath))) ||
      todayBooks[0] ||
      books[0];
    if (!target) {
      flash('没有可生成作业包的书');
      return;
    }
    await handleGeneratePack(target.projectKey);
  };

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
            todayBooks[0] ||
            overdueBooks[0] ||
            books.find((b) => b.status === 'scheduled');
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
        case 'open':
        default:
          break;
      }
    });
    // 故意不把全部 handler 列入 deps：命令总线挂载一次即可，读最新闭包经 state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books, quota, projectPath, today, settings, refreshReadyScores]);

  const compact = variant === 'sidebar';

  return (
    <div
      className={`flex h-full min-h-0 flex-col text-foreground ${compact ? 'bg-panel' : 'bg-background'}`}
      data-testid="publish-cockpit"
      data-variant={variant}
    >
      <header
        className={`flex flex-wrap items-center gap-1 border-b border-border ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}
      >
        <h1 className={`font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>发行</h1>
        <span className="text-[10px] text-subtle">{yearMonth}</span>
        <div className="flex-1" />
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-elevated"
          onClick={() => void jumpPlatformLogin()}
          title="系统浏览器跳转平台登录/作者页（不代登、不存密码）"
        >
          登录
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-elevated"
          onClick={() => void jumpAuthorHome()}
          title="打开作者后台"
        >
          后台
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-elevated"
          onClick={() => void handleAddCurrentProject()}
          title="将当前项目加入发布库"
        >
          入库
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-elevated"
          onClick={() => void handleCreateSlot()}
        >
          占坑
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-elevated"
          onClick={() => void refreshReadyScores()}
        >
          Ready
        </button>
        {onClose && variant === 'page' && (
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[10px] hover:bg-elevated"
            onClick={onClose}
          >
            关闭
          </button>
        )}
      </header>

      <div className="flex flex-wrap gap-0.5 border-b border-border px-1 py-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`publish-tab-${t.id}`}
            className={`rounded px-1.5 py-0.5 text-[10px] ${tab === t.id ? 'bg-elevated text-foreground' : 'text-subtle hover:bg-elevated/60'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {message && (
        <div className="border-b border-border bg-elevated/40 px-3 py-1 text-xs">{message}</div>
      )}

      <div className={`min-h-0 flex-1 overflow-auto text-sm ${compact ? 'p-2' : 'p-3'}`}>
        <div className={`mb-2 grid gap-1.5 ${compact ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
          <Stat label="目标" value={String(settings.monthlyOpenTarget)} />
          <Stat label="理论产能" value={String(capacity.theory)} />
          <Stat label="spare" value={String(capacity.spare)} warn={capacity.spareWarn} />
          <Stat label="目标缺口" value={String(gap)} warn={gap > 0} />
        </div>

        {tab === 'daily' && (
          <section className="space-y-3">
            <Block title="今日应开">
              {todayBooks.length === 0 ? (
                <Empty>今日无排期</Empty>
              ) : (
                todayBooks.map((b) => (
                  <BookRow
                    key={b.projectKey}
                    book={b}
                    accounts={accounts}
                    onOpen={() => void markOpened(b.projectKey)}
                    onPack={() => void handleGeneratePack(b.projectKey)}
                    onCopy={() => void handleCopyTitle(b.title)}
                    onDrop={() => void markDropped(b.projectKey)}
                    onAssist={() => setAssistBookKey(b.projectKey)}
                  />
                ))
              )}
            </Block>
            <Block title="逾期未开">
              {overdueBooks.length === 0 ? (
                <Empty>无逾期</Empty>
              ) : (
                overdueBooks.map((b) => (
                  <BookRow
                    key={b.projectKey}
                    book={b}
                    accounts={accounts}
                    onOpen={() => void markOpened(b.projectKey)}
                    onPack={() => void handleGeneratePack(b.projectKey)}
                    onCopy={() => void handleCopyTitle(b.title)}
                    onDrop={() => void markDropped(b.projectKey)}
                    onAssist={() => setAssistBookKey(b.projectKey)}
                  />
                ))
              )}
            </Block>
            <Block title="本周队列（已排期）">
              {books.filter((b) => b.status === 'scheduled').length === 0 ? (
                <Empty>暂无</Empty>
              ) : (
                books
                  .filter((b) => b.status === 'scheduled')
                  .map((b) => (
                    <div key={b.projectKey} className="text-xs text-subtle">
                      {b.planOpenDate} · {b.title}
                    </div>
                  ))
              )}
            </Block>
          </section>
        )}

        {tab === 'pipeline' && (
          <section className="space-y-2">
            <div className="flex flex-wrap gap-2 rounded border border-border p-2 text-xs">
              <input
                className="min-w-[8rem] flex-1 rounded border border-border bg-background px-2 py-1"
                placeholder="空位标题"
                value={slotTitle}
                onChange={(e) => setSlotTitle(e.target.value)}
              />
              <input
                type="date"
                className="rounded border border-border bg-background px-1 py-1"
                value={slotDate}
                onChange={(e) => setSlotDate(e.target.value)}
              />
              <button
                type="button"
                className="rounded bg-elevated px-2 py-1"
                onClick={() => void handleCreateSlot()}
              >
                创建空位
              </button>
            </div>
            {books.length === 0 ? (
              <Empty>发布库为空。打开项目后点「加入当前项目」，或创建空位占坑。</Empty>
            ) : (
              books.map((b) => (
                <div
                  key={b.projectKey}
                  className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1.5"
                >
                  <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] uppercase">
                    {b.status}
                    {isPlaceholderBook(b) ? ' · 空位' : ''}
                  </span>
                  <span className="font-medium">{b.title}</span>
                  <span className="text-xs text-subtle">
                    {b.planOpenDate ?? '未排期'} · Ready {b.readyScore}
                    {b.readyConfirmed ? ' · 已放行' : ''}
                  </span>
                  <div className="flex-1" />
                  {isPlaceholderBook(b) && (
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-xs hover:bg-elevated"
                      onClick={() => void handleBindSlot(b.projectKey)}
                    >
                      绑定当前项目
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-xs hover:bg-elevated"
                    onClick={() => {
                      const reason = window.prompt('强制 Ready 原因（必填）', b.forceReadyReason ?? '');
                      if (reason === null) return;
                      if (!reason.trim()) {
                        flash('强制放行须填写原因');
                        return;
                      }
                      void (async () => {
                        const next = books.map((x) =>
                          x.projectKey === b.projectKey
                            ? {
                                ...x,
                                readyConfirmed: true,
                                forceReadyReason: reason.trim(),
                                readyScore: Math.max(x.readyScore, settings.readyScoreThreshold),
                                status: x.status === 'writing' || x.status === 'polish' || x.status === 'idea'
                                  ? ('ready' as const)
                                  : x.status,
                                updatedAt: new Date().toISOString(),
                              }
                            : x,
                        );
                        await saveLibrary(next);
                        setBooks(next);
                        flash('已强制 Ready');
                      })();
                    }}
                  >
                    强制Ready
                  </button>
                  <select
                    className="rounded border border-border bg-background px-1 py-0.5 text-xs"
                    value={b.status}
                    onChange={(e) => {
                      const status = e.target.value as PublishBook['status'];
                      const check = canTransition(b, status);
                      if (!check.ok) {
                        flash(check.reason);
                        return;
                      }
                      void (async () => {
                        const next = books.map((x) =>
                          x.projectKey === b.projectKey
                            ? { ...x, status, updatedAt: new Date().toISOString() }
                            : x,
                        );
                        await saveLibrary(next);
                        setBooks(next);
                      })();
                    }}
                  >
                    {[
                      'idea',
                      'writing',
                      'polish',
                      'ready',
                      'scheduled',
                      'opened',
                      'serializing',
                      'dropped',
                    ].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              ))
            )}
          </section>
        )}

        {tab === 'calendar' && (
          <section className="space-y-2">
            <p className="text-xs text-subtle">
              月历（{yearMonth}）：改 planOpenDate；超同日全池上限会阻断
            </p>
            {books
              .filter((b) => b.status !== 'dropped')
              .sort((a, b) => (a.planOpenDate ?? '9999').localeCompare(b.planOpenDate ?? '9999'))
              .map((b) => (
                <div
                  key={b.projectKey}
                  className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1.5 text-xs"
                >
                  <span className="min-w-[8rem] font-medium">{b.title}</span>
                  <input
                    type="date"
                    className="rounded border border-border bg-background px-1 py-0.5"
                    value={b.planOpenDate ?? ''}
                    onChange={(e) => {
                      const date = e.target.value || null;
                      if (date) {
                        const check = canScheduleOnDate(
                          books,
                          date,
                          settings,
                          b.assignedAccountId,
                          b.projectKey,
                        );
                        if (!check.ok) {
                          flash(check.reason);
                          return;
                        }
                      }
                      void (async () => {
                        const next = books.map((x) =>
                          x.projectKey === b.projectKey
                            ? { ...x, planOpenDate: date, updatedAt: new Date().toISOString() }
                            : x,
                        );
                        await saveLibrary(next);
                        setBooks(next);
                        flash(date ? `已改期 ${date}` : '已清除计划日');
                      })();
                    }}
                  />
                  <span className="text-subtle">{b.status}</span>
                </div>
              ))}
            {books.length === 0 && <Empty>无书可排期</Empty>}
          </section>
        )}

        {tab === 'accounts' && (
          <section className="space-y-3">
            <p className="text-[10px] text-subtle">
              番茄无第三方 OAuth 回调：流程是「跳转浏览器登录 → 回 SF 确认已登录」。
              会话态是本地台账，不是浏览器 Cookie / access_token。
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded bg-elevated px-2 py-1 text-xs"
                onClick={() => void jumpPlatformLogin()}
              >
                跳转平台登录
              </button>
              <button
                type="button"
                className="rounded bg-elevated px-2 py-1 text-xs"
                onClick={() => void jumpAuthorHome()}
              >
                打开作者后台
              </button>
            </div>
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                placeholder="新笔名"
                value={newPenName}
                onChange={(e) => setNewPenName(e.target.value)}
              />
              <button
                type="button"
                className="rounded bg-elevated px-2 py-1 text-xs"
                onClick={() => void handleAddAccount()}
              >
                添加账号
              </button>
            </div>
            {accounts.map((a) => {
              const stale = isSessionStale(a);
              const sessionLabel = stale
                ? '可能失效'
                : sessionStatusLabel(a.sessionStatus);
              const sessionClass =
                a.sessionStatus === 'logged_in' && !stale
                  ? 'text-emerald-400'
                  : a.sessionStatus === 'pending'
                    ? 'text-amber-400'
                    : a.sessionStatus === 'expired' || stale
                      ? 'text-red-400'
                      : 'text-subtle';
              return (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1.5 text-xs"
              >
                <span className="font-medium">{a.penName}</span>
                <span className="text-subtle">limit {a.monthlyOpenLimit}</span>
                <span className="text-subtle">剩余 {remainingForAccount(a, quota, today)}</span>
                <span className={sessionClass} title={a.sessionConfirmedAt ?? a.lastLoginJumpAt ?? ''}>
                  会话:{sessionLabel}
                </span>
                <span
                  className={
                    a.riskStatus === 'blocked' ? 'text-red-400' : 'text-subtle'
                  }
                >
                  {a.riskStatus}
                </span>
                {a.coldUntil && a.coldUntil >= today && (
                  <span className="text-amber-400">冷号→{a.coldUntil}</span>
                )}
                <label className="flex items-center gap-1 text-subtle">
                  校准已开
                  <input
                    type="number"
                    min={0}
                    className="w-14 rounded border border-border bg-background px-1 py-0.5"
                    defaultValue={
                      quota.calibratedOpenedByAccount[a.id] ??
                      quota.openedByAccount[a.id] ??
                      0
                    }
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isNaN(n)) return;
                      void (async () => {
                        const next = calibrateOpened(quota, a.id, n);
                        await saveMonthQuota(next);
                        setQuota(next);
                        flash(`${a.penName} 本月已开校准为 ${n}`);
                      })();
                    }}
                  />
                </label>
                <div className="flex-1" />
                <button
                  type="button"
                  className="rounded px-2 py-0.5 hover:bg-elevated"
                  onClick={() => void jumpPlatformLogin(a.id)}
                >
                  去登录
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-0.5 hover:bg-elevated"
                  onClick={() => void confirmAccountSession(a.id)}
                >
                  确认已登录
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-0.5 hover:bg-elevated"
                  onClick={() => void clearAccountSession(a.id)}
                >
                  标退出
                </button>
                {(a.sessionStatus === 'logged_in' || stale) && (
                  <button
                    type="button"
                    className="rounded px-2 py-0.5 hover:bg-elevated"
                    onClick={() => void expireAccountSession(a.id)}
                  >
                    标失效
                  </button>
                )}
                <button
                  type="button"
                  className="rounded px-2 py-0.5 hover:bg-elevated"
                  onClick={() => void toggleCold(a.id)}
                >
                  {a.coldUntil && a.coldUntil >= today ? '解除冷号' : '标冷号30天'}
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-0.5 hover:bg-elevated"
                  onClick={() => void toggleBlock(a.id)}
                >
                  {a.riskStatus === 'blocked' ? '解除熔断' : '熔断停派'}
                </button>
              </div>
              );
            })}
            {accounts.length === 0 && <Empty>先添加笔名账号（默认月开 3）</Empty>}
          </section>
        )}

        {tab === 'assign' && (
          <section className="space-y-2">
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded bg-elevated px-2 py-1 text-xs"
                onClick={() => runAutoAssign()}
              >
                预览智能指派
              </button>
              <button
                type="button"
                className="rounded bg-elevated px-2 py-1 text-xs"
                onClick={() => void applyAutoAssign()}
              >
                确认应用
              </button>
            </div>
            <pre className="whitespace-pre-wrap rounded border border-border bg-elevated/30 p-2 text-xs">
              {assignPreview || '点击预览生成建议（不超卖、避 blocked、错峰）'}
            </pre>
          </section>
        )}

        {tab === 'review' && (
          <section className="space-y-2 text-xs">
            <p>
              本月目标 {settings.monthlyOpenTarget} · 理论 {capacity.theory} · spare{' '}
              {capacity.spare} · 缺口 {gap}
            </p>
            <p>
              已开合计{' '}
              {Object.values(quota.openedByAccount).reduce((s, n) => s + n, 0)} · 预留{' '}
              {quota.reservations.length}
            </p>
            <p>
              止损{' '}
              {books.filter((b) => b.status === 'dropped').length} · 熔断号{' '}
              {accounts.filter((a) => a.riskStatus === 'blocked').length}
            </p>
            {capacity.fullLoad && (
              <p className="text-amber-400">满载：建议加号或降目标，保留 spare。</p>
            )}
          </section>
        )}

        {tab === 'settings' && (
          <section className="space-y-2 text-xs">
            <label className="flex items-center gap-2">
              月开目标
              <input
                type="number"
                className="w-20 rounded border border-border bg-background px-1 py-0.5"
                value={settings.monthlyOpenTarget}
                onChange={(e) => void saveTarget(Number(e.target.value) || 0)}
              />
            </label>
            <label className="flex items-center gap-2">
              默认平台 pack
              <select
                className="rounded border border-border bg-background px-1 py-0.5"
                value={settings.defaultPlatform}
                onChange={(e) => void saveDefaultPlatform(e.target.value)}
              >
                {listPlatformPacks().map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.ready ? '' : '（骨架）'}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-subtle">
              同日全池上限 {settings.maxOpensPerDayGlobal} · 号默认月开{' '}
              {settings.defaultMonthlyOpenLimit} · pack{' '}
              {resolvePlatformPack(settings.defaultPlatform).id} · 执行 L0–L2（无代登/无打码）
            </p>
            <p className="text-subtle">
              已注册 pack：
              {listPlatformPacks()
                .map((p) => `${p.id}${p.ready ? '' : '*'}`)
                .join(', ')}
              （*骨架不跑真实规则）
            </p>
          </section>
        )}
      </div>

      {assistBook && (
        <OpenAssistWizard
          book={assistBook}
          accounts={accounts}
          onClose={() => setAssistBookKey(null)}
          onConfirmOpened={markOpened}
          onFlash={flash}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded border border-border px-2 py-1.5">
      <div className="text-[10px] text-subtle">{label}</div>
      <div className={`text-base font-semibold ${warn ? 'text-amber-400' : ''}`}>{value}</div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-1 text-xs font-semibold text-subtle">{title}</h2>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="text-xs text-subtle">{children}</div>;
}

function BookRow({
  book,
  accounts,
  onOpen,
  onPack,
  onCopy,
  onDrop,
  onAssist,
}: {
  book: PublishBook;
  accounts: PublishAccount[];
  onOpen: () => void;
  onPack: () => void;
  onCopy: () => void;
  onDrop: () => void;
  onAssist: () => void;
}) {
  const pen = accounts.find((a) => a.id === book.assignedAccountId)?.penName ?? '未指派';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1.5 text-xs">
      <span className="font-medium">{book.title}</span>
      <span className="text-subtle">{pen}</span>
      <span className="text-subtle">{book.planOpenDate}</span>
      <div className="flex-1" />
      <button type="button" className="rounded px-1.5 py-0.5 hover:bg-elevated" onClick={onCopy}>
        复制书名
      </button>
      <button type="button" className="rounded px-1.5 py-0.5 hover:bg-elevated" onClick={onPack}>
        作业包
      </button>
      <button type="button" className="rounded px-1.5 py-0.5 hover:bg-elevated" onClick={onAssist}>
        开书辅助
      </button>
      <button type="button" className="rounded px-1.5 py-0.5 hover:bg-elevated" onClick={onOpen}>
        确认已开
      </button>
      <button type="button" className="rounded px-1.5 py-0.5 hover:bg-elevated" onClick={onDrop}>
        止损
      </button>
    </div>
  );
}

function normalizeKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
