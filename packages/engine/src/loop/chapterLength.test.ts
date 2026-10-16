import { describe, expect, it } from 'vitest';
import type { EncodedFile } from '../kernel/contextFixture.test-support';
import { memoryProject } from '../kernel/memoryProject.test-support';
import type { SerialPlan } from '../kernel/serialPlan';
import { chapterChars } from './chapterCheckProtocol';
import { bookChapterRange, buildBriefSeed, recentChapterChars } from './chapterWritingContracts';

// 与 apps/api/tests/test_chapter_writing_contracts.py 同一组例子、同一组期望：影子档逐字节比对章纲请求，两边必须算得一样。
const ROOT = 'D:\\book';

function encoded(text: string): EncodedFile {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return { chunks: [{ base64: btoa(binary), repeat: 1 }] };
}

describe('chapter length', () => {
  it('counts every character except whitespace', () => {
    expect(chapterChars('字。\n\n'.repeat(60))).toBe(120);
    expect(chapterChars('他 推\t门。' + String.fromCharCode(0x3000, 0xa0) + '\r\n')).toBe(4);
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
    expect(await recentChapterChars(reader, ROOT, '正文/第005章.md', 'windows')).toEqual([
      1200, 900, 600,
    ]);
    expect(await recentChapterChars(reader, ROOT, '正文/第003章.md', 'windows')).toEqual([600]);
    expect(await recentChapterChars(reader, 'D:\\missing', '正文/第001章.md', 'windows')).toEqual(
      [],
    );
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

  it('prefers the plan, then the book, then the default', () => {
    const seed = (plan: SerialPlan | null, recentChars?: number[]) =>
      buildBriefSeed({
        userMessage: '写下一章',
        targetPath: '正文/第005章.md',
        planned: null,
        plan,
        recentChars,
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
