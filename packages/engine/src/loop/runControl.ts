import type { Obj } from '../kernel/json';
import { RunControl, type RunProgress } from '../llm/control';
import type { ChatLoopOutcome } from './chatLoopTypes';

/** 一次 agent 调用的总时长预算（秒），所有路径共用同一个截止时间。 */
export const RUN_MAX_DURATION_SECONDS = 900;

/** 同步读出当前 run 的暂停 / 停止事实（null 表示继续）。 */
export type InterruptionCallback = (boundary: string) => Obj | null;

type InterruptionOwner = { shouldInterrupt: InterruptionCallback | null; interruption: Obj | null };

export type RunControlClock = {
  /** 单调时钟（秒）。 */
  clock: () => number;
  wait: (seconds: number) => Promise<void>;
};

/** 第一次读到中断事实后就记住它，此后每个边界都按同一个原因退出。 */
export function buildRunControl(
  owner: InterruptionOwner,
  options: RunControlClock & {
    durationSeconds: number;
    onProgress?: (progress: RunProgress) => void;
  },
): RunControl {
  if (options.durationSeconds <= 0) throw new RangeError('Run duration budget must be positive');
  return new RunControl({
    checkInterruption: (boundary) => {
      if (owner.interruption === null && owner.shouldInterrupt !== null)
        owner.interruption = owner.shouldInterrupt(boundary);
      if (owner.interruption !== null) return String(owner.interruption.status || 'interrupted');
      return null;
    },
    deadline: options.clock() + options.durationSeconds,
    onProgress: options.onProgress,
    clock: options.clock,
    wait: options.wait,
  });
}

/**
 * 一次 agent 调用里唯一的控制与截止时间所有者（Python 经 ContextVar 隐式传递，这里显式持有）。
 * 循环、回落单轮与隐藏任务都看同一个中断事实。
 */
export class RunControlScope implements InterruptionOwner {
  interruption: Obj | null = null;
  readonly control: RunControl;

  constructor(
    readonly shouldInterrupt: InterruptionCallback | null,
    options: RunControlClock & { onProgress?: (progress: RunProgress) => void },
  ) {
    this.control = buildRunControl(this, {
      ...options,
      durationSeconds: RUN_MAX_DURATION_SECONDS,
    });
  }
}

/** 循环被中断后的收尾：截止时间按失败记，作者的暂停 / 停止按中断记且保留原事实。 */
export function finishInterruptedRun(
  context: { outcome: ChatLoopOutcome; providerAttempts: number; interruption: Obj | null },
  reason: string,
  scope: RunControlScope,
): ChatLoopOutcome {
  const outcome = context.outcome;
  outcome.rounds = context.providerAttempts;
  if (reason === 'deadline_exceeded') {
    outcome.markFailed('runtime_deadline', '本轮执行时间预算已用完，未继续派发模型或工具。');
    outcome.exhausted = true;
  } else {
    if (context.interruption === null) {
      if (scope.interruption === null)
        throw new Error('Interrupted run is missing its control fact');
      context.interruption = scope.interruption;
    }
    outcome.interrupted = true;
    outcome.interruption = context.interruption;
    outcome.answer = outcome.answer || '已按你的操作停下，这轮没有继续。';
  }
  return outcome;
}
