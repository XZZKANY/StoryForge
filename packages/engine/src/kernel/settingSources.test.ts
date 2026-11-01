import { PROJECT_GUIDE_MARKDOWN } from '@storyforge/project-core';
import { describe, expect, it } from 'vitest';
import type { EncodedFile } from './contextFixture.test-support';
import { GenerationSourceCapture } from './generationSources';
import { memoryProject } from './memoryProject.test-support';
import {
  BOOK_OUTLINE_MAX_CHARS,
  collectBookOutline,
  collectSettingSources,
  SETTING_FILE_MAX_CHARS,
  SETTING_MAX_FILES,
  SETTING_TOTAL_MAX_CHARS,
  settingSourcesWarnings,
} from './settingSources';

const ROOT = 'D:\\book';
const SECRETS = { values: ['sk-setting-secret-123456'] };

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

describe('collectSettingSources', () => {
  it('returns null when the project has no outline, character or setting files', async () => {
    const reader = readerOf({ '正文/第001章.md': '第一章', '资料/参考.md': '参考资料' });
    expect(await collectSettingSources(reader, ROOT, { secrets: SECRETS })).toBeNull();
  });

  it('puts the outline first, then characters and settings, whole, and leaves out materials and data files', async () => {
    const reader = readerOf({
      '设定/世界规则.md': '灵气三分。',
      '人物/02-师兄.md': '师兄嫉妒他。',
      '人物/01-主角.md': '主角十八岁。',
      '大纲/总纲.md': '主线：对抗天命。',
      '资料/参考.md': '不该带上。',
      '设定/数值.json': '{"灵石": 1}',
      '正文/第001章.md': '第一章',
    });
    const result = await collectSettingSources(reader, ROOT, { secrets: SECRETS });
    expect(result?.paths).toEqual([
      '大纲/总纲.md',
      '人物/01-主角.md',
      '人物/02-师兄.md',
      '设定/世界规则.md',
    ]);
    expect(result?.block).toContain('### 设定/世界规则.md\n<<<SETTING\n灵气三分。\nSETTING>>>');
    expect(result?.block).not.toContain('不该带上');
    expect(result?.block).not.toContain('灵石');
    expect(result?.block).not.toContain('第一章');
    expect(result?.truncated).toEqual([]);
    expect(result?.omitted).toEqual([]);
  });

  it('leaves out the folder guide every new book starts with, unless the author edited it', async () => {
    const guide = await collectSettingSources(
      readerOf({ '大纲/项目说明.md': PROJECT_GUIDE_MARKDOWN, '大纲/总纲.md': '主线' }),
      ROOT,
      { secrets: SECRETS },
    );
    expect(guide?.paths).toEqual(['大纲/总纲.md']);
    const edited = await collectSettingSources(
      readerOf({ '大纲/项目说明.md': `${PROJECT_GUIDE_MARKDOWN}\n\n主线：对抗天命。` }),
      ROOT,
      { secrets: SECRETS },
    );
    expect(edited?.paths).toEqual(['大纲/项目说明.md']);
  });

  it('keeps the second half of a setting file that the 1200-char excerpt used to cut', async () => {
    const reader = readerOf({ '设定/世界观.md': '前文。'.repeat(500) + '天命是天道认可的标记。' });
    const result = await collectSettingSources(reader, ROOT, { secrets: SECRETS });
    expect(result?.block).toContain('天命是天道认可的标记。');
  });

  it('cuts a file longer than the per-file cap and says how much was kept', async () => {
    const long = '字'.repeat(SETTING_FILE_MAX_CHARS + 100);
    const result = await collectSettingSources(readerOf({ '大纲/总纲.md': long }), ROOT, {
      secrets: SECRETS,
    });
    expect(result?.truncated).toEqual(['大纲/总纲.md']);
    expect(result?.block).toContain(
      `这份共 ${SETTING_FILE_MAX_CHARS + 100} 字，这里只放了开头 ${SETTING_FILE_MAX_CHARS} 字`,
    );
    expect(result?.block).not.toContain('字'.repeat(SETTING_FILE_MAX_CHARS + 1));
  });

  it('stops at the total budget and names what was left out', async () => {
    const piece = '甲'.repeat(5000);
    const result = await collectSettingSources(
      readerOf({
        '人物/a.md': piece,
        '人物/b.md': piece,
        '人物/c.md': piece,
        '人物/d.md': piece,
      }),
      ROOT,
      { secrets: SECRETS },
    );
    expect(result?.paths).toEqual(['人物/a.md', '人物/b.md', '人物/c.md']);
    expect(result?.truncated).toEqual(['人物/c.md']);
    expect(result?.omitted).toEqual(['人物/d.md']);
    expect(result?.block).toContain('另有 1 份立项资料没放进来：人物/d.md');
    const delivered = [...result!.block].filter((char) => char === '甲').length;
    expect(delivered).toBe(SETTING_TOTAL_MAX_CHARS);
  });

  it('takes at most the file-count cap', async () => {
    const files = Object.fromEntries(
      Array.from({ length: SETTING_MAX_FILES + 2 }, (_, index) => [
        `人物/${String(index).padStart(2, '0')}.md`,
        `角色${index}`,
      ]),
    );
    const result = await collectSettingSources(readerOf(files), ROOT, { secrets: SECRETS });
    expect(result?.paths).toHaveLength(SETTING_MAX_FILES);
    expect(result?.omitted).toEqual(['人物/12.md', '人物/13.md']);
  });

  it('redacts secrets and records what it delivered without copying the text into evidence', async () => {
    const reader = readerOf({ '设定/接口.md': '钥匙是 sk-setting-secret-123456，别外传。' });
    const capture = await GenerationSourceCapture.create({
      root: ROOT,
      platform: 'windows',
      secrets: SECRETS,
    });
    const result = await collectSettingSources(reader, ROOT, { secrets: SECRETS, capture });
    expect(result?.block).not.toContain('sk-setting-secret-123456');
    expect(capture.selections).toEqual([
      {
        purpose: 'setting_files',
        value: expect.objectContaining({ file_count: 1, omitted_count: 0, truncated_count: 0 }),
      },
    ]);
    expect(capture.projections.map(([row, text]) => [row.purpose, text])).toEqual([
      ['setting_files', result!.block],
    ]);
    expect(JSON.stringify(capture.selections)).not.toContain('别外传');
  });
});

/** 人物写得长、章节节点排在最后：只取开头时第 5 章节点落在截断处之后（真书即如此）。 */
function longOutline(): string {
  const nodes = Array.from(
    { length: 10 },
    (_, index) => `### 第${index + 1}章：节点${index + 1}\n\n节点${index + 1}安排。`,
  ).join('\n\n');
  return [
    '# 总纲',
    `## 人物\n\n${'人物小传。'.repeat(1300)}`,
    `## 第一卷：开篇\n\n${'第一卷安排。'.repeat(20)}`,
    `## 开篇节点\n\n${nodes}`,
  ].join('\n\n');
}

describe('collectSettingSources 按章挑总纲', () => {
  it('puts the chapter node in when the outline is too long, where the head cut lost it', async () => {
    const outline = longOutline();
    expect([...outline].slice(0, SETTING_FILE_MAX_CHARS).join('')).not.toContain('节点5安排');
    const result = await collectSettingSources(readerOf({ '大纲/总纲.md': outline }), ROOT, {
      secrets: SECRETS,
      ordinal: 5,
    });
    expect(result?.truncated).toEqual(['大纲/总纲.md']);
    expect(result?.block).toContain('按第 5 章挑');
    for (const node of [5, 6, 7]) expect(result?.block).toContain(`节点${node}安排`);
    // 放不下的小节只留标题，模型仍看得到全书骨架。
    expect(result?.block).toContain('### 第10章：节点10');
    expect(result?.block).not.toContain('这里只放了开头');
  });

  it('keeps the headings in order when no chapter number is known', async () => {
    const result = await collectSettingSources(readerOf({ '大纲/总纲.md': longOutline() }), ROOT, {
      secrets: SECRETS,
    });
    expect(result?.block).toContain('小节按原顺序放到额度用完');
    expect(result?.block).toContain('### 第5章：节点5');
  });

  it('cuts characters and settings at the head as before, and outlines without headings too', async () => {
    const long = `## 第5章\n\n${'字'.repeat(SETTING_FILE_MAX_CHARS)}`;
    const result = await collectSettingSources(
      readerOf({ '人物/主角.md': long, '大纲/总纲.md': '无标题。'.repeat(2000) }),
      ROOT,
      { secrets: SECRETS, ordinal: 5 },
    );
    expect(result?.block).toContain('大纲/总纲.md\n<<<SETTING\n无标题。');
    expect(result?.block.match(/这里只放了开头/gu)).toHaveLength(2);
    expect(result?.block).not.toContain('按第 5 章挑');
  });
});

describe('collectBookOutline', () => {
  it('takes only the outline folder, without per-chapter outlines, characters or settings', async () => {
    const outline = await collectBookOutline(
      readerOf({
        '大纲/总纲.md': '主线：对抗天命。',
        '大纲/第3章细纲.md': '第三章细纲。',
        '人物/主角.md': '主角十八岁。',
        '设定/世界.md': '灵气三分。',
      }),
      ROOT,
      { secrets: SECRETS, ordinal: 3 },
    );
    expect(outline).toBe('【大纲/总纲.md】\n主线：对抗天命。');
  });

  it('returns null when the book has no outline', async () => {
    const outline = await collectBookOutline(readerOf({ '人物/主角.md': '主角。' }), ROOT, {
      secrets: SECRETS,
      ordinal: 1,
    });
    expect(outline).toBeNull();
  });

  it('picks the chapter node out of a long outline', async () => {
    const outline = await collectBookOutline(readerOf({ '大纲/总纲.md': longOutline() }), ROOT, {
      secrets: SECRETS,
      ordinal: 5,
    });
    expect([...outline!].length).toBeLessThanOrEqual(BOOK_OUTLINE_MAX_CHARS + 200);
    expect(outline).toContain('节点5安排');
    expect(outline).toContain('按第 5 章挑');
  });
});

describe('settingSourcesWarnings', () => {
  const warn = (files: Record<string, string>) =>
    settingSourcesWarnings(readerOf(files), ROOT, { secrets: SECRETS });

  it('says nothing when there is no setting material, or all of it fits', async () => {
    expect(await warn({})).toEqual([]);
    expect(await warn({ '大纲/总纲.md': '## 第1章\n开场。\n', '人物/主角.md': '林舟。' })).toEqual(
      [],
    );
  });

  it('tells the author an outline with chapter headings is picked per chapter', async () => {
    const nodes = Array.from({ length: 12 }, (_, i) => `## 第${i + 1}章\n${'字'.repeat(600)}`);
    const text = nodes.join('\n\n');
    const warnings = await warn({ '大纲/总纲.md': text });
    expect(warnings).toEqual([
      `「大纲/总纲.md」共 ${[...text].length} 字，每章只放得下 ${SETTING_FILE_MAX_CHARS} 字：` +
        '写每一章时按章号先挑相关的小节，放不下的小节只留标题。',
    ]);
  });

  it('says what is lost when only the head fits, and hints headings only for outlines', async () => {
    const long = '字'.repeat(SETTING_FILE_MAX_CHARS + 10);
    const warnings = await warn({ '大纲/总纲.md': long, '人物/主角.md': long });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('「大纲/总纲.md」');
    expect(warnings[0]).toContain(
      `只带开头 ${SETTING_FILE_MAX_CHARS} 字，后面的内容 AI 写章时看不到`,
    );
    expect(warnings[0]).toContain('加上标题就能按章挑相关小节');
    expect(warnings[1]).toContain('「人物/主角.md」');
    expect(warnings[1]).not.toContain('标题');
  });

  it('names the files left out by the total budget', async () => {
    const piece = '甲'.repeat(5000);
    const warnings = await warn({
      '人物/a.md': piece,
      '人物/b.md': piece,
      '人物/c.md': piece,
      '人物/d.md': piece,
    });
    expect(warnings.at(-1)).toBe(
      `另有 1 份立项资料放不进去（每章最多带 ${SETTING_MAX_FILES} 份、合计 ${SETTING_TOTAL_MAX_CHARS} 字），` +
        'AI 写章时一字不带：「人物/d.md」。',
    );
  });

  it('adds the chapter-outline step only for outlines it cuts beyond what drafting cuts', async () => {
    const piece = '纲'.repeat(4000);
    const warnings = await warn({ '大纲/a.md': piece, '大纲/b.md': piece, '大纲/c.md': piece });
    // 起草：三份全文，合计正好 12000。章纲：a 全文，b 截到 2000，c 不带。
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toBe(
      `排章纲时大纲合计只带 ${BOOK_OUTLINE_MAX_CHARS} 字，这几份带不全或不带（起草时照上面的规矩带）：` +
        '「大纲/b.md」「大纲/c.md」。',
    );
  });
});
