import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-chapter-writing.windows.json';
import { AgentRuntimeUserMessageError } from './agentRuntime';
import { agentRunReplay, REPLAY_KEYS } from './agentRunReplay.test-support';
import { buildCheck, checkPrompt } from './chapterCheckProtocol';
import { RUN_MAX_DURATION_SECONDS } from './runControl';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 脚本按 Python 预言机的 JSON 形状读
const { replay, expectSame } = agentRunReplay(golden);

describe('chapter writing pipeline replays the Python oracle', () => {
  it('pins the oracle sources and scenario count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(19);
    expect(golden.scenarios).toHaveLength(39);
  });

  it.each((golden.scenarios as Obj[]).map((item) => [item.id, item] as const))(
    '%s',
    async (_id, scenario) => {
      const { record, error } = await replay(scenario);
      if (scenario.error) {
        expect(error).toBeInstanceOf(AgentRuntimeUserMessageError);
        expect((error as Error).message).toBe(scenario.error.message);
      } else {
        if (error) throw error;
        expectSame(record.result, scenario.result, 'result');
      }
      if ('controls' in scenario) expectSame(record.controls, scenario.controls, 'controls');
      for (const key of REPLAY_KEYS) expectSame(record[key], scenario[key], key);
    },
  );
});

// 作者 10-30 拍板：各档位都不再停在章纲等确认，拟完章纲直接起草；作者只在补丁那一步按档位把关。
describe('chapter writing no longer waits for the brief to be confirmed', () => {
  const BRIEF_MARK = '整理成 Chapter Brief';

  async function run(id: string, change: (spec: Obj) => void = () => undefined) {
    const base = (golden.scenarios as Obj[]).find((item) => item.id === id)!;
    const spec = JSON.parse(base.spec_json);
    change(spec);
    return { spec, ...(await replay({ ...base, spec_json: JSON.stringify(spec) })) };
  }
  const userPrompts = (record: Obj) =>
    (record.requests as Obj[]).map((request) => {
      const messages = request.body.messages as Obj[];
      return messages[messages.length - 1].content as string;
    });
  const eventsOf = (record: Obj, type: string) =>
    (record.events as Obj[]).filter((event) => event.event_type === type);

  it('briefs, drafts, checks and proposes the patch in one run', async () => {
    const { record, error } = await run('write-brief-then-pass');
    if (error) throw error;
    expect(eventsOf(record, 'agent_execution_started')).toHaveLength(1);
    expect(eventsOf(record, 'permission_required').map((event) => event.payload.reason)).toEqual([
      'requires_user_confirmation',
    ]);
    expect(JSON.stringify(record.frames)).not.toContain('"confirmation_kind":"chapter_brief"');
    expect(record.result.agent_result.confirmation_kind).toBeUndefined();
    expect(record.result.plan.map((step: Obj) => step.step)).not.toContain('chapter.brief.confirm');
    expect(record.result.proposed_patch).toMatchObject({
      created_by_tool: 'chapter.write',
      requires_confirmation: true,
    });
    expect(
      eventsOf(record, 'tool_trace').map((event) => [
        event.payload.trace.tool_name,
        event.payload.index,
      ]),
    ).toEqual([
      ['chapter.brief', 0],
      ['chapter.draft', 1],
      ['chapter.check', 2],
    ]);
    // 每章仍是拟章纲、起草、检查各一次模型调用，不多一次。
    expect(record.requests).toHaveLength(3);
    expect(userPrompts(record).filter((prompt) => prompt.includes(BRIEF_MARK))).toHaveLength(1);
  });

  it('records each step as it finishes, not all at once after the check', async () => {
    const { record } = await run('write-brief-then-pass');
    const order = (record.events as Obj[]).map((event) =>
      event.event_type === 'tool_trace' ? event.payload.trace.tool_name : event.event_type,
    );
    expect(order.indexOf('chapter.draft')).toBeLessThan(
      order.lastIndexOf('agent_runtime_progress'),
    );
  });

  it('auto profile proposes a patch that needs no click and never pauses', async () => {
    const { record, error } = await run('write-auto-profile');
    if (error) throw error;
    expect(eventsOf(record, 'permission_required')).toEqual([]);
    expect(record.runs[0]).toMatchObject({ status: 'completed' });
    expect(record.result.proposed_patch).toMatchObject({ requires_confirmation: false });
  });

  it('read profile is still blocked before any model call', async () => {
    const { record, error } = await run('write-brief', (spec) => {
      spec.message.permission_profile = 'read';
    });
    expect(error).toBeInstanceOf(AgentRuntimeUserMessageError);
    expect((error as Error).message).toBe(
      '权限策略阻止工具 chapter.brief：read_profile_blocks_write_pending',
    );
    expect(record.requests).toEqual([]);
    expect(eventsOf(record, 'tool_trace')).toEqual([]);
    expect(record.runs[0]).toMatchObject({ status: 'failed' });
  });

  it('a run paused after the brief continues from it without re-briefing', async () => {
    const { spec, record, error } = await run('write-missing-brief-on-resume');
    if (error) throw error;
    expect(spec.ops).toEqual([{ op: 'control', type: 'resume_run' }]);
    expect(record.controls[0].event.payload.control_effect).toBe('applied');
    expect(record.controls[0].resumed_result.proposed_patch).toBeTruthy();
    expect(record.requests).toHaveLength(3);
    expect(userPrompts(record).filter((prompt) => prompt.includes(BRIEF_MARK))).toHaveLength(1);
  });

  it('an old run left waiting for brief confirmation still resumes with the edited brief', async () => {
    const { spec, record, error } = await run('write-project-name');
    if (error) throw error;
    expect(spec.triggers).toEqual([
      expect.objectContaining({ status: 'paused', current_step: 'chapter.brief.confirm' }),
    ]);
    expect(spec.ops[0].payload.chapter_brief.goal).toBe('沈禾带林舟入城，夜宿客栈');
    const resumed = record.controls[0].resumed_result;
    expect(resumed.proposed_patch).toBeTruthy();
    expect(resumed.plan.map((step: Obj) => step.step)).toContain('chapter.brief.confirm');
    expect(resumed.agent_result.chapter_brief.goal).toBe('沈禾带林舟入城，夜宿客栈');
    const draft = userPrompts(record).find((prompt) =>
      prompt.includes('请输出该文件的完整初稿正文'),
    );
    expect(draft).toContain('章节目标：沈禾带林舟入城，夜宿客栈');
  });

  // 回放台的模型回包可以把虚拟时钟往前拨（advance，秒）：拨在请求发出之后，像一次慢请求。
  it('gives drafting its own full time budget once the brief is done', async () => {
    const { spec, record, error } = await run('write-brief-then-pass', (draftSpec) => {
      draftSpec.replies[0].advance = 700;
      draftSpec.replies[1].advance = 500;
    });
    if (error) throw error;
    // 两步加起来超过一次调用的 900 秒；起草阶段若与章纲共用这 900 秒，检查前就会超时。
    expect(spec.replies[0].advance + spec.replies[1].advance).toBeGreaterThan(
      RUN_MAX_DURATION_SECONDS,
    );
    expect(record.result.agent_result.execution_outcome).toBeUndefined();
    expect(record.result.proposed_patch).toBeTruthy();
    expect(record.requests).toHaveLength(3);
    expect(record.runs[0]).toMatchObject({ status: 'paused', current_step: 'permission.confirm' });
  });

  it('still holds the brief itself to the first budget', async () => {
    const { record, error } = await run('write-brief-then-pass', (briefSpec) => {
      briefSpec.replies[0].advance = RUN_MAX_DURATION_SECONDS + 50;
    });
    if (error) throw error;
    expect(record.result.agent_result.execution_outcome).toMatchObject({
      code: 'runtime_deadline',
    });
    expect(record.requests).toHaveLength(1);
    expect(record.runs[0]).toMatchObject({ status: 'failed' });
  });
});

// 真模型试跑（10-31）：自动写进文件之后对话里仍说「通过 brief 检查……待审阅修订」。
// 结果说明按要不要作者点分两种说法；写没写进文件引擎不知道，所以不用点的只说按权限直接写进。
describe('the result line follows whether the author still has to accept the revision', () => {
  const PLAN = JSON.stringify({
    version: 1,
    chapters: [
      { ordinal: 1, title: '出城' },
      { ordinal: 2, title: '夜行' },
      { ordinal: 3, title: '入城', goal: '沈禾带林舟入城' },
    ],
    arcs: [],
  });

  async function written(
    profile: string,
    files: Record<string, string> = {},
    change: (spec: Obj) => void = () => undefined,
  ) {
    const base = (golden.scenarios as Obj[]).find((item) => item.id === 'write-auto-profile')!;
    const spec = JSON.parse(base.spec_json);
    spec.message.permission_profile = profile;
    spec.extra_files = files;
    change(spec);
    const { record, error } = await replay({ ...base, spec_json: JSON.stringify(spec) });
    if (error) throw error;
    return record as Obj;
  }

  it('says the revision goes straight into the file when no click is needed', async () => {
    const record = await written('auto');
    expect(record.result.proposed_patch.requires_confirmation).toBe(false);
    expect(record.result.agent_result.summary).toBe(
      '章节草稿通过了章纲检查，修订按这部作品的权限直接写进 正文/第003章.md。',
    );
  });

  it('asks the author to look at the comparison when a click is needed', async () => {
    const record = await written('ask');
    expect(record.result.proposed_patch.requires_confirmation).toBe(true);
    expect(record.result.agent_result.summary).toBe(
      '章节草稿通过了章纲检查，生成了 正文/第003章.md 的修订，请看过对比再决定是否接受。',
    );
  });

  it.each([
    ['auto', '第 3 章的草稿通过了章纲检查，修订按这部作品的权限直接写进 正文/第003章.md。'],
    [
      'ask',
      '第 3 章的草稿通过了章纲检查，生成了 正文/第003章.md 的修订，请看过对比再决定是否接受。',
    ],
  ])('names the chapter when the brief carries its number (%s)', async (profile, summary) => {
    const record = await written(profile, { '.storyforge/serial-plan.json': PLAN });
    expect(record.result.agent_result.chapter_brief.chapter_ordinal).toBe(3);
    expect(record.result.agent_result.summary).toBe(summary);
  });

  it('does not double the full stop when the brief goal already ends a sentence', async () => {
    const record = await written('auto', {}, (spec) => {
      spec.replies[0].body = spec.replies[0].body.replace('夜宿客栈\\"', '夜宿客栈。\\"');
    });
    expect(record.result.agent_result.chapter_brief.goal).toBe('沈禾带林舟入城，夜宿客栈。');
    expect((record.messages as Obj[])[1].content).toBe('章纲已准备：沈禾带林舟入城，夜宿客栈。');
  });

  it('marks the brief in the session with the word the author sees', async () => {
    const record = await written('auto');
    expect((record.messages as Obj[]).map((message) => message.content)).toEqual([
      '写第三章：沈禾带林舟入城',
      '章纲已准备：沈禾带林舟入城，夜宿客栈。',
    ]);
  });
});

// 检查协议的整份校验：端到端场景走不到的分支逐条对 Python（重复键、非有限数字、引用定位、预算）。
describe('chapter check protocol matches Python', () => {
  it('builds the same checker prompt', () => {
    const record = (golden.check_records as Obj[])[0];
    expect(checkPrompt(golden.check_brief as Obj, record.content)).toBe(golden.check_prompt);
  });

  it.each((golden.check_records as Obj[]).map((item) => [item.name, item] as const))(
    '%s',
    (_name, item) => {
      const raw = item.raw_repeat ? item.raw_repeat[0].repeat(item.raw_repeat[1]) : item.raw;
      expect(
        buildCheck(item.content, golden.check_brief as Obj, raw, {
          providerFailed: item.provider_failed === true,
        }),
      ).toEqual(item.result);
    },
  );
});
