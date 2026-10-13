import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-conversation.windows.json';
import type { EncodedFile } from '../kernel/contextFixture.test-support';
import { dumpJson, parseJson, type JsonObject } from '../kernel/json';
import { nativeProjectPath } from '../kernel/fsTools';
import { memoryProject } from '../kernel/memoryProject.test-support';
import { sha256Hex } from '../kernel/sha256';
import { chatResponse, TokenUsage, ToolCall, type ChatRequest } from '../llm/contracts';
import { authorViewFromPayload } from './authorView';
import {
  CompactionRejected,
  ContextBudgetError,
  createCompactionCheckpoint,
  projectConversationHistory,
  type ConversationSources,
} from './conversationHistory';
import { storyforgeMessages } from './loopMessages';
import { AUTHOR_INSTRUCTIONS_PREFIX, SYSTEM_PROMPT } from './promptContext';
import {
  mergeCostBreakdown,
  reviewFeedback,
  reviseFeedback,
  serializeToolOutput,
  toolOutputSummary,
} from './toolFeedback';
import { chatContextBlock } from './tools/runtimeArguments';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- golden 记录按函数名分派后才知道形状
type Record_ = {
  fn: string;
  args_json: string;
  output_json?: string;
  error?: { type: string; message: string };
};
const ROOT = golden.synthetic_root;
const platform = golden.platform as 'windows' | 'posix';
const secrets = { values: [golden.secret] };
const ESCAPED_ROOT = JSON.stringify(ROOT).slice(1, -1);
const plain = (value: unknown): unknown => JSON.parse(dumpJson(value, { ensureAscii: false }));
const stable = (value: unknown): unknown =>
  JSON.parse(dumpJson(value, { ensureAscii: false }).split(ESCAPED_ROOT).join('$ROOT'));

function sources(rows: Obj): ConversationSources {
  return {
    messages: async () => rows.messages,
    toolCalls: async () => rows.tool_calls,
    runEvents: async () => rows.events,
    runArtifacts: async () => rows.artifacts,
    artifact: async (id) => rows.artifacts.find((row: Obj) => row.id === id) ?? null,
  };
}

/** 与 Python 预言机同一个脚本化压缩模型：每个新来源一条，引用前十个码点。 */
function scriptedProvider(mode: string, calls: Obj[]) {
  return {
    async complete(request: ChatRequest) {
      const modelInput = parseJson(request.messages[1].content!, 'input') as JsonObject;
      calls.push({
        system: request.messages[0].content,
        user: request.messages[1].content,
        max_tokens: request.maxTokens,
        model: request.model,
      });
      const usage = new TokenUsage(30, 20, 50, null, null, 'provider_usage');
      const entries = (modelInput.new_sources as Obj[]).map((source) => ({
        category: 'decision',
        text: `摘要 ${source.key}`,
        source_id: source.key,
        quote: Array.from(source.content as string)
          .slice(0, 10)
          .join(''),
      }));
      if (mode === 'length') return chatResponse({ content: '{}', finishReason: 'length', usage });
      if (mode === 'tool')
        return chatResponse({
          content: '{}',
          toolCalls: [new ToolCall('t', 'x', '{}')],
          finishReason: 'stop',
          usage,
        });
      if (mode === 'not-json')
        return chatResponse({ content: '不是 JSON', finishReason: 'stop', usage });
      if (mode === 'extra-key')
        return chatResponse({ content: dumpJson({ entries, x: 1 }), finishReason: 'stop' });
      if (mode === 'missing-source') entries.shift();
      else if (mode === 'bad-quote') entries[0].quote = '不存在的引用';
      else if (mode === 'bad-category') entries[0].category = 'other';
      else if (mode === 'long-text') entries[0].text = '长'.repeat(2001);
      else if (mode === 'medium-text') entries[0].text = '长'.repeat(500);
      else if (mode === 'secret') entries[0].text = `包含 ${golden.secret} 的摘要`;
      return chatResponse({
        content: dumpJson({ entries }, { ensureAscii: false }),
        finishReason: 'stop',
        usage,
      });
    },
  };
}

const CALLS: Record<string, (args: Obj) => Promise<unknown>> = {
  project_conversation_history: (a) => projectConversationHistory(sources(a.rows), a.session),
  create_compaction_checkpoint: async (a) => {
    const calls: Obj[] = [];
    const payload = await createCompactionCheckpoint(sources(a.rows), a.session, {
      provider: scriptedProvider(a.mode, calls),
      model: 'm-compact',
      secrets,
    });
    return { payload, calls };
  },
  tool_output_summary: async (a) => toolOutputSummary(a.name, a.output),
  serialize_tool_output: async (a) => serializeToolOutput(a.output),
  review_feedback: async (a) => reviewFeedback(a.output),
  revise_feedback: async (a) => reviseFeedback(a.output),
  merge_cost_breakdown: async (a) =>
    mergeCostBreakdown(a.current, a.incoming, {
      promptTokens: 10,
      completionTokens: 4,
      tokenUsageSource: 'provider_usage',
    }),
};

const withoutMetadata = (output: Obj) => ({
  ...output,
  ...(Array.isArray(output.calls)
    ? { calls: output.calls.map(({ metadata: _ignored, ...rest }: Obj) => rest) }
    : {}),
});

describe('P3-4 对话上下文（Python 预言机）', () => {
  it('system prompt 与作者指令前缀逐字节一致', () => {
    expect(SYSTEM_PROMPT).toBe(golden.system_prompt);
    expect(AUTHOR_INSTRUCTIONS_PREFIX).toBe(golden.author_instructions_prefix);
  });

  for (const [index, record] of (golden.records as Record_[]).entries()) {
    const args = parseJson(record.args_json, 'args') as Obj;
    it(`#${index} ${record.fn} ${String(args.label ?? args.name ?? '')} ${String(args.mode ?? '')}`, async () => {
      if (record.error) {
        const type =
          record.error.type === 'ContextBudgetError' ? ContextBudgetError : CompactionRejected;
        await expect(CALLS[record.fn](args)).rejects.toThrow(type);
        await expect(CALLS[record.fn](args)).rejects.toThrow(record.error.message);
        return;
      }
      const expected = JSON.parse(record.output_json!);
      const actual = plain(await CALLS[record.fn](args)) as Obj;
      // 请求 metadata 只在 Python 的 ChatRequest 里，从不进请求体，TS 不搬。
      expect(actual).toEqual(
        record.fn === 'create_compaction_checkpoint' ? withoutMetadata(expected) : expected,
      );
    });
  }

  const projects = golden.projects as unknown as {
    id: string;
    files: Record<string, EncodedFile>;
    calls: { fn: string; args_json: string; output_json: string }[];
  }[];
  for (const project of projects)
    for (const call of project.calls) {
      const spec = parseJson(call.args_json, 'args') as Obj;
      it(`循环消息组装 ${project.id} ${spec.label}`, async () => {
        const { reader } = memoryProject(ROOT, project.files);
        const provenance: Obj = {};
        const args = spec.args as Obj | null;
        const messages = await storyforgeMessages(
          { reader, conversation: sources(spec.rows), platform },
          {
            assistantSessionId: spec.session,
            userMessage: spec.label === 'plain-project' ? 'hi' : '  帮我检查一下  ',
            projectPath: ROOT,
            currentFile:
              spec.current_file === null
                ? null
                : nativeProjectPath(ROOT, spec.current_file, platform),
            authorView: args === null ? null : authorViewFromPayload(args),
            pinnedContext: args === null ? null : chatContextBlock(args),
          },
          provenance,
        );
        const expected = JSON.parse(call.output_json);
        expect(stable(messages)).toEqual(expected.messages);
        if (expected.provenance) {
          // 段落指纹随正文里的项目根变化：含根路径的段，用替换回合成根的 Python 消息重算。
          for (const section of expected.provenance.sections as Obj[]) {
            const entries = (section.message_indices as number[]).map((i) => expected.messages[i]);
            const text = dumpJson(entries, { ensureAscii: false });
            if (text.includes('$ROOT'))
              section.sha256 = sha256Hex(
                dumpJson(parseJson(text.split('$ROOT').join(ESCAPED_ROOT), 'entries'), {
                  ensureAscii: false,
                  sortKeys: true,
                }),
              );
          }
          expect(stable(provenance)).toEqual(expected.provenance);
        }
      });
    }
});
