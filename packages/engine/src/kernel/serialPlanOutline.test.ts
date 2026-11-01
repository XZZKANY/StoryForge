import { describe, expect, it } from 'vitest';
import { chapterOutlinePaths, suggestedChapterOutlinePath } from './chapterOutline';
import { memoryProject } from './memoryProject.test-support';
import { buildPlan, buildPlanBlock, renderPlanBlock } from './serialPlan';

const ROOT = '/book';
const file = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const plan = (chapters: object[]) => ({
  '.storyforge/serial-plan.json': file(JSON.stringify({ version: 1, chapters })),
});
const book = {
  '正文/第001章.md': file('第一章\n\n正文。\n'),
  ...plan([
    { ordinal: 1, title: '入城', goal: '林舟入城', status: 'done' },
    { ordinal: 2, title: '寻亲', goal: '林舟寻亲', status: 'pending' },
  ]),
};

describe('chapterOutlinePaths', () => {
  it('maps the requested chapters to their outline, skipping empty files', async () => {
    const { reader } = memoryProject(ROOT, {
      '大纲/第2章细纲.md': file('先写守卫议论他。\n'),
      '大纲/第3章细纲.md': file('  \n'),
      '大纲/细纲/第三章.md': file('第三章的安排。\n'),
      '大纲/第4章细纲.md': file('第四章的安排。\n'),
    });
    const found = await chapterOutlinePaths(reader, ROOT, [2, 3, 5]);
    expect([...found]).toEqual([
      [2, '大纲/第2章细纲.md'],
      [3, '大纲/细纲/第三章.md'],
    ]);
  });

  it('suggests 大纲/第N章细纲.md with an Arabic number', () => {
    expect(suggestedChapterOutlinePath(12)).toBe('大纲/第12章细纲.md');
  });
});

describe('连载计划块里的本章细纲', () => {
  it('stays as before when not told about the next chapter’s outline', async () => {
    const built = (await buildPlan(memoryProject(ROOT, book).reader, ROOT, 'posix'))!;
    expect(renderPlanBlock(built)).not.toContain('本章细纲');
  });

  it('tells the model where to save an outline the next chapter does not have yet', async () => {
    const block = await buildPlanBlock(memoryProject(ROOT, book).reader, ROOT, 'posix');
    expect(block).toContain(
      '[下一章待写]\n· 第 2 章《寻亲》\n· 本章目标：林舟寻亲\n· 本章细纲：还没有；要写就用 file_create 存成 大纲/第2章细纲.md',
    );
  });

  it('names the outline the next chapter has, and ignores other chapters’ outlines', async () => {
    const { reader } = memoryProject(ROOT, {
      ...book,
      '大纲/第2章细纲.md': file('先写守卫议论他。\n'),
      '大纲/第3章细纲.md': file('第三章的安排。\n'),
    });
    const block = await buildPlanBlock(reader, ROOT, 'posix');
    expect(block).toContain('· 本章细纲：大纲/第2章细纲.md（写章时整份交给章纲和起草）');
    expect(block).not.toContain('第3章细纲');
  });
});
