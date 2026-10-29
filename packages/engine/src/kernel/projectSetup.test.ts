import { PROJECT_GUIDE_MARKDOWN } from '@storyforge/project-core';
import { describe, expect, it } from 'vitest';
import type { EncodedFile } from './contextFixture.test-support';
import { memoryProject } from './memoryProject.test-support';
import {
  missingSetupBeforeFirstChapter,
  projectSetupFacts,
  setupGapSection,
  setupKindOfPath,
  setupNote,
  SKIP_SETUP_PATTERN,
} from './projectSetup';

const ROOT = 'D:\\book';

function encode(text: string): EncodedFile {
  const bytes = new TextEncoder().encode(text);
  return { chunks: [{ base64: btoa(String.fromCharCode(...bytes)), repeat: 1 }] };
}

const missing = (files: Record<string, string>) =>
  missingSetupBeforeFirstChapter(
    memoryProject(
      ROOT,
      Object.fromEntries(Object.entries(files).map(([path, text]) => [path, encode(text)])),
    ).reader,
    ROOT,
    'windows',
  );

describe('missingSetupBeforeFirstChapter', () => {
  it('reports all three for a new book that only has the folder guide', async () => {
    expect(await missing({})).toEqual(['outline', 'character', 'setting']);
    expect(await missing({ '大纲/项目说明.md': PROJECT_GUIDE_MARKDOWN })).toEqual([
      'outline',
      'character',
      'setting',
    ]);
    expect(await missing({ '大纲/项目说明.md': `${PROJECT_GUIDE_MARKDOWN}\r\n` })).toEqual([
      'outline',
      'character',
      'setting',
    ]);
  });

  it('counts an edited guide, any file under 人物, and 世界观 as setting', async () => {
    expect(
      await missing({ '大纲/项目说明.md': `${PROJECT_GUIDE_MARKDOWN}\n\n主线：对抗天命。` }),
    ).toEqual(['character', 'setting']);
    expect(await missing({ '大纲/总纲.md': '主线', '人物/主角.md': '十八岁' })).toEqual([
      'setting',
    ]);
    expect(
      await missing({ '大纲/总纲.md': '主线', '角色/主角.md': '十八岁', '世界观/规则.md': '仪式' }),
    ).toBeNull();
  });

  it('does not count blank files or data files', async () => {
    expect(
      await missing({ '大纲/总纲.md': '  \n', '人物/主角.json': '{}', '设定/规则.md': '仪式' }),
    ).toEqual(['outline', 'character']);
  });

  it('stays out of the way once any chapter exists', async () => {
    expect(await missing({ '正文/第001章.md': '第一章' })).toBeNull();
  });
});

const facts = (files: Record<string, string>) =>
  projectSetupFacts(
    memoryProject(
      ROOT,
      Object.fromEntries(Object.entries(files).map(([path, text]) => [path, encode(text)])),
    ).reader,
    ROOT,
    'windows',
  );

describe('projectSetupFacts', () => {
  it('reports an empty book as no manuscript and all three kinds missing', async () => {
    expect(await facts({ '大纲/项目说明.md': PROJECT_GUIDE_MARKDOWN })).toEqual({
      hasManuscript: false,
      missing: ['outline', 'character', 'setting'],
    });
  });

  it('agrees with the first-chapter check before any chapter exists', async () => {
    const files = { '大纲/总纲.md': '主线', '设定/规则.md': '仪式', '人物/主角.json': '{}' };
    expect(await facts(files)).toEqual({ hasManuscript: false, missing: ['character'] });
    expect(await missing(files)).toEqual(['character']);
    expect(
      await facts({ '大纲/总纲.md': '主线', '人物/主角.md': '十八岁', '世界观/规则.md': '仪式' }),
    ).toEqual({ hasManuscript: false, missing: [] });
  });

  it('still lists missing kinds once chapters exist, where the first-chapter check stays quiet', async () => {
    const files = { '正文/第001章.md': '第一章', '人物/主角.md': '十八岁' };
    expect(await facts(files)).toEqual({ hasManuscript: true, missing: ['outline', 'setting'] });
    expect(await missing(files)).toBeNull();
  });
});

describe('setupKindOfPath', () => {
  it('classifies like the setup check, accepting either separator', () => {
    expect(setupKindOfPath('大纲/总纲.md')).toBe('outline');
    expect(setupKindOfPath('角色\\主角.md')).toBe('character');
    expect(setupKindOfPath('世界观/规则.txt')).toBe('setting');
    expect(setupKindOfPath('人物/主角.json')).toBeNull();
    expect(setupKindOfPath('伏笔/线索.md')).toBeNull();
    expect(setupKindOfPath('正文/第001章.md')).toBeNull();
  });
});

describe('setup wording', () => {
  it('lists what is missing in order and teaches how to skip', () => {
    const note = setupNote(['character', 'setting']);
    expect(note).toContain('还缺人物、世界规则文件');
    expect(note).toContain('人物/主要人物.md → 设定/世界规则.md');
    expect(note).toContain('跳过立项，写第一章');
    expect(SKIP_SETUP_PATTERN.test('跳过立项，写第一章')).toBe(true);
    expect(SKIP_SETUP_PATTERN.test('这次不用立项了，直接写')).toBe(true);
    expect(SKIP_SETUP_PATTERN.test('直接开始写第一章正文')).toBe(false);
    expect(setupGapSection(['outline'])).toBe(
      '[立项 · 确定性]\n· 还没有正文，也还缺总纲文件；开写第一章前先起草，作者审过再写。',
    );
  });
});
