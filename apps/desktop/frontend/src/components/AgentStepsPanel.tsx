/**
 * Agent 执行步骤：thinking 流动折叠，对齐 Claude Code / Codex 的简洁 log 观感（#6c）。
 * 收起为一行「思考中 / 已思考 · N 步 · K 工具」摘要，展开为等宽单色 log
 * （前导状态字形 + 工具名 mono + 简短观测），不再用左边线 + 彩色圆点的「时间线」皮肤。
 * 运行 / 等待中默认展开、完成 / 失败后自动收起；作者手动切换后以手动为准。
 */

import { useState } from 'react';
import type { AgentRun, AgentStep, AgentStepStatus } from './chat-window/types';

export function AgentStepsPanel({ run }: { run: AgentRun }) {
  // null = 跟随运行状态；true/false = 作者手动覆盖。
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const isTerminal = run.status === 'completed' || run.status === 'failed';
  const open = manualOpen ?? !isTerminal;

  const stepCount = run.steps.length;
  const toolCount = run.steps.filter((step) => step.id.startsWith('tool-')).length;
  const thinkingLabel = isTerminal ? '已思考' : '思考中';

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setManualOpen(!open)}
        className="flex h-[22px] w-full items-center gap-2 text-[11.5px] text-subtle transition-colors hover:text-muted"
        data-testid="thinking-fold-toggle"
        aria-expanded={open}
      >
        <span className="text-[12px] text-agent">✦</span>
        <span>
          {thinkingLabel} · {stepCount} 步{toolCount > 0 ? ` · ${toolCount} 工具` : ''}
        </span>
        <span className={`text-[9px] transition-transform ${open ? '' : '-rotate-90'}`}>▾</span>
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

  return (
    <button
      type="button"
      onClick={() => hasDetail && setDetailOpen((value) => !value)}
      disabled={!hasDetail}
      className={`flex w-full items-baseline gap-2 rounded px-1 py-px text-left font-mono text-[11px] leading-5 ${
        hasDetail ? 'cursor-pointer hover:bg-elevated' : 'cursor-default'
      }`}
    >
      <span className={`flex-shrink-0 ${glyphClass(step.status)}`} aria-hidden="true">
        {statusGlyph(step.status)}
      </span>
      <span className={`flex-shrink-0 ${isToolStep ? 'text-foreground' : 'text-muted'}`}>
        {step.title}
      </span>
      {hasDetail && (
        <span
          className={`min-w-0 flex-1 text-subtle ${
            detailOpen ? 'whitespace-pre-wrap break-words' : 'truncate'
          }`}
        >
          {step.detail}
        </span>
      )}
    </button>
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
