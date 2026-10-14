import { getVersion } from '@tauri-apps/api/app';
import {
  AssistantSessionNotFoundError,
  createAgentToolRegistry,
  LoopCheckpointStore,
  MemoryRunStore,
  storeRunSources,
  storeToolArtifactQuery,
  type AgentHostDeps,
  type RunReadDeps,
  type ConversationSources,
  type MessageRow,
  type SessionTitlePort,
  type ToolCallRow,
} from '@storyforge/engine';
import { getApiConfig, trimApiBaseUrl } from '../api/config';
import { readErrorDetail } from '../api/errors';
import { clock, platform, pythonAssistantStore, wait } from './assistant';
import { nativeHttpPort, nativeLlmSource } from './llm';
import { nativeProjectReader } from './reader';
import { workerRegexCompiler } from './regex';
import { nativeProjectWriter } from './writer';

/**
 * run / 事件 / artifact 与续跑检查点：P4 换 sqlite 之前只活在这个 WebView 里，刷新或重启就没了
 * （迁移计划 §2.6：不跨重启续跑）。同一个 WebView 里所有 ts 档的 run 共用这一份。
 */
export const engineRuns = {
  store: new MemoryRunStore(),
  checkpoints: new LoopCheckpointStore(),
};

const regex = workerRegexCompiler();
const hex = () => crypto.randomUUID().replace(/-/g, '');

type Json = { [key: string]: unknown };
const plainObject = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** 会话的 Python 那一半（P4 前会话库还在 Python）：经现有只读接口取。 */
async function pythonGet(path: string): Promise<unknown> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}${path}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { 'X-StoryForge-API-Key': apiKey },
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    if (response.status === 404) throw new AssistantSessionNotFoundError(detail);
    throw new Error(detail);
  }
  return response.json();
}

async function pythonSession(sessionId: number): Promise<Json> {
  const data = await pythonGet(`/api/assistant/sessions/${sessionId}`);
  if (!plainObject(data) || data.id !== sessionId || typeof data.title !== 'string')
    throw new TypeError('Invalid assistant session response');
  return data;
}

function messageRows(value: unknown): MessageRow[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid assistant messages response');
  return value
    .map((row) => {
      if (
        !plainObject(row) ||
        !safeId(row.id) ||
        typeof row.role !== 'string' ||
        typeof row.content !== 'string'
      )
        throw new TypeError('Invalid assistant message row');
      return { id: row.id, role: row.role, content: row.content };
    })
    .sort((a, b) => a.id - b.id);
}

function toolCallRows(value: unknown): ToolCallRow[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid assistant tool calls response');
  const optionalString = (item: unknown) => item === null || typeof item === 'string';
  return value
    .map((row) => {
      if (
        !plainObject(row) ||
        !safeId(row.id) ||
        typeof row.tool_name !== 'string' ||
        typeof row.status !== 'string' ||
        !plainObject(row.input_summary) ||
        !plainObject(row.output_summary) ||
        !optionalString(row.related_type) ||
        !(row.related_id === null || safeId(row.related_id))
      )
        throw new TypeError('Invalid assistant tool call row');
      return {
        id: row.id,
        tool_name: row.tool_name,
        status: row.status,
        input_summary: row.input_summary,
        output_summary: row.output_summary,
        related_type: row.related_type as string | null,
        related_id: row.related_id as number | null,
      };
    })
    .sort((a, b) => a.id - b.id);
}

export const pythonConversation: Pick<ConversationSources, 'messages' | 'toolCalls'> = {
  messages: async (sessionId) => messageRows((await pythonSession(sessionId)).messages),
  toolCalls: async (sessionId) =>
    toolCallRows(await pythonGet(`/api/assistant/sessions/${sessionId}/tool-calls`)),
};

/**
 * 会话标题：读 Python 会话库。P4 前 Python 没有改标题的接口（迁移期间 Python 只修不加），
 * 隐藏标题任务照常算出标题、记进事件，但不改写会话——左栏仍显示新建时的「IDE Agent: …」。
 */
export const pythonTitles: SessionTitlePort = {
  title: async (sessionId) => (await pythonSession(sessionId)).title as string,
  setTitle: async () => undefined,
};

async function slots() {
  const [main, polish] = await Promise.all([nativeLlmSource('main'), nativeLlmSource('polish')]);
  const secrets = { values: [...new Set([...main.secrets.values, ...polish.secrets.values])] };
  return { main, polish, secrets };
}

/** 读接口（事件 / 保存点）只要存储、脱敏用的密钥快照与读口，不建工具。 */
export async function engineReadDeps(): Promise<RunReadDeps> {
  const { secrets } = await slots();
  return {
    store: engineRuns.store,
    checkpoints: engineRuns.checkpoints,
    reader: nativeProjectReader,
    secrets,
  };
}

/** 一次作者消息 / 控制消息用的依赖：模型配置每次重新取（设置里换模型下一条就生效）。 */
export async function engineAgentDeps(): Promise<AgentHostDeps> {
  const [{ main, polish, secrets }, appVersion] = await Promise.all([slots(), getVersion()]);
  const os = platform();
  const tools = createAgentToolRegistry({
    reader: nativeProjectReader,
    writer: nativeProjectWriter,
    platform: os,
    secrets,
    proposals: { newUuid: () => crypto.randomUUID(), now: () => new Date() },
    artifacts: storeToolArtifactQuery(engineRuns.store),
    regex,
    clock,
    newHex: hex,
  });
  return {
    store: engineRuns.store,
    checkpoints: engineRuns.checkpoints,
    secrets,
    assistant: pythonAssistantStore,
    titles: pythonTitles,
    conversation: { ...pythonConversation, ...storeRunSources(engineRuns.store) },
    reader: nativeProjectReader,
    platform: os,
    source: main.source,
    polish: { source: polish.source, http: nativeHttpPort('polish') },
    llm: { http: nativeHttpPort('main'), clock, wait, random: Math.random, appVersion },
    tools,
    ids: { stream: () => crypto.randomUUID(), attempt: () => crypto.randomUUID(), hex },
    newRunId: hex,
  };
}
