import { useState } from 'react';
import {
  semanticKindLabel,
  type ContextBundle,
  type SemanticFile,
} from '../../lib/project-context';
import { AgentStepsPanel } from '../AgentStepsPanel';
import { ComposerSurface } from './Composer';
import { contextBudgetText, selectedContextPreview } from './display-utils';
import type { AgentRunRecoveryDisplay } from './recovery';
import type { AgentRun, AgentRunControlHandlers, Message, WritingRunProjection } from './types';

export function ConversationHeader({ title }: { title: string }) {
  return (
    <header className="flex h-10 flex-shrink-0 items-center gap-3 border-b border-border bg-panel px-4">
      <h1 className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{title}</h1>
      <button
        type="button"
        className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
        title="更多"
      >
        ...
      </button>
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
  contextPickerOpen,
  lastContextBundle,
  missingContextPaths,
  onAddContext,
  onTogglePinnedContext,
  agentRunControls,
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
  contextPickerOpen: boolean;
  lastContextBundle: ContextBundle | null;
  missingContextPaths: string[];
  onAddContext: () => void;
  onTogglePinnedContext: (path: string) => void;
  agentRunControls: AgentRunControlHandlers;
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
          contextPickerOpen={contextPickerOpen}
          lastContextBundle={lastContextBundle}
          missingContextPaths={missingContextPaths}
          onAddContext={onAddContext}
          onTogglePinnedContext={onTogglePinnedContext}
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
            <AgentRunControlBar run={agentRun} controls={agentRunControls} />
            <AgentStepsPanel run={agentRun} />
            <AgentRunRecoveryPanel recovery={agentRunRecovery} />
          </div>
        )}

        {writingRunProjection && <WritingRunProgressPanel projection={writingRunProjection} />}

        <ContextSummaryPanel
          currentFileLabel={currentFileLabel}
          explicitContextPaths={explicitContextPaths}
          contextCandidates={contextCandidates}
          contextPickerOpen={contextPickerOpen}
          lastContextBundle={lastContextBundle}
          missingContextPaths={missingContextPaths}
          onAddContext={onAddContext}
          onTogglePinnedContext={onTogglePinnedContext}
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

export function AgentRunControlBar({
  run,
  controls,
}: {
  run: AgentRun;
  controls: AgentRunControlHandlers;
}) {
  const waitingForPermission = run.steps.some(
    (step) => step.id === 'permission-required' && step.status === 'waiting',
  );
  const canStop = run.status === 'running' || run.status === 'waiting';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-panel px-3 py-2">
      <div className="min-w-0 flex-1 text-xs text-muted">AgentRun #{run.id}</div>
      {waitingForPermission && (
        <>
          <button
            type="button"
            className="h-7 rounded-md bg-accent px-2.5 text-xs text-accent-foreground hover:bg-accent"
            onClick={controls.onApprovePermission}
            title="批准权限请求"
          >
            批准
          </button>
          <button
            type="button"
            className="h-7 rounded-md border border-error/40 px-2.5 text-xs text-error hover:bg-error/10"
            onClick={controls.onDenyPermission}
            title="拒绝权限请求"
          >
            拒绝
          </button>
        </>
      )}
      <button
        type="button"
        className="h-7 rounded-md border border-error/40 px-2.5 text-xs text-error hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={controls.onStopRun}
        disabled={!canStop}
        title="停止 AgentRun"
      >
        停止
      </button>
    </div>
  );
}

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
        <span className="rounded-md border border-accent px-2 py-1 text-xs text-accent">
          managed
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
  currentFileLabel,
  explicitContextPaths,
  contextCandidates,
  contextPickerOpen,
  lastContextBundle,
  missingContextPaths,
  onAddContext,
  onTogglePinnedContext,
}: {
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  contextCandidates: SemanticFile[];
  contextPickerOpen: boolean;
  lastContextBundle: ContextBundle | null;
  missingContextPaths: string[];
  onAddContext: () => void;
  onTogglePinnedContext: (path: string) => void;
}) {
  const visibleCandidates = contextCandidates
    .filter((file) => file.relativePath !== currentFileLabel)
    .slice(0, 24);
  return (
    <section
      className="animate-slide-up-fade rounded-md border border-border bg-panel px-3 py-2"
      data-testid="context-summary"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-foreground">
            {contextBudgetText(lastContextBundle)}
          </div>
          <div className="mt-1 truncate text-xs text-subtle">
            当前：{currentFileLabel ?? '未选择文件'}；已选：
            {selectedContextPreview(lastContextBundle)}
          </div>
        </div>
        <button
          type="button"
          className="h-7 flex-shrink-0 rounded-md border border-border-strong px-2.5 text-xs text-foreground hover:bg-elevated"
          onClick={onAddContext}
          data-testid="context-picker-toggle"
        >
          添加上下文
        </button>
      </div>

      {explicitContextPaths.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="pinned-context-list">
          {explicitContextPaths.map((path) => (
            <button
              key={path}
              type="button"
              className="max-w-full truncate rounded-md border border-accent bg-accent px-2 py-1 text-xs text-accent-foreground hover:bg-accent"
              title="取消 pin"
              onClick={() => onTogglePinnedContext(path)}
            >
              pin {path}
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
          {visibleCandidates.length === 0 ? (
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
                  <span className="flex-shrink-0 text-subtle">{pinned ? 'pinned' : 'pin'}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

export function MessageItem({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex animate-slide-up-fade justify-end">
        <div className="max-w-[85%] rounded-[12px_12px_2px_12px] bg-elevated px-3 py-2 text-sm leading-6 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <article className="max-w-[760px] animate-slide-up-fade text-sm leading-7 text-foreground">
      <p className="whitespace-pre-wrap break-words">{message.content}</p>
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
  contextPickerOpen,
  lastContextBundle,
  missingContextPaths,
  onAddContext,
  onTogglePinnedContext,
}: {
  projectName: string | null;
  currentFileLabel: string | null;
  disabled: boolean;
  onSubmit: (value: string) => void;
  explicitContextPaths: string[];
  contextCandidates: SemanticFile[];
  contextPickerOpen: boolean;
  lastContextBundle: ContextBundle | null;
  missingContextPaths: string[];
  onAddContext: () => void;
  onTogglePinnedContext: (path: string) => void;
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
            contextPickerOpen={contextPickerOpen}
            lastContextBundle={lastContextBundle}
            missingContextPaths={missingContextPaths}
            onAddContext={onAddContext}
            onTogglePinnedContext={onTogglePinnedContext}
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
