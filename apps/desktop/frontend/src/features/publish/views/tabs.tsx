import {
  canPublishDirect,
  isCsrfStale,
  isPlaceholderBook,
  isSessionStale,
  pipelineStatusLabel,
  remainingForAccount,
  riskStatusLabel,
  sessionStatusLabel,
  type PublishBook,
  type SerialHealthEntry,
  PIPELINE_STATUSES,
} from '../model';
import { listPlatformPacks, resolvePlatformPack } from '../packs';
import type { BatchItemProgress, PublishCockpitApi } from '../hooks/usePublishCockpit';
import { useState } from 'react';
import { Block, BookRow, Empty, StatusBadge, ToolbarBtn } from './ui';

function serialHealthLabel(e: SerialHealthEntry): { text: string; cls: string } {
  switch (e.kind) {
    case 'overdue':
      return { text: `断更 ${e.daysSince} 天`, cls: 'text-error' };
    case 'due':
      return { text: '今天该更', cls: 'text-warning' };
    case 'ok':
      return { text: '今日已更', cls: 'text-success' };
    default:
      return { text: '未知', cls: 'text-subtle' };
  }
}

/** 连载更新纪律：断更/该更/已更清单（数据来自快照+本地发布盖章，线上刷新按需拉）。 */
function SerialHealthBlock({ api }: { api: PublishCockpitApi }) {
  const { serialHealth, serialSweeping } = api;
  const overdueCount = serialHealth.filter((e) => e.kind === 'overdue').length;
  const dueCount = serialHealth.filter((e) => e.kind === 'due').length;
  return (
    <Block title="连载更新">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10.5px] text-subtle">
        <span>
          断更 <span className={overdueCount > 0 ? 'text-error' : ''}>{overdueCount}</span> · 该更{' '}
          <span className={dueCount > 0 ? 'text-warning' : ''}>{dueCount}</span> · 共{' '}
          {serialHealth.length} 本
        </span>
        <ToolbarBtn onClick={() => void api.refreshSerialHealth()}>
          {serialSweeping ? '巡检中…' : '线上巡检'}
        </ToolbarBtn>
      </div>
      {serialHealth.length === 0 ? (
        <Empty>无连载中的书（状态为「已开」或「连载」的书会出现在这里）。</Empty>
      ) : (
        serialHealth.map((e) => {
          const label = serialHealthLabel(e);
          return (
            <div key={e.projectKey} className="flex flex-wrap items-center gap-x-2 text-[11px]">
              <span className={`${label.cls} shrink-0 tabular-nums`}>{label.text}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{e.title}</span>
              {e.penName && <span className="text-subtle">{e.penName}</span>}
              {e.latestChapterTitle && (
                <span className="max-w-[10rem] truncate text-subtle">
                  最近「{e.latestChapterTitle}」
                </span>
              )}
              {e.lastUpdateAt && (
                <span className="text-subtle tabular-nums">{e.lastUpdateAt.slice(0, 10)}</span>
              )}
              {e.note && <span className="text-subtle">{e.note}</span>}
            </div>
          );
        })
      )}
    </Block>
  );
}

export function DailyTab({ api }: { api: PublishCockpitApi }) {
  const { todayBooks, overdueBooks, books, accounts, quota, today } = api;
  return (
    <section className="space-y-3">
      <SerialHealthBlock api={api} />
      <Block title="今日应开">
        {todayBooks.length === 0 ? (
          <Empty>今日无排期。可在「日历」改计划日，或「智能指派」生成建议。</Empty>
        ) : (
          todayBooks.map((b) => (
            <BookRow
              key={b.projectKey}
              book={b}
              accounts={accounts}
              quota={quota}
              today={today}
              onOpen={() => void api.markOpened(b.projectKey)}
              onPack={() => void api.handleGeneratePack(b.projectKey)}
              onCopy={() => void api.handleCopyTitle(b.title)}
              onDrop={() => void api.markDropped(b.projectKey)}
              onAssist={() => api.setAssistBookKey(b.projectKey)}
              onApiPublish={() => void api.apiPublishForBook(b.projectKey)}
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
              quota={quota}
              today={today}
              onOpen={() => void api.markOpened(b.projectKey)}
              onPack={() => void api.handleGeneratePack(b.projectKey)}
              onCopy={() => void api.handleCopyTitle(b.title)}
              onDrop={() => void api.markDropped(b.projectKey)}
              onAssist={() => api.setAssistBookKey(b.projectKey)}
              onApiPublish={() => void api.apiPublishForBook(b.projectKey)}
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
              <div key={b.projectKey} className="flex items-center gap-2 text-[11px] text-subtle">
                <span className="tabular-nums">{b.planOpenDate}</span>
                <span className="text-foreground">{b.title}</span>
              </div>
            ))
        )}
      </Block>
    </section>
  );
}

export function PipelineTab({ api }: { api: PublishCockpitApi }) {
  const { books, slotTitle, slotDate } = api;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface/30 p-2">
        <input
          className="h-7 min-w-[7rem] flex-1 rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:border-border-strong"
          placeholder="空位标题"
          value={slotTitle}
          onChange={(e) => api.setSlotTitle(e.target.value)}
        />
        <input
          type="date"
          className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px]"
          value={slotDate}
          onChange={(e) => api.setSlotDate(e.target.value)}
        />
        <ToolbarBtn onClick={() => void api.handleCreateSlot()}>创建空位</ToolbarBtn>
      </div>
      {books.length === 0 ? (
        <Empty>发布库为空。打开项目后点「入库」，或创建空位占坑。</Empty>
      ) : (
        books.map((b) => (
          <div
            key={b.projectKey}
            className="rounded-md border border-border bg-surface/30 px-2 py-1.5"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={b.status} placeholder={isPlaceholderBook(b)} />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{b.title}</span>
            </div>
            <div className="mt-0.5 text-[10.5px] text-subtle">
              {b.planOpenDate ?? '未排期'} · 可开分 {b.readyScore}
              {b.readyConfirmed ? ' · 已放行' : ''}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {isPlaceholderBook(b) && (
                <ToolbarBtn onClick={() => void api.handleBindSlot(b.projectKey)}>
                  绑定当前项目
                </ToolbarBtn>
              )}
              <ToolbarBtn
                onClick={() => void api.forceReady(b.projectKey)}
                title="强制标记为可排期"
              >
                强制可开
              </ToolbarBtn>
              <select
                className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px]"
                value={b.status}
                onChange={(e) =>
                  void api.changeStatus(b.projectKey, e.target.value as PublishBook['status'])
                }
                aria-label={`状态：${pipelineStatusLabel(b.status)}`}
              >
                {PIPELINE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {pipelineStatusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

export function CalendarTab({ api }: { api: PublishCockpitApi }) {
  const { books, yearMonth } = api;
  return (
    <section className="space-y-2">
      <p className="text-[11px] leading-relaxed text-subtle">
        月历（{yearMonth}）：改计划开书日；超同日全池上限会阻断
      </p>
      {books
        .filter((b) => b.status !== 'dropped')
        .sort((a, b) => (a.planOpenDate ?? '9999').localeCompare(b.planOpenDate ?? '9999'))
        .map((b) => (
          <div
            key={b.projectKey}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface/30 px-2 py-1.5"
          >
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{b.title}</span>
            <input
              type="date"
              className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px]"
              value={b.planOpenDate ?? ''}
              onChange={(e) => void api.changePlanDate(b.projectKey, e.target.value || null)}
            />
            <StatusBadge status={b.status} />
          </div>
        ))}
      {books.length === 0 && <Empty>无书可排期</Empty>}
    </section>
  );
}

/** API 发布：当前项目章节文件 → 番茄（隐藏 webview 内 fetch 发布）。 */
function ApiPublishPanel({ api }: { api: PublishCockpitApi }) {
  const { accounts, onlineBooks, projectChapters } = api;
  const [accountId, setAccountId] = useState('');
  const [bookId, setBookId] = useState('');
  const [chapterPath, setChapterPath] = useState('');
  const [title, setTitle] = useState('');
  const acctOptions = accounts.filter((a) => a.cookieText?.trim());
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-surface/30 p-2 text-[10.5px]">
      <div className="font-semibold text-subtle">API 发布章节（当前项目 → 番茄）</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          className="h-7 rounded border border-border bg-background px-1 text-[10.5px]"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">选账号</option>
          {acctOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.penName}
            </option>
          ))}
        </select>
        <select
          className="h-7 min-w-[7rem] rounded border border-border bg-background px-1 text-[10.5px]"
          value={bookId}
          onChange={(e) => setBookId(e.target.value)}
        >
          <option value="">选线上作品</option>
          {onlineBooks.map((b) => (
            <option key={b.bookId} value={b.bookId}>
              {b.bookName}
            </option>
          ))}
        </select>
        <ToolbarBtn onClick={() => void api.loadProjectChapters()}>刷新章节</ToolbarBtn>
        <select
          className="h-7 min-w-[8rem] rounded border border-border bg-background px-1 text-[10.5px]"
          value={chapterPath}
          onChange={(e) => setChapterPath(e.target.value)}
        >
          <option value="">选章节文件（{projectChapters.length}）</option>
          {projectChapters.map((c) => (
            <option key={c.path} value={c.path}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <input
        className="h-7 w-full rounded border border-border bg-background px-2 text-[10.5px]"
        placeholder="标题（留空取章节首行；番茄格式如「第1章 觉醒」，≤30字）"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarBtn
          onClick={() =>
            void api.publishProjectChapter({
              accountId,
              onlineBookId: bookId,
              chapterPath,
              titleOverride: title,
            })
          }
        >
          发布到番茄
        </ToolbarBtn>
        <span className="text-subtle">需先 WebView 登录；正文≥1000字、勿与已发章节重复</span>
      </div>
    </div>
  );
}

function BatchStatusDot({ status }: { status: BatchItemProgress['status'] }) {
  const cls =
    status === 'ok'
      ? 'text-success'
      : status === 'fail'
        ? 'text-error'
        : status === 'publishing'
          ? 'text-warning'
          : status === 'skip'
            ? 'text-muted'
            : 'text-subtle';
  return <span className={`${cls} text-[10px] leading-none`}>●</span>;
}

/** 对账：拉线上书单 ↔ library 并排，写快照/绑定/纳入台账（不自动改月账）。 */
function ReconcilePanel({ api }: { api: PublishCockpitApi }) {
  const { reconcile, books } = api;
  if (!reconcile) {
    return (
      <div className="rounded-md border border-border bg-surface/30 p-2 text-[10.5px] text-subtle">
        对账：在下方账号行点「对账」，拉线上书单与台账并排比对（只写本地快照，不自动改月账）。
      </div>
    );
  }
  const { result, ledger, penName } = reconcile;
  const bindTargets = books.filter((b) => !b.onlineBookId && !b.path.startsWith('online://'));
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-surface/30 p-2 text-[10.5px]">
      <div className="font-semibold text-subtle">对账 · {penName}</div>
      <div className="text-subtle">
        台账本月已开 {ledger.ledgerOpened} · 线上此号 {ledger.onlineTotal} 本 · 匹配{' '}
        {ledger.matchedCount} · 线上多出 {ledger.onlineOnlyCount} · 本地查无 {ledger.missingCount}
      </div>
      {result.onlineOnly.length > 0 && (
        <div className="space-y-1">
          <div className="text-warning">线上有、台账无：</div>
          {result.onlineOnly.map((o) => (
            <div key={o.bookId} className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{o.bookName}</span>
              <span className="text-subtle">
                {o.chapterNumber}章·{o.wordNumber}字
              </span>
              <select
                className="h-6 rounded border border-border bg-background px-1 text-[10px]"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) void api.bindOnlineBook(e.target.value, o.bookId);
                }}
                aria-label={`绑定线上作品 ${o.bookName}`}
              >
                <option value="">绑定到本地书…</option>
                {bindTargets.map((b) => (
                  <option key={b.projectKey} value={b.projectKey}>
                    {b.title}
                  </option>
                ))}
              </select>
              <ToolbarBtn onClick={() => void api.importOnlineBook(result.accountId, o.bookId)}>
                纳入台账
              </ToolbarBtn>
            </div>
          ))}
        </div>
      )}
      {result.localMissing.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-error">本地标已开、线上查无（可能改名/号不对）：</div>
          {result.localMissing.map((b) => (
            <div key={b.projectKey} className="text-error/90">
              · {b.title}
            </div>
          ))}
        </div>
      )}
      {result.matched.length > 0 && (
        <div className="text-subtle">
          已同步快照 {result.matched.length} 本（
          {result.matched
            .map((m) => m.book.title)
            .slice(0, 4)
            .join('、')}
          {result.matched.length > 4 ? '…' : ''}）
        </div>
      )}
      <div className="text-subtle">
        配额仍用账号行「校准已开」手动定；线上无开书日期，不自动改本月账。
      </div>
    </div>
  );
}

/** 批量发章：当前项目全部章节 → 番茄，按线上已发去重 + 字数下限跳过 + 间隔节流。 */
function BatchPublishPanel({ api }: { api: PublishCockpitApi }) {
  const { accounts, onlineBooks, projectChapters, batch } = api;
  const [accountId, setAccountId] = useState('');
  const [bookId, setBookId] = useState('');
  const acctOptions = accounts.filter((a) => a.cookieText?.trim());
  const running = batch?.running ?? false;
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-surface/30 p-2 text-[10.5px]">
      <div className="font-semibold text-subtle">批量发章（当前项目全部章节 → 番茄）</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          className="h-7 rounded border border-border bg-background px-1 text-[10.5px]"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">选账号</option>
          {acctOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.penName}
            </option>
          ))}
        </select>
        <select
          className="h-7 min-w-[7rem] rounded border border-border bg-background px-1 text-[10.5px]"
          value={bookId}
          onChange={(e) => setBookId(e.target.value)}
        >
          <option value="">选线上作品</option>
          {onlineBooks.map((b) => (
            <option key={b.bookId} value={b.bookId}>
              {b.bookName}
            </option>
          ))}
        </select>
        <ToolbarBtn onClick={() => void api.loadProjectChapters()}>
          刷新章节（{projectChapters.length}）
        </ToolbarBtn>
        {running ? (
          <ToolbarBtn onClick={() => api.stopBatch()}>停止</ToolbarBtn>
        ) : (
          <ToolbarBtn
            onClick={() => void api.startBatchPublish({ accountId, onlineBookId: bookId })}
          >
            开始批量发布
          </ToolbarBtn>
        )}
      </div>
      <div className="text-subtle">
        自动跳过已在线/不足1000字；两章间隔按设置节流防频控（-3009）。
      </div>
      {batch && (
        <div className="space-y-0.5 rounded border border-border bg-background/40 p-1.5">
          <div className="text-subtle">
            {batch.penName} · 待发 {batch.publishCount} ·{' '}
            {batch.running ? (batch.stopRequested ? '停止中…' : '发布中…') : '已结束'}
          </div>
          {batch.items.map((it) => (
            <div key={it.path} className="flex items-center gap-1.5">
              <BatchStatusDot status={it.status} />
              <span className="min-w-0 flex-1 truncate">{it.title || it.name}</span>
              <span className="text-subtle">
                {it.status === 'skip'
                  ? it.skipReason
                  : it.status === 'fail'
                    ? `失败${it.code ? ` ${it.code}` : ''}`
                    : it.status === 'ok'
                      ? '成功'
                      : it.status === 'publishing'
                        ? '发布中'
                        : '待发'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AccountsTab({ api }: { api: PublishCockpitApi }) {
  const { accounts, quota, today, newPenName, onlineBooks } = api;
  return (
    <section className="space-y-3">
      <p className="text-[10.5px] leading-relaxed text-subtle">
        番茄无第三方 OAuth：优先 WebView 登录自动取 Cookie +
        写侧令牌（取到即「直连就绪」，多号可各自发章， 不必让 webview
        登着某个号）；也可浏览器登录后手动粘贴 Cookie（无令牌则发章回落隐藏 webview）。
      </p>
      <div className="flex flex-wrap gap-1">
        <ToolbarBtn onClick={() => void api.loginViaWebView()}>WebView 登录</ToolbarBtn>
        <ToolbarBtn onClick={() => void api.jumpPlatformLogin()}>浏览器登录</ToolbarBtn>
        <ToolbarBtn onClick={() => void api.jumpAuthorHome()}>作者后台</ToolbarBtn>
      </div>
      <div className="flex gap-1.5">
        <input
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:border-border-strong"
          placeholder="新笔名"
          value={newPenName}
          onChange={(e) => api.setNewPenName(e.target.value)}
        />
        <ToolbarBtn onClick={() => void api.handleAddAccount()}>添加</ToolbarBtn>
      </div>
      {onlineBooks.length > 0 && (
        <div className="rounded-md border border-border bg-surface/30 p-2 text-[10.5px]">
          <div className="mb-1 font-semibold text-subtle">线上作品（实时拉取）</div>
          {onlineBooks.map((b) => (
            <div key={b.bookId} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{b.bookName}</span>
              <span className="text-subtle">
                {b.chapterNumber}章 · {b.wordNumber}字
              </span>
              {b.statusTag && <span className="text-warning">{b.statusTag}</span>}
            </div>
          ))}
        </div>
      )}
      <ApiPublishPanel api={api} />
      <BatchPublishPanel api={api} />
      <ReconcilePanel api={api} />
      {accounts.map((a) => {
        const stale = isSessionStale(a);
        const sessionLabel = stale ? '可能失效' : sessionStatusLabel(a.sessionStatus);
        const sessionClass =
          a.sessionStatus === 'logged_in' && !stale
            ? 'text-success'
            : a.sessionStatus === 'pending'
              ? 'text-warning'
              : a.sessionStatus === 'expired' || stale
                ? 'text-error'
                : 'text-subtle';
        const riskClass = a.riskStatus === 'blocked' ? 'text-error' : 'text-subtle';
        return (
          <div
            key={a.id}
            className="space-y-1.5 rounded-md border border-border bg-surface/30 px-2 py-2"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-[12px] font-medium">{a.penName}</span>
              <span className={`text-[10.5px] ${sessionClass}`}>会话 {sessionLabel}</span>
              <span className={`text-[10.5px] ${riskClass}`}>{riskStatusLabel(a.riskStatus)}</span>
              {canPublishDirect(a) ? (
                <span
                  className={`text-[10.5px] ${isCsrfStale(a) ? 'text-warning' : 'text-success'}`}
                  title="有 Cookie + 写侧令牌，可直连发章，不必让 webview 登着本号"
                >
                  直连就绪{isCsrfStale(a) ? '（令牌偏旧）' : ''}
                </span>
              ) : (
                <span
                  className="text-[10.5px] text-subtle"
                  title="缺写侧令牌，发章回落隐藏 webview"
                >
                  webview 发章
                </span>
              )}
              {a.coldUntil && a.coldUntil >= today && (
                <span className="text-[10.5px] text-warning">冷号→{a.coldUntil}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-subtle">
              <span>月限 {a.monthlyOpenLimit}</span>
              <span>剩余 {remainingForAccount(a, quota, today)}</span>
              <label className="inline-flex items-center gap-1">
                校准已开
                <input
                  type="number"
                  min={0}
                  className="h-6 w-12 rounded border border-border bg-background px-1 text-[11px]"
                  defaultValue={
                    quota.calibratedOpenedByAccount[a.id] ?? quota.openedByAccount[a.id] ?? 0
                  }
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isNaN(n)) return;
                    void api.calibrateAccountOpened(a.id, n);
                  }}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <input
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[10.5px] outline-none focus:border-border-strong"
                placeholder="Cookie（DevTools 复制，或 WebView 自动写入）"
                defaultValue={a.cookieText}
                onBlur={(e) => {
                  void api.saveAccountCookie(a.id, e.target.value);
                }}
              />
              <ToolbarBtn onClick={() => void api.testAccountCookie(a.id)}>验证</ToolbarBtn>
              <ToolbarBtn onClick={() => void api.syncOnlineStatus(a.id)}>拉线上</ToolbarBtn>
              <ToolbarBtn onClick={() => void api.reconcileAccount(a.id)}>对账</ToolbarBtn>
            </div>
            <div className="flex flex-wrap items-center gap-0.5">
              <ToolbarBtn onClick={() => void api.loginViaWebView(a.id)}>登录</ToolbarBtn>
              <ToolbarBtn onClick={() => void api.confirmAccountSession(a.id)}>
                确认已登录
              </ToolbarBtn>
              <ToolbarBtn onClick={() => void api.clearAccountSession(a.id)}>标退出</ToolbarBtn>
              {(a.sessionStatus === 'logged_in' || stale) && (
                <ToolbarBtn onClick={() => void api.expireAccountSession(a.id)}>标失效</ToolbarBtn>
              )}
              <div className="flex-1" />
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md px-2 text-[11px] text-muted hover:bg-elevated hover:text-foreground"
                onClick={() => void api.toggleCold(a.id)}
              >
                {a.coldUntil && a.coldUntil >= today ? '解除冷号' : '冷号 30 天'}
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md px-2 text-[11px] text-error/90 hover:bg-error/10"
                onClick={() => {
                  const blocking = a.riskStatus !== 'blocked';
                  if (
                    blocking &&
                    !window.confirm(`确认熔断停派「${a.penName}」？该号将不再参与指派。`)
                  ) {
                    return;
                  }
                  void api.toggleBlock(a.id);
                }}
              >
                {a.riskStatus === 'blocked' ? '解除熔断' : '熔断停派'}
              </button>
            </div>
          </div>
        );
      })}
      {accounts.length === 0 && (
        <Empty>先添加笔名账号（默认月开 3）。上方输入笔名后点「添加」。</Empty>
      )}
    </section>
  );
}

export function AssignTab({ api }: { api: PublishCockpitApi }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <ToolbarBtn onClick={() => api.runAutoAssign()}>预览智能指派</ToolbarBtn>
        <ToolbarBtn onClick={() => void api.applyAutoAssign()}>确认应用</ToolbarBtn>
      </div>
      <pre className="whitespace-pre-wrap rounded-md border border-border bg-elevated/30 p-2.5 text-[11px] leading-relaxed text-muted">
        {api.assignPreview || '点击预览生成建议（不超卖、避熔断、错峰）'}
      </pre>
    </section>
  );
}

export function ReviewTab({ api }: { api: PublishCockpitApi }) {
  const { settings, capacity, gap, quota, books, accounts } = api;
  return (
    <section className="space-y-2 text-[12px] leading-relaxed">
      <p className="text-muted">
        本月目标 {settings.monthlyOpenTarget} · 理论 {capacity.theory} · 余量 {capacity.spare} ·
        缺口 {gap}
      </p>
      <p className="text-muted">
        已开合计 {Object.values(quota.openedByAccount).reduce((s, n) => s + n, 0)} · 预留{' '}
        {quota.reservations.length}
      </p>
      <p className="text-muted">
        止损 {books.filter((b) => b.status === 'dropped').length} · 熔断号{' '}
        {accounts.filter((a) => a.riskStatus === 'blocked').length}
      </p>
      {capacity.fullLoad && <p className="text-warning">满载：建议加号或降目标，保留余量。</p>}
    </section>
  );
}

export function SettingsTab({ api }: { api: PublishCockpitApi }) {
  const { settings } = api;
  return (
    <section className="space-y-3 text-[12px]">
      <label className="flex items-center gap-2 text-muted">
        月开目标
        <input
          type="number"
          className="h-7 w-20 rounded-md border border-border bg-background px-2 text-foreground"
          value={settings.monthlyOpenTarget}
          onChange={(e) => void api.saveTarget(Number(e.target.value) || 0)}
        />
      </label>
      <label className="flex items-center gap-2 text-muted">
        默认平台
        <select
          className="h-7 rounded-md border border-border bg-background px-1.5 text-foreground"
          value={settings.defaultPlatform}
          onChange={(e) => void api.saveDefaultPlatform(e.target.value)}
        >
          {listPlatformPacks().map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.ready ? '' : '（骨架）'}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[11px] leading-relaxed text-subtle">
        同日全池上限 {settings.maxOpensPerDayGlobal} · 号默认月开 {settings.defaultMonthlyOpenLimit}{' '}
        · 平台 {resolvePlatformPack(settings.defaultPlatform).label} · 执行 L0–L2（无代登/无打码）
      </p>
      <p className="text-[11px] leading-relaxed text-subtle">
        已注册平台：
        {listPlatformPacks()
          .map((p) => `${p.label}${p.ready ? '' : '*'}`)
          .join('、')}
        （*骨架不跑真实规则）
      </p>
    </section>
  );
}
