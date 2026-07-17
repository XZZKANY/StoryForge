import { ComposerBox } from './Composer';
import { runStatusText } from './display-utils';
import { ConversationHeader, LightweightStatus, MessageList } from './panels';
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
        agentRunControls={agentRunControls}
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
          onSubmit={handleSubmit}
          onPauseRun={agentRunControls.onPauseRun}
        />
      )}
    </div>
  );
}
