import { getVersion } from '@tauri-apps/api/app';
import {
  createAgentToolRegistry,
  storeRunSources,
  storeToolArtifactQuery,
  type AgentHostDeps,
  type HttpPort,
  type LoopCheckpointStore,
  type ProjectReader,
  type ProjectWriter,
  type RunReadDeps,
  type SqlAssistantStore,
} from '@storyforge/engine';
import { clock, platform, wait } from './assistant';
import { nativeHttpPort, nativeLlmSource } from './llm';
import { nativeProjectReader } from './reader';
import { workerRegexCompiler } from './regex';
import { engineRuns, engineSessions } from './store';
import { nativeProjectWriter } from './writer';

const regex = workerRegexCompiler();
const hex = () => crypto.randomUUID().replace(/-/g, '');

export async function slots() {
  const [main, polish] = await Promise.all([nativeLlmSource('main'), nativeLlmSource('polish')]);
  const secrets = { values: [...new Set([...main.secrets.values, ...polish.secrets.values])] };
  return { main, polish, secrets };
}

/** 读接口（事件 / 保存点）只要存储、脱敏用的密钥快照与读口，不建工具。 */
export async function engineReadDeps(): Promise<RunReadDeps> {
  const [{ secrets }, runs] = await Promise.all([slots(), engineRuns()]);
  return {
    store: runs.store,
    checkpoints: runs.checkpoints,
    reader: nativeProjectReader,
    secrets,
  };
}

/**
 * 一次作者消息 / 控制消息用的依赖：模型配置每次重新取（设置里换模型下一条就生效）。
 * ts 档的会话、消息、工具调用与标题都在引擎库（会话放哪个库跟着 `engine.agentLoop` 走）。
 */
export async function engineAgentDeps(): Promise<AgentHostDeps> {
  const [{ main, polish, secrets }, appVersion, runs] = await Promise.all([
    slots(),
    getVersion(),
    engineRuns(),
  ]);
  return hostDeps({
    ...runs,
    sessions: await engineSessions(secrets),
    slots: { main, polish, secrets },
    appVersion,
    reader: nativeProjectReader,
    writer: nativeProjectWriter,
    http: nativeHttpPort,
    wait,
  });
}

/** 宿主依赖的装配：存储、读写口与出网端口由调用方给（影子档换成临时库、叠加读写口与拒发端口）。 */
export function hostDeps(parts: {
  store: AgentHostDeps['store'];
  checkpoints: LoopCheckpointStore;
  sessions: SqlAssistantStore;
  slots: Awaited<ReturnType<typeof slots>>;
  appVersion: string;
  reader: ProjectReader;
  writer: ProjectWriter;
  http: (slot: 'main' | 'polish') => HttpPort;
  wait: (seconds: number) => Promise<void>;
}): AgentHostDeps {
  const { store, sessions, reader, writer } = parts;
  const { main, polish, secrets } = parts.slots;
  const os = platform();
  const tools = createAgentToolRegistry({
    reader,
    writer,
    platform: os,
    secrets,
    proposals: { newUuid: () => crypto.randomUUID(), now: () => new Date() },
    artifacts: storeToolArtifactQuery(store),
    regex,
    clock,
    newHex: hex,
  });
  return {
    store,
    checkpoints: parts.checkpoints,
    secrets,
    assistant: sessions,
    titles: sessions,
    conversation: {
      messages: (sessionId) => sessions.messages(sessionId),
      toolCalls: (sessionId) => sessions.toolCalls(sessionId),
      ...storeRunSources(store),
    },
    reader,
    platform: os,
    source: main.source,
    polish: { source: polish.source, http: parts.http('polish') },
    llm: {
      http: parts.http('main'),
      clock,
      wait: parts.wait,
      random: Math.random,
      appVersion: parts.appVersion,
    },
    tools,
    ids: { stream: () => crypto.randomUUID(), attempt: () => crypto.randomUUID(), hex },
    newRunId: hex,
  };
}
