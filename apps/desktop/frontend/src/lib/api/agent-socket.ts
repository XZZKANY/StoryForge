import { reconstructAgentResultFromEvents } from './agent-run-events';
import { getAgentRunEvents } from './agent-runs';
import { getApiConfig, trimApiBaseUrl } from './config';
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

// Agent WebSocket 等待 LLM 编排返回的默认上限。必须大于后端 _call_llm 的
// STORYFORGE_LLM_TIMEOUT_SECONDS（默认 300s）——审稿会并行发 3 路真模型调用，
// DeepSeek 等慢响应下 120s 远不够，会在后端还没返回时被前端误判超时。
const DEFAULT_AGENT_TIMEOUT_MS = 360_000;

// 前端超时后不再硬 reject（后端 8×300s 结构性长于此，run 仍在跑且花钱）：close socket 后转
// REST 轮询事件表重建终态（F10）。轮询总上限覆盖剩余最坏时长，间隔避免打爆 sidecar。
const AGENT_POLL_INTERVAL_MS = 3_000;
const AGENT_POLL_TOTAL_MS = 5 * 60_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function websocketUrlFromBaseUrl(baseUrl: string, path: string): string {
  const url = new URL(path, trimApiBaseUrl(baseUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function apiKeyWebSocketProtocol(apiKey: string): string {
  const bytes = new TextEncoder().encode(apiKey);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `storyforge-api-key.${encoded}`;
}

export async function sendAgentUserMessage(
  request: AgentUserMessageRequest,
): Promise<AgentSocketMessage> {
  const { baseUrl, apiKey } = await getApiConfig();
  const socketUrl = websocketUrlFromBaseUrl(
    baseUrl,
    `/api/ide/agent/sessions/${encodeURIComponent(request.sessionId)}`,
  );

  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl, [apiKeyWebSocketProtocol(apiKey)]);
    let settled = false;
    let polling = false;
    const effectiveTimeoutMs = request.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
    const timeout = window.setTimeout(() => {
      // 超时不 reject：close socket，转后台轮询事件表把 run 的终态取回来（F10）。
      // 拿不到 runId 就无从轮询，退回旧的硬超时语义。
      if (settled || polling) return;
      if (!request.runId) {
        finish(() =>
          reject(
            new Error(
              `Agent 响应超时（已等待 ${Math.round(effectiveTimeoutMs / 1000)}s）。真实模型较慢时可调大 timeoutMs，并确认后端 STORYFORGE_LLM_TIMEOUT_SECONDS 设置。`,
            ),
          ),
        );
        return;
      }
      polling = true;
      try {
        socket.close();
      } catch {
        // 转轮询前关 socket，忽略关闭异常。
      }
      pollAgentRunUntilTerminal(request.runId, request.sessionId)
        .then((message) => finish(() => resolve(message)))
        .catch((error) => finish(() => reject(error)));
    }, effectiveTimeoutMs);

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // Ignore close errors after the response is received.
      }
      callback();
    };

    socket.onopen = () => {
      const args = {
        ...(request.args ?? {}),
        ...(request.agentRoleHints ? { agent_role_hints: request.agentRoleHints } : {}),
        ...(request.agentRoleMentions ? { agent_role_mentions: request.agentRoleMentions } : {}),
      };
      socket.send(
        JSON.stringify({
          type: 'user_message',
          stream: request.stream ?? Boolean(request.onEvent),
          run_id: request.runId,
          user_message: request.userMessage,
          assistant_session_id: request.assistantSessionId ?? undefined,
          intent: request.intent,
          args,
        }),
      );
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as AgentSocketMessage;
        request.onEvent?.(message);
        if (isAgentResultMessage(message) || isAgentErrorMessage(message)) {
          finish(() => resolve(message));
        }
      } catch (error) {
        finish(() => reject(error));
      }
    };

    socket.onerror = () => {
      finish(() => reject(new Error('Agent WebSocket 连接失败。')));
    };

    socket.onclose = (event) => {
      // 转后台轮询时是我们主动关的 socket，不当失败处理。
      if (!settled && !polling) {
        const detail =
          event.reason || (event.code === 1000 ? '返回结果前关闭' : String(event.code));
        finish(() => reject(new Error(`Agent WebSocket 已关闭：${detail}`)));
      }
    };
  });
}

// 超时转后台后按间隔轮询事件表，直到重建出终态或彻底超时。纯 REST，不依赖 socket 生命周期。
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
  const socketUrl = websocketUrlFromBaseUrl(
    baseUrl,
    `/api/ide/agent/sessions/${encodeURIComponent(request.sessionId)}`,
  );

  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl, [apiKeyWebSocketProtocol(apiKey)]);
    let settled = false;
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error('Agent 控制消息响应超时。')));
    }, request.timeoutMs ?? 30000);

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // Ignore close errors after the response is received.
      }
      callback();
    };

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: request.type,
          run_id: request.runId,
          payload: request.payload ?? {},
        }),
      );
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as AgentSocketMessage;
        if (isAgentControlAckMessage(message) || isAgentErrorMessage(message)) {
          finish(() => resolve(message));
        }
      } catch (error) {
        finish(() => reject(error));
      }
    };

    socket.onerror = () => {
      finish(() => reject(new Error('Agent 控制 WebSocket 连接失败。')));
    };

    socket.onclose = (event) => {
      if (!settled) {
        const detail =
          event.reason || (event.code === 1000 ? '返回结果前关闭' : String(event.code));
        finish(() => reject(new Error(`Agent 控制 WebSocket 已关闭：${detail}`)));
      }
    };
  });
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
