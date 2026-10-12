import type { TokenUsage } from './contracts';

/** 控制面退出（暂停 / 停止 / 截止时间），与 provider / 超时错误无关。 */
export class RunInterrupted extends Error {
  constructor(
    readonly reason: string,
    public usage: TokenUsage | null = null,
  ) {
    super('LLM run interrupted.');
    this.name = 'RunInterrupted';
  }
}

export type RunProgress = { phase: string; request_number: number; [key: string]: unknown };

/**
 * 一次运行内对 LLM 传输的协作式控制：在请求前、重试等待中、读流前后检查是否被暂停 / 停止，
 * 以及是否越过截止时间。已经发出的请求仍要等它返回或超时（与 Python 同）。
 */
export class RunControl {
  private reason: string | null = null;
  private requestNumber = 0;
  readonly deadline: number | null;

  constructor(
    private readonly options: {
      checkInterruption: (boundary: string) => string | null;
      deadline?: number | null;
      onProgress?: (progress: RunProgress) => void;
      /** 单调时钟（秒）。 */
      clock: () => number;
      wait: (seconds: number) => Promise<void>;
    },
  ) {
    this.deadline = options.deadline ?? null;
    if (this.deadline !== null && !Number.isFinite(this.deadline))
      throw new RangeError('deadline must be finite');
  }

  check(boundary: string): void {
    if (this.reason === null) this.reason = this.options.checkInterruption(boundary);
    if (this.reason === null && this.deadline !== null && this.options.clock() >= this.deadline)
      this.reason = 'deadline_exceeded';
    if (this.reason !== null) throw new RunInterrupted(this.reason);
  }

  emit(phase: string, values: { [key: string]: unknown } = {}): void {
    this.options.onProgress?.({ phase, request_number: this.requestNumber, ...values });
  }

  private boundedTimeout(timeout: number): number {
    if (this.deadline === null) return timeout;
    const bounded = Math.min(timeout, this.deadline - this.options.clock());
    if (bounded <= 0) {
      this.reason = 'deadline_exceeded';
      throw new RunInterrupted(this.reason);
    }
    return bounded;
  }

  requestTimeout(configured: number): number {
    this.check('before_http_request');
    let timeout = this.boundedTimeout(configured);
    this.requestNumber += 1;
    this.emit('request_started', { timeout_seconds: timeout });
    // 进度观察者自己可能改变控制状态。
    this.check('before_http_dispatch');
    timeout = this.boundedTimeout(timeout);
    return timeout;
  }

  async waitForRetry(delay: number): Promise<void> {
    if (!Number.isFinite(delay) || delay < 0)
      throw new RangeError('retry delay must be finite and non-negative');
    this.check('before_retry_wait');
    const end = this.options.clock() + delay;
    this.emit('retry_wait', { delay_seconds: delay });
    for (;;) {
      this.check('retry_wait');
      let remaining = end - this.options.clock();
      if (remaining <= 0) break;
      if (this.deadline !== null)
        remaining = Math.min(remaining, this.deadline - this.options.clock());
      if (remaining > 0) await this.options.wait(Math.min(0.1, remaining));
    }
    this.check('before_retry_dispatch');
    this.emit('retry_started');
  }
}

/** 没有运行控制时：照配置超时、照常睡眠、不检查。 */
export const requestTimeout = (control: RunControl | null | undefined, configured: number) =>
  control ? control.requestTimeout(configured) : configured;

export async function waitForRetry(
  control: RunControl | null | undefined,
  wait: (seconds: number) => Promise<void>,
  delay: number,
): Promise<void> {
  if (control) await control.waitForRetry(delay);
  else if (delay > 0) await wait(delay);
}

export const checkRunInterruption = (control: RunControl | null | undefined, boundary: string) =>
  control?.check(boundary);
