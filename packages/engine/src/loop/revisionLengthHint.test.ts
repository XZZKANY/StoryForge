// issue #492：作者要「改成 X 字左右」，修订稿差得远时补丁要带字数提示；只提示，不改确认档位、不重写。
import { describe, expect, it } from 'vitest';
import fixedGolden from '../../golden/p3-fixed-pipelines.windows.json';
import loopGolden from '../../golden/p3-patch-tools.windows.json';
import { agentRunReplay } from './agentRunReplay.test-support';
import { chapterChars } from './chapterCheckProtocol';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 照预言机场景的 JSON 形状改

const CHAPTER = '正文/第001章.md';
const BEFORE = [
  '第一章 风起',
  '',
  '林舟推开门。',
  '',
  '院子里的雪已经积到脚踝，他把斗篷往肩上拢了拢。',
  '',
  '沈禾在廊下等他，手里提着一盏快灭的灯。',
  '',
].join('\n');
const LONGER = `${BEFORE}\n${'两人一前一后出了巷口，谁也没有先开口。\n\n'.repeat(6)}`;

function revisionStream(content: string): string {
  const frames = [
    { choices: [{ index: 0, delta: { content } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } },
  ];
  return `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`;
}

function scenarioWith(
  golden: Obj,
  id: string,
  options: { message: string; after: string; replyIndex: number; toolInstruction?: string },
) {
  const base = (golden.scenarios as Obj[]).find((item) => item.id === id)!;
  const spec = JSON.parse(base.spec_json);
  expect(spec.replies[options.replyIndex].body).toContain('data: [DONE]');
  spec.replies[options.replyIndex].body = revisionStream(options.after);
  spec.message.user_message = options.message;
  if (spec.message.args.content !== undefined) spec.message.args.content = BEFORE;
  if (options.toolInstruction !== undefined) {
    const reply = JSON.parse(spec.replies[0].body);
    const call = reply.choices[0].message.tool_calls[0].function;
    call.arguments = JSON.stringify({
      ...JSON.parse(call.arguments),
      instruction: options.toolInstruction,
    });
    spec.replies[0].body = JSON.stringify(reply);
  }
  return { ...base, spec_json: JSON.stringify(spec) };
}

const withChapter = (golden: Obj) =>
  agentRunReplay({ ...golden, files: { ...golden.files, [CHAPTER]: BEFORE } });

const reviseTrace = (result: Obj) =>
  (result.tool_trace as Obj[]).find((item) => item.tool_name === 'file.revise')!;

describe('对话循环里的修订：作者给了目标字数', () => {
  const { replay } = withChapter(loopGolden);
  const run = async (options: Parameters<typeof scenarioWith>[2]) => {
    const { record, error } = await replay(scenarioWith(loopGolden, 'revise-auto', options));
    if (error) throw error;
    return record.result as Obj;
  };

  it('修订稿超出目标：补丁带字数提示，自动档照旧不用点', async () => {
    const result = await run({ message: '把第一章改成40字左右', after: LONGER, replyIndex: 1 });
    const actual = chapterChars(result.proposed_patch.after);
    expect(actual).toBeGreaterThan(44);
    const hint = result.agent_result.length_hint;
    expect(hint).toEqual({
      message: `字数提示：目标约 36–44 字，这版实际 ${actual} 字（偏多 ${actual - 44} 字）。`,
      target_min: 36,
      target_max: 44,
      actual_chars: actual,
      direction: 'over',
      off_by: actual - 44,
    });
    expect(result.proposed_patch.requires_confirmation).toBe(false);
    expect(result.agent_result.requires_user_confirmation).toBe(false);
    expect(result.plan.map((step: Obj) => step.step)).not.toContain('permission.confirm');
    const trace = reviseTrace(result);
    expect(trace.output_summary.length_hint).toEqual(hint);
    expect(trace.output_summary.patch_id).toBe(result.proposed_patch.id);
  });

  it('作者原话没写字数时，看交给修订的那句指令', async () => {
    const result = await run({
      message: '就照刚才说的改',
      after: LONGER,
      replyIndex: 1,
      toolInstruction: '压缩到40字以内',
    });
    expect(result.agent_result.length_hint.message).toContain('目标不超过 40 字');
    expect(result.agent_result.length_hint.direction).toBe('over');
  });

  it('落在目标里、或没提字数：不带提示', async () => {
    const inRange = await run({
      message: `把第一章改成${chapterChars(LONGER)}字左右`,
      after: LONGER,
      replyIndex: 1,
    });
    expect(inRange.agent_result.length_hint).toBeUndefined();
    expect(reviseTrace(inRange).output_summary.length_hint).toBeUndefined();
    const none = await run({ message: '改一下第一章开门那句', after: LONGER, replyIndex: 1 });
    expect(none.agent_result.length_hint).toBeUndefined();
  });
});

describe('固定修订管线：同样把字数提示带给界面', () => {
  const { replay } = withChapter(fixedGolden);
  const run = async (message: string) => {
    const { record, error } = await replay(
      scenarioWith(fixedGolden, 'revise-fixed-auto', { message, after: LONGER, replyIndex: 3 }),
    );
    if (error) throw error;
    return record.result as Obj;
  };

  it('revise-fixed-auto 的修订稿超出「不超过 40 字」：提示进 agent_result，确认位不变', async () => {
    const plain = await run('把开门写得更有力');
    const capped = await run('把开门写得更有力，全文不超过40字');
    expect(plain.agent_result.length_hint).toBeUndefined();
    expect(capped.agent_result.length_hint.message).toMatch(/^字数提示：目标不超过 40 字/);
    expect(capped.agent_result.summary).toContain(capped.agent_result.length_hint.message);
    expect(capped.proposed_patch.requires_confirmation).toBe(
      plain.proposed_patch.requires_confirmation,
    );
  });
});
