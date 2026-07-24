import { emitToast } from '../../lib/toast';
import { ComposerBox } from './Composer';
import { runStatusText } from './display-utils';
import { ConversationHeader, LightweightStatus, MessageList, RunActionBar } from './panels';
import type { AgentRunControlHandlers, ChatWindowProps } from './types';
import type { ChatWindowState } from './useChatWindowState';

type Props = {
  state: ChatWindowState;
  projectPath: ChatWindowProps['projectPath'];
  assistantSessionId: ChatWindowProps['assistantSessionId'];
  layoutMode: ChatWindowProps['layoutMode'];
  onSetLayoutMode: ChatWindowProps['onSetLayoutMode'];
  onOpenObservatory: ChatWindowProps['onOpenObservatory'];
  observatoryAttention: ChatWindowProps['observatoryAttention'];
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
  handleSelectSession,
  handleNewSession,
  retryAssistantSessionLoad,
  retryContextCandidates,
  addExplicitContext,
  togglePinnedContext,
  handleSubmit,
  handleComposerSubmit,
  userMessageHistory,
  retryLastFailedRun,
  agentRunControls,
}: Props) {
  const statusText = runStatusText(state.agentRun);
  // 待确认（补丁 / 权限）期间 agentBusy 已置 false、输入框可用；直接发新消息会静默顶掉待确认轮，
  // 故拦一道：提示先处理待确认的修订，不静默 supersede（放弃走编辑器里拒绝补丁 / 拒绝权限）。
  const awaitingConfirm = state.agentRun?.status === 'waiting';
  const submitGuarded = async () => {
    if (awaitingConfirm) {
      emitToast('先在编辑器里处理待确认的修订（接受或拒绝），再发下一条', { tone: 'info' });
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
        disabled={!projectPath || state.agentBusy}
        onSubmit={handleComposerSubmit}
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

      {statusText && (
        <LightweightStatus
          text={statusText}
          retryVisible={
            state.agentRun?.status === 'failed' && state.retryRequest !== null && !state.agentBusy
          }
          onRetry={retryLastFailedRun}
        />
      )}

      {state.agentRun && <RunActionBar run={state.agentRun} controls={agentRunControls} />}

      {state.messages.length > 0 && (
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
          onPauseRun={agentRunControls.onPauseRun}
        />
      )}
    </div>
  );
}
