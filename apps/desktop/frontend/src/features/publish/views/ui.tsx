import type { ReactNode } from 'react';
import type { PublishAccount, PublishBook } from '../model';

export function Stat({
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

export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-1 text-xs font-semibold text-subtle">{title}</h2>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-xs text-subtle">{children}</div>;
}

export function BookRow({
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
