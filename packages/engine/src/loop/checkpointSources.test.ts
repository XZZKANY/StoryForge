import { describe, expect, it } from 'vitest';
import type { AssistantStore } from '../assistant/service';
import { AUTHOR_INSTRUCTIONS_PATH } from '../kernel/fsTools';
import { memoryProject } from '../kernel/memoryProject.test-support';
import { chatResponse, type ChatRequest } from '../llm/contracts';
import { runChatLoop } from './chatLoop';
import { diagnoseCheckpoint, LoopCheckpointStore } from './chatLoopCheckpoints';
import { RunControlScope } from './runControl';
import { listLoopToolSpecs } from './tools/catalog';
import { toolDefinitionFromSpec } from './tools/execution';

const ROOT = 'D:/book';
const OLD = '称呼必须使用旧称青禾。';
const FRESH = '称呼必须使用新称林舟。';
const encoded = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});

function setup() {
  const project = memoryProject(ROOT, { [AUTHOR_INSTRUCTIONS_PATH]: encoded(OLD) });
  const checkpoints = new LoopCheckpointStore();
  const requests: ChatRequest[] = [];
  let paused = false;
  let editWhileBuilding = false;
  const unexpected = async (): Promise<never> => {
    throw new Error('unexpected');
  };
  const assistant = {
    createSession: unexpected,
    getSession: unexpected,
    appendMessage: unexpected,
    createToolCall: async (_id: number, input: { input_summary: unknown }) => ({
      id: 1,
      input_summary: input.input_summary,
    }),
    updateToolCall: async (id: number, patch: { input_summary?: unknown }) => ({
      id,
      input_summary: patch.input_summary ?? {},
    }),
  } as unknown as AssistantStore;
  // 拼消息时会先读作者指令、再取对话历史：在取历史这一刻改掉指令文件，正好落在「读完指令、还没记指纹」之间。
  const conversation = {
    messages: async () => {
      if (editWhileBuilding) {
        project.apply({ [AUTHOR_INSTRUCTIONS_PATH]: encoded(FRESH) });
        editWhileBuilding = false;
      }
      return [];
    },
    toolCalls: async () => [],
    runEvents: async () => [],
    runArtifacts: async () => [],
    artifact: async () => null,
  };
  const pause = () => (paused ? { status: 'paused', reason: 'author-pause' } : null);
  const run = (id: string, resumed = false) =>
    runChatLoop(
      {
        reader: project.reader,
        conversation,
        platform: 'windows',
        assistant,
        secrets: { values: [] },
        buildProvider: () => ({
          streaming: false,
          complete: async (request: ChatRequest) => {
            requests.push(request);
            return chatResponse({ content: '回答' });
          },
          stream: unexpected,
        }),
        checkpoints,
        scope: new RunControlScope(pause, { clock: () => 1000, wait: async () => {} }),
        newStreamId: () => 'stream',
      } as never,
      {
        run: {
          public_id: id,
          permission_profile: 'ask',
          assistant_session_id: 1,
          current_step: resumed ? 'resumed' : null,
        },
        definitions: listLoopToolSpecs().map((spec) => toolDefinitionFromSpec(spec, unexpected)),
        source: { STORYFORGE_LLM_MODEL: 'm-1' },
        assistantSessionId: 1,
        userMessage: '请沿用作者指令',
        projectPath: ROOT,
        currentFile: null,
        executeTool: unexpected,
        onTrace: () => {},
        shouldInterrupt: pause,
      } as never,
    );
  return {
    project,
    checkpoints,
    run,
    pauseNextRun: () => (paused = true),
    editInstructionsWhileBuilding: () => (editWhileBuilding = true),
  };
}

describe('pausing right after the author instructions changed', () => {
  it('refuses to resume a run whose prompt was built from instructions that have since changed', async () => {
    const h = setup();
    h.editInstructionsWhileBuilding();
    h.pauseNextRun();
    await h.run('race');
    const saved = h.checkpoints.latest('race')!;
    expect(saved.checkpoint.messages.some((message) => message.content?.includes(OLD))).toBe(true);
    const diagnostic = await diagnoseCheckpoint({ reader: h.project.reader } as never, saved, {
      public_id: 'race',
      assistant_session_id: 1,
      permission_profile: 'ask',
    });
    expect(diagnostic).toMatchObject({ can_resume: false, reason: 'source_version_changed' });
  });

  it('still resumes when nothing changed', async () => {
    const h = setup();
    h.pauseNextRun();
    await h.run('calm');
    const diagnostic = await diagnoseCheckpoint(
      { reader: h.project.reader } as never,
      h.checkpoints.latest('calm')!,
      { public_id: 'calm', assistant_session_id: 1, permission_profile: 'ask' },
    );
    expect(diagnostic.can_resume).toBe(true);
  });
});
