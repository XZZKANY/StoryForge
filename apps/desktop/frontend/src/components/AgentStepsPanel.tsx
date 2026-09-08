/**
 * Agent 执行步骤：thinking 流动折叠，对齐 Claude Code / Codex 的简洁 log 观感（#6c）。
 * 收起为一行「思考中 / 已思考 · N 步 · K 工具」摘要，展开为等宽单色 log
 * （前导状态字形 + 工具名 mono + 简短观测），不再用左边线 + 彩色圆点的「时间线」皮肤。
 * 运行 / 等待中默认展开、完成 / 失败后自动收起；作者手动切换后以手动为准。
 */

import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { AgentRun, AgentStep, AgentStepStatus } from './chat-window/types';

export function AgentStepsPanel({ run }: { run: AgentRun }) {
  // null = 跟随运行状态；true/false = 作者手动覆盖。
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = `agent-steps-${useId().replace(/:/g, '')}`;
  const isTerminal = run.status === 'completed' || run.status === 'failed';
  const open = manualOpen ?? !isTerminal;

  useLayoutEffect(() => {
    if (open || !contentRef.current?.contains(document.activeElement)) return;
    // 运行结束时内容会立刻变为 aria-hidden；把焦点留在折叠内容里会让键盘用户
    // 看不见当前焦点，也无法通过 Tab 回到可见控件。
    toggleRef.current?.focus({ preventScroll: true });
  }, [open]);

  const stepCount = run.steps.length;
  const toolCount = run.steps.filter((step) => step.id.startsWith('tool-')).length;
  const thinkingLabel = isTerminal ? '已思考' : '思考中';

  return (
    <div className="mb-1">
      <button
        type="button"
        ref={toggleRef}
        onClick={() => setManualOpen(!open)}
        className="flex h-[22px] w-full items-center gap-2 text-2xs text-subtle transition-colors hover:text-muted"
        data-testid="thinking-fold-toggle"
        aria-expanded={open}
        aria-controls={contentId}
      >
        <span className="text-xs text-agent" aria-hidden="true">
          ✦
        </span>
        <span>
          {thinkingLabel} · {stepCount} 步{toolCount > 0 ? ` · ${toolCount} 工具` : ''}
        </span>
        <span
          className={`text-3xs transition-transform ${open ? '' : '-rotate-90'}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {/* 流动折叠：grid 0fr→1fr，长内容不截断、短内容不空跑 */}
      <div
        ref={contentRef}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
        id={contentId}
        aria-hidden={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="ml-[18px] mt-1 flex flex-col py-0.5">
            {run.steps.map((step) => (
              <StepRow key={step.id} step={step} interactive={open} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepRow({ step, interactive }: { step: AgentStep; interactive: boolean }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const detailId = `agent-step-detail-${useId().replace(/:/g, '')}`;
  const isToolStep = step.id.startsWith('tool-');
  const hasDetail = step.detail.trim().length > 0;
  const metrics = step.metrics ?? [];
  const hasMetrics = metrics.length > 0;
  const expanded = interactive && detailOpen;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => hasDetail && setDetailOpen((value) => !value)}
        disabled={!hasDetail}
        tabIndex={interactive ? undefined : -1}
        aria-expanded={hasDetail ? expanded : undefined}
        aria-controls={hasDetail ? detailId : undefined}
        className={`flex w-full items-baseline gap-2 rounded-sm px-1 py-px text-left font-mono text-2xs leading-5 ${
          hasDetail ? 'cursor-pointer hover:bg-elevated' : 'cursor-default'
        }`}
      >
        <span className={`flex-shrink-0 ${glyphClass(step.status)}`} aria-hidden="true">
          {statusGlyph(step.status)}
        </span>
        <span className={`flex-shrink-0 ${isToolStep ? 'text-foreground' : 'text-muted'}`}>
          {step.title}
        </span>
        {/* 有结构化指标时首行让位给 chip 行；仅纯文本 detail（如 plan step）仍在首行内联。 */}
        {hasDetail && !hasMetrics && !expanded && (
          <span className="min-w-0 flex-1 truncate text-subtle">{step.detail}</span>
        )}
      </button>

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

      {hasDetail && (
        <div
          id={detailId}
          role="region"
          aria-label={`${step.title} 详情`}
          hidden={!expanded}
          className="ml-[18px] whitespace-pre-wrap break-words py-0.5 text-2xs leading-5 text-subtle"
        >
          {step.detail}
        </div>
      )}
    </div>
  );
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
