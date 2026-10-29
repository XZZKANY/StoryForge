// 10-28 丢稿事故：中转回了终止标记，修订新稿却截在半句；补丁要带警告、自动档也要等作者过目。
import { describe, expect, it } from 'vitest';
import fixedGolden from '../../golden/p3-fixed-pipelines.windows.json';
import loopGolden from '../../golden/p3-patch-tools.windows.json';
import { agentRunReplay } from './agentRunReplay.test-support';

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
  '两人一前一后出了巷口，谁也没有先开口。',
  '',
].join('\n');
const COMPLETE = BEFORE.replace('林舟推开门。', '林舟一脚踹开了门。');
const TRUNCATED = COMPLETE.slice(0, COMPLETE.indexOf('一盏快灭'));

/** 修订那一次流式回复：内容照给、终止标记与 usage 都在——传输层看不出被截断。 */
function revisionStream(content: string): string {
  const frames = [
    { choices: [{ index: 0, delta: { content } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } },
  ];
  return `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`;
}

function scenarioWith(golden: Obj, id: string, after: string, replyIndex: number) {
  const base = (golden.scenarios as Obj[]).find((item) => item.id === id)!;
  const spec = JSON.parse(base.spec_json);
  expect(spec.replies[replyIndex].body).toContain('data: [DONE]');
  spec.replies[replyIndex].body = revisionStream(after);
  if (spec.message.args.content !== undefined) spec.message.args.content = BEFORE;
  return { ...base, spec_json: JSON.stringify(spec) };
}

const withChapter = (golden: Obj) =>
  agentRunReplay({ ...golden, files: { ...golden.files, [CHAPTER]: BEFORE } });

describe('对话循环里的整文件修订：新稿看起来没写完', () => {
  const { replay } = withChapter(loopGolden);

  it('补丁带截断警告进 agent_result，自动档也改成等作者确认', async () => {
    const { record, error } = await replay(scenarioWith(loopGolden, 'revise-auto', TRUNCATED, 1));
    if (error) throw error;
    const result = record.result as Obj;
    expect(result.proposed_patch.after).toBe(TRUNCATED.trim());
    expect(result.proposed_patch.requires_confirmation).toBe(true);
    expect(result.agent_result.requires_user_confirmation).toBe(true);
    expect(result.plan.map((step: Obj) => step.step)).toContain('permission.confirm');
    const warning = result.agent_result.truncation_warning;
    expect(warning.message).toContain('AI 的输出可能没写完');
    expect(warning.message).toContain('原文最后 2 段');
    const trace = (result.tool_trace as Obj[]).find((item) => item.tool_name === 'file.revise')!;
    expect(trace.output_summary.truncation_warning).toEqual(warning);
    expect(trace.output_summary.patch_id).toBe(result.proposed_patch.id);
  });

  it('完整的新稿照旧：没有警告，自动档不用点', async () => {
    const { record, error } = await replay(scenarioWith(loopGolden, 'revise-auto', COMPLETE, 1));
    if (error) throw error;
    const result = record.result as Obj;
    expect(result.proposed_patch.requires_confirmation).toBe(false);
    expect(result.agent_result.truncation_warning).toBeUndefined();
  });
});

describe('固定修订管线：同样把截断警告带给界面', () => {
  const { replay } = withChapter(fixedGolden);

  it('revise-fixed-auto 的新稿截在半句：警告进 agent_result，补丁改成等确认', async () => {
    const { record, error } = await replay(
      scenarioWith(fixedGolden, 'revise-fixed-auto', TRUNCATED, 3),
    );
    if (error) throw error;
    const result = record.result as Obj;
    expect(result.proposed_patch.requires_confirmation).toBe(true);
    expect(result.agent_result.truncation_warning.message).toContain('停在半句');
  });
});
