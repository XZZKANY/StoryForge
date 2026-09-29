/**
 * Agent 执行步骤：thinking 流动折叠，对齐 Claude Code / Codex 的简洁 log 观感（#6c）。
 * 收起为一行「思考中 / 已思考 · N 步 · K 工具」摘要，展开为等宽单色 log
 * （前导状态字形 + 工具名 mono + 简短观测），不再用左边线 + 彩色圆点的「时间线」皮肤。
 * 运行 / 等待 / 暂停 / 失败默认展开（失败要直接看到失败步），完成 / 停止自动收起；
 * 作者手动切换后以手动为准。
 */

import { useState } from 'react';
import type { AgentRun, AgentRunStatus, AgentStep, AgentStepStatus } from './chat-window/types';

export function AgentStepsPanel({ run }: { run: AgentRun }) {
  // null = 跟随运行状态；true/false = 作者手动覆盖。
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const isLive = run.status === 'running' || run.status === 'waiting';
  const open = manualOpen ?? (run.status !== 'completed' && run.status !== 'stopped');

  const stepCount = run.steps.length;
  const toolCount = run.steps.filter((step) => step.id.startsWith('tool-')).length;
  // 仅活动态在折叠头部显示当前活动步骤：作者收起也想看到「正在跑哪个工具」。
  const activeStep = isLive
    ? (run.steps.find((step) => step.status === 'running') ??
      run.steps.find((step) => step.status === 'waiting') ??
      run.steps.find((step) => step.status === 'pending'))
    : null;

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
            <span className="text-muted">
              {activeStep ? activeStep.title : '思考中'} · {stepCount} 步
              {toolCount > 0 ? ` · ${toolCount} 工具` : ''}
            </span>
          </span>
        ) : (
          <span
            className={run.status === 'failed' ? 'text-error' : undefined}
            data-testid="thinking-settled-header"
          >
            {settledHeaderText(run.status)} · {stepCount} 步
            {toolCount > 0 ? ` · ${toolCount} 工具` : ''}
            {run.status === 'failed' ? ' ✗' : ''}
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
          <div className="ml-[18px] mt-1 flex flex-col py-0.5">
            {run.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
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
      <span className={`flex-shrink-0 ${isToolStep ? 'text-foreground' : 'text-muted'}`}>
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
