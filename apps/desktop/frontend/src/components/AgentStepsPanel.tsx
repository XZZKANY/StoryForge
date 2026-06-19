/**
 * Agent 执行步骤可视化面板
 * 展示 Agent 的执行计划、工具调用和状态
 */

import { useState } from 'react';

export type AgentStepStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed';

export type AgentStep = {
  id: string;
  title: string;
  tool: string;
  status: AgentStepStatus;
  detail: string;
  startTime?: number;
  endTime?: number;
  error?: string;
};

export type AgentRunStatus = 'running' | 'waiting' | 'completed' | 'failed';

export type AgentRun = {
  id: string;
  goal: string;
  status: AgentRunStatus;
  steps: AgentStep[];
  startTime?: number;
  endTime?: number;
};

type AgentStepsPanelProps = {
  run: AgentRun;
  compact?: boolean;
};

export function AgentStepsPanel({ run, compact = false }: AgentStepsPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  const completedSteps = run.steps.filter((s) => s.status === 'completed').length;
  const totalSteps = run.steps.length;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <div className="rounded-lg border border-[#3A3A40] bg-[#202024] overflow-hidden">
      {/* 头部 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#2A2A30] transition-colors"
      >
        <div className="flex-shrink-0">
          <AgentRunIcon status={run.status} />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-sm font-medium text-[#EDEDED] truncate">{run.goal}</div>
          <div className="text-xs text-[#A8A8B0] mt-0.5">
            {completedSteps} / {totalSteps} 步骤完成
            {run.status === 'running' && ' · 执行中'}
            {run.status === 'waiting' && ' · 等待确认'}
            {run.status === 'completed' && ' · 已完成'}
            {run.status === 'failed' && ' · 失败'}
          </div>
        </div>
        <div className="flex-shrink-0">
          <svg
            className={`w-4 h-4 text-[#A8A8B0] transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* 进度条 */}
      {run.status === 'running' && (
        <div className="h-1 bg-[#2A2A30]">
          <div
            className="h-full bg-[#4A9EFF] transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* 步骤列表 */}
      {expanded && (
        <div className="px-4 py-3 space-y-2">
          {run.steps.map((step, index) => (
            <AgentStepItem
              key={step.id}
              step={step}
              index={index}
              compact={compact}
              expanded={expandedSteps.has(step.id)}
              onToggle={() => toggleStep(step.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentStepItem({
  step,
  index,
  compact,
  expanded,
  onToggle,
}: {
  step: AgentStep;
  index: number;
  compact: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetail = step.detail && step.detail.length > 0;
  const duration = step.startTime && step.endTime ? step.endTime - step.startTime : null;

  return (
    <div className="flex gap-3">
      {/* 时间线 */}
      <div className="flex flex-col items-center flex-shrink-0 w-6">
        <div className="flex-shrink-0">
          <StepStatusIcon status={step.status} />
        </div>
        {!compact && (
          <div className="flex-1 w-px bg-[#3A3A40] mt-1" />
        )}
      </div>

      {/* 内容 */}
      <div className="flex-1 min-w-0 pb-3">
        <button
          onClick={onToggle}
          disabled={!hasDetail}
          className={`w-full text-left ${hasDetail ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
        >
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[#EDEDED]">
                  {index + 1}. {step.title}
                </span>
                {duration !== null && (
                  <span className="text-xs text-[#8A8A90] px-1.5 py-0.5 rounded bg-[#2A2A30]">
                    {formatDuration(duration)}
                  </span>
                )}
              </div>

              {/* 工具名称 */}
              {step.tool && step.tool !== step.title && (
                <div className="text-xs text-[#8A8A90] mt-0.5">
                  工具: <code className="px-1 py-0.5 rounded bg-[#2A2A30]">{step.tool}</code>
                </div>
              )}

              {/* 简短详情（未展开时） */}
              {!expanded && hasDetail && (
                <div className="text-xs text-[#A8A8B0] mt-1 line-clamp-1">
                  {step.detail}
                </div>
              )}
            </div>

            {/* 展开图标 */}
            {hasDetail && (
              <svg
                className={`w-3 h-3 text-[#8A8A90] flex-shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </div>
        </button>

        {/* 详细信息（展开时） */}
        {expanded && hasDetail && (
          <div className="mt-2 px-3 py-2 rounded-md bg-[#2A2A30] text-xs text-[#C0C0C8] leading-relaxed whitespace-pre-wrap break-words">
            {step.detail}
          </div>
        )}

        {/* 错误信息 */}
        {step.error && (
          <div className="mt-2 px-3 py-2 rounded-md bg-[#3A1F1F] border border-[#5A2F2F] text-xs text-[#FF8A80] leading-relaxed">
            {step.error}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentRunIcon({ status }: { status: AgentRunStatus }) {
  if (status === 'running') {
    return (
      <div className="w-6 h-6 rounded-full bg-[#2A4A7F] flex items-center justify-center">
        <div className="w-3 h-3 border-2 border-[#4A9EFF] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'waiting') {
    return (
      <div className="w-6 h-6 rounded-full bg-[#4A4A2F] flex items-center justify-center">
        <svg className="w-4 h-4 text-[#FFA726]" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
        </svg>
      </div>
    );
  }

  if (status === 'completed') {
    return (
      <div className="w-6 h-6 rounded-full bg-[#2A4A2F] flex items-center justify-center">
        <svg className="w-4 h-4 text-[#66BB6A]" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      </div>
    );
  }

  // failed
  return (
    <div className="w-6 h-6 rounded-full bg-[#4A2F2F] flex items-center justify-center">
      <svg className="w-4 h-4 text-[#EF5350]" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
    </div>
  );
}

function StepStatusIcon({ status }: { status: AgentStepStatus }) {
  if (status === 'pending') {
    return (
      <div className="w-6 h-6 rounded-full border-2 border-[#3A3A40] bg-[#202024] flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-[#5A5A60]" />
      </div>
    );
  }

  if (status === 'running') {
    return (
      <div className="w-6 h-6 rounded-full border-2 border-[#4A9EFF] bg-[#202024] flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-[#4A9EFF] animate-pulse" />
      </div>
    );
  }

  if (status === 'waiting') {
    return (
      <div className="w-6 h-6 rounded-full border-2 border-[#FFA726] bg-[#202024] flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-[#FFA726]" />
      </div>
    );
  }

  if (status === 'completed') {
    return (
      <div className="w-6 h-6 rounded-full bg-[#66BB6A] flex items-center justify-center">
        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }

  // failed
  return (
    <div className="w-6 h-6 rounded-full bg-[#EF5350] flex items-center justify-center">
      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
