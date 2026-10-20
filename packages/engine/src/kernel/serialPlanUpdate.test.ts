import { describe, expect, it } from 'vitest';
import { memoryProject } from './memoryProject.test-support';
import { PLAN_RELATIVE_PATH } from './serialPlan';
import { applyPlanUpdate, overlongPlanFields } from './serialPlanUpdate';

const ROOT = '/book';
const file = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const book = () => memoryProject(ROOT, { '正文/第001章.md': file('第一章\n\n雨夜。\n') });

// 全项目审计 C-12：计划更新曾把超过 200 字的目标 / 备注截短了照存，工具还报成功。
describe('plan fields over the length limit', () => {
  it('are refused with which chapter and field to shorten, and nothing is written', async () => {
    const project = book();
    await expect(
      applyPlanUpdate(
        project.reader,
        project.writer,
        ROOT,
        { chapters: [{ ordinal: 2, goal: '短目标', note: '卡'.repeat(201) }] },
        'posix',
      ),
    ).rejects.toThrow('第 2 章的备注有 201 字（上限 200）');
    expect(project.takeWrites()).toEqual({});
  });

  it('right at the limit are stored whole', async () => {
    const project = book();
    const note = '卡'.repeat(200);
    await applyPlanUpdate(
      project.reader,
      project.writer,
      ROOT,
      { chapters: [{ ordinal: 2, goal: '短目标', note }] },
      'posix',
    );
    const written = project.takeWrites()[PLAN_RELATIVE_PATH];
    const plan = JSON.parse(new TextDecoder().decode(written));
    expect(plan.chapters.find((item: { ordinal: number }) => item.ordinal === 2).note).toBe(note);
  });

  it('are all listed at once, counted in characters rather than UTF-16 units', () => {
    expect(
      overlongPlanFields({
        chapters: [
          { ordinal: 1, title: '题'.repeat(81) },
          { ordinal: 3, goal: '𠀀'.repeat(200) },
          { ordinal: 4, goal: 'g'.repeat(201), note: '  留白  ' },
        ],
        premise: '主'.repeat(301),
      }),
    ).toEqual([
      '第 1 章的标题有 81 字（上限 80）',
      '第 4 章的目标有 201 字（上限 200）',
      '主线有 301 字（上限 300）',
    ]);
  });
});
