import { describe, expect, it } from 'vitest';
import { BREAKDOWN_SKILLS_PATH } from './breakdownSkills';
import { BreakdownCancellations, runBookBreakdown } from './bookBreakdown';
import type { EncodedFile } from './contextFixture.test-support';
import { executeIdeCommand } from './ideCommands';
import { isManuscriptPath } from './manuscript';
import { memoryProject } from './memoryProject.test-support';

const ROOT = 'D:\\book';
const REFERENCE = [
  '第1章 开端',
  '某城下了一夜雨。',
  '“你来了。”她说。',
  '第2章 发展',
  '城门开了，他走进去？',
  '第3章 高潮',
  '对手拦住了他。',
].join('\n');
const OWN = '# 第一章\n\n作者自己的正文，不该被拆。\n';
const ANALYSIS = JSON.stringify({ story_structure: '三幕', transferable_insights: '开场就有事' });
const SKILLS = JSON.stringify({
  skills: [
    { name: '开篇', when: '写第 1 章', body: '- 第一句对白在 10 字前后。' },
    { name: '章末钩子', when: '每章结尾', body: '- 停在问句上。' },
  ],
});

function encode(text: string): EncodedFile {
  const bytes = new TextEncoder().encode(text);
  return { chunks: [{ base64: btoa(String.fromCharCode(...bytes)), repeat: 1 }] };
}

async function breakdown(replies: (string | Error)[], options: { writingSkills?: boolean } = {}) {
  const project = memoryProject(ROOT, {
    '参考/书.txt': encode(REFERENCE),
    '正文/第001章.md': encode(OWN),
  });
  const prompts: { system: string; user: string }[] = [];
  const output = await runBookBreakdown(project.reader, project.writer, ROOT, {
    platform: 'windows',
    targetCount: 3,
    model: {
      provider: 'openai',
      model: 'fake-model',
      callLlm: async ({ systemPrompt, userPrompt }) => {
        prompts.push({ system: systemPrompt, user: userPrompt });
        const reply = replies[prompts.length - 1];
        if (reply instanceof Error || reply === undefined) throw reply ?? new Error('no reply');
        return { content: reply };
      },
    },
    cancellations: new BreakdownCancellations(),
    newAnalysisId: () => 'a1',
    ...options,
  });
  const writes = Object.fromEntries(
    Object.entries(project.takeWrites()).map(([path, bytes]) => [
      path,
      new TextDecoder().decode(bytes).replace(/\r\n/g, '\n'),
    ]),
  );
  return { output: output as { [key: string]: any }, prompts, writes }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 报告是开放 JSON
}

describe('拆书产出写法 skill', () => {
  it('breaks down only the reference book when one sits under 参考/ or 资料/', async () => {
    const { output, prompts } = await breakdown([ANALYSIS]);
    expect(output.source_count).toBe(1);
    expect(output.chapter_count).toBe(3);
    expect(prompts[0].user).not.toContain('作者自己的正文');
  });

  it('measures the book, asks for skills once more and saves them for the author to adopt', async () => {
    const { output, prompts, writes } = await breakdown([ANALYSIS, SKILLS], {
      writingSkills: true,
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1].user).toContain('程序从代表章节实测（3 章）');
    expect(prompts[1].user).not.toContain('作者自己的正文');
    expect(output.writing_skills).toMatchObject({
      status: 'completed',
      count: 2,
      names: ['开篇', '章末钩子'],
      path: BREAKDOWN_SKILLS_PATH,
    });
    expect(output.paths).toContain(BREAKDOWN_SKILLS_PATH);
    const saved = JSON.parse(writes[BREAKDOWN_SKILLS_PATH]);
    expect(saved.skills.map((item: { file_name: string }) => item.file_name)).toEqual([
      '01-开篇.md',
      '02-章末钩子.md',
    ]);
    expect(saved.skills[0].content).toContain('名字：开篇\n什么时候用：写第 1 章');
    expect(writes['.storyforge/analysis/book-breakdown.md']).toContain('## 写法 skill\n');
    expect(writes['.storyforge/analysis/book-breakdown.md']).toContain('- 章末钩子');
  });

  it('keeps the report when the skills come back broken twice', async () => {
    const { output, prompts, writes } = await breakdown([ANALYSIS, '不是 JSON', '还不是'], {
      writingSkills: true,
    });
    expect(prompts).toHaveLength(3);
    expect(output.status).toBe('completed');
    expect(output.writing_skills).toMatchObject({ status: 'failed', count: 0 });
    expect(output.writing_skills.error).toBe('写法 skill 不是有效 JSON。');
    expect(JSON.parse(writes[BREAKDOWN_SKILLS_PATH]).skills).toEqual([]);
  });

  it('says in plain words that skills need a model when none is configured', async () => {
    const project = memoryProject(ROOT, { '参考/书.txt': encode(REFERENCE) });
    const output = (await runBookBreakdown(project.reader, project.writer, ROOT, {
      platform: 'windows',
      targetCount: 3,
      model: null,
      cancellations: new BreakdownCancellations(),
      newAnalysisId: () => 'a1',
      writingSkills: true,
    })) as { writing_skills?: { status: string; count: number; error?: string } };
    expect(output.writing_skills).toMatchObject({
      status: 'failed',
      count: 0,
      error: '还没配置模型，拆不了写法',
    });
  });

  it('a reference book saved as Markdown is not taken for one of the author’s chapters', () => {
    expect(isManuscriptPath('参考/喜欢的书.md')).toBe(false);
    expect(isManuscriptPath('资料/喜欢的书.md')).toBe(false);
  });

  it('the desktop command asks for skills only when it says so', async () => {
    for (const asked of [true, false]) {
      const project = memoryProject(ROOT, { '参考/书.txt': encode(REFERENCE) });
      const replies = [ANALYSIS, SKILLS];
      const result = (await executeIdeCommand(
        'book.breakdown',
        { project_root: ROOT, target_count: 3, ...(asked ? { writing_skills: true } : {}) },
        {
          reader: project.reader,
          writer: project.writer,
          secrets: { values: [] },
          platform: 'windows',
          now: () => new Date('2026-10-24T00:00:00Z'),
          cancellations: new BreakdownCancellations(),
          newAnalysisId: () => 'a1',
          breakdownModel: {
            provider: 'openai',
            model: 'fake-model',
            callLlm: async () => ({ content: replies.shift()! }),
          },
        },
      )) as { payload: { breakdown?: { writing_skills?: { count: number } } } };
      expect(result.payload.breakdown?.writing_skills?.count).toBe(asked ? 2 : undefined);
    }
  });

  it('leaves the report as it was when skills are not asked for', async () => {
    const { output, prompts, writes } = await breakdown([ANALYSIS]);
    expect(prompts).toHaveLength(1);
    expect(output.writing_skills).toBeUndefined();
    expect(writes[BREAKDOWN_SKILLS_PATH]).toBeUndefined();
  });
});
