// 批量写章时新章写完直接写进文件、最后统一审：中转掐断却回了「正常结束」的新章必须拦下等作者点。
import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-chapter-writing.windows.json';
import { agentRunReplay } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 照预言机场景的 JSON 形状改

const { replay } = agentRunReplay(golden);

// 收句规则参照前面同类行的多数习惯（不带句号的章题也算一行），所以开头多给几句正文。
const OPENING = '第三章 入城\n\n沈禾带林舟穿过城门。\n城里的灯一盏盏亮起来。\n客栈还开着门。\n';
const DRAFT_CUT = `${OPENING}守卫看了他们一眼，他刚要开口\n`;
const REPAIRED_OPENING =
  '第三章 入城\n\n沈禾带林舟穿过城门，夜宿客栈。\n城里的灯一盏盏亮起来。\n客栈还开着门。\n';
const REPAIRED = `${REPAIRED_OPENING}守卫看了他们一眼。\n`;
const REPAIRED_CUT = `${REPAIRED_OPENING}守卫看了他们一眼，他刚要开口\n`;

/** 起草 / 修稿那一次流式回复：内容照给、终止标记与 usage 都在——传输层看不出被截断。 */
function draftStream(content: string): string {
  const frames = [
    { choices: [{ index: 0, delta: { content } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } },
  ];
  return `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`;
}

async function run(id: string, replies: Record<number, string>, profile?: string) {
  const base = (golden.scenarios as Obj[]).find((item) => item.id === id)!;
  const spec = JSON.parse(base.spec_json);
  for (const [index, content] of Object.entries(replies)) {
    expect(spec.replies[Number(index)].body).toContain('data: [DONE]');
    spec.replies[Number(index)].body = draftStream(content);
  }
  if (profile !== undefined) spec.message.permission_profile = profile;
  const { record, error } = await replay({ ...base, spec_json: JSON.stringify(spec) });
  if (error) throw error;
  return record as Obj;
}

const artifact = (record: Obj, kind: string) =>
  [...(record.artifacts as Obj[])].reverse().find((item) => item.kind === kind)!;
const eventsOf = (record: Obj, type: string) =>
  (record.events as Obj[]).filter((event) => event.event_type === type);

function expectHeldForAuthor(record: Obj, stoppedAt: string) {
  const result = record.result as Obj;
  const warning = result.agent_result.truncation_warning;
  expect(warning).toEqual({
    message: expect.stringContaining(`停在半句（「…${stoppedAt}」）`),
    missing_line_count: 0,
    missing_headings: [],
    ends_mid_sentence: true,
  });
  expect(warning.message).toContain('AI 写的这一章疑似没写完');
  expect(result.agent_result.summary).toContain(warning.message);
  expect(result.proposed_patch).toMatchObject({
    created_by_tool: 'chapter.write',
    before: '',
    requires_confirmation: true,
  });
  expect(result.agent_result.requires_user_confirmation).toBe(true);
  expect(eventsOf(record, 'permission_required')).toHaveLength(1);
  expect(record.runs[0]).toMatchObject({ status: 'paused', current_step: 'permission.confirm' });
  // 运行记录里留下这次判定：最终那份检查的证据带上同一份警告。
  expect(artifact(record, 'chapter_check').payload.truncation_warning).toEqual(warning);
  expect(artifact(record, 'proposed_patch').payload.requires_confirmation).toBe(true);
  return warning;
}

describe('新写的一章停在半句：修订照交、带警告、任何档位都等作者点接受', () => {
  it('起草稿停在半句，自动档也退回手动确认，且不多调一次模型', async () => {
    const record = await run('write-auto-profile', { 1: DRAFT_CUT }, 'auto');
    expect(record.result.proposed_patch.after).toContain('他刚要开口');
    expectHeldForAuthor(record, '看了他们一眼，他刚要开口');
    expect(record.requests).toHaveLength(3);
  });

  it('询问档同样带警告', async () => {
    const record = await run('write-brief-then-pass', { 1: DRAFT_CUT });
    expect(record.runs[0].permission_profile).toBe('ask');
    expectHeldForAuthor(record, '看了他们一眼，他刚要开口');
  });

  it('修过一次后的稿停在半句同样拦下', async () => {
    const record = await run('write-repair-then-pass', { 3: REPAIRED_CUT }, 'auto');
    expect(record.result.agent_result.repair_count).toBe(1);
    expectHeldForAuthor(record, '看了他们一眼，他刚要开口');
    expect(record.requests).toHaveLength(5);
  });

  it('只看最终交出的那份：起草稿停在半句、修后稿收句，不报、自动档照常免点', async () => {
    const record = await run('write-repair-then-pass', { 1: DRAFT_CUT, 3: REPAIRED }, 'auto');
    const result = record.result as Obj;
    expect(result.agent_result.repair_count).toBe(1);
    expect(result.agent_result.truncation_warning).toBeUndefined();
    expect(result.proposed_patch.requires_confirmation).toBe(false);
    expect(artifact(record, 'chapter_check').payload.truncation_warning).toBeUndefined();
    expect(eventsOf(record, 'permission_required')).toEqual([]);
  });

  it('检查器给不出结果、正文又停在半句：两条提示都在，仍是等作者确认', async () => {
    const record = await run('write-check-invalid-auto-profile', { 1: DRAFT_CUT });
    const warning = expectHeldForAuthor(record, '看了他们一眼，他刚要开口');
    expect(record.result.agent_result.summary).toContain('这章正文未经检查');
    expect(record.result.agent_result.summary).toContain(warning.message);
  });

  it('检查拦下、没出修订时不带警告', async () => {
    const record = await run('write-repair-still-failing', { 1: DRAFT_CUT, 3: DRAFT_CUT });
    const result = record.result as Obj;
    expect(result.proposed_patch).toBeNull();
    expect(result.agent_result.truncation_warning).toBeUndefined();
    expect(artifact(record, 'chapter_check').payload.truncation_warning).toBeUndefined();
  });
});

describe('收句的新章照旧：不带警告，确认与否照档位', () => {
  it.each([
    ['自动档', 'auto', false],
    ['询问档', 'ask', true],
  ])('%s', async (_name, profile, confirm) => {
    const record = await run('write-auto-profile', {}, profile);
    const result = record.result as Obj;
    expect(result.agent_result.truncation_warning).toBeUndefined();
    expect(result.agent_result.summary).not.toContain('疑似没写完');
    expect(result.proposed_patch.requires_confirmation).toBe(confirm);
    expect(artifact(record, 'chapter_check').payload.truncation_warning).toBeUndefined();
  });

  it.each([
    ['对话行收在引号上', `${OPENING}守卫看了他们一眼。\n“进去吧，天黑前找好落脚处。”\n`],
    [
      '结尾是本来就不带句号的列表',
      `${OPENING}林舟清点行囊：\n- 青铜剑一柄\n- 干粮三日\n- 碎银二两\n`,
    ],
  ])('%s：参照同类行的习惯不误判，自动档免点', async (_name, content) => {
    const record = await run('write-auto-profile', { 1: content }, 'auto');
    const result = record.result as Obj;
    expect(result.proposed_patch.after).toContain(content.trim().split('\n').pop());
    expect(result.agent_result.truncation_warning).toBeUndefined();
    expect(result.proposed_patch.requires_confirmation).toBe(false);
  });
});
