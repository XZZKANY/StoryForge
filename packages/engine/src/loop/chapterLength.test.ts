import { describe, expect, it } from 'vitest';
import { countProseChars } from '@storyforge/project-core';
import type { EncodedFile } from '../kernel/contextFixture.test-support';
import { memoryProject } from '../kernel/memoryProject.test-support';
import type { SerialPlan } from '../kernel/serialPlan';
import { bookChapterRange, buildBriefSeed, earliestChapterChars } from './chapterWritingContracts';

// 与 apps/api/tests/test_chapter_writing_contracts.py 同一组例子、同一组期望：影子档逐字节比对章纲请求，两边必须算得一样。
const ROOT = 'D:\\book';

function encoded(text: string): EncodedFile {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return { chunks: [{ base64: btoa(binary), repeat: 1 }] };
}

describe('chapter length', () => {
  it('counts every character except whitespace', () => {
    expect(countProseChars('字。\n\n'.repeat(60))).toBe(120);
    expect(countProseChars('他 推\t门。' + String.fromCharCode(0x3000, 0xa0) + '\r\n')).toBe(4);
  });

  it('samples the chapters before the target, skipping stubs and outlines', async () => {
    const { reader } = memoryProject(ROOT, {
      '正文/第001章.md': encoded('第一章 待写\n'),
      '正文/第002章.md': encoded('甲'.repeat(600) + '\n'.repeat(50)),
      '正文/第003章.md': encoded('乙'.repeat(900)),
      '正文/第004章.md': encoded('丙'.repeat(1200)),
      '正文/第006章.md': encoded('戊'.repeat(3000)),
      '大纲/总纲.md': encoded('丁'.repeat(5000)),
    });
    expect(await earliestChapterChars(reader, ROOT, '正文/第005章.md', 'windows')).toEqual([
      600, 900, 1200,
    ]);
    expect(await earliestChapterChars(reader, ROOT, '正文/第003章.md', 'windows')).toEqual([600]);
    expect(await earliestChapterChars(reader, 'D:\\missing', '正文/第001章.md', 'windows')).toEqual(
      [],
    );
  });

  it('samples mixed padded chapter names in reading order for a missing or saved target', async () => {
    const project = memoryProject(ROOT, {
      '正文/第1章 空着的卡槽.md': encoded('甲'.repeat(767)),
      '正文/第002章.md': encoded('乙'.repeat(1063)),
      '正文/第10章.md': encoded('丁'.repeat(2000)),
    });
    for (const saved of [false, true]) {
      if (saved) project.apply({ '正文/第003章.md': encoded('丙'.repeat(900)) });
      const counts = await earliestChapterChars(project.reader, ROOT, '正文/第003章.md', 'windows');
      expect(counts).toEqual([767, 1063]);
      expect(bookChapterRange(counts)).toEqual([600, 1000]);
    }
  });

  it('keeps the earliest chapters as the baseline when later chapters run long', async () => {
    const name = (ordinal: number) => `正文/第${String(ordinal).padStart(3, '0')}章.md`;
    const files: Record<string, EncodedFile> = { [name(1)]: encoded('第一章 待写\n') };
    for (let ordinal = 2; ordinal <= 40; ordinal += 1)
      files[name(ordinal)] = encoded(ordinal <= 4 ? '甲'.repeat(1000) : '乙'.repeat(5000));
    const { reader } = memoryProject(ROOT, files);
    const counts = await earliestChapterChars(reader, ROOT, name(41), 'windows');
    expect(counts).toEqual(Array(3).fill(1000));
    expect(bookChapterRange(counts)).toEqual([800, 1200]);
  });

  it.each([
    [
      [1200, 900, 600],
      [700, 1100],
    ],
    [
      [2972, 4017, 3963],
      [3100, 4800],
    ],
    [
      [600, 1000],
      [400, 800],
    ],
    [
      [500, 501],
      [400, 600],
    ],
    [[3000], null],
    [[], null],
  ])('ranges %j as %j', (counts, expected) => {
    expect(bookChapterRange(counts)).toEqual(expected);
  });

  // 10-31 实验书：没定字数，模型每章写到上限附近，前 20 章的目标从 1600–2600 抬到 4400–6700。
  it('fixes the target once three chapters are written, however long later chapters run', async () => {
    const name = (ordinal: number) => `正文/第${String(ordinal).padStart(3, '0')}章.md`;
    const files: Record<string, EncodedFile> = {};
    for (let ordinal = 1; ordinal <= 20; ordinal += 1)
      files[name(ordinal)] = encoded('甲'.repeat(2400 + (ordinal - 1) * 250));
    const { reader } = memoryProject(ROOT, files);
    const range = async (ordinal: number) =>
      bookChapterRange(await earliestChapterChars(reader, ROOT, name(ordinal), 'windows'));
    expect(await range(3)).toEqual([1900, 2900]);
    for (const ordinal of [4, 10, 21]) expect(await range(ordinal)).toEqual([2100, 3200]);
  });

  it('prefers the plan, then the book, then the default', () => {
    const seed = (plan: SerialPlan | null, earliestChars?: number[]) =>
      buildBriefSeed({
        userMessage: '写下一章',
        targetPath: '正文/第005章.md',
        planned: null,
        plan,
        earliestChars,
      });
    const range = (value: { [key: string]: unknown }) => [
      value.target_chars_min,
      value.target_chars_max,
    ];
    expect(range(seed(null, [1200, 900, 600]))).toEqual([700, 1100]);
    expect(range(seed(null))).toEqual([1600, 2600]);
    const plan = { chapterWordCountMin: 2000, chapterWordCountMax: 3000 } as SerialPlan;
    expect(range(seed(plan, [1200, 900, 600]))).toEqual([2000, 3000]);
  });
});
