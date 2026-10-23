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
  canonicalJson,
  contentDigest,
  createCompactionCheckpoint,
  currentEvidenceOverlay,
  evidenceSources,
  HISTORY_BUDGET_BYTES,
  projectConversationHistory,
  validateCompactionPublication,
  type ArtifactRow,
  type ConversationSources,
  type MessageRow,
  type RunEventRow,
  type ToolCallRow,
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

describe('连续作者流程的历史证据投影', () => {
  function authorJourney() {
    const messages: MessageRow[] = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      role: i % 2 ? 'assistant' : 'user',
      content: i % 2 ? '请确认提案。' : '父亲是邮局稽核员，不是船厂调度。禁止超自然。',
    }));
    const bundle = {
      files: [{ relative_path: '设定/核心设定.md', excerpt: '恢复专用上下文。'.repeat(400) }],
    };
    const artifacts: ArtifactRow[] = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1,
      run_id: i + 1,
      kind: 'runtime_pending_call',
      requires_confirmation: false,
      payload: {
        intent: 'chapter.write',
        boundary: 'after_tool:chapter.brief',
        status: 'pending',
        resume_strategy: 'continue_chapter_writing_after_brief',
        resume_message: {
          user_message: '保留作者原话：林苇先问地址，再决定同行。',
          args: { file_path: `正文/第00${i + 1}章.md`, context_bundle: bundle },
        },
        chapter_brief: { brief_id: `brief-${i}`, forbidden_items: ['不得提前知道地址'] },
        llm_prompt_context_bundle: bundle,
        source_guard: { version: 2, context: { receipt: bundle }, sha256: 'source-guard-hash' },
      },
    }));
    const tool_calls: ToolCallRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      tool_name: 'assistant.draft',
      status: 'completed',
      related_type: null,
      related_id: null,
      input_summary: {
        instruction: '不得凭空知道七号仓。',
        generation_sources: {
          version: 'generation-sources-v1',
          delivery_boundary: 'writer_provider_seam',
          sources: Array.from({ length: 12 }, (_, j) => ({
            source_id: `gsrc-${j}`,
            purpose: 'context',
            observed_content_sha256: 'a'.repeat(64),
            relative_path: `设定/背景${j}.md`,
            evidence_state: 'observed',
          })),
        },
      },
      output_summary: { content_chars: 1800 },
    }));
    const events: RunEventRow[] = [
      {
        id: 1,
        run_id: 4,
        sequence: 1,
        event_type: 'permission_required',
        message: '请确认',
        payload: { patch_id: 'patch-4' },
      },
      {
        id: 2,
        run_id: 4,
        sequence: 2,
        event_type: 'permission_denied',
        message: '不要这版',
        payload: { control_effect: 'applied', reason: '林苇不能未卜先知' },
      },
      {
        id: 3,
        run_id: 5,
        sequence: 1,
        event_type: 'permission_approved',
        message: '已批准',
        payload: { control_effect: 'applied' },
      },
    ];
    const rows = { messages, tool_calls, artifacts, events };
    return { rows, store: sources(rows) };
  }

  it('不把多轮恢复快照和生成审计全文反复塞入短会话，保留原话、来源及有效决策', async () => {
    const { rows, store } = authorJourney();
    const original = canonicalJson(rows);
    const history = await projectConversationHistory(store, 1);
    expect(new TextEncoder().encode(canonicalJson(history)).length).toBeLessThan(
      HISTORY_BUDGET_BYTES,
    );
    expect(history.slice(0, 10)).toEqual(
      rows.messages.map(({ role, content }) => ({ role, content })),
    );
    const evidence = await evidenceSources(store, 1);
    expect(evidence).toHaveLength(12);
    const serialized = canonicalJson(evidence);
    expect(serialized).toContain('林苇先问地址，再决定同行');
    expect(serialized).toContain('不得提前知道地址');
    expect(serialized).toContain('不得凭空知道七号仓');
    expect(serialized).not.toContain('恢复专用上下文');
    expect(serialized).not.toContain('gsrc-11');
    const raw = rows.artifacts[0];
    expect(JSON.parse(evidence[0].content).payload.source_guard).toEqual({
      omitted: 'internal_evidence',
      digest: contentDigest((raw.payload as Obj).source_guard),
    });
    expect(evidence[0].digest).toBe(
      contentDigest({
        kind: raw.kind,
        run_id: raw.run_id,
        requires_confirmation: raw.requires_confirmation,
        payload: raw.payload,
      }),
    );
    const overlay = currentEvidenceOverlay(evidence);
    expect(overlay.permission_by_run).toEqual(
      new Map([
        [
          4,
          {
            source_id: 'event:2',
            permission: 'denied',
            writeback: 'unverified',
            pending_patch_available: false,
          },
        ],
        [
          5,
          {
            source_id: 'event:3',
            permission: 'approved',
            writeback: 'unverified',
            pending_patch_available: false,
          },
        ],
      ]),
    );
    expect(canonicalJson(rows)).toBe(original);
  });

  it('不按同名字段全局删减未知artifact或权限事件', async () => {
    const { rows, store } = authorJourney();
    rows.artifacts.push({
      id: 5,
      run_id: 5,
      kind: 'review_report',
      requires_confirmation: false,
      payload: { context_bundle: '审校独有事实', source_guard: '报告独有依据' },
    });
    rows.events[1].payload.context_bundle = '作者拒绝时的独有说明';
    const evidence = await evidenceSources(store, 1);
    expect(evidence.find((item) => item.key === 'artifact:5')!.content).toContain('审校独有事实');
    expect(evidence.find((item) => item.key === 'artifact:5')!.content).toContain('报告独有依据');
    expect(evidence.find((item) => item.key === 'event:2')!.content).toContain(
      '作者拒绝时的独有说明',
    );
  });

  it('真实超长作者要求仍明确拒绝，不提高预算或删除消息', async () => {
    const { rows, store } = authorJourney();
    rows.messages[0].content = '必须保留的作者原文'.repeat(20_000);
    const original = canonicalJson(rows);
    await expect(projectConversationHistory(store, 1)).rejects.toThrow(ContextBudgetError);
    expect(canonicalJson(rows)).toBe(original);
  });

  it('旧检查点引用已省略的恢复全文时回退完整原始历史，不伪认可原引用', async () => {
    const { rows, store } = authorJourney();
    rows.messages.push(
      ...Array.from({ length: 4 }, (_, i) => ({
        id: 11 + i,
        role: i % 2 ? 'assistant' : 'user',
        content: `继续第${i}轮。`,
      })),
    );
    const payload = (await createCompactionCheckpoint(store, 1, {
      provider: scriptedProvider('valid', []),
      model: 'test',
      secrets: { values: [] },
    }))!;
    const entry = (payload.entries as Obj[]).find((item) => item.source_id === 'artifact:1')!;
    const raw = rows.artifacts[0];
    const legacyContent = canonicalJson({
      kind: raw.kind,
      run_id: raw.run_id,
      requires_confirmation: raw.requires_confirmation,
      payload: raw.payload,
    });
    entry.quote = '恢复专用上下文。';
    entry.quote_start = Array.from(
      legacyContent.slice(0, legacyContent.indexOf(entry.quote)),
    ).length;
    entry.quote_end = entry.quote_start + Array.from(entry.quote).length;
    const { checkpoint_digest: _oldDigest, ...unsigned } = payload;
    payload.checkpoint_digest = contentDigest(unsigned);
    rows.artifacts.push({
      id: 5,
      run_id: 5,
      kind: 'system_compaction',
      requires_confirmation: false,
      payload,
    });
    const history = await projectConversationHistory(store, 1);
    expect(history.slice(0, 14)).toEqual(
      rows.messages.map(({ role, content }) => ({ role, content })),
    );
  });

  it('摘要省略的恢复材料发生变化，仍阻止旧检查点发布', async () => {
    const { rows, store } = authorJourney();
    rows.messages.push(
      ...Array.from({ length: 4 }, (_, i) => ({
        id: 11 + i,
        role: i % 2 ? 'assistant' : 'user',
        content: `继续第${i}轮。`,
      })),
    );
    const payload = (await createCompactionCheckpoint(store, 1, {
      provider: scriptedProvider('valid', []),
      model: 'test',
      secrets: { values: [] },
    }))!;
    (rows.artifacts[0].payload as Obj).source_guard.sha256 = 'changed';
    await expect(validateCompactionPublication(store, payload)).rejects.toThrow(
      '发布前来源版本已改变',
    );
  });
});
