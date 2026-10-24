import { PROJECT_GUIDE_MARKDOWN } from '@storyforge/project-core';
import { describe, expect, it } from 'vitest';
import type { EncodedFile } from './contextFixture.test-support';
import { GenerationSourceCapture } from './generationSources';
import { memoryProject } from './memoryProject.test-support';
import {
  collectSettingSources,
  SETTING_FILE_MAX_CHARS,
  SETTING_MAX_FILES,
  SETTING_TOTAL_MAX_CHARS,
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
