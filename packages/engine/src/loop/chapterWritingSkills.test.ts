import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-chapter-writing.windows.json';
import { agentRunReplay } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 照预言机场景的 JSON 形状改
const { replay } = agentRunReplay(golden);
const DRIFT = 'Chapter Brief 的来源在确认期间已变化，请重新生成 Brief 后再确认。';
const SKILLS = {
  '写法/01-开篇.md': '---\n名字：开篇第一章\n什么时候用：写第 1 章\n---\n第一句对白在 110 字左右。',
  '写法/02-章末.md': '---\n名字：章末钩子\n什么时候用：每章结尾\n---\n停在一个没解决的具体问题上。',
};

/** 拿写章 golden 的一个场景，改一改 spec 再回放（不和 golden 比，只看这里关心的行为）。 */
async function run(id: string, change: (spec: Obj) => void) {
  const base = (golden.scenarios as Obj[]).find((item) => item.id === id)!;
  const spec = JSON.parse(base.spec_json);
  change(spec);
  const { record, error } = await replay({ ...base, spec_json: JSON.stringify(spec) });
  if (error) throw error;
  return record;
}

/** 章纲那条脚本回复里加上模型挑的写法。 */
function briefPicks(spec: Obj, names: string[]) {
  const body = JSON.parse(spec.replies[0].body);
  const brief = JSON.parse(body.choices[0].message.content);
  brief.writing_skills = names;
  body.choices[0].message.content = JSON.stringify(brief);
  spec.replies[0].body = JSON.stringify(body);
}

const prompts = (record: Obj) =>
  (record.requests as Obj[]).map((request) => {
    const messages = request.body.messages as Obj[];
    return messages[messages.length - 1].content as string;
  });

describe('写法 skill 进章纲与起草', () => {
  it('lists the skills for the brief, keeps its picks and drafts with only those bodies', async () => {
    const record = await run('write-brief-then-pass', (spec) => {
      spec.extra_files = SKILLS;
      briefPicks(spec, ['章末钩子', '没有这个']);
    });
    const [brief, ...rest] = prompts(record);
    expect(brief).toContain(
      '写法 skill 目录（作者审过的写法 · 名字：什么时候用）：\n- 开篇第一章：写第 1 章\n- 章末钩子：每章结尾',
    );
    expect(brief).toContain('另加 writing_skills');
    const draft = rest.find((prompt) => prompt.endsWith('请输出该文件的完整初稿正文。'))!;
    expect(draft).toContain('### 章末钩子\n停在一个没解决的具体问题上。');
    expect(draft).not.toContain('第一句对白在 110 字左右');
    expect(JSON.stringify(record.artifacts)).toContain('"writing_skills":["章末钩子"]');
  });

  it('leaves the brief prompt as before when the book has no skills', async () => {
    const [brief] = prompts(await run('write-brief-then-pass', () => undefined));
    expect(brief).not.toContain('写法 skill');
    expect(brief).not.toContain('writing_skills');
  });

  it('refuses to draft when a skill changed while the brief waited', async () => {
    const record = await run('write-source-drift', (spec) => {
      spec.extra_files = SKILLS;
      spec.ops[0] = {
        op: 'edit',
        path: '写法/02-章末.md',
        content: '---\n名字：章末钩子\n---\n改过了',
      };
    });
    expect(JSON.stringify(record.controls)).toContain(DRIFT);
  });
});
