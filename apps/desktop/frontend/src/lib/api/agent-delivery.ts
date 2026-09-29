/** Transport uncertainty is not an execution failure and never authorizes another POST. */
export class AgentRunOutcomeUnknownError extends Error {
  constructor(
    readonly runId: string,
    readonly sessionId: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgentRunOutcomeUnknownError';
  }
}

/** Bounded read-only observation; even a transport that ignores abort cannot retain the UI. */
export async function readAgentRunWithin<T>(
  read: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('读取运行状态超时，可再次核对；未重新执行。'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
