import { emitToast } from '../../lib/toast';
import { ComposerBox } from './Composer';
import { ChapterBriefCard } from './ChapterBriefCard';
import { runStatusText } from './display-utils';
import { ConversationHeader, LightweightStatus, MessageList, RunActionBar } from './panels';
import type { AgentRunControlHandlers, ChatWindowProps } from './types';
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import type { ChatWindowState } from './useChatWindowState';

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
  retryLastFailedRun: () => void;
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
  retryLastFailedRun,
  agentRunControls,
}: Props) {
  const statusText = runStatusText(state.agentRun);
  // chapterBrief 待确认期间 agentBusy 已置 false、输入框可用；直接发新消息会静默顶掉待确认轮，
  // 故拦一道。补丁待确认已由下方 RunActionBar 就地处理，不再拦截作者发送。
  const awaitingConfirm = Boolean(state.chapterBrief);
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
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
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

      {state.sessionLoadError && (
        <div
          className="flex flex-shrink-0 items-center gap-3 border-b border-warning bg-panel px-4 py-2 text-xs text-warning"
          data-testid="assistant-session-load-error"
        >
          <span className="min-w-0 flex-1 break-words">{state.sessionLoadError}</span>
          <button
            type="button"
            className="h-7 flex-shrink-0 rounded-md border border-warning px-2.5 text-xs hover:bg-elevated"
            onClick={retryAssistantSessionLoad}
            data-testid="assistant-session-load-retry"
          >
            重试
          </button>
        </div>
      )}

      <MessageList
        messages={state.messages}
        projectName={state.projectName}
        currentFileLabel={state.contextRef}
        agentRun={state.agentRun}
        agentRunRecovery={state.agentRunRecovery}
        writingRunProjection={state.writingRunProjection}
        explicitContextPaths={state.explicitContextPaths}
        contextCandidates={state.contextCandidates}
        contextCandidatesLoading={state.contextCandidatesLoading}
        contextCandidatesError={state.contextCandidatesError}
        contextPickerOpen={state.contextPickerOpen}
        lastContextBundle={state.lastContextBundle}
        missingContextPaths={state.missingContextPaths}
        onAddContext={addExplicitContext}
        onTogglePinnedContext={togglePinnedContext}
        onRetryContextCandidates={retryContextCandidates}
      />

      {state.chapterBrief && (
        <div className="flex-shrink-0 border-t border-border bg-background px-5 py-3">
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
            state.agentRun?.status === 'failed' && state.retryRequest !== null && !state.agentBusy
          }
          onRetry={retryLastFailedRun}
        />
      )}

      {state.agentRun && !state.chapterBrief && (
        <RunActionBar run={state.agentRun} controls={agentRunControls} />
      )}

      <ComposerBox
        value={state.input}
        disabled={!projectPath}
        busy={state.agentBusy}
        currentFileLabel={state.contextRef}
        explicitContextPaths={state.explicitContextPaths}
        history={userMessageHistory}
        onAddContext={addExplicitContext}
        onTogglePinnedContext={togglePinnedContext}
        onChange={state.setInput}
        onSubmit={submitGuarded}
        permissionProfile={composerPermissionProfile}
        onPermissionProfileChange={onAgentPermissionProfileChange}
      />
    </div>
  );
}
