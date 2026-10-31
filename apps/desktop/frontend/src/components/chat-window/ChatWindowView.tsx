import { useRef, useState } from 'react';
import { emitToast } from '../../lib/toast';
import { ComposerBox } from './Composer';
import { ChapterBriefCard } from './ChapterBriefCard';
import { IconButton } from '../ui';
import { Layers } from '../icons/shell-icons';
import { ChatSideRail } from './ChatSideRail';
import { ContextPanelToggle } from './ContextPanel';
import { CHAT_COLUMN } from './column';
import { isAuthorRejection, runLivePhaseText, runStatusText } from './display-utils';
import { LiveStatus } from '../shell/LiveStatus';
import { ContextSummaryPanel } from './ContextSummaryPanel';
import { ConversationHeader, LightweightStatus, MessageList, RunActionBar } from './panels';
import type { AgentRunControlHandlers, ChatWindowProps } from './types';
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import type { AssistantSessionRecord } from '../../lib/api-client';
import type { ChatWindowState } from './useChatWindowState';
import type { QueuedChatMessage, WriteBatchRequest } from './useChatSubmission';
import { WriteBatchPanel, WriteBatchProgressBar } from './WriteBatchPanel';
import type { WriteBatchStartFeedback } from './WriteBatchCard';
import type { WriteBatchScheduler } from './useWriteBatchScheduler';
import { useChatSideRail } from './useChatSideRail';
import type { ApiWriteBatchPlan } from '../../lib/api/contracts';
import { ChapterCheckHistoryToggle } from './ChapterCheckHistoryPanel';
import type { ChapterCheckHistoryState } from './useChapterCheckHistory';
import { PartnerOpening } from './PartnerOpening';
import type { ChapterHandoff } from '../../lib/chapter-handoff';
import type { ChapterWriteRequest } from '../../lib/assistant-events';

type Props = {
  state: ChatWindowState;
  chapterCheckHistory?: ChapterCheckHistoryState;
  projectPath: ChatWindowProps['projectPath'];
  assistantSessionId: ChatWindowProps['assistantSessionId'];
  layoutMode: ChatWindowProps['layoutMode'];
  onSetLayoutMode: ChatWindowProps['onSetLayoutMode'];
  onOpenObservatory: ChatWindowProps['onOpenObservatory'];
  observatoryAttention: ChatWindowProps['observatoryAttention'];
  agentPermissionProfile: AgentPermissionProfile;
  onAgentPermissionProfileChange: (profile: AgentPermissionProfile) => void;
  onOpenSettings?: ChatWindowProps['onOpenSettings'];
  handleSelectSession: (id: number) => void;
  handleNewSession: () => void;
  /** 列表里该显示的会话（已移除的藏掉）；缺省用全部。 */
  sessions?: AssistantSessionRecord[];
  onRenameSession?: (id: number, title: string) => void | Promise<void | boolean>;
  onRemoveSession?: (id: number) => void;
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
  agentRunControls: AgentRunControlHandlers;
  /** 新会话开场「接着写」；null 时对话区保持空白。 */
  opening?: ChapterHandoff | null;
  onOpeningDraft?: (request: ChapterWriteRequest) => void;
  /** 输入框空着时的「下一句」提示（`lib/composer-hint.ts`）；null 时用原占位文字。 */
  composerHint?: string | null;
  /** 对话里打的 `/写 …`：在下面出批量写章确认卡。 */
  writeBatch?: WriteBatchRequest | null;
  onCloseWriteBatch?: () => void;
  /** 卡上「开始写」交给它；没接时按钮禁用。 */
  onStartWriteBatch?: (plan: ApiWriteBatchPlan) => Promise<WriteBatchStartFeedback>;
  /** 批量写章调度器：进行中的进度条、续写确认卡、停下或写完的卡。 */
  writeBatchScheduler?: WriteBatchScheduler;
};

export function ChatWindowView({
  state,
  chapterCheckHistory,
  projectPath,
  assistantSessionId,
  layoutMode,
  onSetLayoutMode,
  onOpenObservatory,
  observatoryAttention,
  agentPermissionProfile,
  onAgentPermissionProfileChange,
  onOpenSettings,
  handleSelectSession,
  handleNewSession,
  sessions,
  onRenameSession,
  onRemoveSession,
  retryAssistantSessionLoad,
  retryContextCandidates,
  addExplicitContext,
  togglePinnedContext,
  handleSubmit,
  handleComposerSubmit,
  userMessageHistory,
  conversationScope,
  queuedMessages = [],
  onRemoveQueuedMessage,
  retryLastFailedRun,
  agentRunControls,
  opening = null,
  onOpeningDraft,
  composerHint = null,
  writeBatch = null,
  onCloseWriteBatch,
  onStartWriteBatch,
  writeBatchScheduler,
}: Props) {
  const statusText = runStatusText(state.agentRun);
  // 待确认期间 agentBusy 已置 false、输入框可用；直接发新消息会静默顶掉当前 run，
  // 并让编辑器里尚未处理的补丁失去对应操作条。先完成本轮作者决策再允许发送。
  const awaitingConfirm = Boolean(state.chapterBrief) || state.agentRun?.status === 'waiting';
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 对话占满中右且够宽：批量写章进度、参考资料、上下文进右边侧栏，输入框顶边小条和对话头浮窗就不再放它们。
  const sideRail = useChatSideRail(rootRef, layoutMode === 'chat');
  const batchProgress =
    writeBatchScheduler?.phase.kind === 'running' ? writeBatchScheduler.phase.progress : null;
  const references = (variant: 'dock' | 'rail' | 'picker') => (
    <ContextSummaryPanel
      variant={variant}
      compact={variant === 'dock'}
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
  );
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
          ? '先确认或取消上面的章纲，再发下一条'
          : '先在上面选好这版修订要不要，再发下一条',
        { tone: 'info' },
      );
      return;
    }
    await handleSubmit();
  };
  return (
    <div ref={rootRef} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel">
      {/* D5 状态变化反馈：Agent 运行相位（运行 → 等待确认 → 暂停 → 终态）对读屏作者不可见。
          常驻 sr-only live region 播报相位级措辞；可见操作条/轻状态条原样保留。 */}
      <LiveStatus
        text={
          state.agentRun?.deliveryUnknown
            ? '本轮结果未知，请核对状态。'
            : runLivePhaseText(state.agentRun)
        }
        testid="agent-run-live"
        tone={
          state.agentRun?.status === 'failed' && !isAuthorRejection(state.agentRun)
            ? 'assertive'
            : 'polite'
        }
      />

      <ConversationHeader
        title={state.conversationTitle}
        sessions={sessions ?? state.assistantSessions}
        activeSessionId={assistantSessionId ?? null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onRenameSession={onRenameSession}
        onRemoveSession={onRemoveSession}
        layoutMode={layoutMode}
        onSetLayoutMode={onSetLayoutMode}
        onOpenObservatory={onOpenObservatory}
        observatoryAttention={observatoryAttention}
        checkHistoryToggle={
          chapterCheckHistory ? (
            <ChapterCheckHistoryToggle history={chapterCheckHistory} />
          ) : undefined
        }
        contextToggle={
          sideRail.available ? (
            <IconButton
              type="button"
              onClick={sideRail.toggle}
              data-testid="conversation-side-rail-toggle"
              size="xs"
              className={sideRail.open ? 'relative bg-elevated' : 'relative'}
              aria-pressed={sideRail.open}
              label={sideRail.open ? '收起侧栏' : '展开侧栏'}
              tooltip={
                sideRail.open ? '收起侧栏' : '展开侧栏：批量写章进度、参考资料、长期规矩与技能'
              }
              icon={<Layers size={14} strokeWidth={1.6} />}
            />
          ) : (
            <ContextPanelToggle
              projectPath={projectPath}
              run={state.agentRun}
              onOpenSettings={onOpenSettings}
            />
          )
        }
      />

      {state.sessionLoadError && state.sessionLoadError !== dismissedSessionError && (
        <div
          className="flex-shrink-0 border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning"
          data-testid="assistant-session-load-error"
        >
          <div className={`${CHAT_COLUMN} flex items-center gap-3`}>
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
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MessageList
            conversationScope={
              conversationScope ?? `${projectPath}:${assistantSessionId ?? 'draft'}`
            }
            messages={state.messages}
            agentRun={state.agentRun}
            agentRunRecovery={state.agentRunRecovery}
            onRegenerate={
              state.agentBusy ? undefined : (userText) => void handleComposerSubmit(userText)
            }
            emptyState={
              opening && onOpeningDraft ? (
                <PartnerOpening
                  handoff={opening}
                  onDraft={onOpeningDraft}
                  onAsk={(prompt) => void handleComposerSubmit(prompt)}
                  actionsHidden={writeBatch !== null || Boolean(writeBatchScheduler?.occupied)}
                />
              ) : null
            }
          />

          {/* 要作者拍板的事一次只在这里出一件（章纲、权限、补丁），不弹居中窗口、不盖住编辑器。 */}
          {state.chapterBrief && (
            <section
              className="max-h-[60%] flex-shrink-0 overflow-y-auto px-5 py-3"
              aria-label="确认章纲后开始起草"
              data-testid="chapter-brief-decision"
            >
              <div className={CHAT_COLUMN}>
                <ChapterBriefCard
                  key={`${state.chapterBrief.briefId}:${state.chapterBrief.revision}`}
                  brief={state.chapterBrief}
                  onConfirm={agentRunControls.onConfirmChapterBrief ?? (() => undefined)}
                  // 取消就是停掉这一轮：章纲待确认时后端不认「拒绝」，那个「拒绝」只会落到之后的补丁上。
                  onCancel={agentRunControls.onStopRun}
                  busy={state.agentBusy}
                />
              </div>
            </section>
          )}

          <WriteBatchPanel
            projectPath={projectPath}
            permissionProfile={agentPermissionProfile}
            request={writeBatch}
            scheduler={writeBatchScheduler}
            onStart={onStartWriteBatch}
            onClose={onCloseWriteBatch ?? (() => undefined)}
          />

          {showLightweightStatus && statusText && (
            <LightweightStatus
              text={statusText}
              retryVisible={
                state.agentRun?.status === 'failed' &&
                !isAuthorRejection(state.agentRun) &&
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
              onTypeAhead={() => inputRef.current?.focus()}
            />
          )}

          <ComposerBox
            dock={
              sideRail.visible ? (
                references('picker')
              ) : (
                <>
                  {batchProgress && writeBatchScheduler && (
                    <WriteBatchProgressBar
                      progress={batchProgress}
                      onStop={writeBatchScheduler.stop}
                    />
                  )}
                  {references('dock')}
                </>
              )
            }
            key={conversationScope ?? `${projectPath}:${assistantSessionId ?? 'draft'}`}
            inputRef={inputRef}
            value={state.input}
            disabled={!projectPath}
            busy={state.agentBusy}
            explicitContextPaths={state.explicitContextPaths}
            history={userMessageHistory}
            onAddContext={addExplicitContext}
            contextPickerOpen={state.contextPickerOpen}
            onTogglePinnedContext={togglePinnedContext}
            onChange={state.setInput}
            onSubmit={submitGuarded}
            permissionProfile={composerPermissionProfile}
            onPermissionProfileChange={onAgentPermissionProfileChange}
            projectPath={projectPath}
            onOpenSettings={onOpenSettings}
            queuedMessages={queuedMessages}
            onRemoveQueuedMessage={onRemoveQueuedMessage}
            onStop={
              // 恢复请求等最终结果才更新状态；期间仍可能是 waiting（章纲）或 paused。
              state.agentBusy && actionBarVisible ? agentRunControls.onStopRun : undefined
            }
            hint={composerHint}
          />
        </div>
        {sideRail.visible && (
          <ChatSideRail
            projectPath={projectPath}
            run={state.agentRun}
            writeBatch={batchProgress}
            onStopWriteBatch={writeBatchScheduler?.stop ?? (() => undefined)}
            references={references('rail')}
            onOpenSettings={onOpenSettings}
          />
        )}
      </div>
    </div>
  );
}
