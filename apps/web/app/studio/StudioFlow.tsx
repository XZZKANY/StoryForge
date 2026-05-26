'use client';

import { type ReactNode, useEffect, useMemo, useRef } from 'react';

export type StudioFlowStep = {
  readonly id: 'book' | 'goal' | 'generate' | 'review';
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly completed: boolean;
  readonly content: ReactNode;
};

type StudioFlowStepStatus = 'completed' | 'current' | 'pending';

type StudioFlowProps = {
  readonly steps: readonly StudioFlowStep[];
};

const stepNumberLabels = ['Step 1', 'Step 2', 'Step 3', 'Step 4'] as const;

function getCurrentStepIndex(steps: readonly StudioFlowStep[]): number {
  const firstIncompleteIndex = steps.findIndex((step) => !step.completed);
  return firstIncompleteIndex === -1 ? steps.length - 1 : firstIncompleteIndex;
}

function getStepStatus(
  index: number,
  currentStepIndex: number,
  completed: boolean,
): StudioFlowStepStatus {
  if (completed && index < currentStepIndex) {
    return 'completed';
  }
  if (index === currentStepIndex) {
    return 'current';
  }
  return 'pending';
}
function getStepClassName(status: StudioFlowStepStatus): string {
  const baseClassName = 'rounded-2xl border p-4 transition shadow-sm';
  if (status === 'completed') {
    return `${baseClassName} border-emerald-600 bg-emerald-50 text-emerald-950`;
  }
  if (status === 'current') {
    return `${baseClassName} border-amber-700 bg-white ring-2 ring-amber-700/40 text-stone-950`;
  }
  return `${baseClassName} border-stone-200 bg-stone-100 text-stone-500 opacity-50`;
}

function getPanelClassName(status: StudioFlowStepStatus): string {
  const baseClassName = 'scroll-mt-8 rounded-3xl border p-5 shadow-sm';
  if (status === 'completed') {
    return `${baseClassName} border-emerald-600 bg-emerald-50/60`;
  }
  if (status === 'current') {
    return `${baseClassName} border-amber-700 bg-white ring-2 ring-amber-700/30`;
  }
  return `${baseClassName} border-stone-200 bg-stone-100/80 opacity-50`;
}

export function StudioFlow({ steps }: StudioFlowProps) {
  const currentStepIndex = useMemo(() => getCurrentStepIndex(steps), [steps]);
  const previousStepIndexRef = useRef(currentStepIndex);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    const isFirstStep = currentStepIndex === 0;
    const shouldScroll = previousStepIndexRef.current !== currentStepIndex || !isFirstStep;
    previousStepIndexRef.current = currentStepIndex;
    if (!shouldScroll) {
      return;
    }
    stepRefs.current[currentStepIndex]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [currentStepIndex]);
  return (
    <section
      aria-labelledby="studio-flow-title"
      className="space-y-6 rounded-3xl border border-stone-200 bg-white/80 p-5 shadow-lg"
    >
      <div>
        <h2 id="studio-flow-title" className="text-2xl font-bold text-stone-950">
          Studio 操作流程
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          按顺序完成选作品、设目标、生成、评审并批准，当前步骤会高亮，未完成步骤会置灰。
        </p>
      </div>
      <ol className="grid gap-3 md:grid-cols-4" aria-label="Studio 四步操作进度">
        {steps.map((step, index) => {
          const status = getStepStatus(index, currentStepIndex, step.completed);
          return (
            <li
              key={step.id}
              className={getStepClassName(status)}
              aria-current={status === 'current' ? 'step' : undefined}
            >
              <span className="text-xs font-semibold uppercase tracking-wide">
                {stepNumberLabels[index]}
              </span>
              <strong className="mt-1 block text-base">{step.label}</strong>
              <span className="mt-2 block text-sm">
                {step.completed ? '已完成' : status === 'current' ? '当前步骤' : '等待前置步骤'}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="space-y-5">
        {steps.map((step, index) => {
          const status = getStepStatus(index, currentStepIndex, step.completed);
          return (
            <section
              aria-labelledby={`studio-flow-${step.id}-title`}
              className={getPanelClassName(status)}
              key={step.id}
              ref={(node) => {
                stepRefs.current[index] = node;
              }}
            >
              <div className="mb-4 flex flex-col gap-2 border-b border-stone-200 pb-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                    {stepNumberLabels[index]}
                  </p>
                  <h3
                    id={`studio-flow-${step.id}-title`}
                    className="mt-1 text-xl font-bold text-stone-950"
                  >
                    {step.title}
                  </h3>
                  <p className="mt-1 text-sm text-stone-600">{step.description}</p>
                </div>
                <span className="rounded-full border border-stone-200 px-3 py-1 text-sm font-semibold text-stone-700">
                  {step.completed ? '已完成' : status === 'current' ? '当前步骤' : '未完成'}
                </span>
              </div>
              <div className="space-y-4">{step.content}</div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
