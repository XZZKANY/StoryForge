import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-chapter-writing.windows.json';
import { GENERATION_PREFIX, PLUGIN_GENERATION_PREFIX } from '../kernel/authorVoice';
import { agentRunReplay } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 照预言机场景的 JSON 形状改
const { replay } = agentRunReplay(golden);
const DRIFT = '章纲的来源在确认期间已变化，请重新生成章纲后再确认。';
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
    expect(draft).toContain(
      '写法要点（作者审过的写法 skill，这一章照着写；例句只示意，不要照抄）：\n' +
        '### 章末钩子\n停在一个没解决的具体问题上。',
    );
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

const PLUGINS = {
  网文包: {
    'storyforge-plugin.json': JSON.stringify({
      name: '网文包',
      version: '1.0.0',
      description: '写网文',
    }),
    '写法/爽点.md': '---\n名字：爽点\n什么时候用：写打脸时\n---\n先压后扬，再一口气翻盘。',
    '写法/章末钩子.md':
      '---\n名字：章末钩子\n什么时候用：插件里的同名写法\n---\n插件的钩子不该出现。',
    '指令.md': '对白要短，一句不超过二十字。',
  },
  没启用的包: { '指令.md': '不该出现。' },
};
const ENABLED = { '.storyforge/plugins.json': JSON.stringify({ version: 1, enabled: ['网文包'] }) };
const PLUGIN_BLOCK = `${PLUGIN_GENERATION_PREFIX}【插件「网文包」】\n对白要短，一句不超过二十字。`;

const requestPair = (record: Obj) =>
  (record.requests as Obj[]).map((request) => {
    const messages = request.body.messages as Obj[];
    return [messages[0].content, messages[messages.length - 1].content] as [string, string];
  });

describe('插件写法与插件指令进写章', () => {
  it('lists plugin styles after the book’s own, drafts with a picked one and the plugin instructions', async () => {
    const record = await run('write-brief-then-pass', (spec) => {
      spec.extra_files = {
        ...SKILLS,
        ...ENABLED,
        '.storyforge/agent-instructions.md': '不改人名。',
      };
      spec.plugins = PLUGINS;
      briefPicks(spec, ['爽点（插件「网文包」）', '章末钩子']);
    });
    const [[, brief], ...rest] = requestPair(record);
    expect(brief).toContain(
      '写法 skill 目录（作者审过的写法 · 名字：什么时候用）：\n- 开篇第一章：写第 1 章\n' +
        '- 章末钩子：每章结尾\n- 爽点（插件「网文包」）：写打脸时\n',
    );
    const [system, draft] = rest.find(([, user]) => user.endsWith('请输出该文件的完整初稿正文。'))!;
    expect(draft).toContain(
      '写法要点（作者选用的写法 skill，这一章照着写；例句只示意，不要照抄）：\n' +
        '### 爽点（插件「网文包」）\n先压后扬，再一口气翻盘。',
    );
    expect(draft).toContain('### 章末钩子\n停在一个没解决的具体问题上。');
    expect(draft).not.toContain('插件的钩子不该出现');
    expect(JSON.stringify(record.artifacts)).toContain('"writing_skills":["爽点","章末钩子"]');
    // 插件指令在通用准则之后、作者指令之前。
    expect(system).toContain(`\n\n${PLUGIN_BLOCK}\n\n`);
    expect(system.indexOf(PLUGIN_BLOCK)).toBeLessThan(system.indexOf(GENERATION_PREFIX));
    expect(system.endsWith(`${GENERATION_PREFIX}不改人名。`)).toBe(true);
    expect(JSON.stringify(record.requests)).not.toContain('不该出现');
    // 拟章纲时记下的来源签名与起草前核对的一致（管线与起草工具用的是同一个插件库）。
    expect(record.result.proposed_patch).toBeTruthy();
  });

  it('gives the same run as before when the library is there but the book enabled no plugin', async () => {
    const change = (withLibrary: boolean) => (spec: Obj) => {
      spec.extra_files = SKILLS;
      if (withLibrary) spec.plugins = PLUGINS;
      briefPicks(spec, ['章末钩子']);
    };
    const plain = await run('write-brief-then-pass', change(false));
    expect(JSON.stringify(plain.artifacts)).toContain('"source_guard"');
    expect(await run('write-brief-then-pass', change(true))).toEqual(plain);
  });

  it.each([
    ['a plugin style', '写法/爽点.md', '---\n名字：爽点\n---\n改过了'],
    ['the plugin instructions', '指令.md', '对白要长。'],
  ])('refuses to draft when %s changed while the brief waited', async (_name, path, content) => {
    const record = await run('write-source-drift', (spec) => {
      spec.extra_files = { ...SKILLS, ...ENABLED };
      spec.plugins = PLUGINS;
      spec.ops[0] = { op: 'edit_plugin', id: '网文包', path, content };
    });
    expect(JSON.stringify(record.controls)).toContain(DRIFT);
  });
});
