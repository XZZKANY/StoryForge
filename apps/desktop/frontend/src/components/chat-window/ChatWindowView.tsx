import { useRef, useState } from 'react';
import { emitToast } from '../../lib/toast';
import { ComposerBox } from './Composer';
import { ChapterBriefCard } from './ChapterBriefCard';
import { runLivePhaseText, runStatusText } from './display-utils';
import { LiveStatus } from '../shell/LiveStatus';
import {
  ContextSummaryPanel,
  ConversationHeader,
  LightweightStatus,
  MessageList,
  RunActionBar,
} from './panels';
import type { AgentRunControlHandlers, ChatWindowProps } from './types';
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import type { ChatWindowState } from './useChatWindowState';
import type { QueuedChatMessage } from './useChatSubmission';

type Props = {
  state: ChatWindowState;
  projectPath: ChatWindowProps['projectPath'];
  assistantSessionId: ChatWindowProps['assistantSessionId'];
  layoutMode: ChatWindowProps['layoutMode'];
  onSetLayoutMode: ChatWindowProps['onSetLayoutMode'];
  onOpenObservatory: ChatWindowProps['onOpenObservatory'];
  observatoryAttention: ChatWindowProps['observatoryAttention'];
  agentPermissionProfile: AgentPermissionProfile;
  onAgentPermissionProfileChange: (profile: AgentPermissionProfile) => void;
  handleSelectSession: (id: number) => void;
  handleNewSession: () => void;
  retryAssistantSessionLoad: () => void;
  retryContextCandidates: () => void;
  addExplicitContext: () => void;
  togglePinnedContext: (path: string) => void;
  handleSubmit: () => Promise<void>;
  handleComposerSubmit: (value: string) => Promise<void>;
  userMessageHistory: string[];
  conversationScope?: number;
  queuedMessages?: readonly QueuedChatMessage[];
  onRemoveQueuedMessage?: (id: number) => void;
  retryLastFailedRun: () => void;
  retryWritingRunSubscription: () => void;
  agentRunControls: AgentRunControlHandlers;
};

export function ChatWindowView({
  state,
  projectPath,
  assistantSessionId,
  layoutMode,
  onSetLayoutMode,
  onOpenObservatory,
  observatoryAttention,
  agentPermissionProfile,
  onAgentPermissionProfileChange,
  handleSelectSession,
  handleNewSession,
  retryAssistantSessionLoad,
  retryContextCandidates,
  addExplicitContext,
  togglePinnedContext,
  handleSubmit,
  userMessageHistory,
  conversationScope,
  queuedMessages = [],
  onRemoveQueuedMessage,
  retryLastFailedRun,
  retryWritingRunSubscription,
  agentRunControls,
}: Props) {
  const statusText = runStatusText(state.agentRun);
  // 待确认期间 agentBusy 已置 false、输入框可用；直接发新消息会静默顶掉当前 run，
  // 并让编辑器里尚未处理的补丁失去对应操作条。先完成本轮作者决策再允许发送。
  const awaitingConfirm = Boolean(state.chapterBrief) || state.agentRun?.status === 'waiting';
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // 会话加载错误条可关闭：按错误串记忆已关内容，新错误（含换会话）会重新出现；重试先摘标记。
  const [dismissedSessionError, setDismissedSessionError] = useState<string | null>(null);
  // 第14条：run 控制统一到 RunActionBar，运行/等待/暂停三态都显示操作条；completed 的
  // 「本轮已完成。」不再长驻（完成已在回复里）；只有 failed / stopped 留轻状态条收尾。
  const runStatus = state.agentRun?.status;
  const actionBarVisible =
    runStatus === 'running' || runStatus === 'waiting' || runStatus === 'paused';
  const showLightweightStatus =
    Boolean(statusText) && !actionBarVisible && runStatus !== 'completed';
  const composerPermissionProfile = state.agentBusy
    ? (state.agentRun?.permissionProfile ?? agentPermissionProfile)
    : agentPermissionProfile;
  const submitGuarded = async () => {
    if (state.agentRun?.deliveryUnknown) {
      emitToast('这轮结果未知，请先核对状态；不会重新执行。', { tone: 'info' });
      return;
    }
    if (awaitingConfirm) {
      emitToast(
        state.chapterBrief
          ? '先确认或取消 Chapter Brief，再发下一条'
          : '先处理下方待确认的修订（接受或拒绝），再发下一条',
        { tone: 'info' },
      );
      return;
    }
    await handleSubmit();
  };
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel">
      {/* D5 状态变化反馈：Agent 运行相位（运行 → 等待确认 → 暂停 → 终态）对读屏作者不可见。
          常驻 sr-only live region 播报相位级措辞；可见操作条/轻状态条原样保留。 */}
      <LiveStatus
        text={
          state.agentRun?.deliveryUnknown
            ? '本轮结果未知，请核对状态。'
            : runLivePhaseText(state.agentRun)
        }
        testid="agent-run-live"
        tone={state.agentRun?.status === 'failed' ? 'assertive' : 'polite'}
      />

      <ConversationHeader
        title={state.conversationTitle}
        sessions={state.assistantSessions}
        activeSessionId={assistantSessionId ?? null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        layoutMode={layoutMode}
        onSetLayoutMode={onSetLayoutMode}
        onOpenObservatory={onOpenObservatory}
        observatoryAttention={observatoryAttention}
      />

      {state.sessionLoadError && state.sessionLoadError !== dismissedSessionError && (
        <div
          className="flex flex-shrink-0 items-center gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning"
          data-testid="assistant-session-load-error"
        >
          <span className="flex-shrink-0 rounded-sm bg-warning/15 px-1.5 py-px text-3xs font-medium leading-4 text-warning">
            会话记录加载失败
          </span>
          <span className="min-w-0 flex-1 break-words">{state.sessionLoadError}</span>
          <button
            type="button"
            className="h-7 flex-shrink-0 rounded-md border border-warning px-2.5 text-xs transition-colors hover:bg-elevated"
            onClick={() => {
              setDismissedSessionError(null);
              retryAssistantSessionLoad();
            }}
            data-testid="assistant-session-load-retry"
          >
            重试
          </button>
          <button
            type="button"
            className="h-7 flex-shrink-0 rounded-md border border-warning px-2.5 text-xs transition-colors hover:bg-elevated"
            onClick={() => setDismissedSessionError(state.sessionLoadError)}
            data-testid="assistant-session-load-error-dismiss"
          >
            关闭
          </button>
        </div>
      )}

      <MessageList
        conversationScope={conversationScope ?? `${projectPath}:${assistantSessionId ?? 'draft'}`}
        messages={state.messages}
        agentRun={state.agentRun}
        agentRunRecovery={state.agentRunRecovery}
        writingRunProjection={state.writingRunProjection}
        onRetryWritingRunSubscription={retryWritingRunSubscription}
      />

      {state.chapterBrief && (
        <div className="flex-shrink-0 px-5 py-3">
          <div className="mx-auto w-full max-w-[800px]">
            <ChapterBriefCard
              brief={state.chapterBrief}
              onConfirm={agentRunControls.onConfirmChapterBrief ?? (() => undefined)}
              onCancel={agentRunControls.onDenyPermission}
            />
          </div>
        </div>
      )}

      {showLightweightStatus && statusText && (
        <LightweightStatus
          text={statusText}
          retryVisible={
            state.agentRun?.status === 'failed' &&
            state.retryRequest !== null &&
            !state.agentBusy &&
            !state.agentRunRecovery?.checkpointResume &&
            !state.agentRun?.deliveryUnknown
          }
          onRetry={retryLastFailedRun}
        />
      )}

      {state.agentRun && !state.chapterBrief && (
        <RunActionBar
          run={state.agentRun}
          controls={agentRunControls}
          recovery={state.agentRunRecovery}
          resumePending={state.agentBusy}
        />
      )}

      <ContextSummaryPanel
        compact
        currentFileLabel={state.contextRef}
        explicitContextPaths={state.explicitContextPaths}
        contextCandidates={state.contextCandidates}
        contextCandidatesLoading={state.contextCandidatesLoading}
        contextCandidatesError={state.contextCandidatesError}
        contextPickerOpen={state.contextPickerOpen}
        lastContextBundle={state.lastContextBundle}
        missingContextPaths={state.missingContextPaths}
        onAddContext={() => {
          addExplicitContext();
          // 显式关闭会移除面板按钮，回到原 Composer，不能把焦点丢给 body。
          if (state.contextPickerOpen) inputRef.current?.focus();
        }}
        onTogglePinnedContext={togglePinnedContext}
        onRetryContextCandidates={retryContextCandidates}
      />

      <ComposerBox
        key={conversationScope ?? `${projectPath}:${assistantSessionId ?? 'draft'}`}
        inputRef={inputRef}
        value={state.input}
        disabled={!projectPath}
        busy={state.agentBusy}
        currentFileLabel={state.contextRef}
        explicitContextPaths={state.explicitContextPaths}
        history={userMessageHistory}
        onAddContext={addExplicitContext}
        contextPickerOpen={state.contextPickerOpen}
        onTogglePinnedContext={togglePinnedContext}
        onChange={state.setInput}
        onSubmit={submitGuarded}
        permissionProfile={composerPermissionProfile}
        onPermissionProfileChange={onAgentPermissionProfileChange}
        queuedMessages={queuedMessages}
        onRemoveQueuedMessage={onRemoveQueuedMessage}
      />
    </div>
  );
}
