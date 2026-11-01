import { describe, expect, it } from 'vitest';
import { dumpJson, parseJson, type JsonObject } from '../kernel/json';
import { chatResponse, TokenUsage, type ChatRequest } from '../llm/contracts';
import {
  canonicalJson,
  createCompactionCheckpoint,
  evidenceSources,
  projectConversationHistory,
  type ArtifactRow,
  type ConversationSources,
  type MessageRow,
  type RunEventRow,
  type ToolCallRow,
} from './conversationHistory';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 手搭的库行

// 10-31 实验书：`/写` 写了 14 章，每章往对话历史塞约 22 KB 证据，第 15 轮聊天就超出预算、会话废了。
// 写完的一章在历史里只留一条摘要；挂着待续调用、还没结束的 run 照旧整份留着。

const RUN = 7;
const PROVENANCE = {
  source_manifest: ['设定/来源清单.md'],
  selected_content_sha256: 'a'.repeat(64),
};

function brief(status: string): Obj {
  return {
    brief_id: 'chapter-brief-1',
    revision: 1,
    status,
    chapter_ordinal: 3,
    chapter_title: '入城',
    goal: '沈禾带林舟入城，夜宿客栈',
    target_path: '正文/第003章.md',
    target_chars_min: 2100,
    target_chars_max: 3200,
    pov: '林舟',
    setting: '城门',
    required_beats: ['入城'],
    forbidden_items: [],
    continuity_constraints: [],
    context_provenance: PROVENANCE,
  };
}

function chapterSession(): { rows: Obj; store: ConversationSources } {
  const artifacts: ArtifactRow[] = [
    {
      id: 1,
      run_id: RUN,
      kind: 'chapter_brief',
      requires_confirmation: false,
      payload: brief('proposed'),
    },
    {
      id: 2,
      run_id: RUN,
      kind: 'runtime_pending_call',
      requires_confirmation: false,
      payload: {
        status: 'pending',
        boundary: 'after_tool:chapter.brief',
        chapter_brief: brief('proposed'),
      },
    },
    {
      id: 3,
      run_id: RUN,
      kind: 'runtime_pending_call_resolution',
      requires_confirmation: false,
      payload: { pending_artifact_id: 2, resolution: 'resumed', status: 'resolved' },
    },
    {
      id: 4,
      run_id: RUN,
      kind: 'chapter_check',
      requires_confirmation: false,
      payload: {
        status: 'pass',
        manuscript_status: 'pass',
        content_chars: 2900,
        hard_failure_count: 0,
        advisory_count: 1,
        repair_count: 0,
        findings: [
          {
            rule: 'word_count_out_of_range',
            severity: 'advisory',
            message: '正文 2900 字。',
            line: 3,
            evidence: '城门下的正文引文',
          },
        ],
        new_facts: [
          { subject: '林舟', kind: '持有', value: '一块令牌', quote: '令牌那句正文引文' },
        ],
        content_sha256: 'b'.repeat(64),
      },
    },
    {
      id: 5,
      run_id: RUN,
      kind: 'proposed_patch',
      requires_confirmation: false,
      payload: {
        id: 'patch-3',
        file_path: '正文/第003章.md',
        before: '',
        after: '沈禾带林舟穿过城门。',
        created_by_tool: 'chapter.write',
      },
    },
  ];
  const events: RunEventRow[] = [
    { id: 1, run_id: RUN, sequence: 1, event_type: 'agent_run_started', message: '', payload: {} },
    {
      id: 2,
      run_id: RUN,
      sequence: 2,
      event_type: 'agent_run_completed',
      message: '',
      payload: {},
    },
  ];
  const call = (
    id: number,
    tool_name: string,
    related: number | null,
    input: Obj,
  ): ToolCallRow => ({
    id,
    tool_name,
    status: 'completed',
    related_type: related === null ? null : 'agent_run',
    related_id: related,
    input_summary: input,
    output_summary: { prompt_tokens: 9000 },
  });
  const tool_calls: ToolCallRow[] = [
    call(1, 'assistant.chat', RUN, { message: '整理成 Chapter Brief……' }),
    call(2, 'assistant.draft', RUN, { instruction: '章节目标：沈禾带林舟入城' }),
    call(3, 'assistant.chat', RUN, { message: '检查这一章……' }),
    // 对话 AI 用 file.create 起草时服务记的那条：不属于写章 run，#467 定了它的指令照留。
    call(4, 'assistant.draft', null, { instruction: '不得凭空知道七号仓。' }),
    call(5, 'fs.read', null, { path: '大纲/总纲.md' }),
  ];
  const messages: MessageRow[] = [
    { id: 1, role: 'user', content: '写第三章' },
    { id: 2, role: 'assistant', content: '章纲已准备：沈禾带林舟入城，夜宿客栈。' },
  ];
  const rows = { messages, tool_calls, artifacts, events };
  return {
    rows,
    store: {
      messages: async () => rows.messages,
      toolCalls: async () => rows.tool_calls,
      runEvents: async () => rows.events,
      runArtifacts: async () => rows.artifacts,
      artifact: async (id) => rows.artifacts.find((row: Obj) => row.id === id) ?? null,
    },
  };
}

const keys = async (store: ConversationSources) =>
  (await evidenceSources(store, 1)).map((source) => source.key);

describe('写完的一章在对话历史里只留一条', () => {
  it('章纲、待续调用、检查、补丁和这一章发起的模型调用折成一条摘要，不带正文与引文', async () => {
    const { store } = chapterSession();
    const evidence = await evidenceSources(store, 1);
    expect(evidence.map((source) => source.key)).toEqual(['chapter_run:7', 'tool:4', 'tool:5']);
    expect(JSON.parse(evidence[0].content)).toEqual({
      kind: 'chapter_write_run',
      run_id: 7,
      chapter_ordinal: 3,
      chapter_title: '入城',
      target_path: '正文/第003章.md',
      goal: '沈禾带林舟入城，夜宿客栈',
      target_chars: [2100, 3200],
      check: {
        status: 'pass',
        manuscript_status: 'pass',
        content_chars: 2900,
        hard_failure_count: 0,
        advisory_count: 1,
        repair_count: 0,
        findings: [
          { rule: 'word_count_out_of_range', severity: 'advisory', message: '正文 2900 字。' },
        ],
        new_fact_count: 1,
      },
      proposed_patch: { id: 'patch-3', file_path: '正文/第003章.md', requires_confirmation: false },
    });
    const serialized = canonicalJson(evidence);
    for (const text of [
      '城门下的正文引文',
      '令牌那句正文引文',
      '沈禾带林舟穿过城门',
      '来源清单',
      '整理成 Chapter Brief',
    ])
      expect(serialized).not.toContain(text);
    expect(serialized).toContain('不得凭空知道七号仓');
  });

  it('待续调用还没结算的 run 整份留着：续写要用', async () => {
    const { rows, store } = chapterSession();
    rows.artifacts = rows.artifacts.filter(
      (row: Obj) => row.kind !== 'runtime_pending_call_resolution',
    );
    expect(await keys(store)).toEqual([
      'artifact:1',
      'artifact:2',
      'artifact:4',
      'artifact:5',
      'tool:1',
      'tool:2',
      'tool:3',
      'tool:4',
      'tool:5',
    ]);
  });

  it('run 还没结束不折；失败结束的照样折，没有补丁时补丁一栏是 null', async () => {
    const { rows, store } = chapterSession();
    rows.events = rows.events.filter((row: Obj) => row.event_type !== 'agent_run_completed');
    expect((await keys(store))[0]).toBe('artifact:1');
    rows.events.push({
      id: 3,
      run_id: RUN,
      sequence: 3,
      event_type: 'agent_run_failed',
      message: '',
      payload: {},
    });
    rows.artifacts = rows.artifacts.filter((row: Obj) => row.kind !== 'proposed_patch');
    const evidence = await evidenceSources(store, 1);
    expect(evidence[0].key).toBe('chapter_run:7');
    expect(JSON.parse(evidence[0].content).proposed_patch).toBeNull();
  });

  it('不是写章的 run（没有章纲）原样留着', async () => {
    const { rows, store } = chapterSession();
    rows.artifacts = rows.artifacts.filter((row: Obj) => row.kind === 'proposed_patch');
    expect(await keys(store)).toEqual([
      'artifact:5',
      'tool:1',
      'tool:2',
      'tool:3',
      'tool:4',
      'tool:5',
    ]);
  });

  it('压缩能引用这条摘要，下一轮历史用上检查点、不再重送它', async () => {
    const { rows, store } = chapterSession();
    for (let id = 3; id <= 16; id += 1)
      rows.messages.push({
        id,
        role: id % 2 ? 'user' : 'assistant',
        content: `第${id}条：林舟不能提前知道借阅者。`,
      });
    const provider = {
      async complete(request: ChatRequest) {
        const input = parseJson(request.messages[1].content!, 'input') as JsonObject;
        const entries = (input.new_sources as Obj[]).map((source) => ({
          category: 'decision',
          text: `摘要 ${source.key}`,
          source_id: source.key,
          quote: Array.from(source.content as string)
            .slice(0, 10)
            .join(''),
        }));
        return chatResponse({
          content: dumpJson({ entries }, { ensureAscii: false }),
          finishReason: 'stop',
          usage: new TokenUsage(30, 20, 50, null, null, 'provider_usage'),
        });
      },
    };
    const payload = (await createCompactionCheckpoint(store, 1, {
      provider,
      model: 'test',
      secrets: { values: [] },
    }))!;
    expect((payload.source_evidence as Obj[]).map((ref) => ref.key)).toContain('chapter_run:7');
    rows.artifacts.push({
      id: 6,
      run_id: 8,
      kind: 'system_compaction',
      requires_confirmation: false,
      payload,
    });
    const history = await projectConversationHistory(store, 1);
    expect(history[1].content).toContain('历史检查点数据');
    expect(history[history.length - 1].content).not.toContain('chapter_run:7');
  });
});
