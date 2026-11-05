import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-fixed-pipelines.windows.json';
import { agentRunReplay } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 合成回放场景
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
]
  .join('\n')
  .trimEnd();
const AFTER = BEFORE.replace('林舟推开门。', '林舟一脚踹开了门。');

function stream(content: string): string {
  return (
    [
      { choices: [{ index: 0, delta: { content } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } },
    ]
      .map((frame) => 'data: ' + JSON.stringify(frame) + '\n\n')
      .join('') + 'data: [DONE]\n\n'
  );
}

async function revise(profile: string, after = AFTER) {
  const base = (golden.scenarios as Obj[]).find((item) => item.id === 'revise-fixed-auto')!;
  const spec = JSON.parse(base.spec_json);
  spec.message.permission_profile = profile;
  spec.message.args.content = BEFORE;
  expect(spec.replies[3].body).toContain('data: [DONE]');
  spec.replies[3].body = stream(after);
  const { record, error } = await agentRunReplay({
    ...golden,
    files: { ...golden.files, [CHAPTER]: BEFORE },
  }).replay({ ...base, spec_json: JSON.stringify(spec) });
  if (error) throw error;
  return record;
}

function assertOutcome(record: Obj, confirm: boolean) {
  const result = record.result;
  expect(result.agent_result.requires_user_confirmation).toBe(confirm);
  expect(result.agent_result.writeback_blocked_until_user_confirms).toBe(confirm);
  expect(result.plan.some((step: Obj) => step.step === 'permission.confirm')).toBe(confirm);
  expect(record.runs[0].status).toBe(confirm ? 'paused' : 'completed');
  const events = record.events as Obj[];
  expect(events.some((event) => event.event_type === 'permission_required')).toBe(confirm);
  expect(events.some((event) => event.event_type === 'agent_run_completed')).toBe(!confirm);
  if (!confirm) {
    const completed = events.find((event) => event.event_type === 'agent_run_completed')!;
    const started = events.find((event) => event.event_type === 'agent_execution_started')!;
    expect(completed.payload.assistant_session_id).toBe(result.assistant_session_id);
    expect(completed.payload.execution_id).toBe(started.id);
    expect(started.payload.run_id).toBe(result.run_id);
  }
}

describe('固定修订的补丁和运行使用同一确认要求', () => {
  it.each(['auto', 'full'])(
    '%s can settle automatic writes without an impossible approval wait',
    async (profile) => {
      const record = await revise(profile);
      expect(record.result.proposed_patch.requires_confirmation).toBe(false);
      assertOutcome(record, false);
    },
  );

  it('ask waits for author approval before the run completes', async () => {
    const record = await revise('ask');
    expect(record.result.proposed_patch.requires_confirmation).toBe(true);
    assertOutcome(record, true);
  });

  it('automatic mode still waits when the revised manuscript is truncated', async () => {
    const record = await revise('auto', AFTER.slice(0, AFTER.indexOf('一盏快灭')));
    expect(record.result.proposed_patch.requires_confirmation).toBe(true);
    expect(record.result.agent_result.truncation_warning.message).toContain('停在半句');
    assertOutcome(record, true);
  });

  it('an unchanged revision completes without a phantom pending patch or approval', async () => {
    const record = await revise('ask', BEFORE);
    expect(record.result.proposed_patch).toBeNull();
    assertOutcome(record, false);
  });
});
