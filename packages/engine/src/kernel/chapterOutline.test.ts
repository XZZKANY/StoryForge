import { describe, expect, it } from 'vitest';
import {
  CHAPTER_OUTLINE_MAX_CHARS,
  chapterFileOrdinal,
  chapterOutlineFrom,
  chapterOutlineOrdinal,
  findChapterOutline,
} from './chapterOutline';
import type { EncodedFile } from './contextFixture.test-support';
import { memoryProject } from './memoryProject.test-support';
import { collectSettingSources } from './settingSources';

const ROOT = 'D:\\book';
const SECRETS = { values: ['sk-outline-secret-123456'] };

function encode(text: string): EncodedFile {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { chunks: [{ base64: btoa(binary), repeat: 1 }] };
}

const readerOf = (files: Record<string, string>) =>
  memoryProject(
    ROOT,
    Object.fromEntries(Object.entries(files).map(([path, text]) => [path, encode(text)])),
  ).reader;

describe('chapterOutlineOrdinal', () => {
  it('reads the chapter number of a chapter outline, in Arabic or Chinese numerals', () => {
    expect(chapterOutlineOrdinal('大纲/第2章细纲.md')).toBe(2);
    expect(chapterOutlineOrdinal('大纲/第002章 细纲.md')).toBe(2);
    expect(chapterOutlineOrdinal('大纲/细纲/第十二章.md')).toBe(12);
    expect(chapterOutlineOrdinal('大纲/细纲-第三章-入府.md')).toBe(3);
  });

  it('is null for files that are not one chapter’s outline', () => {
    expect(chapterOutlineOrdinal('大纲/总纲.md')).toBeNull();
    expect(chapterOutlineOrdinal('大纲/第2章.md')).toBeNull();
    expect(chapterOutlineOrdinal('大纲/细纲总表.md')).toBeNull();
  });
});

describe('chapterFileOrdinal', () => {
  it('reads the chapter number from the file name of a relative or absolute path', () => {
    expect(chapterFileOrdinal('正文/第055章.md')).toBe(55);
    expect(chapterFileOrdinal('E:\\书\\第3章草稿\\正文\\第055章.md')).toBe(55);
    expect(chapterFileOrdinal('正文/第十二章 入城.md')).toBe(12);
    expect(chapterFileOrdinal('人物/主角.md')).toBeNull();
  });
});

describe('findChapterOutline', () => {
  it('returns the whole outline of the requested chapter, past the 1200-char excerpt', async () => {
    const text = `# 第2章细纲\n${'开场。'.repeat(500)}\n收在他走出偏厅。`;
    const reader = readerOf({
      '大纲/总纲.md': '主线。',
      '大纲/第2章细纲.md': text,
      '大纲/第3章细纲.md': '第三章的安排。',
    });
    const outline = await findChapterOutline(reader, ROOT, 2, { secrets: SECRETS });
    expect(outline).toEqual({
      path: '大纲/第2章细纲.md',
      text,
      totalChars: Array.from(text).length,
      truncated: false,
    });
  });

  it('is null without a chapter number or without an outline for that chapter', async () => {
    const reader = readerOf({ '大纲/第3章细纲.md': '第三章的安排。' });
    expect(await findChapterOutline(reader, ROOT, null, { secrets: SECRETS })).toBeNull();
    expect(await findChapterOutline(reader, ROOT, 2, { secrets: SECRETS })).toBeNull();
  });

  it('cuts an outline longer than the cap and says so', async () => {
    const reader = readerOf({ '大纲/第2章细纲.md': '甲'.repeat(CHAPTER_OUTLINE_MAX_CHARS + 10) });
    const outline = await findChapterOutline(reader, ROOT, 2, { secrets: SECRETS });
    expect(outline?.truncated).toBe(true);
    expect(outline?.totalChars).toBe(CHAPTER_OUTLINE_MAX_CHARS + 10);
    expect(Array.from(outline!.text)).toHaveLength(CHAPTER_OUTLINE_MAX_CHARS);
  });

  it('redacts secrets', async () => {
    const reader = readerOf({ '大纲/第2章细纲.md': `钥匙 ${SECRETS.values[0]} 别写进去。` });
    const outline = await findChapterOutline(reader, ROOT, 2, { secrets: SECRETS });
    expect(outline?.text).not.toContain(SECRETS.values[0]);
  });

  it('round-trips through a tool payload and rejects other shapes', async () => {
    const reader = readerOf({ '大纲/第2章细纲.md': '安排。' });
    const outline = await findChapterOutline(reader, ROOT, 2, { secrets: SECRETS });
    expect(chapterOutlineFrom(JSON.parse(JSON.stringify(outline)))).toEqual(outline);
    expect(chapterOutlineFrom({ path: '大纲/第2章细纲.md', text: '' })).toBeNull();
    expect(chapterOutlineFrom('安排。')).toBeNull();
  });
});

describe('setting sources leave chapter outlines to their own chapter', () => {
  it('keeps the book outline and drops every per-chapter outline', async () => {
    const reader = readerOf({
      '大纲/总纲.md': '主线。',
      '大纲/第2章细纲.md': '第二章的安排。',
      '大纲/细纲/第三章.md': '第三章的安排。',
      '人物/主角.md': '主角十四岁。',
    });
    const result = await collectSettingSources(reader, ROOT, { secrets: SECRETS });
    expect(result?.paths).toEqual(['大纲/总纲.md', '人物/主角.md']);
    expect(result?.block).not.toContain('的安排');
  });
});
