/**
 * Agent 执行步骤：thinking 流动折叠。
 * 收起为一行「思考中 / 已思考 · N 步 · K 次工具调用」摘要，展开为轻量时间线
 * （细左边线 + 6px 状态圆点 + 工具名 mono + 简短观测）。
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
          {thinkingLabel} · {stepCount} 步{toolCount > 0 ? ` · ${toolCount} 次工具调用` : ''}
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
          <div className="ml-[5px] mt-1.5 flex flex-col gap-[7px] border-l border-border py-0.5 pl-3.5">
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
    <div className="relative">
      <span
        className={`absolute -left-[17.5px] top-[6px] h-1.5 w-1.5 rounded-full ${dotClass(step.status)}`}
        style={
          step.status === 'running' ? { boxShadow: '0 0 0 3px rgb(var(--agent) / 0.2)' } : undefined
        }
      />
      <button
        type="button"
        onClick={() => hasDetail && setDetailOpen((value) => !value)}
        disabled={!hasDetail}
        className={`flex w-full items-baseline gap-2 text-left text-[11.5px] text-muted ${
          hasDetail ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <span
          className={`flex-shrink-0 ${
            isToolStep ? 'font-mono text-[11px] text-foreground' : 'text-foreground'
          }`}
        >
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
    </div>
  );
}

function dotClass(status: AgentStepStatus): string {
  if (status === 'completed') return 'bg-success';
  if (status === 'running') return 'bg-agent';
  if (status === 'waiting') return 'bg-warning';
  if (status === 'failed') return 'bg-error';
  return 'bg-subtle';
}
