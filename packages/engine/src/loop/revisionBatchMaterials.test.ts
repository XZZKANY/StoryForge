import { expect, it } from 'vitest';
import golden from '../../golden/p3-fixed-pipelines.windows.json';
import { agentRunReplay } from './agentRunReplay.test-support';
type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 合成回放场景

it('continuous file revisions receive full world rules and the shared character boundary', async () => {
  const base = (golden.scenarios as Obj[]).find((item) => item.id === 'revise-fixed')!;
  const spec = JSON.parse(base.spec_json);
  spec.message.args.include_writing_materials = true;
  const world = '世界规则。'.repeat(1600) + '世界规则末尾。';
  spec.extra_files = {
    '设定/世界规则.md': world,
    '人物/主要人物.md':
      '# 人物\n## 一、林舟\n林舟只凭证据行动。\n## 二、沈禾\n' +
      '沈禾经历。'.repeat(1500) +
      '\n## 三、统一写作边界\n不要让能力替代调查。',
  };
  const { record, error } = await agentRunReplay(golden).replay({
    ...base,
    spec_json: JSON.stringify(spec),
  });
  if (error) throw error;
  const texts = (record.requests as Obj[]).map((request) =>
    request.body.messages.map((message: Obj) => message.content).join('\n'),
  );
  expect(texts.some((text) => text.includes(world) && text.includes('不要让能力替代调查。'))).toBe(
    true,
  );
  expect(record.result.proposed_patch.file_path).toContain('第001章.md');
});
