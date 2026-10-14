import {
  AgentHostRejection,
  agentRunSavePoints as engineSavePoints,
  dumpJson,
  listAgentRunEvents,
  postAgentControl,
  streamAgentUserMessage,
} from '@storyforge/engine';
import type { AgentRunEventRecord } from '../api/agent-run-events';
import type {
  AgentControlAckMessage,
  AgentControlMessageRequest,
  AgentErrorMessage,
  AgentRunSavePointProjection,
  AgentSocketMessage,
  AgentUserMessageRequest,
} from '../api/types';
import { engineAgentDeps, engineReadDeps, engineRuns } from './agent';

/** 与 SSE 线上同一种编码：Python json.dumps 写、前端 JSON.parse 读（整数值浮点读回成整数）。 */
const wire = <T>(value: unknown): T => JSON.parse(dumpJson(value, { ensureAscii: false })) as T;

/** 宿主在执行前拒掉的请求：与 SSE 路由的 HTTP 拒绝同样以普通 Error 交给调用方。 */
function rejected(error: unknown): unknown {
  return error instanceof AgentHostRejection ? new Error(error.message) : error;
}

/** 这个 WebView 里的引擎是否认识这个 run（读接口与控制按 run 归属分流）。 */
export async function ownsRun(runId: string): Promise<boolean> {
  return (await engineRuns.store.findRun(runId)) !== null;
}

/**
 * 作者消息的 ts 档：同一个请求体交给进程内宿主，帧按产生顺序回调，结果帧或错误帧即终态。
 * 没有传输层，所以没有超时转轮询：模型请求自己的超时由引擎出网客户端负责。
 */
export async function sendAgentUserMessage(
  request: AgentUserMessageRequest,
): Promise<AgentSocketMessage> {
  if (request.executionProtocol === 'external_writeback_v1')
    throw new Error('当前宿主未开放连续写回协议');
  const args = {
    ...(request.args ?? {}),
    ...(request.agentRoleHints ? { agent_role_hints: request.agentRoleHints } : {}),
    ...(request.agentRoleMentions ? { agent_role_mentions: request.agentRoleMentions } : {}),
  };
  const body = {
    user_message: request.userMessage,
    run_id: request.runId,
    assistant_session_id: request.assistantSessionId ?? undefined,
    intent: request.intent,
    permission_profile: request.permissionProfile,
    args,
  };
  let terminal: AgentSocketMessage | null = null;
  try {
    await streamAgentUserMessage(
      await engineAgentDeps(),
      request.sessionId,
      // 与 HTTP 请求体同一种编码：undefined 的键不出现。
      JSON.parse(JSON.stringify(body)),
      (frame) => {
        const message = wire<AgentSocketMessage>(frame);
        request.onEvent?.(message);
        if (message.type === 'agent_result' || message.type === 'error') terminal = message;
      },
    );
  } catch (error) {
    throw rejected(error);
  }
  if (terminal === null) throw new Error('Agent 流在返回结果前结束。');
  return terminal;
}

export async function sendAgentControlMessage(
  request: AgentControlMessageRequest,
): Promise<AgentControlAckMessage | AgentErrorMessage> {
  try {
    const ack = await postAgentControl(await engineAgentDeps(), request.sessionId, {
      type: request.type,
      run_id: request.runId,
      payload: request.payload ?? {},
    });
    return wire<AgentControlAckMessage | AgentErrorMessage>(ack);
  } catch (error) {
    throw rejected(error);
  }
}

export async function agentRunEvents(runId: string): Promise<AgentRunEventRecord[]> {
  return wire(await listAgentRunEvents(await engineReadDeps(), runId));
}

export async function agentRunSavePoints(runId: string): Promise<AgentRunSavePointProjection> {
  return wire(await engineSavePoints(await engineReadDeps(), runId));
}
