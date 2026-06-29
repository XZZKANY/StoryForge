import { useState } from 'react';

import { semanticKindLabel, type ContextBundle, type SemanticFile } from '../../lib/project-context';
import { AgentStepsPanel } from '../AgentStepsPanel';
import { ComposerSurface } from './Composer';
import { contextBudgetText, selectedContextPreview } from './display-utils';
import type { AgentRunRecoveryDisplay } from './recovery';
import { reviewCategoryLabel } from './review';
import type {
  AgentRun,
  AgentRunControlHandlers,
  Message,
  ReviewCategory,
  ReviewIssue,
  WritingRunProjection,
} from './types';

export function ConversationHeader({ title }: { title: string }) {
  return (
    <header className="flex h-10 flex-shrink-0 items-center gap-3 border-b border-[#3A3A40] bg-[#202024] px-4">
      <h1 className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#EDEDED]">{title}</h1>
      <button
        type="button"
        className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-[#A8A8B0] transition-colors hover:bg-[#2A2A30] hover:text-[#EDEDED]"
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
  reviewIssues,
  onReviseIssue,
  onReviseIssues,
  onReviseCategory,
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
  reviewIssues: ReviewIssue[];
  onReviseIssue: (issue: ReviewIssue) => void;
  onReviseIssues: (issues: ReviewIssue[]) => void;
  onReviseCategory: (category: ReviewCategory) => void;
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

        {reviewIssues.length > 0 && (
          <ReviewIssueActions
            issues={reviewIssues}
            onReviseIssue={onReviseIssue}
            onReviseIssues={onReviseIssues}
            onReviseCategory={onReviseCategory}
          />
        )}
      </div>
    </div>
  );
}

export function AgentRunRecoveryPanel({
  recovery,
}: {
  recovery: AgentRunRecoveryDisplay | null;
}) {
  if (!recovery) return null;
  const toneClass = recoveryToneClass(recovery.tone);
  return (
    <section
      className={`rounded-md border px-3 py-2 ${toneClass}`}
      data-testid="agent-run-recovery"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="truncate text-xs font-semibold text-[#EDEDED]">
          {recovery.statusText}；{recovery.resumeText}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#A8A8B0]">
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
  if (tone === 'error') return 'border-[#5A2F2F] bg-[#251D1F]';
  if (tone === 'waiting') return 'border-[#5F5238] bg-[#272418]';
  if (tone === 'ok') return 'border-[#3B5F47] bg-[#1E2A22]';
  return 'border-[#333338] bg-[#202024]';
}

export function ReviewIssueActions({
  issues,
  onReviseIssue,
  onReviseIssues,
  onReviseCategory,
}: {
  issues: ReviewIssue[];
  onReviseIssue: (issue: ReviewIssue) => void;
  onReviseIssues: (issues: ReviewIssue[]) => void;
  onReviseCategory: (category: ReviewCategory) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<ReviewCategory | 'all'>('all');
  const categories = Array.from(new Set(issues.map((issue) => issue.category)));
  const visibleIssues =
    categoryFilter === 'all' ? issues : issues.filter((issue) => issue.category === categoryFilter);
  const selectedIssues = issues.filter((issue) => selectedIds.has(issue.id));
  const toggleIssue = (issueId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  };
  return (
    <section
      className="animate-slide-up-fade border-t border-[#333338] pt-4"
      data-testid="review-issue-actions"
    >
      <div className="mb-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={`h-7 rounded-md border px-2.5 text-xs ${categoryFilter === 'all' ? 'border-[#7FB1FF] bg-[#253044] text-[#EAF2FF]' : 'border-[#45454C] text-[#D8D8DD] hover:bg-[#2A2A30]'}`}
          onClick={() => setCategoryFilter('all')}
          data-testid="review-category-all"
        >
          全部
        </button>
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            className={`h-7 rounded-md border px-2.5 text-xs ${categoryFilter === category ? 'border-[#7FB1FF] bg-[#253044] text-[#EAF2FF]' : 'border-[#45454C] text-[#D8D8DD] hover:bg-[#2A2A30]'}`}
            onClick={() => setCategoryFilter(category)}
            data-testid={`review-category-${category}`}
          >
            {reviewCategoryLabel(category)}
          </button>
        ))}
        {categories.map((category) => (
          <button
            key={`revise-${category}`}
            type="button"
            className="h-7 rounded-md border border-[#45454C] px-2.5 text-xs text-[#D8D8DD] hover:bg-[#2A2A30]"
            onClick={() => onReviseCategory(category)}
            data-testid={`review-revise-category-${category}`}
          >
            只修{reviewCategoryLabel(category)}
          </button>
        ))}
        <button
          type="button"
          className="h-7 rounded-md bg-[#E6E6E6] px-2.5 text-xs text-[#111111] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={selectedIssues.length === 0}
          onClick={() => onReviseIssues(selectedIssues)}
          data-testid="review-revise-selected"
        >
          修选中问题
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {visibleIssues.map((issue) => (
          <div
            key={issue.id}
            className="rounded-md border border-[#333338] bg-[#202024] px-3 py-2"
            data-testid="review-issue"
            data-issue-id={issue.id}
          >
            <div className="flex min-w-0 items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 flex-shrink-0"
                checked={selectedIds.has(issue.id)}
                onChange={() => toggleIssue(issue.id)}
                aria-label={`选择 ${issue.id}`}
                data-testid="review-issue-checkbox"
                data-issue-id={issue.id}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-[#EDEDED]">
                  {issue.id} · {reviewCategoryLabel(issue.category)} · {issue.severity}
                </div>
                <p className="mt-1 text-xs leading-5 text-[#CFCFD4]">{issue.message}</p>
                <p className="mt-1 text-xs leading-5 text-[#92929A]">{issue.suggestedAction}</p>
              </div>
              <button
                type="button"
                className="h-7 flex-shrink-0 rounded-md bg-[#E6E6E6] px-2.5 text-xs text-[#111111] hover:bg-white"
                onClick={() => onReviseIssue(issue)}
              >
                只修此条
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
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
  const canPause = run.status === 'running';
  const canResume = run.status === 'waiting' && !waitingForPermission;
  const canStop = run.status === 'running' || run.status === 'waiting';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#333338] bg-[#202024] px-3 py-2">
      <div className="min-w-0 flex-1 text-xs text-[#A8A8B0]">AgentRun #{run.id}</div>
      {waitingForPermission && (
        <>
          <button
            type="button"
            className="h-7 rounded-md bg-[#E6E6E6] px-2.5 text-xs text-[#111111] hover:bg-white"
            onClick={controls.onApprovePermission}
            title="批准权限请求"
          >
            批准
          </button>
          <button
            type="button"
            className="h-7 rounded-md border border-[#5A2F2F] px-2.5 text-xs text-[#FFB8B0] hover:bg-[#3A1F1F]"
            onClick={controls.onDenyPermission}
            title="拒绝权限请求"
          >
            拒绝
          </button>
        </>
      )}
      <button
        type="button"
        className="h-7 rounded-md border border-[#45454C] px-2.5 text-xs text-[#D8D8DD] hover:bg-[#2A2A30] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={controls.onPauseRun}
        disabled={!canPause}
        title="暂停 AgentRun"
      >
        暂停
      </button>
      <button
        type="button"
        className="h-7 rounded-md border border-[#45454C] px-2.5 text-xs text-[#D8D8DD] hover:bg-[#2A2A30] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={controls.onResumeRun}
        disabled={!canResume}
        title="恢复 AgentRun"
      >
        恢复
      </button>
      <button
        type="button"
        className="h-7 rounded-md border border-[#5A2F2F] px-2.5 text-xs text-[#FFB8B0] hover:bg-[#3A1F1F] disabled:cursor-not-allowed disabled:opacity-40"
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
      className="animate-slide-up-fade rounded-md border border-[#333338] bg-[#202024] px-3 py-2"
      data-testid="writing-run-progress"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-[#EDEDED]">
            写作任务 #{projection.writingRunId} · {projection.status}
          </div>
          <div className="mt-1 truncate text-xs text-[#92929A]">
            章节：{chapters}；最近事件：{projection.latestEvent}
            {projection.currentChapterIndex !== null
              ? `；当前第 ${projection.currentChapterIndex} 章`
              : ''}
          </div>
        </div>
        <span className="rounded-md border border-[#3E4B64] px-2 py-1 text-xs text-[#D8E7FF]">
          managed
        </span>
      </div>
      {projection.failureReason && (
        <div className="mt-2 text-xs text-[#FFB86B]" data-testid="writing-run-failure-reason">
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
      className="animate-slide-up-fade rounded-md border border-[#333338] bg-[#202024] px-3 py-2"
      data-testid="context-summary"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-[#EDEDED]">
            {contextBudgetText(lastContextBundle)}
          </div>
          <div className="mt-1 truncate text-xs text-[#92929A]">
            当前：{currentFileLabel ?? '未选择文件'}；已选：
            {selectedContextPreview(lastContextBundle)}
          </div>
        </div>
        <button
          type="button"
          className="h-7 flex-shrink-0 rounded-md border border-[#45454C] px-2.5 text-xs text-[#D8D8DD] hover:bg-[#2A2A30]"
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
              className="max-w-full truncate rounded-md border border-[#3E4B64] bg-[#253044] px-2 py-1 text-xs text-[#D8E7FF] hover:bg-[#2F3C55]"
              title="取消 pin"
              onClick={() => onTogglePinnedContext(path)}
            >
              pin {path}
            </button>
          ))}
        </div>
      )}

      {missingContextPaths.length > 0 && (
        <div className="mt-2 text-xs text-[#FFB86B]" data-testid="missing-context-warning">
          未读到：{missingContextPaths.join('、')}
        </div>
      )}

      {contextPickerOpen && (
        <div
          className="mt-3 grid max-h-52 grid-cols-1 gap-1 overflow-y-auto border-t border-[#333338] pt-2"
          data-testid="context-picker"
        >
          {visibleCandidates.length === 0 ? (
            <div className="px-2 py-1 text-xs text-[#92929A]">
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
                    pinned ? 'bg-[#2F3C55] text-[#EAF2FF]' : 'text-[#CFCFD4] hover:bg-[#2A2A30]'
                  }`}
                  onClick={() => onTogglePinnedContext(file.relativePath)}
                  data-testid="context-candidate"
                  data-context-path={file.relativePath}
                >
                  <span className="w-10 flex-shrink-0 text-[#92929A]">
                    {semanticKindLabel(file.kind)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{file.relativePath}</span>
                  <span className="flex-shrink-0 text-[#8F8F8F]">{pinned ? 'pinned' : 'pin'}</span>
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
      <div className="flex justify-end animate-slide-up-fade">
        <div className="max-w-[68%] rounded-lg bg-[#262626] px-3.5 py-2.5 text-sm leading-6 text-[#EDEDED]">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <article className="max-w-[760px] animate-slide-up-fade">
      <div className="mb-2 text-xs font-medium text-[#AFAFAF]">StoryForge</div>
      <div className="text-sm leading-7 text-[#E6E6E6]">
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
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
          <div className="text-[13px] font-medium text-[#EDEDED]">StoryForge</div>
          <div className="mt-1 truncate text-xs text-[#8F8F8F]">
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
    <div className="flex-shrink-0 border-t border-[#333338] bg-[#202024] px-5 py-2">
      <div className="mx-auto flex max-w-[800px] items-center gap-3">
        <div className="min-w-0 flex-1 truncate text-xs text-[#A8A8B0]">{text}</div>
        {retryVisible && (
          <button
            type="button"
            className="h-7 flex-shrink-0 rounded-md border border-[#4A4A52] px-2.5 text-xs text-[#EDEDED] hover:bg-[#2A2A30]"
            onClick={onRetry}
          >
            重试本轮
          </button>
        )}
      </div>
    </div>
  );
}
