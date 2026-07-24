import { useRef, useState } from 'react';
import {
  semanticKindLabel,
  type ContextBundle,
  type SemanticFile,
} from '../../lib/project-context';
import type { AssistantSessionRecord } from '../../lib/api-client';
import { AgentStepsPanel } from '../AgentStepsPanel';
import {
  ChevronDown,
  Maximize2,
  PanelRight,
  PanelRightClose,
  Plus,
  Radar,
  Sparkles,
} from '../icons/shell-icons';
import type { LayoutMode } from '../shell/useShellState';
import { useDismissableMenu } from '../shell/useDismissableMenu';
import { AssistantMarkdown } from './AssistantMarkdown';
import { ComposerSurface } from './Composer';
import { contextBudgetText, selectedContextPreview } from './display-utils';
import type { AgentRunRecoveryDisplay } from './recovery';
import type { AgentRun, AgentRunControlHandlers, Message, WritingRunProjection } from './types';

export function ConversationHeader({
  title,
  sessions,
  activeSessionId = null,
  onSelectSession,
  onNewSession,
  layoutMode,
  onSetLayoutMode,
  onOpenObservatory,
  observatoryAttention = false,
}: {
  title: string;
  sessions?: AssistantSessionRecord[];
  activeSessionId?: number | null;
  onSelectSession?: (id: number) => void;
  onNewSession?: () => void;
  layoutMode?: LayoutMode;
  onSetLayoutMode?: (mode: LayoutMode) => void;
  onOpenObservatory?: () => void;
  observatoryAttention?: boolean;
}) {
  // Q5：会话下拉——会话按项目划分，标题变下拉入口（当前项目会话列表 + 新建）。
  // 下拉走内联 absolute（不 portal），token 在 :root/#app 内，避免 portal 出主题作用域翻车。
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  useDismissableMenu(menuOpen, () => setMenuOpen(false), menuTriggerRef);
  const sessionList = sessions ?? [];
  return (
    <header
      className="relative flex h-shell-row flex-shrink-0 items-center gap-2 border-b border-border bg-panel px-3 pr-2"
      data-testid="conversation-header"
    >
      <button
        ref={menuTriggerRef}
        type="button"
        className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left hover:bg-elevated"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-testid="conversation-session-switch"
        title="本项目的会话（会话按项目划分，不再放全局左栏）"
      >
        <Sparkles size={13} strokeWidth={1.7} className="flex-shrink-0 text-agent" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {title}
        </span>
        <ChevronDown size={13} strokeWidth={1.6} className="flex-shrink-0 text-subtle" />
      </button>
      {onNewSession && (
        <button
          type="button"
          className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
          title="新建会话"
          onClick={onNewSession}
          data-testid="conversation-new-session"
        >
          <Plus size={15} strokeWidth={1.7} />
        </button>
      )}
      {onOpenObservatory && (
        <button
          type="button"
          className="relative grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
          title="世界线观测镜 · Ctrl+4"
          onClick={onOpenObservatory}
          data-testid="conversation-open-observatory"
        >
          <Radar size={14} strokeWidth={1.6} />
          {observatoryAttention && (
            <span
              className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-agent"
              data-testid="observatory-attention-dot"
            />
          )}
        </button>
      )}
      {/* Q4 布局三态就地控件：对话头切 编辑 / 平衡 / 对话聚焦 */}
      {onSetLayoutMode &&
        (layoutMode === 'chat' ? (
          <button
            type="button"
            className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
            title="回到编辑 · Ctrl+2"
            onClick={() => onSetLayoutMode('balanced')}
            data-testid="conversation-back-to-balanced"
          >
            <PanelRight size={15} strokeWidth={1.6} />
          </button>
        ) : (
          <>
            <button
              type="button"
              className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
              title="对话占满中右 · Ctrl+3"
              onClick={() => onSetLayoutMode('chat')}
              data-testid="conversation-expand-chat"
            >
              <Maximize2 size={14} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
              title="收起对话栏，编辑占满 · Ctrl+1"
              onClick={() => onSetLayoutMode('editor')}
              data-testid="conversation-collapse-right"
            >
              <PanelRightClose size={15} strokeWidth={1.6} />
            </button>
          </>
        ))}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
          <div className="absolute left-2 right-2 top-shell-row z-40 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-[0_8px_28px_rgba(0,0,0,0.35)]">
            <div className="px-2 py-1 text-[10.5px] uppercase tracking-[0.08em] text-subtle">
              本项目的会话
            </div>
            {sessionList.length === 0 ? (
              <div className="px-2 py-1.5 text-[12px] text-subtle">暂无历史会话</div>
            ) : (
              sessionList.map((session) => {
                const active = session.id === activeSessionId;
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-elevated ${
                      active ? 'text-foreground' : 'text-muted hover:text-foreground'
                    }`}
                    onClick={() => {
                      setMenuOpen(false);
                      onSelectSession?.(session.id);
                    }}
                    title={`会话 #${session.id} · ${session.updated_at}`}
                    data-testid="session-item"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {active ? '✓ ' : ''}
                      {session.title.replace(/^IDE Agent:\s*/, '') || `会话 #${session.id}`}
                    </span>
                    <span className="flex-shrink-0 text-[10.5px] text-subtle">
                      {session.updated_at}
                    </span>
                  </button>
                );
              })
            )}
            {onNewSession && (
              <>
                <div className="mx-1.5 my-1 h-px bg-border" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-muted hover:bg-elevated hover:text-foreground"
                  onClick={() => {
                    setMenuOpen(false);
                    onNewSession();
                  }}
                >
                  <Plus size={13} strokeWidth={1.7} />
                  新建会话
                </button>
              </>
            )}
          </div>
        </>
      )}
    </header>
  );
}

export function MessageList({
  messages,
  projectName,
  currentFileLabel,
  disabled,
  onSubmit,
  agentRun,
  agentRunRecovery,
  writingRunProjection,
  explicitContextPaths,
  contextCandidates,
  contextCandidatesLoading,
  contextCandidatesError,
  contextPickerOpen,
  lastContextBundle,
  missingContextPaths,
  onAddContext,
  onTogglePinnedContext,
  onRetryContextCandidates,
}: {
  messages: Message[];
  projectName: string | null;
  currentFileLabel: string | null;
  disabled: boolean;
  onSubmit: (value: string) => void;
  agentRun: AgentRun | null;
  agentRunRecovery: AgentRunRecoveryDisplay | null;
  writingRunProjection: WritingRunProjection | null;
  explicitContextPaths: string[];
  contextCandidates: SemanticFile[];
  contextCandidatesLoading: boolean;
  contextCandidatesError: string | null;
  contextPickerOpen: boolean;
  lastContextBundle: ContextBundle | null;
  missingContextPaths: string[];
  onAddContext: () => void;
  onTogglePinnedContext: (path: string) => void;
  onRetryContextCandidates: () => void;
  /** @deprecated 控件已迁到 Composer 上方 RunActionBar */
  agentRunControls?: AgentRunControlHandlers;
}) {
  if (messages.length === 0) {
    return (
      <div className="min-h-0 flex-1">
        <EmptyConversation
          projectName={projectName}
          currentFileLabel={currentFileLabel}
          disabled={disabled}
          onSubmit={onSubmit}
          explicitContextPaths={explicitContextPaths}
          contextCandidates={contextCandidates}
          contextCandidatesLoading={contextCandidatesLoading}
          contextCandidatesError={contextCandidatesError}
          contextPickerOpen={contextPickerOpen}
          lastContextBundle={lastContextBundle}
          missingContextPaths={missingContextPaths}
          onAddContext={onAddContext}
          onTogglePinnedContext={onTogglePinnedContext}
          onRetryContextCandidates={onRetryContextCandidates}
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
      <div className="mx-auto flex w-full max-w-[800px] flex-col gap-6">
        {messages.map((message, index) => (
          <MessageItem key={index} message={message} />
        ))}

        {agentRun && agentRun.steps.length > 0 && (
          <div className="animate-slide-up-fade space-y-2">
            <AgentStepsPanel run={agentRun} />
            <AgentRunRecoveryPanel recovery={agentRunRecovery} />
          </div>
        )}

        {writingRunProjection && <WritingRunProgressPanel projection={writingRunProjection} />}

        <ContextSummaryPanel
          compact
          currentFileLabel={currentFileLabel}
          explicitContextPaths={explicitContextPaths}
          contextCandidates={contextCandidates}
          contextCandidatesLoading={contextCandidatesLoading}
          contextCandidatesError={contextCandidatesError}
          contextPickerOpen={contextPickerOpen}
          lastContextBundle={lastContextBundle}
          missingContextPaths={missingContextPaths}
          onAddContext={onAddContext}
          onTogglePinnedContext={onTogglePinnedContext}
          onRetryContextCandidates={onRetryContextCandidates}
        />
      </div>
    </div>
  );
}

export function AgentRunRecoveryPanel({ recovery }: { recovery: AgentRunRecoveryDisplay | null }) {
  if (!recovery) return null;
  const toneClass = recoveryToneClass(recovery.tone);
  return (
    <section
      className={`rounded-md border px-3 py-2 ${toneClass}`}
      data-testid="agent-run-recovery"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="truncate text-xs font-semibold text-foreground">
          {recovery.statusText}；{recovery.resumeText}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {recovery.pendingText && <span>{recovery.pendingText}</span>}
          {recovery.latestControlText && <span>{recovery.latestControlText}</span>}
          {recovery.boundaryText && <span>{recovery.boundaryText}</span>}
          {recovery.checkpointText && <span>{recovery.checkpointText}</span>}
        </div>
      </div>
    </section>
  );
}

function recoveryToneClass(tone: AgentRunRecoveryDisplay['tone']): string {
  if (tone === 'error') return 'border-error/40 bg-error/10';
  if (tone === 'waiting') return 'border-warning/40 bg-warning/10';
  if (tone === 'ok') return 'border-success/40 bg-success/10';
  return 'border-border bg-panel';
}

/** Composer 上方固定操作条：停止 + 权限批准/拒绝（中流不再放主 CTA）。 */
export function RunActionBar({
  run,
  controls,
}: {
  run: AgentRun;
  controls: AgentRunControlHandlers;
}) {
  const waitingForPermission = run.steps.some(
    (step) => step.id === 'permission-required' && step.status === 'waiting',
  );
  // status==='waiting' 且非权限 = run 已产出、等你在编辑器确认 diff/导出。此时「停止」会把 run
  // 误标 failed 却不清掉待确认补丁（放弃应走编辑器里拒绝），故这里只给去向提示、不给破坏性停止。
  const awaitingConfirm = run.status === 'waiting' && !waitingForPermission;
  const canStop = run.status === 'running' || waitingForPermission;
  if (!canStop && !awaitingConfirm) return null;

  return (
    <div
      className="flex flex-shrink-0 flex-wrap items-center gap-2 border-t border-border bg-panel px-4 py-2"
      data-testid="run-action-bar"
    >
      <div className="mx-auto flex w-full max-w-[800px] flex-wrap items-center gap-2">
        <div
          className="min-w-0 flex-1 text-xs text-muted"
          title={`运行 ${run.id}`}
          data-testid="run-action-status"
        >
          {waitingForPermission
            ? '等待你确认'
            : awaitingConfirm
              ? '在编辑器里确认修订'
              : '正在处理'}
        </div>
        {waitingForPermission && (
          <>
            <button
              type="button"
              className="h-7 rounded-md bg-accent px-2.5 text-xs text-accent-foreground hover:bg-accent/90 active:bg-accent"
              onClick={controls.onApprovePermission}
              title="批准权限请求"
              data-testid="run-approve-permission"
            >
              批准
            </button>
            <button
              type="button"
              className="h-7 rounded-md border border-error/40 px-2.5 text-xs text-error hover:bg-error/10"
              onClick={controls.onDenyPermission}
              title="拒绝权限请求"
              data-testid="run-deny-permission"
            >
              拒绝
            </button>
          </>
        )}
        {canStop && (
          <button
            type="button"
            className="h-7 rounded-md border border-error/40 px-2.5 text-xs text-error hover:bg-error/10"
            onClick={controls.onStopRun}
            title="停止本轮"
            data-testid="run-stop"
          >
            停止
          </button>
        )}
      </div>
    </div>
  );
}

/** @deprecated 中流控制已迁到 RunActionBar；保留别名避免外部引用断裂。 */
export const AgentRunControlBar = RunActionBar;

export function WritingRunProgressPanel({ projection }: { projection: WritingRunProjection }) {
  const chapters = projection.totalChapters
    ? `${projection.completedCount ?? 0}/${projection.totalChapters}`
    : projection.completedCount !== null
      ? `${projection.completedCount} 已完成`
      : '等待章节进度';
  return (
    <section
      className="animate-slide-up-fade rounded-md border border-border bg-panel px-3 py-2"
      data-testid="writing-run-progress"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-foreground">
            写作任务 #{projection.writingRunId} · {projection.status}
          </div>
          <div className="mt-1 truncate text-xs text-subtle">
            章节：{chapters}；最近事件：{projection.latestEvent}
            {projection.currentChapterIndex !== null
              ? `；当前第 ${projection.currentChapterIndex} 章`
              : ''}
          </div>
        </div>
        <span className="rounded-md border border-border px-2 py-1 text-xs text-subtle">
          写作任务
        </span>
      </div>
      {projection.failureReason && (
        <div className="mt-2 text-xs text-warning" data-testid="writing-run-failure-reason">
          {projection.failureReason}
        </div>
      )}
    </section>
  );
}

export function ContextSummaryPanel({
  compact = false,
  currentFileLabel,
  explicitContextPaths,
  contextCandidates,
  contextCandidatesLoading,
  contextCandidatesError,
  contextPickerOpen,
  lastContextBundle,
  missingContextPaths,
  onAddContext,
  onTogglePinnedContext,
  onRetryContextCandidates,
}: {
  compact?: boolean;
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  contextCandidates: SemanticFile[];
  contextCandidatesLoading: boolean;
  contextCandidatesError: string | null;
  contextPickerOpen: boolean;
  lastContextBundle: ContextBundle | null;
  missingContextPaths: string[];
  onAddContext: () => void;
  onTogglePinnedContext: (path: string) => void;
  onRetryContextCandidates: () => void;
}) {
  const [expanded, setExpanded] = useState(!compact);

  const visibleCandidates = contextCandidates
    .filter((file) => file.relativePath !== currentFileLabel)
    .slice(0, 24);
  // picker 由 Composer「+」打开时派生展开，避免操作落空；不再用 effect 同步 state。
  const detailsOpen = !compact || expanded || contextPickerOpen;

  return (
    <section
      className="animate-slide-up-fade rounded-md border border-border bg-panel px-3 py-2"
      data-testid="context-summary"
      data-compact={compact ? 'true' : 'false'}
      data-expanded={detailsOpen ? 'true' : 'false'}
    >
      <div className="flex items-center gap-3">
        {compact ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => setExpanded((value) => !value)}
            data-testid="context-summary-toggle"
            aria-expanded={detailsOpen}
          >
            <span
              className={`flex-shrink-0 text-[9px] text-subtle transition-transform ${
                detailsOpen ? '' : '-rotate-90'
              }`}
            >
              ▾
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-foreground">
                {contextBudgetText(lastContextBundle)}
              </span>
              {!detailsOpen && (
                <span className="mt-0.5 block truncate text-xs text-subtle">
                  当前：{currentFileLabel ?? '未选择文件'}
                  {explicitContextPaths.length > 0 ? ` · 固定 ${explicitContextPaths.length}` : ''}
                </span>
              )}
            </span>
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-foreground">
              {contextBudgetText(lastContextBundle)}
            </div>
            <div className="mt-1 truncate text-xs text-subtle">
              当前：{currentFileLabel ?? '未选择文件'}；已选：
              {selectedContextPreview(lastContextBundle)}
            </div>
          </div>
        )}
        <button
          type="button"
          className="h-7 flex-shrink-0 rounded-md border border-border-strong px-2.5 text-xs text-foreground hover:bg-elevated"
          onClick={() => {
            if (compact) setExpanded(true);
            onAddContext();
          }}
          data-testid="context-picker-toggle"
        >
          添加上下文
        </button>
      </div>

      {detailsOpen && (
        <>
          {compact && (
            <div className="mt-1 truncate pl-5 text-xs text-subtle">
              当前：{currentFileLabel ?? '未选择文件'}；已选：
              {selectedContextPreview(lastContextBundle)}
            </div>
          )}

          {explicitContextPaths.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="pinned-context-list">
              {explicitContextPaths.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="max-w-full truncate rounded-md border border-accent bg-accent px-2 py-1 text-xs text-accent-foreground hover:bg-accent"
                  title="取消固定"
                  onClick={() => onTogglePinnedContext(path)}
                >
                  已固定 {path}
                </button>
              ))}
            </div>
          )}

          {missingContextPaths.length > 0 && (
            <div className="mt-2 text-xs text-warning" data-testid="missing-context-warning">
              未读到：{missingContextPaths.join('、')}
            </div>
          )}

          {contextPickerOpen && (
            <div
              className="mt-3 grid max-h-52 grid-cols-1 gap-1 overflow-y-auto border-t border-border pt-2"
              data-testid="context-picker"
            >
              {contextCandidatesLoading ? (
                <div
                  className="px-2 py-1 text-xs text-subtle"
                  data-testid="context-candidates-loading"
                >
                  正在读取项目上下文…
                </div>
              ) : contextCandidatesError ? (
                <div
                  className="flex items-center gap-2 px-2 py-1 text-xs text-warning"
                  data-testid="context-candidates-error"
                >
                  <span className="min-w-0 flex-1 break-words">{contextCandidatesError}</span>
                  <button
                    type="button"
                    className="h-7 flex-shrink-0 rounded-md border border-warning px-2.5 hover:bg-elevated"
                    onClick={onRetryContextCandidates}
                    data-testid="context-candidates-retry"
                  >
                    重试
                  </button>
                </div>
              ) : visibleCandidates.length === 0 ? (
                <div className="px-2 py-1 text-xs text-subtle">
                  当前项目还没有可选的 Markdown 上下文。
                </div>
              ) : (
                visibleCandidates.map((file) => {
                  const pinned =
                    explicitContextPaths.includes(file.relativePath) ||
                    explicitContextPaths.includes(file.path);
                  return (
                    <button
                      key={file.path}
                      type="button"
                      className={`flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs ${
                        pinned ? 'bg-accent text-accent-foreground' : 'text-muted hover:bg-elevated'
                      }`}
                      onClick={() => onTogglePinnedContext(file.relativePath)}
                      data-testid="context-candidate"
                      data-context-path={file.relativePath}
                    >
                      <span className="w-10 flex-shrink-0 text-subtle">
                        {semanticKindLabel(file.kind)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{file.relativePath}</span>
                      <span className="flex-shrink-0 text-subtle">
                        {pinned ? '已固定' : '固定'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </>
      )}

      {!detailsOpen && missingContextPaths.length > 0 && (
        <div className="mt-2 text-xs text-warning" data-testid="missing-context-warning">
          未读到：{missingContextPaths.join('、')}
        </div>
      )}
    </section>
  );
}

export function MessageItem({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex animate-slide-up-fade justify-end" data-testid="user-message">
        <div className="max-w-[85%] rounded-[12px_12px_2px_12px] bg-elevated px-3 py-2 text-sm leading-6 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <article
      className="max-w-[760px] animate-slide-up-fade text-sm leading-7 text-foreground"
      data-testid="assistant-message"
    >
      <AssistantMarkdown content={message.content} />
    </article>
  );
}

export function EmptyConversation({
  projectName,
  currentFileLabel,
  disabled,
  onSubmit,
  explicitContextPaths,
  contextCandidates,
  contextCandidatesLoading,
  contextCandidatesError,
  contextPickerOpen,
  lastContextBundle,
  missingContextPaths,
  onAddContext,
  onTogglePinnedContext,
  onRetryContextCandidates,
}: {
  projectName: string | null;
  currentFileLabel: string | null;
  disabled: boolean;
  onSubmit: (value: string) => void;
  explicitContextPaths: string[];
  contextCandidates: SemanticFile[];
  contextCandidatesLoading: boolean;
  contextCandidatesError: string | null;
  contextPickerOpen: boolean;
  lastContextBundle: ContextBundle | null;
  missingContextPaths: string[];
  onAddContext: () => void;
  onTogglePinnedContext: (path: string) => void;
  onRetryContextCandidates: () => void;
}) {
  const [value, setValue] = useState('');

  const submit = () => {
    const next = value.trim();
    if (!next || disabled) return;
    setValue('');
    onSubmit(next);
  };

  return (
    <div className="flex h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-[680px] translate-y-[-3vh]">
        <div className="mb-4 px-1">
          <div className="text-[13px] font-medium text-foreground">StoryForge</div>
          <div className="mt-1 truncate text-xs text-subtle">
            {projectName
              ? `${projectName}${currentFileLabel ? ` · ${currentFileLabel}` : ''}`
              : '打开项目后即可开始创作会话'}
          </div>
        </div>

        <ComposerSurface
          value={value}
          disabled={disabled}
          busy={false}
          currentFileLabel={currentFileLabel}
          explicitContextPaths={explicitContextPaths}
          onAddContext={onAddContext}
          onTogglePinnedContext={onTogglePinnedContext}
          onChange={setValue}
          onSubmit={submit}
        />
        <div className="mt-3">
          <ContextSummaryPanel
            currentFileLabel={currentFileLabel}
            explicitContextPaths={explicitContextPaths}
            contextCandidates={contextCandidates}
            contextCandidatesLoading={contextCandidatesLoading}
            contextCandidatesError={contextCandidatesError}
            contextPickerOpen={contextPickerOpen}
            lastContextBundle={lastContextBundle}
            missingContextPaths={missingContextPaths}
            onAddContext={onAddContext}
            onTogglePinnedContext={onTogglePinnedContext}
            onRetryContextCandidates={onRetryContextCandidates}
          />
        </div>
      </div>
    </div>
  );
}

export function LightweightStatus({
  text,
  retryVisible = false,
  onRetry,
}: {
  text: string;
  retryVisible?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="flex-shrink-0 border-t border-border bg-panel px-5 py-2">
      <div className="mx-auto flex max-w-[800px] items-center gap-3">
        <div className="min-w-0 flex-1 truncate text-xs text-muted">{text}</div>
        {retryVisible && (
          <button
            type="button"
            className="h-7 flex-shrink-0 rounded-md border border-border-strong px-2.5 text-xs text-foreground hover:bg-elevated"
            onClick={onRetry}
          >
            重试本轮
          </button>
        )}
      </div>
    </div>
  );
}
