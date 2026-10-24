import { describe, expect, it } from 'vitest';
import type { EncodedFile } from './contextFixture.test-support';
import { isManuscriptPath } from './manuscript';
import { memoryProject } from './memoryProject.test-support';
import {
  loadWritingSkills,
  parseWritingSkill,
  pickWritingSkills,
  WRITING_SKILL_INDEX_MAX,
  WRITING_SKILL_MAX_CHARS,
  writingSkillIndex,
  writingSkillsBlock,
} from './writingSkills';

const ROOT = 'D:\\book';
const SECRETS = { values: ['sk-skill-secret-123456'] };

function encode(text: string): EncodedFile {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { chunks: [{ base64: btoa(binary), repeat: 1 }] };
}

const load = (files: Record<string, string>) =>
  loadWritingSkills(
    memoryProject(
      ROOT,
      Object.fromEntries(Object.entries(files).map(([path, text]) => [path, encode(text)])),
    ).reader,
    ROOT,
    SECRETS,
  );

const OPENING = '---\n名字：开篇第一章\n什么时候用：写第 1 章\n---\n- 第一句对白在 110 字左右。';

describe('parseWritingSkill', () => {
  it('reads the name and when-to-use from the header, full- or half-width colons', () => {
    expect(parseWritingSkill('写法/开篇.md', OPENING)).toEqual({
      path: '写法/开篇.md',
      name: '开篇第一章',
      when: '写第 1 章',
      body: '- 第一句对白在 110 字左右。',
    });
    expect(
      parseWritingSkill(
        '写法/hook.md',
        '---\r\nname: 章末钩子\r\nwhen: 每章结尾\r\n---\r\n停在问题上。',
      ),
    ).toMatchObject({ name: '章末钩子', when: '每章结尾', body: '停在问题上。' });
  });

  it('falls back to the file name and the first line when there is no header', () => {
    expect(
      parseWritingSkill('写法/对白节奏.md', '# 对白多一点\n\n对白约占四分之一。'),
    ).toMatchObject({
      name: '对白节奏',
      when: '对白多一点',
    });
  });
});

describe('loadWritingSkills', () => {
  it('reads only Markdown under 写法, in path order, skipping hidden and empty ones', async () => {
    const skills = await load({
      '写法/02-章末.md': '---\n名字：章末钩子\n什么时候用：每章结尾\n---\n停在问题上。',
      '写法/01-开篇.md': OPENING,
      '写法/.草稿.md': '不该读',
      '写法/空.md': '---\n名字：空\n---\n',
      '写法/数据.json': '{}',
      '设定/写法.md': '不是 skill',
    });
    expect(skills.map((skill) => skill.name)).toEqual(['开篇第一章', '章末钩子']);
    expect(writingSkillIndex(skills)).toBe('- 开篇第一章：写第 1 章\n- 章末钩子：每章结尾');
  });

  it('redacts secrets and caps how many it lists', async () => {
    const files: Record<string, string> = {
      '写法/00.md': '钥匙 sk-skill-secret-123456 别写进正文',
    };
    for (let index = 1; index <= WRITING_SKILL_INDEX_MAX + 2; index += 1)
      files[`写法/${String(index).padStart(2, '0')}.md`] = `写法 ${index}`;
    const skills = await load(files);
    expect(skills).toHaveLength(WRITING_SKILL_INDEX_MAX);
    expect(skills[0].body).not.toContain('sk-skill-secret-123456');
  });

  it('keeps skill files out of the chapter order', () => {
    expect(isManuscriptPath('写法/开篇.md')).toBe(false);
  });
});

describe('picking and delivering skills', () => {
  const skills = [
    { path: '写法/a.md', name: '开篇第一章', when: '第 1 章', body: '开篇要点', sha256: 'a' },
    { path: '写法/b.md', name: '章末钩子', when: '每章', body: '钩子要点', sha256: 'b' },
    { path: '写法/c.md', name: '对白', when: '每章', body: '对白要点', sha256: 'c' },
    { path: '写法/d.md', name: '打斗', when: '打斗场面', body: '打斗要点', sha256: 'd' },
  ];

  it('keeps only known names, once each, at most three', () => {
    expect(pickWritingSkills(['章末钩子', '没有这个', '章末钩子', ' 开篇第一章 '], skills)).toEqual(
      ['章末钩子', '开篇第一章'],
    );
    expect(pickWritingSkills(['开篇第一章', '章末钩子', '对白', '打斗'], skills)).toHaveLength(3);
    expect(pickWritingSkills('开篇第一章', skills)).toEqual([]);
  });

  it('delivers the picked bodies in order and cuts long ones', () => {
    expect(writingSkillsBlock(skills, ['章末钩子', '开篇第一章'])).toBe(
      '写法要点（作者审过的写法 skill，这一章照着写；例句只示意，不要照抄）：\n' +
        '### 章末钩子\n钩子要点\n\n### 开篇第一章\n开篇要点',
    );
    expect(writingSkillsBlock(skills, ['没有这个'])).toBeNull();
    const long = [{ ...skills[0], body: '长'.repeat(WRITING_SKILL_MAX_CHARS + 10) }];
    expect(writingSkillsBlock(long, ['开篇第一章'])).toContain(
      `${'长'.repeat(WRITING_SKILL_MAX_CHARS)}……`,
    );
  });
});
