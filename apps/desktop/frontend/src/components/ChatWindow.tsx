/**
 * 对话窗口
 * 显示完整的消息历史流，并驱动 Agent 作者闭环。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  AUTHOR_LOOP_RESULT_EVENT,
  emitExportCurrentFile,
  emitFileSuggestion,
  emitSuggestionResult,
  REVIEW_CURRENT_EVENT,
  SUGGESTION_RESULT_EVENT,
  type AuthorLoopResult,
  type SuggestionResult,
} from '../lib/assistant-events';
import { createRemoteFileSuggestion } from '../lib/assistant-suggestions';
import {
  getAssistantSession,
  sendAgentUserMessage,
  toAssistantContextBundlePayload,
  isAgentErrorMessage,
  isAgentResultMessage,
  type AgentPlanStep,
  type AgentResultMessage,
  type AgentToolTrace,
} from '../lib/api-client';
import { buildContextBundle } from '../lib/project-context';
import { TauriFileSystem } from '../lib/tauri-fs';
import { AgentStepsPanel } from './AgentStepsPanel';

type ChatWindowProps = {
  projectPath: string | null;
  currentFile: string | null;
  assistantSessionId?: number | null;
  layoutMode?: 'normal' | 'custom' | 'assistant-only' | 'workspace-only';
  onCollapse?: () => void;
  onFocusOnly?: () => void;
  onRestoreLayout?: () => void;
  onAssistantSessionChange?: (assistantSessionId: number | null) => void;
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type AgentStepStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed';

type AgentStep = {
  id: string;
  title: string;
  tool: string;
  status: AgentStepStatus;
  detail: string;
};

type AgentRun = {
  id: string;
  goal: string;
  status: 'running' | 'waiting' | 'completed' | 'failed';
  steps: AgentStep[];
};

type ConversationIntent = 'chat.explain' | 'file.revise' | 'file.export';

type RetryRequest = {
  goal: string;
  intent: ConversationIntent;
};

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function relativePath(projectPath: string | null, filePath: string): string {
  if (!projectPath) return basename(filePath);
  const root = projectPath.replace(/[/\\]+$/, '');
  if (filePath.startsWith(root)) {
    return filePath.slice(root.length).replace(/^[/\\]+/, '');
  }
  return basename(filePath);
}

function mapAgentStepStatus(status: string): AgentStepStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'needs_approval' || status === 'paused') return 'waiting';
  if (status === 'running') return 'running';
  return 'pending';
}

function planStepTitle(step: string): string {
  const titleByStep: Record<string, string> = {
    intent: '识别意图',
    respond: '生成回答',
    revise: '生成修订',
    approval: '等待作者确认',
    load_scene_packet: '读取场景包',
    'judge.run': '运行 Judge',
    'judge.repair': '生成修复建议',
    'bookrun.start': '启动 BookRun',
    audit: '记录审计',
  };
  return titleByStep[step] ?? step;
}

function toolTraceDetail(trace: AgentToolTrace): string {
  if (trace.error_message) return trace.error_message;
  const output = trace.output_summary ?? {};
  const audit = trace.audit_event_id ? `；审计 ${trace.audit_event_id}` : '';
  const model = typeof output.model === 'string' ? `；模型 ${output.model}` : '';
  const latency = typeof output.latency_ms === 'number' ? `；${output.latency_ms}ms` : '';
  return `${trace.status}${model}${latency}${audit}`;
}

function stepsFromAgentResult(message: AgentResultMessage): AgentStep[] {
  const planSteps = message.plan.map((step: AgentPlanStep, index) => ({
    id: `plan-${index}-${step.step}`,
    title: planStepTitle(step.step),
    tool: step.step,
    status: mapAgentStepStatus(step.status),
    detail: step.detail,
  }));
  const toolSteps = message.tool_trace.map((trace: AgentToolTrace, index) => ({
    id: `tool-${index}-${trace.tool_name}`,
    title: trace.tool_name,
    tool: trace.tool_name,
    status: mapAgentStepStatus(trace.status),
    detail: toolTraceDetail(trace),
  }));
  return [...planSteps, ...toolSteps];
}

function fileRevisionPatch(message: AgentResultMessage): {
  file_path: string;
  before: string;
  after: string;
} | null {
  const patch = message.proposed_patch;
  if (!patch || patch.kind !== 'file_revision') return null;
  if (
    typeof patch.file_path === 'string'
    && typeof patch.before === 'string'
    && typeof patch.after === 'string'
  ) {
    return { file_path: patch.file_path, before: patch.before, after: patch.after };
  }
  return null;
}

function modelFromToolTrace(message: AgentResultMessage): string {
  for (const trace of message.tool_trace) {
    const model = trace.output_summary?.model;
    if (typeof model === 'string' && model.trim()) return model;
  }
  return 'StoryForge Agent';
}

function deriveConversationTitle(text: string): string {
  const compact = text
    .replace(/\s+/g, '')
    .replace(/[，。！？!?；;：:,.、]/g, '')
    .trim();
  if (!compact) return '新的创作会话';

  const title = compact
    .replace(/^请?帮我?/, '')
    .replace(/^我想/, '')
    .slice(0, 12);
  return title || '新的创作会话';
}

function toConversationMessage(role: string, content: string): Message | null {
  if (role !== 'user' && role !== 'assistant') return null;
  return { role, content };
}

function compactConversationMessages(messages: Array<{ role: string; content: string }>): Message[] {
  return messages
    .map((message) => toConversationMessage(message.role, message.content))
    .filter((message): message is Message => message !== null);
}

function detectConversationIntent(text: string): ConversationIntent {
  if (/导出|交付|发布/.test(text) && !/修|改|审|润|检查|问题|一致|节奏|结构/.test(text)) {
    return 'file.export';
  }
  if (/写回|应用|保存|直接改|直接修|改写|修订|润色|生成diff|给我一版diff|给一版diff/.test(text)) {
    return 'file.revise';
  }
  return 'chat.explain';
}

function runStatusText(run: AgentRun | null): string | null {
  if (!run) return null;
  if (run.status === 'waiting') return '等待确认：需要你在右侧 diff 或导出动作里确认。';
  if (run.status === 'completed') return '本轮已完成。';
  if (run.status === 'failed') return '本轮遇到问题，详情在回复里。';

  const active = run.steps.find((step) => step.status === 'running')
    ?? run.steps.find((step) => step.status === 'waiting')
    ?? run.steps.find((step) => step.status === 'pending');
  if (!active) return '正在整理这一轮回复。';
  if (active.id === 'context') return active.detail.startsWith('读取') ? active.detail : `正在读取：${active.detail}`;
  if (active.id === 'draft') return `正在读取：${active.detail.replace(/^读取\s*/, '')}`;
  if (active.id === 'orchestrate') return '正在整理：创作判断与下一步建议';
  return active.detail || active.title;
}

export function ChatWindow({
  projectPath,
  currentFile,
  assistantSessionId,
  layoutMode: _layoutMode = 'normal',
  onCollapse: _onCollapse,
  onFocusOnly: _onFocusOnly,
  onRestoreLayout: _onRestoreLayout,
  onAssistantSessionChange,
}: ChatWindowProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  const [conversationTitle, setConversationTitle] = useState('新的创作会话');

  const projectName = projectPath ? basename(projectPath) : null;
  const contextRef = currentFile ? relativePath(projectPath, currentFile) : null;

  const contextRefRef = useRef<string | null>(contextRef);
  const currentFileRef = useRef<string | null>(currentFile);
  const projectPathRef = useRef<string | null>(projectPath);
  const agentRunIdRef = useRef<string | null>(null);
  const assistantSessionIdRef = useRef<number | null>(assistantSessionId ?? null);
  contextRefRef.current = contextRef;
  currentFileRef.current = currentFile;
  projectPathRef.current = projectPath;
  assistantSessionIdRef.current = assistantSessionId ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!assistantSessionId) {
      setMessages([]);
      setConversationTitle('新的创作会话');
      return () => {
        cancelled = true;
      };
    }

    void getAssistantSession(assistantSessionId)
      .then((session) => {
        if (cancelled) return;
        setConversationTitle(session.title.replace(/^IDE Agent:\s*/, '') || '新的创作会话');
        setMessages(compactConversationMessages(session.messages));
      })
      .catch(() => {
        if (!cancelled) onAssistantSessionChange?.(null);
      });

    return () => {
      cancelled = true;
    };
  }, [assistantSessionId, onAssistantSessionChange]);

  const updateAgentStep = useCallback((stepId: string, patch: Partial<AgentStep>) => {
    setAgentRun((run) => {
      if (!run) return run;
      return {
        ...run,
        steps: run.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step),
      };
    });
  }, []);

  const updateAgentStatus = useCallback((status: AgentRun['status']) => {
    setAgentRun((run) => run ? { ...run, status } : run);
    setAgentBusy(status === 'running');
  }, []);

  const runAuthorAgent = useCallback(async (goal: string, intent: ConversationIntent = detectConversationIntent(goal)) => {
    if (agentBusy) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '这轮还在整理。我先把当前读取、修订或确认收口，再接新的问题。' },
      ]);
      return;
    }

    const project = projectPathRef.current;
    const file = currentFileRef.current;
    const ref = contextRefRef.current;
    if (!project) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '我需要先知道这是哪个项目。打开本地项目目录后，我们就可以直接围绕稿件聊。' },
      ]);
      return;
    }
    if (!file || !ref) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '我需要先看到右侧当前稿件。打开正文文件后，我会按你的问题来审、聊或给方案。' },
      ]);
      return;
    }

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    agentRunIdRef.current = runId;
    setAgentBusy(true);
    setRetryRequest(null);
    setAgentRun({
      id: runId,
      goal,
      status: 'running',
      steps: [
        { id: 'plan', title: '理解目标并制定步骤', tool: 'agent.orchestrator', status: 'pending', detail: '等待后端 Agent 编排' },
        { id: 'context', title: '扫描项目上下文', tool: 'project.context', status: 'pending', detail: '等待执行' },
        { id: 'draft', title: '读取当前稿件', tool: 'filesystem.read_file', status: 'pending', detail: '等待执行' },
        { id: 'orchestrate', title: '调用 Agent Orchestrator', tool: 'ide.agent.websocket', status: 'pending', detail: '等待执行' },
        { id: 'approval', title: '等待作者确认并收口', tool: 'author.approval', status: 'pending', detail: '等待执行' },
      ],
    });

    const exportOnly = intent === 'file.export';
    const reviseFile = intent === 'file.revise';
    updateAgentStep('plan', {
      status: 'completed',
      detail: exportOnly
        ? '目标判断为导出当前稿'
        : reviseFile
          ? '目标判断为生成可确认的修订'
          : '目标判断为先对话、分析或给方案，不写回文件',
    });

    try {
      updateAgentStep('context', { status: 'running', detail: '读取大纲、人物、设定、正文摘要' });
      const contextBundle = await buildContextBundle({ projectPath: project, currentFile: file });
      updateAgentStep('context', {
        status: 'completed',
        detail: `载入 ${contextBundle.files.length} 个上下文文件；正文 ${contextBundle.summary.counts.draft ?? 0} 个`,
      });

      updateAgentStep('draft', { status: 'running', detail: `读取 ${ref}` });
      const content = await TauriFileSystem.readFile(file);
      updateAgentStep('draft', {
        status: 'completed',
        detail: `当前稿件 ${content.length} 字符，约 ${content.split(/\n\s*\n/).filter(Boolean).length} 段`,
      });

      if (exportOnly) {
        updateAgentStep('orchestrate', { status: 'completed', detail: '无需后端修订，进入导出动作' });
        updateAgentStep('approval', { status: 'running', detail: '正在导出当前稿' });
        emitExportCurrentFile();
        updateAgentStatus('waiting');
        return;
      }

      updateAgentStep('orchestrate', {
        status: 'running',
        detail: reviseFile ? '生成待确认修订' : '整理创作判断',
      });
      const response = await sendAgentUserMessage({
        sessionId: runId,
        assistantSessionId: assistantSessionIdRef.current,
        userMessage: goal,
        intent: reviseFile ? 'file.revise' : 'chat.explain',
        args: {
          ...(reviseFile ? { file_path: file, content, instruction: goal } : { context: content, selection: content }),
          project_name: projectName,
          context_bundle: toAssistantContextBundlePayload(contextBundle),
        },
      });

      if (isAgentErrorMessage(response)) {
        updateAgentStep('orchestrate', { status: 'failed', detail: response.detail });
        updateAgentStatus('failed');
        setRetryRequest({ goal, intent });
        setMessages((prev) => [...prev, { role: 'assistant', content: `这轮没跑通：${response.detail}` }]);
        return;
      }

      if (!isAgentResultMessage(response)) {
        const detail = `Agent 返回了暂不支持的消息：${response.type}`;
        updateAgentStep('orchestrate', { status: 'failed', detail });
        updateAgentStatus('failed');
        setRetryRequest({ goal, intent });
        setMessages((prev) => [...prev, { role: 'assistant', content: detail }]);
        return;
      }

      assistantSessionIdRef.current = response.assistant_session_id;
      onAssistantSessionChange?.(response.assistant_session_id);

      const agentSteps = stepsFromAgentResult(response);
      setAgentRun((run) => run ? {
        ...run,
        status: response.agent_result.requires_user_confirmation ? 'waiting' : 'completed',
        steps: [
          { id: 'context', title: '扫描项目上下文', tool: 'project.context', status: 'completed', detail: `载入 ${contextBundle.files.length} 个上下文文件` },
          { id: 'draft', title: '读取当前稿件', tool: 'filesystem.read_file', status: 'completed', detail: `当前稿件 ${content.length} 字符` },
          { id: 'orchestrate', title: '整理回复', tool: 'ide.agent.websocket', status: 'completed', detail: `intent=${response.intent}；assistant_session=${response.assistant_session_id}` },
          ...agentSteps,
          {
            id: 'approval',
            title: '等待作者确认并收口',
            tool: 'author.approval',
            status: response.agent_result.requires_user_confirmation ? 'waiting' : 'completed',
            detail: response.agent_result.requires_user_confirmation ? '等待作者在右侧 diff 面板确认' : '无需写回确认',
          },
        ],
      } : run);
      setAgentBusy(false);

      const proposed = fileRevisionPatch(response);
      if (proposed) {
        emitFileSuggestion(createRemoteFileSuggestion({
          filePath: proposed.file_path,
          before: proposed.before,
          after: proposed.after,
          summary: response.agent_result.summary ?? 'Agent 已生成修订建议。',
          model: modelFromToolTrace(response),
          userIntent: goal,
        }));
        emitSuggestionResult({
          filePath: proposed.file_path,
          status: 'ready',
          message: response.agent_result.summary ?? 'Agent 已生成修订建议。',
          assistantSessionId: response.assistant_session_id,
        });
        updateAgentStatus('waiting');
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: response.agent_result.summary ?? '这轮已经完成。' },
      ]);
      updateAgentStatus(response.agent_result.requires_user_confirmation ? 'waiting' : 'completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateAgentStep('orchestrate', { status: 'failed', detail: message });
      updateAgentStatus('failed');
      setRetryRequest({ goal, intent });
      setMessages((prev) => [...prev, { role: 'assistant', content: `这轮没跑通：${message}` }]);
    }
  }, [agentBusy, onAssistantSessionChange, projectName, updateAgentStatus, updateAgentStep]);

  const retryLastFailedRun = useCallback(() => {
    if (!retryRequest || agentBusy) return;
    setMessages((prev) => [...prev, { role: 'user', content: `重试：${retryRequest.goal}` }]);
    void runAuthorAgent(retryRequest.goal, retryRequest.intent);
  }, [agentBusy, retryRequest, runAuthorAgent]);

  // 命令面板触发"审查当前文件"
  useEffect(() => {
    const onReview = () => {
      const ref = contextRefRef.current;
      if (!ref) return;
      const ask = `审查 ${ref} 的结构与节奏`;
      setConversationTitle(deriveConversationTitle(ask));
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: ask },
        {
          role: 'assistant',
          content: `可以。我按商业连载节奏看，重点检查冲突进入、信息密度和章尾钩子。\n\n我会先看当前稿和项目上下文；这轮只给判断和建议，不直接写回文件。`,
        },
      ]);
      void runAuthorAgent(ask, 'chat.explain');
    };
    window.addEventListener(REVIEW_CURRENT_EVENT, onReview);
    return () => window.removeEventListener(REVIEW_CURRENT_EVENT, onReview);
  }, [runAuthorAgent]);

  // 右侧 Editor 回传真实修订结果
  useEffect(() => {
    const onResult = (event: Event) => {
      const result = (event as CustomEvent<SuggestionResult>).detail;
      if (!result) return;
      const ref = result.filePath ? relativePath(projectPathRef.current, result.filePath) : null;
      const content =
        result.status === 'ready'
          ? `已生成对 \`${ref ?? result.filePath}\` 的 AI 修订，请在右侧查看 diff，可接受、拒绝或保存旁注。`
          : `AI 修订失败：${result.message}`;
      if (agentRunIdRef.current) {
        updateAgentStep('revise', {
          status: result.status === 'ready' ? 'completed' : 'failed',
          detail: result.message,
        });
        updateAgentStep('approval', {
          status: result.status === 'ready' ? 'waiting' : 'failed',
          detail: result.status === 'ready' ? '等待作者在右侧 diff 面板确认' : result.message,
        });
        updateAgentStatus(result.status === 'ready' ? 'waiting' : 'failed');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    };
    window.addEventListener(SUGGESTION_RESULT_EVENT, onResult);
    return () => window.removeEventListener(SUGGESTION_RESULT_EVENT, onResult);
  }, [updateAgentStatus, updateAgentStep]);

  useEffect(() => {
    const onAuthorLoopResult = (event: Event) => {
      const result = (event as CustomEvent<AuthorLoopResult>).detail;
      if (!result) return;
      const ref = relativePath(projectPathRef.current, result.filePath);
      const content =
        result.status === 'completed'
          ? result.action === 'exported'
            ? `作者闭环已完成：\`${ref}\` 已导出为交付稿。\n${result.artifactPath ?? result.message}`
            : `作者闭环已完成：\`${ref}\` 已写回正文，并生成闭环记录。\n${result.recordPath ?? result.message}`
          : `作者闭环失败：${result.message}`;
      if (agentRunIdRef.current) {
        updateAgentStep('approval', {
          status: result.status === 'completed' ? 'completed' : 'failed',
          detail: result.artifactPath ?? result.recordPath ?? result.message,
        });
        updateAgentStatus(result.status === 'completed' ? 'completed' : 'failed');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    };
    window.addEventListener(AUTHOR_LOOP_RESULT_EVENT, onAuthorLoopResult);
    return () => window.removeEventListener(AUTHOR_LOOP_RESULT_EVENT, onAuthorLoopResult);
  }, [updateAgentStatus, updateAgentStep]);

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || !projectPath) return;

    const instruction = input.trim();
    if (messages.length === 0) setConversationTitle(deriveConversationTitle(instruction));
    const userMessage: Message = { role: 'user', content: instruction };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    await runAuthorAgent(instruction);
  }, [input, messages.length, projectPath, runAuthorAgent]);

  const handleComposerSubmit = useCallback(async (value: string) => {
    const instruction = value.trim();
    if (!instruction || !projectPath) return;
    if (messages.length === 0) setConversationTitle(deriveConversationTitle(instruction));
    setMessages((prev) => [...prev, { role: 'user', content: instruction }]);
    await runAuthorAgent(instruction);
  }, [messages.length, projectPath, runAuthorAgent]);

  return (
    <div className="flex h-full min-w-0 flex-col bg-[#18181B]">
      <ConversationHeader title={conversationTitle} />

      <MessageList
        messages={messages}
        projectName={projectName}
        currentFileLabel={contextRef}
        disabled={!projectPath || agentBusy}
        onSubmit={handleComposerSubmit}
        agentRun={agentRun}
      />

      {runStatusText(agentRun) && (
        <LightweightStatus
          text={runStatusText(agentRun) ?? ''}
          retryVisible={agentRun?.status === 'failed' && retryRequest !== null && !agentBusy}
          onRetry={retryLastFailedRun}
        />
      )}

      {messages.length > 0 && (
        <ComposerBox
          value={input}
          disabled={!projectPath}
          busy={agentBusy}
          currentFileLabel={contextRef}
          onChange={setInput}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}

function ConversationHeader({ title }: { title: string }) {
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

function MessageList({
  messages,
  projectName,
  currentFileLabel,
  disabled,
  onSubmit,
  agentRun,
}: {
  messages: Message[];
  projectName: string | null;
  currentFileLabel: string | null;
  disabled: boolean;
  onSubmit: (value: string) => void;
  agentRun: AgentRun | null;
}) {
  if (messages.length === 0) {
    return (
      <div className="min-h-0 flex-1">
        <EmptyConversation
          projectName={projectName}
          currentFileLabel={currentFileLabel}
          disabled={disabled}
          onSubmit={onSubmit}
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

        {/* Agent 执行步骤面板 */}
        {agentRun && agentRun.steps.length > 0 && (
          <div className="animate-slide-up-fade">
            <AgentStepsPanel run={agentRun} />
          </div>
        )}
      </div>
    </div>
  );
}

function MessageItem({ message }: { message: Message }) {
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

function EmptyConversation({
  projectName,
  currentFileLabel,
  disabled,
  onSubmit,
}: {
  projectName: string | null;
  currentFileLabel: string | null;
  disabled: boolean;
  onSubmit: (value: string) => void;
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
            {projectName ? `${projectName}${currentFileLabel ? ` · ${currentFileLabel}` : ''}` : '打开项目后即可开始创作会话'}
          </div>
        </div>

        <ComposerSurface
          value={value}
          disabled={disabled}
          busy={false}
          currentFileLabel={currentFileLabel}
          onChange={setValue}
          onSubmit={submit}
        />
      </div>
    </div>
  );
}

function LightweightStatus({
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

function ComposerBox({
  value,
  disabled,
  busy,
  currentFileLabel,
  onChange,
  onSubmit,
}: {
  value: string;
  disabled: boolean;
  busy: boolean;
  currentFileLabel: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex-shrink-0 border-t border-[#3A3A40] bg-[#18181B] px-4 py-3">
      <div className="mx-auto max-w-[800px]">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <ComposerSurface
            value={value}
            disabled={disabled}
            busy={busy}
            currentFileLabel={currentFileLabel}
            onChange={onChange}
            onSubmit={onSubmit}
          />
        </form>
      </div>
    </div>
  );
}

function ComposerSurface({
  value,
  disabled,
  busy,
  currentFileLabel,
  onChange,
  onSubmit,
}: {
  value: string;
  disabled: boolean;
  busy: boolean;
  currentFileLabel: string | null;
  onChange: (value: string) => void;
  onSubmit?: () => void;
}) {
  const canSubmit = value.trim() && !disabled && !busy;

  return (
    <div className="min-h-[118px] rounded-xl border border-[#45454C] bg-[#2A2A30] shadow-[0_18px_64px_rgba(0,0,0,0.24)]">
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || busy}
        rows={3}
        className="h-[70px] w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-6 text-[#F1F1F2] outline-none placeholder:text-[#9A9AA2] disabled:cursor-not-allowed disabled:opacity-50"
        placeholder={disabled ? '打开项目后即可使用 StoryForge' : '输入想法、问题，或 @ 引用上下文...'}
        aria-label="给 StoryForge 发送消息"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit?.();
          }
        }}
      />
      <div className="flex h-12 items-center gap-2 px-3 pb-3">
        <button
          type="button"
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-[#333333] text-lg leading-none text-[#BDBDBD] transition-colors hover:bg-[#3D3D3D] hover:text-white"
          title="添加上下文"
        >
          +
        </button>
        <span className="max-w-[38%] truncate rounded-md border border-[#333333] px-2 py-1 text-xs text-[#BDBDBD]">
          @ {currentFileLabel ?? '当前文件'}
        </span>
        <span className="ml-auto min-w-0 truncate text-xs text-[#8F8F8F]">
          StoryForge · Claude · 编辑模式
        </span>
        <button
          type={onSubmit ? 'button' : 'submit'}
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-[#E6E6E6] text-sm text-[#111111] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          title="发送"
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
