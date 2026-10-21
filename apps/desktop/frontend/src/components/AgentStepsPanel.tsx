/**
 * Agent 执行步骤：thinking 流动折叠，对齐 Claude Code / Codex 的简洁 log 观感（#6c）。
 * 收起为一行「思考中 / 已思考 · N 步 · K 工具」摘要，展开为等宽单色 log
 * （前导状态字形 + 工具名 mono + 简短观测），不再用左边线 + 彩色圆点的「时间线」皮肤。
 * 运行 / 等待 / 暂停 / 失败默认展开（失败要直接看到失败步），完成 / 停止自动收起；
 * 作者手动切换后以手动为准。
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isModelRequestStep, processSteps } from './chat-window/agent-step-mapping';
import { isAuthorRejection } from './chat-window/display-utils';
import { RunElapsed } from './chat-window/RunElapsed';
import type { AgentRun, AgentRunStatus, AgentStep, AgentStepStatus } from './chat-window/types';

// 「整理回答」是每轮对话都有的循环收尾步，本身不是作者要看的过程。
const isLoopSummary = (step: AgentStep) => step.tool === 'agent.loop';

/**
 * 思考过程里有没有东西可看：跑着的时候总有（这一行报进度与用时）；跑完之后只剩
 * 「整理回答」的纯聊天不再留一行「已思考 · 1 步」。模型请求只报在跑着时的这一行。
 */
export function hasProcess(run: AgentRun): boolean {
  if (run.status === 'running') return true;
  return (
    processSteps(run.steps).some((step) => !isLoopSummary(step)) ||
    Boolean(run.notes?.some((note) => note.text.trim()))
  );
}

/** 跑着时这一行写什么：退避重试写原因，调工具写工具，其余是「思考中」。 */
function liveText(run: AgentRun, steps: readonly AgentStep[]): string {
  // 引擎的退避两句都带「重试」，不管排第几步都把原因写出来，作者才知道为什么慢。
  const backoff = run.steps.find(
    (step) => isModelRequestStep(step) && step.status === 'running' && /重试/.test(step.detail),
  );
  if (backoff) return backoff.detail;
  const active = steps.find((step) => step.status === 'running' && !isLoopSummary(step));
  return active ? active.title : '思考中';
}

export function AgentStepsPanel({ run }: { run: AgentRun }) {
  // null = 跟随运行状态；true/false = 作者手动覆盖。
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  if (!hasProcess(run)) return null;
  const steps = processSteps(run.steps);
  // 等作者决定时不是在跑：头部不再跳动，写「等你决定」（选项在对话底部）。
  const isLive = run.status === 'running';
  const isWaiting = run.status === 'waiting';
  const rejected = isAuthorRejection(run);
  const failed = run.status === 'failed' && !rejected;
  const open = manualOpen ?? (run.status !== 'completed' && run.status !== 'stopped' && !rejected);

  const stepCount = steps.length;
  const toolCount = steps.filter((step) => step.id.startsWith('tool-')).length;

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setManualOpen(!open)}
        className="flex h-[22px] w-full items-center gap-2 text-2xs text-subtle transition-colors hover:text-muted"
        data-testid="thinking-fold-toggle"
        aria-expanded={open}
      >
        <span className="text-xs text-agent">✦</span>
        {isLive ? (
          <span className="flex items-baseline gap-1.5" data-testid="thinking-active-step">
            <span className="sf-thinking-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="text-muted">{liveText(run, steps)}</span>
            {run.startedAt !== undefined && <RunElapsed since={run.startedAt} />}
            {toolCount > 0 && <span className="text-subtle">· {toolCount} 工具</span>}
          </span>
        ) : isWaiting ? (
          <span className="text-muted" data-testid="thinking-waiting-header">
            等你决定 · {stepCount} 步{toolCount > 0 ? ` · ${toolCount} 工具` : ''}
          </span>
        ) : (
          <span className={failed ? 'text-error' : undefined} data-testid="thinking-settled-header">
            {rejected ? '已拒绝' : settledHeaderText(run.status)} · {stepCount} 步
            {toolCount > 0 ? ` · ${toolCount} 工具` : ''}
            {failed ? ' ✗' : ''}
          </span>
        )}
        <span className={`text-3xs transition-transform ${open ? '' : '-rotate-90'}`}>▾</span>
      </button>

      {/* 流动折叠：grid 0fr→1fr，长内容不截断、短内容不空跑 */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <ProcessLog live={isLive}>{processRows(run, steps)}</ProcessLog>
        </div>
      </div>
    </div>
  );
}

/**
 * 跑着时是一个固定高度的小窗，新步骤从底下进来、旧的往上滚走；跑完不再限高，展开就是全部。
 * 作者往上翻看时不把他拽回底部。
 */
function ProcessLog({ live, children }: { live: boolean; children: ReactNode[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (live && element && pinnedRef.current) element.scrollTop = element.scrollHeight;
  });
  return (
    <div
      ref={ref}
      className={`ml-[18px] mt-1 flex flex-col py-0.5 ${
        live ? 'max-h-[7.5rem] overflow-y-auto [scrollbar-width:thin]' : ''
      }`}
      data-testid="thinking-log"
      data-live={live ? 'true' : 'false'}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8;
      }}
    >
      {children}
    </div>
  );
}

/** 步骤按到达顺序排；前几轮模型说的话按 toolIndex 插在它之后那批工具的前面。 */
function processRows(run: AgentRun, steps: readonly AgentStep[]): ReactNode[] {
  const notes = (run.notes ?? [])
    .filter((note) => note.text.trim())
    .sort((a, b) => a.toolIndex - b.toolIndex || a.round - b.round);
  const rows: ReactNode[] = [];
  let next = 0;
  let toolOrdinal = 0;
  const flushNotes = (upTo: number) => {
    while (next < notes.length && notes[next].toolIndex <= upTo) {
      const note = notes[next];
      rows.push(
        <p
          key={`note-${note.round}`}
          className="whitespace-pre-wrap break-words px-1 py-0.5 text-xs leading-5 text-muted"
          data-testid="agent-run-note"
        >
          {note.text}
        </p>,
      );
      next += 1;
    }
  };
  for (const step of steps) {
    if (step.id.startsWith('tool-')) {
      flushNotes(toolOrdinal);
      toolOrdinal += 1;
    }
    rows.push(<StepRow key={step.id} step={step} />);
  }
  flushNotes(Number.POSITIVE_INFINITY);
  return rows;
}

function StepRow({ step }: { step: AgentStep }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const isToolStep = step.id.startsWith('tool-');
  const hasDetail = step.detail.trim().length > 0;
  const metrics = step.metrics ?? [];
  const hasMetrics = metrics.length > 0;

  const rowClass =
    'flex w-full items-baseline gap-2 rounded-sm px-1 py-px text-left font-mono text-2xs leading-5';
  const rowContent = (
    <>
      <span className={`flex-shrink-0 ${glyphClass(step.status)}`} aria-hidden="true">
        {statusGlyph(step.status)}
      </span>
      {/* 工具标题带着文件路径，窄栏里会很长：可以截断，悬停看全名。 */}
      <span
        className={`min-w-0 truncate ${isToolStep ? 'text-foreground' : 'text-muted'}`}
        title={step.title}
      >
        {step.title}
      </span>
      {/* 有结构化指标时首行让位给 chip 行；仅纯文本 detail（如 plan step）仍在首行内联。 */}
      {hasDetail && !hasMetrics && (
        <span
          className={`min-w-0 flex-1 text-subtle ${
            detailOpen ? 'whitespace-pre-wrap break-words' : 'truncate'
          }`}
        >
          {step.detail}
        </span>
      )}
    </>
  );

  return (
    <div className="flex flex-col">
      {hasDetail ? (
        <button
          type="button"
          onClick={() => setDetailOpen((value) => !value)}
          className={`${rowClass} transition-colors hover:bg-elevated`}
        >
          {rowContent}
        </button>
      ) : (
        // 无详情可展开时是纯静态行：渲染 div 而非 disabled button，
        // 避免全局 button:disabled{cursor:not-allowed} 让静态行挂着禁用光标。
        <div className={rowClass}>{rowContent}</div>
      )}

      {hasMetrics && (
        <div
          className="ml-[18px] flex flex-wrap items-center gap-1 py-0.5"
          data-testid="step-metrics"
        >
          {metrics.map((metric) => (
            <span
              key={metric.label}
              className="inline-flex items-baseline gap-1 rounded-sm bg-elevated px-1.5 py-px font-mono text-3xs leading-4 text-subtle"
              data-testid="step-metric-chip"
            >
              <span className="text-subtle">{metric.label}</span>
              <span className="text-foreground">{metric.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function settledHeaderText(status: AgentRunStatus): string {
  if (status === 'failed') return '已失败';
  if (status === 'stopped') return '已停止';
  if (status === 'paused') return '已暂停';
  return '已思考';
}

function statusGlyph(status: AgentStepStatus): string {
  if (status === 'completed') return '✓';
  if (status === 'failed') return '✗';
  if (status === 'running') return '▸';
  return '·';
}

function glyphClass(status: AgentStepStatus): string {
  if (status === 'completed') return 'text-success';
  if (status === 'failed') return 'text-error';
  if (status === 'running') return 'text-agent';
  if (status === 'waiting') return 'text-warning';
  return 'text-subtle';
}
