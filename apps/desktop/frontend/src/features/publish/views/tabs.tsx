import {
  isPlaceholderBook,
  isSessionStale,
  remainingForAccount,
  sessionStatusLabel,
  type PublishBook,
} from '../model';
import { listPlatformPacks, resolvePlatformPack } from '../packs';
import type { PublishCockpitApi } from '../hooks/usePublishCockpit';
import { Block, BookRow, Empty } from './ui';

export function DailyTab({ api }: { api: PublishCockpitApi }) {
  const { todayBooks, overdueBooks, books, accounts } = api;
  return (
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
              onOpen={() => void api.markOpened(b.projectKey)}
              onPack={() => void api.handleGeneratePack(b.projectKey)}
              onCopy={() => void api.handleCopyTitle(b.title)}
              onDrop={() => void api.markDropped(b.projectKey)}
              onAssist={() => api.setAssistBookKey(b.projectKey)}
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
              onOpen={() => void api.markOpened(b.projectKey)}
              onPack={() => void api.handleGeneratePack(b.projectKey)}
              onCopy={() => void api.handleCopyTitle(b.title)}
              onDrop={() => void api.markDropped(b.projectKey)}
              onAssist={() => api.setAssistBookKey(b.projectKey)}
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
  );
}

export function PipelineTab({ api }: { api: PublishCockpitApi }) {
  const { books, slotTitle, slotDate } = api;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap gap-2 rounded border border-border p-2 text-xs">
        <input
          className="min-w-[8rem] flex-1 rounded border border-border bg-background px-2 py-1"
          placeholder="空位标题"
          value={slotTitle}
          onChange={(e) => api.setSlotTitle(e.target.value)}
        />
        <input
          type="date"
          className="rounded border border-border bg-background px-1 py-1"
          value={slotDate}
          onChange={(e) => api.setSlotDate(e.target.value)}
        />
        <button
          type="button"
          className="rounded bg-elevated px-2 py-1"
          onClick={() => void api.handleCreateSlot()}
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
                onClick={() => void api.handleBindSlot(b.projectKey)}
              >
                绑定当前项目
              </button>
            )}
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-xs hover:bg-elevated"
              onClick={() => void api.forceReady(b.projectKey)}
            >
              强制Ready
            </button>
            <select
              className="rounded border border-border bg-background px-1 py-0.5 text-xs"
              value={b.status}
              onChange={(e) =>
                void api.changeStatus(b.projectKey, e.target.value as PublishBook['status'])
              }
            >
              {(
                [
                  'idea',
                  'writing',
                  'polish',
                  'ready',
                  'scheduled',
                  'opened',
                  'serializing',
                  'dropped',
                ] as const
              ).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
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
              onChange={(e) =>
                void api.changePlanDate(b.projectKey, e.target.value || null)
              }
            />
            <span className="text-subtle">{b.status}</span>
          </div>
        ))}
      {books.length === 0 && <Empty>无书可排期</Empty>}
    </section>
  );
}

export function AccountsTab({ api }: { api: PublishCockpitApi }) {
  const { accounts, quota, today, newPenName } = api;
  return (
    <section className="space-y-3">
      <p className="text-[10px] text-subtle">
        番茄无第三方 OAuth 回调：流程是「跳转浏览器登录 → 回 SF 确认已登录」。
        会话态是本地台账，不是浏览器 Cookie / access_token。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded bg-elevated px-2 py-1 text-xs"
          onClick={() => void api.jumpPlatformLogin()}
        >
          跳转平台登录
        </button>
        <button
          type="button"
          className="rounded bg-elevated px-2 py-1 text-xs"
          onClick={() => void api.jumpAuthorHome()}
        >
          打开作者后台
        </button>
      </div>
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
          placeholder="新笔名"
          value={newPenName}
          onChange={(e) => api.setNewPenName(e.target.value)}
        />
        <button
          type="button"
          className="rounded bg-elevated px-2 py-1 text-xs"
          onClick={() => void api.handleAddAccount()}
        >
          添加账号
        </button>
      </div>
      {accounts.map((a) => {
        const stale = isSessionStale(a);
        const sessionLabel = stale ? '可能失效' : sessionStatusLabel(a.sessionStatus);
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
            <span
              className={sessionClass}
              title={a.sessionConfirmedAt ?? a.lastLoginJumpAt ?? ''}
            >
              会话:{sessionLabel}
            </span>
            <span className={a.riskStatus === 'blocked' ? 'text-red-400' : 'text-subtle'}>
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
                  quota.calibratedOpenedByAccount[a.id] ?? quota.openedByAccount[a.id] ?? 0
                }
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isNaN(n)) return;
                  void api.calibrateAccountOpened(a.id, n);
                }}
              />
            </label>
            <div className="flex-1" />
            <button
              type="button"
              className="rounded px-2 py-0.5 hover:bg-elevated"
              onClick={() => void api.jumpPlatformLogin(a.id)}
            >
              去登录
            </button>
            <button
              type="button"
              className="rounded px-2 py-0.5 hover:bg-elevated"
              onClick={() => void api.confirmAccountSession(a.id)}
            >
              确认已登录
            </button>
            <button
              type="button"
              className="rounded px-2 py-0.5 hover:bg-elevated"
              onClick={() => void api.clearAccountSession(a.id)}
            >
              标退出
            </button>
            {(a.sessionStatus === 'logged_in' || stale) && (
              <button
                type="button"
                className="rounded px-2 py-0.5 hover:bg-elevated"
                onClick={() => void api.expireAccountSession(a.id)}
              >
                标失效
              </button>
            )}
            <button
              type="button"
              className="rounded px-2 py-0.5 hover:bg-elevated"
              onClick={() => void api.toggleCold(a.id)}
            >
              {a.coldUntil && a.coldUntil >= today ? '解除冷号' : '标冷号30天'}
            </button>
            <button
              type="button"
              className="rounded px-2 py-0.5 hover:bg-elevated"
              onClick={() => void api.toggleBlock(a.id)}
            >
              {a.riskStatus === 'blocked' ? '解除熔断' : '熔断停派'}
            </button>
          </div>
        );
      })}
      {accounts.length === 0 && <Empty>先添加笔名账号（默认月开 3）</Empty>}
    </section>
  );
}

export function AssignTab({ api }: { api: PublishCockpitApi }) {
  return (
    <section className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded bg-elevated px-2 py-1 text-xs"
          onClick={() => api.runAutoAssign()}
        >
          预览智能指派
        </button>
        <button
          type="button"
          className="rounded bg-elevated px-2 py-1 text-xs"
          onClick={() => void api.applyAutoAssign()}
        >
          确认应用
        </button>
      </div>
      <pre className="whitespace-pre-wrap rounded border border-border bg-elevated/30 p-2 text-xs">
        {api.assignPreview || '点击预览生成建议（不超卖、避 blocked、错峰）'}
      </pre>
    </section>
  );
}

export function ReviewTab({ api }: { api: PublishCockpitApi }) {
  const { settings, capacity, gap, quota, books, accounts } = api;
  return (
    <section className="space-y-2 text-xs">
      <p>
        本月目标 {settings.monthlyOpenTarget} · 理论 {capacity.theory} · spare {capacity.spare} ·
        缺口 {gap}
      </p>
      <p>
        已开合计 {Object.values(quota.openedByAccount).reduce((s, n) => s + n, 0)} · 预留{' '}
        {quota.reservations.length}
      </p>
      <p>
        止损 {books.filter((b) => b.status === 'dropped').length} · 熔断号{' '}
        {accounts.filter((a) => a.riskStatus === 'blocked').length}
      </p>
      {capacity.fullLoad && (
        <p className="text-amber-400">满载：建议加号或降目标，保留 spare。</p>
      )}
    </section>
  );
}

export function SettingsTab({ api }: { api: PublishCockpitApi }) {
  const { settings } = api;
  return (
    <section className="space-y-2 text-xs">
      <label className="flex items-center gap-2">
        月开目标
        <input
          type="number"
          className="w-20 rounded border border-border bg-background px-1 py-0.5"
          value={settings.monthlyOpenTarget}
          onChange={(e) => void api.saveTarget(Number(e.target.value) || 0)}
        />
      </label>
      <label className="flex items-center gap-2">
        默认平台 pack
        <select
          className="rounded border border-border bg-background px-1 py-0.5"
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
  );
}
