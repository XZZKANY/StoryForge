import { isTauri } from '@tauri-apps/api/core';
import { getAgentRunEvents } from '../../src/lib/api/agent-runs';
import { sendAgentControlMessage, sendAgentUserMessage } from '../../src/lib/api/agent-socket';
import type { AgentResultMessage, AgentSocketMessage } from '../../src/lib/api/types';
import { chapterBriefFromAgentResult } from '../../src/components/chat-window/chapter-brief';
import { engineRuns } from '../../src/lib/engine/agent';
import { nativeLlmSource } from '../../src/lib/engine/llm';
import { TauriFileSystem } from '../../src/lib/tauri-fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Obj = { [key: string]: unknown };
const describe = (error: unknown) => ({
  name: error instanceof Error ? error.name : typeof error,
  message: error instanceof Error ? error.message : String(error),
});

/** 每次模型派发的本地证据：操作名、状态、用量（只读引擎存储，不出网）。 */
async function usageOf(runId: string) {
  const run = await engineRuns.store.findRun(runId);
  if (!run) return [];
  return (await engineRuns.store.artifacts(run.id))
    .filter((artifact) => artifact.kind === 'model_request_evidence')
    .map((artifact) => {
      const payload = artifact.payload as Obj;
      const usage = (payload.usage ?? {}) as Obj;
      return {
        operation: payload.step ?? null,
        status: payload.status ?? null,
        finish: payload.finish_reason ?? null,
        prompt: Number(usage.prompt_tokens ?? 0),
        completion: Number(usage.completion_tokens ?? 0),
      };
    });
}

/** 一条作者消息：帧计数、首帧 / 首个文本增量的时刻、结果或错误、本 run 的用量。 */
async function send(input: {
  runId: string;
  userMessage: string;
  intent?: 'chapter.write' | 'file.review' | 'file.revise';
  assistantSessionId: number | null;
  args: Obj;
}) {
  const startedAt = Date.now();
  const frames: { type: string; at: number; tool?: string }[] = [];
  const result = await sendAgentUserMessage({
    sessionId: input.runId,
    runId: input.runId,
    userMessage: input.userMessage,
    intent: input.intent,
    assistantSessionId: input.assistantSessionId,
    permissionProfile: 'ask',
    args: input.args,
    onEvent: (message: AgentSocketMessage) => {
      const value = message as unknown as Obj;
      const trace = value.trace as Obj | undefined;
      frames.push({
        type: String(value.type),
        at: Date.now() - startedAt,
        ...(trace && typeof trace.tool_name === 'string' ? { tool: trace.tool_name } : {}),
      });
    },
  }).then(
    (message) => ({ ok: true as const, message }),
    (error: unknown) => ({ ok: false as const, error: describe(error) }),
  );
  return {
    ms: Date.now() - startedAt,
    frames,
    result,
    events: (await getAgentRunEvents(input.runId).catch(() => [])).map((event) => event.event_type),
    usage: await usageOf(input.runId),
  };
}

// The author's real provider through Rust; a synthetic project and a synthetic session store.
async function runAgentRealRun(input: { projectRoot: string }) {
  assert(isTauri(), 'Real run requires the real Native host');
  localStorage.setItem('engine.agentLoop', 'ts');
  const { source } = await nativeLlmSource('main');
  const provider = {
    model: source.STORYFORGE_LLM_MODEL ?? null,
    keyIsPlaceholder: source.STORYFORGE_LLM_API_KEY === '[已隐藏的密钥]',
  };
  const target = `${input.projectRoot}\\正文\\第003章.md`;
  const base = { project_path: input.projectRoot, project_name: '合成验证书' };

  // 1. 新会话 → 起草下一章：整理章纲后停下等作者确认。
  const write = await send({
    runId: 'p3-real-write',
    userMessage: '起草第三章：林舟跟着老周去水厂，查清停水和那辆翻倒运水车的来由。',
    intent: 'chapter.write',
    assistantSessionId: null,
    args: { ...base, file_path: target },
  });
  const writeResult = write.result.ok ? (write.result.message as AgentResultMessage) : null;
  const sessionId = writeResult?.assistant_session_id ?? null;
  const brief = writeResult ? chapterBriefFromAgentResult(writeResult) : null;

  // 2. 作者确认章纲（照 UI 的 onConfirmChapterBrief 原样回传）→ 起草 → 检查 → 补丁。
  let confirm: Obj | null = null;
  if (brief) {
    const startedAt = Date.now();
    confirm = await sendAgentControlMessage({
      sessionId: 'p3-real-write',
      runId: 'p3-real-write',
      type: 'resume_run',
      payload: {
        source: 'desktop.timeline',
        chapter_brief: {
          brief_id: brief.briefId,
          revision: brief.revision,
          chapter_title: brief.chapterTitle,
          goal: brief.goal,
          pov: brief.pov,
          setting: brief.setting,
          required_beats: brief.requiredBeats,
          forbidden_items: brief.forbiddenItems,
          continuity_constraints: brief.continuityConstraints,
          target_chars_min: brief.targetCharsMin,
          target_chars_max: brief.targetCharsMax,
        },
      },
    }).then(
      (ack) => ({ ok: true, ack, ms: Date.now() - startedAt }) as Obj,
      (error: unknown) => ({ ok: false, error: describe(error), ms: Date.now() - startedAt }),
    );
  }
  const resumed = ((confirm?.ack as Obj | undefined)?.resumed_result ?? null) as Obj | null;
  const patch = (resumed?.proposed_patch ?? null) as Obj | null;

  // 3. 作者接受补丁：走编辑器写回最终落到的那条原生条件写（新章，基线是「不存在」）。
  let writeback: Obj | null = null;
  if (patch && typeof patch.after === 'string' && typeof patch.file_path === 'string') {
    writeback = await TauriFileSystem.writeFileIfUnchanged(
      input.projectRoot,
      patch.file_path,
      patch.after,
      patch.before ? { kind: 'content', content: String(patch.before) } : { kind: 'missing' },
    ).then(
      () => ({ ok: true }),
      (error: unknown) => ({ ok: false, error: describe(error) }),
    );
  }
  const written = writeback?.ok
    ? await TauriFileSystem.readProjectFile(input.projectRoot, target).catch(() => null)
    : null;

  // 4. 同一会话里审一次稿、修订一次（修订只看补丁，不写回）。
  const reviewTarget = written ? target : `${input.projectRoot}\\正文\\第002章.md`;
  const reviewContent =
    written ?? (await TauriFileSystem.readProjectFile(input.projectRoot, reviewTarget));
  const review = await send({
    runId: 'p3-real-review',
    userMessage: '审一下这一章，重点看节奏和人物动机。',
    intent: 'file.review',
    assistantSessionId: sessionId,
    args: { ...base, file_path: reviewTarget, content: reviewContent },
  });
  const reviewResult = review.result.ok ? (review.result.message as Obj) : null;
  const reviewReport = ((reviewResult?.agent_result as Obj | undefined)?.review_report ??
    null) as Obj | null;
  const revise = await send({
    runId: 'p3-real-revise',
    userMessage: '按审稿意见修订这一章，开头三段写得更紧一些。',
    intent: 'file.revise',
    assistantSessionId: sessionId,
    args: {
      ...base,
      file_path: reviewTarget,
      content: reviewContent,
      ...(reviewReport ? { review_report: reviewReport } : {}),
    },
  });

  return {
    native: isTauri(),
    provider,
    target,
    write,
    brief,
    confirm,
    resumed,
    patch,
    writeback,
    written,
    resumedUsage: await usageOf('p3-real-write'),
    reviewTarget,
    review,
    revise,
  };
}

declare global {
  interface Window {
    __ENGINE_P3_AGENT_REAL__: { runAgentRealRun: typeof runAgentRealRun };
  }
}
window.__ENGINE_P3_AGENT_REAL__ = { runAgentRealRun };
document.documentElement.dataset.engineP3AgentRealReady = 'true';
