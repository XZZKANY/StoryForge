import { describe, expect, it } from 'vitest';
import { memoryProject } from './memoryProject.test-support';
import { buildPlan, readPlan, renderPlanBlock } from './serialPlan';
import { markChapterWritten, unmarkChapterWritten } from './serialPlanUpdate';

const ROOT = 'D:/book';
const PLAN = '.storyforge/serial-plan.json';
const file = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const plan = (chapters: object[]) => file(JSON.stringify({ version: 1, chapters }));

describe('serial plan: one manuscript file, one plan entry', () => {
  it('does not stamp a later chapter onto an earlier entry after the earlier one was undone', async () => {
    const project = memoryProject(ROOT, {
      '正文/第001章.md': file('第一章。'),
      '正文/第002章.md': file('第二章。'),
      [PLAN]: plan([
        { ordinal: 1, title: '一', status: 'pending' },
        { ordinal: 2, title: '二', status: 'pending' },
      ]),
    });
    const mark = (path: string) =>
      markChapterWritten(project.reader, project.writer, ROOT, path, 'windows');
    await mark('正文/第001章.md');
    await mark('正文/第002章.md');
    project.apply({ '正文/第001章.md': null });
    await unmarkChapterWritten(project.reader, project.writer, ROOT, '正文/第001章.md', 'windows');

    // 第一章没了，第二章按章序排到了第 1；再接受它的整章修订，不该把它认成计划里的第 1 章。
    const result = await mark('正文/第002章.md');
    expect(result).toMatchObject({ updated: false, reason: 'already_done', ordinal: 2 });
    const chapters = (await readPlan(project.reader, ROOT)).chapters as {
      status: string;
      path?: string | null;
    }[];
    expect(chapters.map((chapter) => [chapter.status, chapter.path ?? null])).toEqual([
      ['pending', null],
      ['done', '正文/第002章.md'],
    ]);
  });
});

describe('serial plan prompt when nothing is left to write', () => {
  const block = async (chapters: object[]) => {
    const project = memoryProject(ROOT, { [PLAN]: plan(chapters) });
    return renderPlanBlock((await buildPlan(project.reader, ROOT, 'windows'))!);
  };

  it('says the remaining chapters are blocked, not that everything is written', async () => {
    const text = await block([{ ordinal: 1, title: '一', status: 'blocked', note: '等设定' }]);
    expect(text).toContain('都被作者标成卡住了');
    expect(text).not.toContain('计划内的章节都已落正文');
  });
});
