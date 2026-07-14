import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  isPlaceholderBook,
  pipelineStatusLabel,
  remainingForAccount,
  type MonthQuota,
  type PublishAccount,
  type PublishBook,
  type PipelineStatus,
} from '../model';

export function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface/40 px-2 py-1.5">
      <div className="text-[10px] text-subtle">{label}</div>
      <div
        className={`text-sm font-semibold tabular-nums ${warn ? 'text-warning' : 'text-foreground'}`}
      >
        {value}
      </div>
    </div>
  );
}

/** 一行产能摘要；点击展开四格。默认收合，省窄栏纵向空间。 */
export function CapacitySummary({
  target,
  theory,
  spare,
  gap,
  spareWarn,
  expanded,
  onToggle,
}: {
  target: number;
  theory: number;
  spare: number;
  gap: number;
  spareWarn: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mb-2.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-md border border-border bg-surface/40 px-2 py-1.5 text-left text-[11px] hover:bg-elevated/50"
        aria-expanded={expanded}
        title={expanded ? '收起产能明细' : '展开产能明细'}
      >
        <span className="text-subtle">{expanded ? '▾' : '▸'}</span>
        <span className="min-w-0 flex-1 truncate text-muted">
          目标 {target}
          <span className="text-subtle"> · </span>
          理论 {theory}
          <span className="text-subtle"> · </span>
          <span className={spareWarn ? 'text-warning' : ''}>余量 {spare}</span>
          <span className="text-subtle"> · </span>
          <span className={gap > 0 ? 'text-warning' : ''}>缺口 {gap}</span>
        </span>
      </button>
      {expanded && (
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <Stat label="目标" value={String(target)} />
          <Stat label="理论产能" value={String(theory)} />
          <Stat label="余量" value={String(spare)} warn={spareWarn} />
          <Stat label="目标缺口" value={String(gap)} warn={gap > 0} />
        </div>
      )}
    </div>
  );
}

export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">
        {title}
      </h2>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border px-2.5 py-3 text-xs leading-relaxed text-subtle">
      {children}
    </div>
  );
}

/** 首次空库引导：三步路径，可点跳转。 */
export function OnboardingGuide({
  hasAccounts,
  hasBooks,
  onGoAccounts,
  onAddProject,
  onCreateSlot,
}: {
  hasAccounts: boolean;
  hasBooks: boolean;
  onGoAccounts: () => void;
  onAddProject: () => void;
  onCreateSlot: () => void;
}) {
  if (hasAccounts && hasBooks) return null;
  return (
    <div
      className="mb-2.5 rounded-md border border-border bg-surface/40 px-2.5 py-2"
      data-testid="publish-onboarding"
    >
      <div className="mb-1.5 text-[11px] font-medium text-foreground">开始发行（三步）</div>
      <ol className="space-y-1.5 text-[11px] leading-snug">
        <li className="flex items-start gap-2">
          <span className={hasAccounts ? 'text-success' : 'text-warning'}>
            {hasAccounts ? '✓' : '1'}
          </span>
          <span className="min-w-0 flex-1 text-muted">
            添加笔名账号
            {!hasAccounts && (
              <button
                type="button"
                className="ml-1 text-foreground underline-offset-2 hover:underline"
                onClick={onGoAccounts}
              >
                去账号
              </button>
            )}
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className={hasBooks ? 'text-success' : 'text-warning'}>{hasBooks ? '✓' : '2'}</span>
          <span className="min-w-0 flex-1 text-muted">
            入库当前项目或占坑
            {!hasBooks && (
              <>
                <button
                  type="button"
                  className="ml-1 text-foreground underline-offset-2 hover:underline"
                  onClick={onAddProject}
                >
                  入库
                </button>
                <button
                  type="button"
                  className="ml-1 text-foreground underline-offset-2 hover:underline"
                  onClick={onCreateSlot}
                >
                  占坑
                </button>
              </>
            )}
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-subtle">3</span>
          <span className="text-muted">在日历/指派里排「今日应开」</span>
        </li>
      </ol>
    </div>
  );
}

export function StatusBadge({
  status,
  placeholder,
}: {
  status: PipelineStatus;
  placeholder?: boolean;
}) {
  const tone =
    status === 'dropped'
      ? 'text-error bg-error/10'
      : status === 'opened' || status === 'serializing'
        ? 'text-success bg-success/10'
        : status === 'scheduled' || status === 'ready'
          ? 'text-warning bg-warning/10'
          : 'text-muted bg-elevated';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}
    >
      {pipelineStatusLabel(status)}
      {placeholder ? ' · 空位' : ''}
    </span>
  );
}

function GhostBtn({
  children,
  onClick,
  title,
  danger,
  primary,
  disabled,
  'aria-expanded': ariaExpanded,
  'aria-controls': ariaControls,
}: {
  children: ReactNode;
  onClick: () => void;
  title?: string;
  danger?: boolean;
  primary?: boolean;
  disabled?: boolean;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
}) {
  const base =
    'inline-flex h-7 items-center rounded-md px-2 text-[11px] transition-colors disabled:opacity-40';
  const tone = danger
    ? 'text-error/90 hover:bg-error/10 hover:text-error'
    : primary
      ? 'bg-elevated font-medium text-foreground hover:bg-surface hover:shadow-[inset_0_0_0_1px_rgb(var(--border-strong))]'
      : 'text-muted hover:bg-elevated hover:text-foreground';
  return (
    <button
      type="button"
      className={`${base} ${tone}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
    >
      {children}
    </button>
  );
}

function MoreMenu({
  items,
}: {
  items: { label: string; onClick: () => void; danger?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <GhostBtn
        onClick={() => setOpen((v) => !v)}
        title="更多操作"
        aria-expanded={open}
        aria-controls={menuId}
      >
        更多
      </GhostBtn>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-8 z-30 min-w-[7.5rem] rounded-md border border-border bg-surface p-1 shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`flex h-7 w-full items-center rounded px-2 text-left text-[11px] hover:bg-elevated ${
                item.danger ? 'text-error' : 'text-foreground'
              }`}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function confirmMarkOpened(opts: {
  title: string;
  penName: string;
  remainingBefore: number;
}): boolean {
  const after = Math.max(0, opts.remainingBefore - 1);
  return window.confirm(
    `确认「${opts.title}」已在平台开书？\n\n` +
      `笔名：${opts.penName}\n` +
      `本月剩余额度：${opts.remainingBefore} → ${after}\n` +
      `额度一经占用，止损不退回。`,
  );
}

export function BookRow({
  book,
  accounts,
  quota,
  today,
  onOpen,
  onPack,
  onCopy,
  onDrop,
  onAssist,
  onApiPublish,
}: {
  book: PublishBook;
  accounts: PublishAccount[];
  quota: MonthQuota;
  today: string;
  onOpen: () => void;
  onPack: () => void;
  onCopy: () => void;
  onDrop: () => void;
  onAssist: () => void;
  onApiPublish?: () => void;
}) {
  const account = accounts.find((a) => a.id === book.assignedAccountId);
  const pen = account?.penName ?? '未指派';
  const remaining = account ? remainingForAccount(account, quota, today) : 0;

  const moreItems = [
    { label: '复制书名', onClick: onCopy },
    { label: '作业包', onClick: onPack },
    {
      label: '确认已开',
      onClick: () => {
        if (!account) {
          onOpen();
          return;
        }
        if (
          confirmMarkOpened({
            title: book.title,
            penName: pen,
            remainingBefore: remaining,
          })
        ) {
          onOpen();
        }
      },
    },
    {
      label: '止损',
      onClick: () => {
        if (window.confirm(`确认止损「${book.title}」？已开额度不退回。`)) onDrop();
      },
      danger: true,
    },
  ];

  return (
    <div className="rounded-md border border-border bg-surface/30 px-2 py-1.5">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-foreground" title={book.title}>
              {book.title}
            </span>
            <StatusBadge status={book.status} placeholder={isPlaceholderBook(book)} />
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-subtle">
            {pen}
            {book.planOpenDate ? ` · ${book.planOpenDate}` : ' · 未排期'}
            {book.readyScore > 0 ? ` · 可开分 ${book.readyScore}` : ''}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-0.5">
        <GhostBtn primary onClick={onAssist} title="分步粘贴开书">
          开书辅助
        </GhostBtn>
        {onApiPublish && (
          <GhostBtn primary onClick={onApiPublish} title="用 Cookie 调平台接口开书">
            平台开书
          </GhostBtn>
        )}
        <div className="flex-1" />
        <MoreMenu items={moreItems} />
      </div>
    </div>
  );
}

export function ToolbarBtn({
  children,
  onClick,
  title,
  active,
}: {
  children: ReactNode;
  onClick: () => void;
  title?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`inline-flex h-7 items-center rounded-md px-2 text-[11px] transition-colors ${
        active
          ? 'bg-elevated text-foreground'
          : 'text-muted hover:bg-elevated hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

export type FlashTone = 'info' | 'ok' | 'err';

export function classifyFlash(message: string): FlashTone {
  if (/失败|错误|阻断|须|请先|无法|不是|无效/.test(message)) return 'err';
  if (/成功|已确认|已加入|已生成|已应用|已打开|已复制|已保存|已提取|有效|通过/.test(message)) {
    return 'ok';
  }
  return 'info';
}

export function FlashBar({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  const tone = classifyFlash(message);
  const toneClass =
    tone === 'err'
      ? 'border-error/30 bg-error/10 text-error'
      : tone === 'ok'
        ? 'border-success/30 bg-success/10 text-success'
        : 'border-border bg-elevated/50 text-muted';
  return (
    <div
      className={`flex items-start gap-2 border-b px-3 py-1.5 text-[11px] leading-snug ${toneClass}`}
      role="status"
      data-flash-tone={tone}
    >
      <span className="min-w-0 flex-1 whitespace-pre-wrap">{message}</span>
      {onDismiss && (
        <button
          type="button"
          className="flex-shrink-0 rounded px-1 text-[10px] opacity-70 hover:opacity-100"
          onClick={onDismiss}
          title="关闭提示"
          aria-label="关闭提示"
        >
          ✕
        </button>
      )}
    </div>
  );
}
