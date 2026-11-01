/**
 * 对话头的会话下拉：本项目的会话列表（可搜）、就地改名、从列表移除、新建会话。
 * 改名在行内改，不弹居中对话框；回车保存，Esc 放弃。
 */
import { useState, type RefObject } from 'react';

import type { AssistantSessionRecord } from '../../lib/api-client';
import { formatStoredTimeFull, formatStoredTimeShort } from '../../lib/stored-time';
import { Pencil, Plus, Search, X } from '../icons/shell-icons';
import { MenuItem, MenuItemAction, MenuSeparator, MenuSurface } from '../ui';
import { sessionDisplayTitle } from './useSessionManagement';

export function SessionMenu({
  sessions,
  activeSessionId,
  triggerRef,
  onDismiss,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onRemoveSession,
}: {
  sessions: AssistantSessionRecord[];
  activeSessionId: number | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onDismiss: () => void;
  onSelectSession?: (id: number) => void;
  onNewSession?: () => void;
  /** 返回 false 表示没存进去：新标题放回输入框。 */
  onRenameSession?: (id: number, title: string) => void | Promise<void | boolean>;
  onRemoveSession?: (id: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: number; title: string } | null>(null);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? sessions.filter((session) => sessionDisplayTitle(session).toLowerCase().includes(needle))
    : sessions;

  const commitRename = () => {
    if (!editing) return;
    const draft = editing;
    setEditing(null);
    void Promise.resolve(onRenameSession?.(draft.id, draft.title))
      .catch(() => false)
      .then((saved) => {
        // 没存进去：新标题放回输入框，作者再按一次回车就行。
        if (saved === false) setEditing((current) => current ?? draft);
      });
  };

  return (
    <MenuSurface
      aria-label="本作品的会话"
      triggerRef={triggerRef}
      onDismiss={onDismiss}
      className="w-72 overflow-y-auto"
    >
      <div className="px-2 py-1 text-3xs uppercase tracking-[0.08em] text-subtle">本作品的会话</div>
      {sessions.length > 0 && (
        <label className="sf-form-shell mx-1 mb-1 flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
          <Search size={12} strokeWidth={1.7} className="flex-shrink-0 text-subtle" />
          <input
            className="sf-inner-input min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-subtle"
            placeholder="搜会话标题"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            data-testid="session-search"
          />
        </label>
      )}
      {sessions.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-subtle">暂无历史会话</div>
      ) : shown.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-subtle">没有标题里含「{query.trim()}」的会话</div>
      ) : (
        shown.map((session) => {
          const active = session.id === activeSessionId;
          const title = sessionDisplayTitle(session);
          if (editing?.id === session.id)
            return (
              <div key={session.id} className="px-1 py-0.5">
                <input
                  autoFocus
                  className="sf-input w-full rounded-sm border border-border-strong bg-background px-2 py-1 text-xs text-foreground outline-none"
                  aria-label="会话新标题"
                  value={editing.title}
                  onChange={(event) => setEditing({ id: session.id, title: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.key !== 'Enter') return;
                    event.preventDefault();
                    commitRename();
                  }}
                  onBlur={commitRename}
                  data-testid="session-rename-input"
                />
              </div>
            );
          return (
            <MenuItem
              key={session.id}
              current={active}
              hint={formatStoredTimeShort(session.updated_at)}
              onClick={() => {
                onDismiss();
                onSelectSession?.(session.id);
              }}
              title={`会话 #${session.id} · ${formatStoredTimeFull(session.updated_at)}`}
              data-testid="session-item"
              actions={
                (onRenameSession || onRemoveSession) && (
                  <>
                    {onRenameSession && (
                      <MenuItemAction
                        label={`改名：${title}`}
                        title="改名"
                        icon={<Pencil size={12} strokeWidth={1.7} />}
                        onClick={() => setEditing({ id: session.id, title })}
                        data-testid="session-rename"
                      />
                    )}
                    {onRemoveSession && (
                      <MenuItemAction
                        label={`从列表移除：${title}`}
                        title="从列表移除（记录仍保留在本机）"
                        icon={<X size={12} strokeWidth={1.7} />}
                        onClick={() => onRemoveSession(session.id)}
                        data-testid="session-remove"
                      />
                    )}
                  </>
                )
              }
            >
              {title}
            </MenuItem>
          );
        })
      )}
      {onNewSession && (
        <>
          <MenuSeparator />
          <MenuItem
            icon={<Plus size={13} strokeWidth={1.7} />}
            onClick={() => {
              onDismiss();
              onNewSession();
            }}
          >
            新建会话
          </MenuItem>
        </>
      )}
    </MenuSurface>
  );
}
