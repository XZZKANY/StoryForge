/**
 * 测试替身：把 agent 消息与控制接到可编排的 fetch 上（沿用早先 HTTP / SSE 传输的报文形状）。
 * 产品里 agent 循环在进程内的 TS 引擎里跑；这些界面测试关心的是流帧、终态与恢复时界面怎么走，
 * 用 fetch 编排后端比搭整个引擎省事。接法：
 *   vi.mock('../src/lib/api/agent-socket', async (importOriginal) => ({
 *     ...(await importOriginal()), ...(await import('./support/http-agent-double')) }));
 */
import { AgentRunOutcomeUnknownError, readAgentRunWithin } from '../../src/lib/api/agent-delivery';
import {
  isAgentErrorMessage,
  isAgentResultMessage,
  isAgentRunStartedMessage,
} from '../../src/lib/api/agent-messages';
import { reconstructAgentResultFromEvents } from '../../src/lib/api/agent-run-events';
import type { AgentRunEventRecord } from '../../src/lib/api/agent-run-events';
import { parseAgentSseFrame } from '../../src/lib/api/agent-sse-frame';
import { getApiConfig, trimApiBaseUrl } from './http-config';
import { readErrorDetail } from '../../src/lib/api/errors';
import type {
  AgentControlAckMessage,
  AgentControlMessageRequest,
  AgentErrorMessage,
  AgentSocketMessage,
  AgentUserMessageRequest,
} from '../../src/lib/api/types';

const DEFAULT_AGENT_TIMEOUT_MS = 360_000;

/** 断线 / 超时后拉持久化事件表（早先的 REST 形状）。 */
async function getAgentRunEvents(
  runId: string,
  options: { signal?: AbortSignal } = {},
): Promise<AgentRunEventRecord[]> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(
    `${trimApiBaseUrl(baseUrl)}/api/agent-runs/${encodeURIComponent(runId)}/events`,
    {
      method: 'GET',
      signal: options.signal,
      cache: 'no-store',
      headers: { 'X-StoryForge-API-Key': apiKey },
    },
  );
  if (!response.ok) throw new Error(await readErrorDetail(response));
  return (await response.json()) as AgentRunEventRecord[];
}

// SSE 超时后只读查询同 run 的持久事件。观察预算不是执行预算：耗尽只能判为结果未知，
// 不能据此判断后台失败或允许重新 POST。作者可继续显式核对。
const AGENT_POLL_INTERVAL_MS = 3_000;
const AGENT_POLL_TOTAL_MS = 5 * 60_000;

const API_KEY_HEADER = 'X-StoryForge-API-Key';

// HTTP 拒绝已是确定结果；错误详情有独立观察预算，不能重新打开执行恢复。
const AGENT_ERROR_DETAIL_TIMEOUT_MS = 2_000;
const AGENT_ERROR_DETAIL_MAX_BYTES = 64 * 1024;

async function readRejectedAgentDetail(response: Response): Promise<string> {
  const fallback = `API 返回 ${response.status}`;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timeout: number | undefined;
  let stopped = false;
  try {
    reader = response.body?.getReader();
    if (!reader) return fallback;
    const bodyReader = reader;
    const readDetail = async () => {
      const decoder = new TextDecoder();
      let text = '';
      let bytes = 0;
      while (!stopped) {
        const { done, value } = await bodyReader.read();
        if (stopped) return fallback;
        if (done) {
          const data: unknown = JSON.parse(text + decoder.decode());
          return data !== null &&
            typeof data === 'object' &&
            'detail' in data &&
            typeof data.detail === 'string' &&
            data.detail.trim()
            ? data.detail
            : fallback;
        }
        bytes += value.byteLength;
        if (bytes > AGENT_ERROR_DETAIL_MAX_BYTES) return fallback;
        text += decoder.decode(value, { stream: true });
      }
      return fallback;
    };
    return await Promise.race([
      readDetail(),
      new Promise<string>((resolve) => {
        timeout = window.setTimeout(() => resolve(fallback), AGENT_ERROR_DETAIL_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    stopped = true;
    window.clearTimeout(timeout);
    // 取消失败或 underlying cancel 挂起不能阻止交付已知 HTTP 拒绝。
    try {
      void reader?.cancel().catch(() => undefined);
    } catch {
      // Best-effort cancellation; preserve the observed HTTP status.
    }
    try {
      reader?.releaseLock();
    } catch {
      // Releasing a failed reader cannot change a definite HTTP rejection either.
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function sendAgentUserMessage(
  request: AgentUserMessageRequest,
): Promise<AgentSocketMessage> {
  const config = await getApiConfig();
  const { baseUrl, apiKey } = config;
  const url = `${trimApiBaseUrl(baseUrl)}/api/ide/agent/sessions/${encodeURIComponent(
    request.sessionId,
  )}/stream`;
  const args = {
    ...(request.args ?? {}),
    ...(request.agentRoleHints ? { agent_role_hints: request.agentRoleHints } : {}),
    ...(request.agentRoleMentions ? { agent_role_mentions: request.agentRoleMentions } : {}),
  };
  const body = JSON.stringify({
    user_message: request.userMessage,
    run_id: request.runId,
    assistant_session_id: request.assistantSessionId ?? undefined,
    intent: request.intent,
    permission_profile: request.permissionProfile,
    args,
  });
  const effectiveTimeoutMs = request.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;

  return await new Promise<AgentSocketMessage>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let polling = false;
    let httpRejected = false;
    // run_id 优先取请求携带的（桌面端 sessionId===runId），否则从 agent_run_started 帧补齐，供超时轮询。
    let runId = request.runId;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      try {
        controller.abort();
      } catch {
        // 收尾时中止流，忽略中止异常。
      }
      callback();
    };

    const startPolling = () => {
      if (settled || polling || httpRejected || !runId) return;
      polling = true;
      request.onStreamDetached?.();
      window.clearTimeout(timeout);
      try {
        controller.abort();
      } catch {
        // 转轮询前中止流，忽略中止异常。
      }
      pollAgentRunUntilTerminal(runId, request.sessionId)
        .then((message) => finish(() => resolve(message)))
        .catch((error) => finish(() => reject(error)));
    };

    const recoverTransportFailure = (error: unknown) => {
      if (polling || settled || httpRejected) return;
      // A lost response does not prove the worker failed. Recover this run, never POST again.
      if (runId) {
        startPolling();
        return;
      }
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    };

    const timeout = window.setTimeout(() => {
      // 超时不 reject：中止 SSE，转后台轮询事件表把 run 的终态取回来（F10）。
      // 拿不到 runId 就无从轮询，退回旧的硬超时语义。
      if (settled || polling || httpRejected) return;
      if (!runId) {
        finish(() =>
          reject(
            new Error(
              `Agent 响应超时（已等待 ${Math.round(effectiveTimeoutMs / 1000)}s）。真实模型较慢时可调大 timeoutMs，并确认后端 STORYFORGE_LLM_TIMEOUT_SECONDS 设置。`,
            ),
          ),
        );
        return;
      }
      startPolling();
    }, effectiveTimeoutMs);

    void (async () => {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'content-type': 'application/json',
            Accept: 'text/event-stream',
            [API_KEY_HEADER]: apiKey,
          },
          body,
          signal: controller.signal,
        });
      } catch (error) {
        recoverTransportFailure(error);
        return;
      }
      if (polling || settled) {
        void response.body?.cancel().catch(() => undefined);
        return;
      }
      if (!response.ok) {
        httpRejected = true;
        window.clearTimeout(timeout);
        const detail = await readRejectedAgentDetail(response);
        finish(() => reject(new Error(detail)));
        return;
      }

      if (!response.body) {
        recoverTransportFailure(new Error('Agent 响应缺少结果流。'));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch (error) {
            recoverTransportFailure(error);
            return;
          }
          if (settled || polling) return;
          const { value, done } = chunk;
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let separator = buffer.search(/\r?\n\r?\n/);
          while (separator !== -1) {
            const match = buffer.slice(separator).match(/^\r?\n\r?\n/);
            const frame = buffer.slice(0, separator);
            buffer = buffer.slice(separator + (match ? match[0].length : 2));
            const message = parseAgentSseFrame(frame);
            if (message) {
              // Validate every frame before consumers see it, not only run_started.
              const wrongRun =
                runId &&
                'run_id' in message &&
                typeof message.run_id === 'string' &&
                message.run_id !== runId;
              const wrongSession =
                'session_id' in message &&
                typeof message.session_id === 'string' &&
                message.session_id !== request.sessionId;
              if (wrongRun || wrongSession) {
                if (runId) startPolling();
                else finish(() => reject(new Error('Agent 流不属于本次会话')));
                return;
              }
              request.onEvent?.(message);
              if (isAgentRunStartedMessage(message) && typeof message.run_id === 'string') {
                runId = message.run_id;
              }
              if (isAgentResultMessage(message) || isAgentErrorMessage(message)) {
                finish(() => resolve(message));
                return;
              }
            }
            separator = buffer.search(/\r?\n\r?\n/);
          }
        }
      } catch (error) {
        // Consumer/decoder failures are not network failures; do not hide them by polling.
        if (polling || settled) return;
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
        return;
      }

      // 流正常结束却没拿到终态帧：有 runId 就转后台轮询重建，否则明确报错。
      if (settled || polling) return;
      if (runId) {
        startPolling();
        return;
      }
      finish(() => reject(new Error('Agent SSE 流在返回结果前结束。')));
    })();
  });
}

// 超时转后台后按间隔轮询事件表，直到重建出终态或彻底超时。纯 REST，不依赖流生命周期。
async function pollAgentRunUntilTerminal(
  runId: string,
  sessionId: string,
): Promise<AgentSocketMessage> {
  const deadline = Date.now() + AGENT_POLL_TOTAL_MS;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    await delay(Math.min(AGENT_POLL_INTERVAL_MS, deadline - Date.now()));
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const events = await readAgentRunWithin(
        (signal) => getAgentRunEvents(runId, { signal }),
        Math.min(15_000, remaining),
      );
      const message = reconstructAgentResultFromEvents(events, { sessionId, runId });
      if (message !== null) {
        return message;
      }
    } catch (error) {
      // 单次轮询失败（sidecar 抖动/重启中）不致命，留到下一轮重试。
      lastError = error;
    }
  }
  throw new AgentRunOutcomeUnknownError(
    runId,
    sessionId,
    `Agent 结果未知：观察时间已到，尚未取回本轮终态${lastError ? `（最后一次错误：${String(lastError)}）` : ''}。请核对原运行，不要重新执行。`,
  );
}

export async function sendAgentControlMessage(
  request: AgentControlMessageRequest,
): Promise<AgentControlAckMessage | AgentErrorMessage> {
  const { baseUrl, apiKey } = await getApiConfig();
  const url = `${trimApiBaseUrl(baseUrl)}/api/ide/agent/sessions/${encodeURIComponent(
    request.sessionId,
  )}/control`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), request.timeoutMs ?? 30000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        [API_KEY_HEADER]: apiKey,
      },
      body: JSON.stringify({
        type: request.type,
        run_id: request.runId,
        payload: request.payload ?? {},
      }),
      signal: controller.signal,
    });
  } catch (error) {
    // 超时会 abort fetch，原样抛出 AbortError（含 caller 可读的中止原因）；网络错误同样透传。
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
  // 领域错误由后端以 200 + {type:"error"} 帧返回，交给调用方按消息处理（不抛出）。
  return (await response.json()) as AgentControlAckMessage | AgentErrorMessage;
}
