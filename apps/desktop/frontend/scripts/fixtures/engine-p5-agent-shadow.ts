import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import {
  importLegacyDb,
  LoopCheckpointStore,
  migrateEngineDb,
  REQUEST_EVIDENCE_KIND,
  SerialQueue,
  SqlAssistantStore,
  SqlRunStore,
  streamAgentUserMessage,
} from '@storyforge/engine';
import type { AgentSocketMessage, AgentUserMessageRequest } from '../../src/lib/api/types';
import { hostDeps, slots } from '../../src/lib/engine/agent';
import { agentRequestBody } from '../../src/lib/engine/agentRoutes';
import { shadowAgentMessage } from '../../src/lib/engine/agentShadow';
import { nativePythonDb, nativeScratchDb } from '../../src/lib/engine/db';
import { nativeProjectReader } from '../../src/lib/engine/reader';
import { refusingHttp } from '../../src/lib/engine/shadow';
import { overlayProject } from '../../src/lib/engine/shadowProject';
import { dbNow } from '../../src/lib/engine/store';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// 与桌面端同形的请求：「起草下一章」按钮（chapter.write，目标文件尚不存在）与一条普通对话。
function requests(projectRoot: string): AgentUserMessageRequest[] {
  const bundle = {
    project_root: projectRoot,
    files: [
      {
        path: `${projectRoot}\\大纲\\项目说明.md`,
        relative_path: '大纲/项目说明.md',
        kind: 'outline',
        title: '项目说明.md',
        excerpt: '# 项目说明 - 大纲：存放总纲、章节节点、反转表。 - 正文：存放章节正文。',
      },
    ],
    summary: { counts: { outline: 1, knowledge: 1 }, hasStoryStructure: true },
    budget: {
      file_count: 1,
      char_count: 40,
      max_files: 12,
      max_excerpt_chars: 4000,
      truncated: false,
    },
  };
  const common = {
    assistantSessionId: null,
    permissionProfile: 'ask',
    agentRoleHints: [],
    agentRoleMentions: [],
  };
  return [
    {
      ...common,
      sessionId: 'p5-shadow-chapter',
      runId: 'p5-shadow-chapter',
      userMessage: '起草第1章',
      intent: 'chapter.write',
      args: {
        project_path: projectRoot,
        instruction: '起草第1章',
        project_name: 'book',
        assistant_session_id: null,
        context_bundle: bundle,
        file_path: '正文/第001章.md',
      },
    },
    {
      ...common,
      sessionId: 'p5-shadow-chat',
      runId: 'p5-shadow-chat',
      userMessage: '先聊聊大纲',
      args: {
        project_path: projectRoot,
        instruction: '先聊聊大纲',
        project_name: 'book',
        assistant_session_id: null,
        context_bundle: bundle,
      },
    },
  ] as unknown as AgentUserMessageRequest[];
}

/** 影子档同一套装配（临时库 + 旧库只读导入 + 叠加读写口 + 拒发端口），但把引擎吐的帧留下来。 */
async function engineOnScratch(request: AgentUserMessageRequest) {
  const db = await nativeScratchDb();
  try {
    await migrateEngineDb(db);
    const imported = await importLegacyDb(
      db,
      { snapshot: (queries) => nativePythonDb.snapshot(queries) },
      dbNow,
    );
    const [parts, appVersion] = await Promise.all([slots(), getVersion()]);
    const store = await SqlRunStore.open(db, dbNow);
    const sessions = new SqlAssistantStore(db, parts.secrets, dbNow, new SerialQueue());
    const overlay = overlayProject(nativeProjectReader);
    const deps = hostDeps({
      store,
      checkpoints: new LoopCheckpointStore(),
      sessions,
      slots: parts,
      appVersion,
      reader: overlay.reader,
      writer: overlay.writer,
      http: () => refusingHttp,
      wait: async () => undefined,
    });
    const frames: Record<string, unknown>[] = [];
    await streamAgentUserMessage(deps, request.sessionId, agentRequestBody(request), (frame) =>
      frames.push(frame),
    );
    const run = await store.findRun(request.runId!);
    const artifacts = run ? [...(await store.artifacts(run.id))] : [];
    const events = run
      ? await db.select(
          'SELECT event_type, message FROM agent_run_events WHERE run_id = $1 ORDER BY sequence',
          [run.id],
        )
      : [];
    const terminal = frames.at(-1) ?? null;
    return {
      sourceFound: imported.source_found,
      platform: navigator.userAgent.includes('Windows') ? 'windows' : 'posix',
      terminal: terminal && {
        type: terminal.type,
        detail: terminal.detail ?? null,
        summary: (terminal.agent_result as { summary?: unknown } | undefined)?.summary ?? null,
      },
      run: run && { status: run.status, current_step: run.current_step },
      events,
      evidenceSteps: artifacts
        .filter((artifact) => artifact.kind === REQUEST_EVIDENCE_KIND)
        .map((artifact) => (artifact.payload as { step?: unknown }).step),
    };
  } finally {
    await db.close();
  }
}

async function runShadowProbe(input: { projectRoot: string }) {
  assert(isTauri(), 'Shadow probe requires the real Native host');
  const direct = [];
  for (const request of requests(input.projectRoot)) direct.push(await engineOnScratch(request));
  // 端到端：Python 那一侧是假的（这里没有 sidecar），只看引擎有没有取到请求、记账落盘。
  for (const request of requests(input.projectRoot))
    await shadowAgentMessage(
      request,
      async () =>
        ({ type: 'agent_result', run_id: request.runId }) as unknown as AgentSocketMessage,
    );
  return { native: true, direct };
}

declare global {
  interface Window {
    __ENGINE_P5_SHADOW__: { runShadowProbe: typeof runShadowProbe };
  }
}
window.__ENGINE_P5_SHADOW__ = { runShadowProbe };
document.documentElement.dataset.engineP5ShadowReady = 'true';
