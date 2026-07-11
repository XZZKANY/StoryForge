import { reconstructAgentResultFromEvents } from './agent-run-events';
import { getAgentRunEvents } from './agent-runs';
import { getApiConfig, trimApiBaseUrl } from './config';
import { readErrorDetail } from './errors';
import type {
  AgentControlAckMessage,
  AgentControlMessageRequest,
  AgentErrorMessage,
  AgentPermissionRequiredMessage,
  AgentResultMessage,
  AgentRunStartedMessage,
  AgentSocketMessage,
  AgentStepEventMessage,
  AgentToolTraceEventMessage,
  AgentUserMessageRequest,
} from './types';

// Agent 本地 SSE 流等待 LLM 编排返回的默认上限。必须大于后端 _call_llm 的
// STORYFORGE_LLM_TIMEOUT_SECONDS（默认 300s）——审稿会并行发 3 路真模型调用，
// DeepSeek 等慢响应下 120s 远不够，会在后端还没返回时被前端误判超时。
const DEFAULT_AGENT_TIMEOUT_MS = 360_000;

// 前端超时后不再硬 reject（后端 8×300s 结构性长于此，run 仍在跑且花钱）：中止 SSE 流后转
// REST 轮询事件表重建终态（F10）。轮询总上限覆盖剩余最坏时长，间隔避免打爆 sidecar。
const AGENT_POLL_INTERVAL_MS = 3_000;
const AGENT_POLL_TOTAL_MS = 5 * 60_000;

const API_KEY_HEADER = 'X-StoryForge-API-Key';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// 从一段 SSE 帧文本（`data: <json>` 行，可多行）解出前端帧；非 JSON 或无 data 行返回 null。
function parseAgentSseFrame(frame: string): AgentSocketMessage | null {
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join('\n')) as AgentSocketMessage;
  } catch {
    return null;
  }
}

export async function sendAgentUserMessage(
  request: AgentUserMessageRequest,
): Promise<AgentSocketMessage> {
  const { baseUrl, apiKey } = await getApiConfig();
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
    args,
  });
  const effectiveTimeoutMs = request.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;

  return await new Promise<AgentSocketMessage>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let polling = false;
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
      polling = true;
      try {
        controller.abort();
      } catch {
        // 转轮询前中止流，忽略中止异常。
      }
      pollAgentRunUntilTerminal(runId as string, request.sessionId)
        .then((message) => finish(() => resolve(message)))
        .catch((error) => finish(() => reject(error)));
    };

    const timeout = window.setTimeout(() => {
      // 超时不 reject：中止 SSE，转后台轮询事件表把 run 的终态取回来（F10）。
      // 拿不到 runId 就无从轮询，退回旧的硬超时语义。
      if (settled || polling) return;
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
        if (polling || settled) return;
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
        return;
      }
      if (!response.ok || !response.body) {
        if (polling || settled) return;
        const detail = await readErrorDetail(response);
        finish(() => reject(new Error(detail)));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let separator = buffer.search(/\r?\n\r?\n/);
          while (separator !== -1) {
            const match = buffer.slice(separator).match(/^\r?\n\r?\n/);
            const frame = buffer.slice(0, separator);
            buffer = buffer.slice(separator + (match ? match[0].length : 2));
            const message = parseAgentSseFrame(frame);
            if (message) {
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
        // 主动中止（转轮询 / 已收尾）不当失败处理。
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
    await delay(AGENT_POLL_INTERVAL_MS);
    try {
      const events = await getAgentRunEvents(runId);
      const message = reconstructAgentResultFromEvents(events, { sessionId, runId });
      if (message !== null) {
        return message;
      }
    } catch (error) {
      // 单次轮询失败（sidecar 抖动/重启中）不致命，留到下一轮重试。
      lastError = error;
    }
  }
  throw new Error(
    `Agent 后台轮询超时，未在事件表取回终态${lastError ? `（最后一次错误：${String(lastError)}）` : ''}。`,
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

export function isAgentErrorMessage(message: AgentSocketMessage): message is AgentErrorMessage {
  return message.type === 'error' && typeof (message as AgentErrorMessage).detail === 'string';
}

export function isAgentResultMessage(message: AgentSocketMessage): message is AgentResultMessage {
  return (
    message.type === 'agent_result' &&
    typeof (message as AgentResultMessage).assistant_session_id === 'number' &&
    Array.isArray((message as AgentResultMessage).plan) &&
    Array.isArray((message as AgentResultMessage).tool_trace)
  );
}

export function isAgentRunStartedMessage(
  message: AgentSocketMessage,
): message is AgentRunStartedMessage {
  return (
    message.type === 'agent_run_started' &&
    typeof (message as AgentRunStartedMessage).run_id === 'string'
  );
}

export function isAgentStepEventMessage(
  message: AgentSocketMessage,
): message is AgentStepEventMessage {
  return (
    message.type === 'agent_step' &&
    typeof (message as AgentStepEventMessage).step === 'string' &&
    typeof (message as AgentStepEventMessage).status === 'string'
  );
}

export function isAgentToolTraceEventMessage(
  message: AgentSocketMessage,
): message is AgentToolTraceEventMessage {
  return (
    message.type === 'tool_trace' &&
    typeof (message as AgentToolTraceEventMessage).trace === 'object' &&
    (message as AgentToolTraceEventMessage).trace !== null
  );
}

export function isAgentPermissionRequiredMessage(
  message: AgentSocketMessage,
): message is AgentPermissionRequiredMessage {
  return (
    message.type === 'permission_required' &&
    typeof (message as AgentPermissionRequiredMessage).run_id === 'string'
  );
}

export function isAgentControlAckMessage(
  message: AgentSocketMessage,
): message is AgentControlAckMessage {
  return (
    (message.type === 'permission_approved' ||
      message.type === 'permission_denied' ||
      message.type === 'pause_run' ||
      message.type === 'resume_run' ||
      message.type === 'stop_run' ||
      message.type === 'retry_from_checkpoint') &&
    (message as AgentControlAckMessage).status === 'recorded'
  );
}
