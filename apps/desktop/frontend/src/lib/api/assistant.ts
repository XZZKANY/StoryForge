import type { ProviderHealth } from '../provider-config';
import type { AssistantFailedTurnRecord, AssistantSessionRecord, ReviseRequest } from './types';

// 修订、续写、测连接与会话都在进程内的 TS 引擎里跑；引擎包按需加载。
const engine = () => import('../engine/assistant');
const sessions = () => import('../engine/sessions');

export async function listAssistantSessions(options?: {
  projectPath?: string;
  limit?: number;
}): Promise<AssistantSessionRecord[]> {
  return (await sessions()).listEngineSessions(options);
}

export async function renameAssistantSession(
  assistantSessionId: number,
  title: string,
): Promise<void> {
  await (await sessions()).renameEngineSession(assistantSessionId, title);
}

export async function getAssistantSession(
  assistantSessionId: number,
): Promise<AssistantSessionRecord> {
  return (await sessions()).getEngineSession(assistantSessionId);
}

export async function getAssistantSessionFailedTurns(
  assistantSessionId: number,
): Promise<AssistantFailedTurnRecord[]> {
  return (await sessions()).getEngineSessionFailedTurns(assistantSessionId);
}

export type AssistantReviseResult = {
  before: string;
  after: string;
  summary: string;
  model: string;
  latencyMs: number;
  completionTokens: number | null;
  assistantSessionId: number;
};

/**
 * 单发修订：整文件全文 + 指令进，真实 LLM 修订后全文出（同步、非流式）。
 * 行间对话（Ctrl+K）走这条通道换取「跟手」，不经 agent 循环。模型未配置或调用失败的错误明细原样透出，
 * 绝不伪造兜底。
 */
export async function reviseFileContent(payload: {
  filePath: string;
  content: string;
  instruction: string;
  projectName?: string | null;
  projectRoot?: string | null;
  assistantSessionId?: number | null;
  qualityGate?: 'polish';
  signal?: AbortSignal;
}): Promise<AssistantReviseResult> {
  return (await engine()).reviseWithEngine(payload);
}

export type ContinueProseResult = {
  /** 权威结果：已做过确定性后处理，不是 delta 的拼接。 */
  text: string;
  model: string;
  assistantSessionId: number;
};

/**
 * 流式续写：在光标处续写一段，逐块回调 onDelta 供即时观感。
 *
 * onDelta 只用于「让作者看到笔在动」；最终写回一律用 resolve 出来的 text。
 */
export type ContinuePayload = {
  filePath: string;
  content: string;
  cursorLine: number;
  instruction?: string | null;
  projectRoot?: string | null;
  assistantSessionId?: number | null;
  targetChars?: number | null;
  contextBundle?: ReviseRequest['contextBundle'];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
};

export async function streamContinueProse(payload: ContinuePayload): Promise<ContinueProseResult> {
  return (await engine()).continueWithEngine(payload);
}

export async function probeProviderHealth(): Promise<ProviderHealth> {
  return (await engine()).probeWithEngine();
}
