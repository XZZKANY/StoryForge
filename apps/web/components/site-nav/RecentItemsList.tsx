'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { MessageSquare, FolderOpen, Package, PlayCircle } from 'lucide-react';

import {
  mergeRecentItems,
  readRecentItems,
  subscribeRecentItems,
  type RecentItem,
} from './recent-items-store';

function getRecentItemIcon(type: RecentItem['type']) {
  switch (type) {
    case 'conversation':
      return <MessageSquare className="h-3 w-3" />;
    case 'project':
      return <FolderOpen className="h-3 w-3" />;
    case 'artifact':
      return <Package className="h-3 w-3" />;
    case 'run':
      return <PlayCircle className="h-3 w-3" />;
  }
}

function getRecentItemTypeLabel(type: RecentItem['type']) {
  switch (type) {
    case 'conversation':
      return '对话';
    case 'project':
      return '项目';
    case 'artifact':
      return '产物';
    case 'run':
      return '运行';
  }
}

export function RecentItemsList({
  initialItems = [],
}: {
  readonly initialItems?: readonly RecentItem[];
}) {
  const storedItems = useSyncExternalStore(subscribeRecentItems, readRecentItems, () => []);
  const mergedItems = mergeRecentItems(initialItems, storedItems);

  if (mergedItems.length === 0) {
    return <p className="m-0 mt-3 text-sm leading-5 text-muted-foreground">暂无最近记录</p>;
  }

  return (
    <ul className="!m-0 mt-3 !grid !grid-cols-1 !gap-2 !p-0 text-sm text-foreground">
      {mergedItems.map((item) => (
        <li
          key={`${item.type}-${item.id}`}
          className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none"
        >
          <Link
            href={item.href}
            title={item.title}
            className="flex items-start gap-2 rounded-md px-2 py-1 font-normal leading-tight text-muted-foreground no-underline transition-colors hover:bg-muted/10 hover:text-foreground dark:hover:bg-muted/15"
          >
            <span
              aria-hidden
              className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center text-muted-foreground"
            >
              {item.metadata?.icon ? item.metadata.icon : getRecentItemIcon(item.type)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.title}</span>
              <span className="text-xs text-muted-foreground/70">
                {getRecentItemTypeLabel(item.type)}
                {item.metadata?.status ? ` · ${item.metadata.status}` : ''}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
