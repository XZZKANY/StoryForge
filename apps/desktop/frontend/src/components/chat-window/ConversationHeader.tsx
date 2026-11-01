// 对话头：会话切换、新建会话、观测镜入口与布局三态的就地控件。
import { IconButton, PlainButton } from '../ui';

import { useRef, useState, type ReactNode } from 'react';
import type { AssistantSessionRecord } from '../../lib/api-client';
import {
  ChevronDown,
  Maximize2,
  PanelLeft,
  PanelRightClose,
  Plus,
  Radar,
  Sparkles,
} from '../icons/shell-icons';
import type { LayoutMode } from '../shell/useShellState';
import { SessionMenu } from './SessionMenu';

export function ConversationHeader({
  title,
  sessions,
  activeSessionId = null,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onRemoveSession,
  layoutMode,
  onSetLayoutMode,
  onOpenObservatory,
  observatoryAttention = false,
  checkHistoryToggle,
  contextToggle,
}: {
  title: string;
  sessions?: AssistantSessionRecord[];
  activeSessionId?: number | null;
  onSelectSession?: (id: number) => void;
  onNewSession?: () => void;
  onRenameSession?: (id: number, title: string) => void | Promise<void | boolean>;
  onRemoveSession?: (id: number) => void;
  layoutMode?: LayoutMode;
  onSetLayoutMode?: (mode: LayoutMode) => void;
  onOpenObservatory?: () => void;
  observatoryAttention?: boolean;
  checkHistoryToggle?: ReactNode;
  contextToggle?: ReactNode;
}) {
  // Q5：会话下拉——会话按项目划分，标题变下拉入口（当前项目会话列表 + 新建）。
  // 下拉走内联 absolute（不 portal），token 在 :root/#app 内，避免 portal 出主题作用域翻车。
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const sessionList = sessions ?? [];
  return (
    <header
      className="relative flex h-shell-row flex-shrink-0 items-center gap-2 bg-panel px-3 pr-2"
      data-testid="conversation-header"
    >
      <PlainButton
        ref={menuTriggerRef}
        className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-elevated"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-testid="conversation-session-switch"
        title="本作品的会话（会话按作品划分，不再放全局左栏）"
      >
        <Sparkles size={13} strokeWidth={1.7} className="flex-shrink-0 text-agent" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
        <ChevronDown size={13} strokeWidth={1.6} className="flex-shrink-0 text-subtle" />
      </PlainButton>
      {onNewSession && (
        <IconButton
          type="button"
          onClick={onNewSession}
          data-testid="conversation-new-session"
          size="xs"
          className="relative"
          label="新建会话"
          tooltip="新建会话"
          icon={
            <>
              <Plus size={15} strokeWidth={1.7} />
            </>
          }
        />
      )}
      {onOpenObservatory && (
        <IconButton
          type="button"
          onClick={onOpenObservatory}
          data-testid="conversation-open-observatory"
          size="xs"
          className="relative"
          label="世界线观测镜"
          tooltip="世界线观测镜 · Ctrl Shift O"
          icon={
            <>
              <Radar size={14} strokeWidth={1.6} />
              {observatoryAttention && (
                <span
                  className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-agent"
                  data-testid="observatory-attention-dot"
                />
              )}
            </>
          }
        />
      )}
      {checkHistoryToggle}
      {contextToggle}
      {/* Q4 布局三态就地控件：对话头切 编辑 / 平衡 / 对话聚焦 */}
      {onSetLayoutMode &&
        (layoutMode === 'chat' ? (
          <IconButton
            type="button"
            onClick={() => onSetLayoutMode('balanced')}
            data-testid="conversation-back-to-balanced"
            size="xs"
            className="relative"
            label="回到编辑"
            tooltip="回到编辑 · Ctrl 2"
            icon={
              <>
                <PanelLeft size={15} strokeWidth={1.6} />
              </>
            }
          />
        ) : (
          <>
            <IconButton
              type="button"
              onClick={() => onSetLayoutMode('chat')}
              data-testid="conversation-expand-chat"
              size="xs"
              className="relative"
              label="对话占满中右"
              tooltip="对话占满中右 · Ctrl 3"
              icon={
                <>
                  <Maximize2 size={14} strokeWidth={1.6} />
                </>
              }
            />
            <IconButton
              type="button"
              onClick={() => onSetLayoutMode('editor')}
              data-testid="conversation-collapse-right"
              size="xs"
              className="relative"
              label="收起对话栏，编辑占满"
              tooltip="收起对话栏，编辑占满 · Ctrl 1"
              icon={
                <>
                  <PanelRightClose size={15} strokeWidth={1.6} />
                </>
              }
            />
          </>
        ))}
      {menuOpen && (
        <SessionMenu
          sessions={sessionList}
          activeSessionId={activeSessionId}
          triggerRef={menuTriggerRef}
          onDismiss={() => setMenuOpen(false)}
          onSelectSession={onSelectSession}
          onNewSession={onNewSession}
          onRenameSession={onRenameSession}
          onRemoveSession={onRemoveSession}
        />
      )}
    </header>
  );
}
