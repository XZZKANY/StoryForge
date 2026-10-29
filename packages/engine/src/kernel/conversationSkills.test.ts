import { describe, expect, it } from 'vitest';
import { ProjectReadError } from '../readPort';
import type { EncodedFile } from './contextFixture.test-support';
import { conversationSkillsBlock, loadConversationSkills } from './conversationSkills';
import { isManuscriptPath } from './manuscript';
import { memoryProject } from './memoryProject.test-support';
import { projectKnowledgeSourceType } from './projectKnowledge';
import { missingSetupBeforeFirstChapter, setupKindOfPath } from './projectSetup';
import { loadWritingSkills } from './writingSkills';

const ROOT = 'D:\\book';
const SECRET = 'sk-skill-secret-123456';
const SECRETS = { values: [SECRET] };

function encode(text: string): EncodedFile {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { chunks: [{ base64: btoa(binary), repeat: 1 }] };
}

const project = (files: Record<string, string>) =>
  memoryProject(
    ROOT,
    Object.fromEntries(Object.entries(files).map(([path, text]) => [path, encode(text)])),
  );
const load = (files: Record<string, string>) =>
  loadConversationSkills(project(files).reader, ROOT, SECRETS);

const SETUP =
  '---\n名字：立项流程\n什么时候用：作者问「下一步干什么」，或世界观、总纲、人物刚写完一份时\n---\n# 立项流程\n\n按这个顺序立项。';
const REVIEW = '---\nname: 审稿口径\nwhen: 作者让你审稿时\n---\n先说最影响读下去的一处。';

describe('loadConversationSkills', () => {
  it('lists only Markdown at the root 技能/, in path order, without bodies', async () => {
    const skills = await load({
      '技能/审稿口径.md': REVIEW,
      '技能/立项流程.md': SETUP,
      '技能/.草稿.md': '不该读',
      '技能/空.md': '---\n名字：空\n---\n',
      '技能/数据.json': '{}',
      '资料/技能/嵌套.md': '---\n名字：嵌套\n---\n不在作品根。',
      '写法/开篇.md': '---\n名字：开篇\n---\n写法不是技能。',
    });
    expect(skills).toEqual([
      { path: '技能/审稿口径.md', name: '审稿口径', when: '作者让你审稿时' },
      {
        path: '技能/立项流程.md',
        name: '立项流程',
        when: '作者问「下一步干什么」，或世界观、总纲、人物刚写完一份时',
      },
    ]);
  });

  it('cuts long names and when-to-use, redacts secrets, caps at 20', async () => {
    const files: Record<string, string> = {
      '技能/00.md': `---\n名字：${'名'.repeat(50)}\n什么时候用：钥匙 ${SECRET} ${'时'.repeat(100)}\n---\n正文`,
    };
    for (let index = 1; index <= 22; index += 1)
      files[`技能/${String(index).padStart(2, '0')}.md`] = `技能 ${index}`;
    const skills = await load(files);
    expect(skills).toHaveLength(20);
    expect(skills[0].name).toBe(`${'名'.repeat(40)}……`);
    expect(skills[0].when).not.toContain(SECRET);
    expect(skills[0].when).toContain('[REDACTED]');
    expect(skills[0].when.endsWith('……')).toBe(true);
    expect(Array.from(skills[0].when)).toHaveLength(82);
    expect(skills[skills.length - 1].path).toBe('技能/19.md');
  });

  it('treats an unreadable project or skill as absent', async () => {
    const { reader } = project({ '技能/立项流程.md': SETUP, '技能/审稿口径.md': REVIEW });
    expect(await loadConversationSkills(reader, 'E:\\别的书', SECRETS)).toEqual([]);
    const flaky = {
      ...reader,
      async readProjectBytes(root: string, path: string, limit: number) {
        if (path.includes('审稿口径')) throw new ProjectReadError('读不了');
        return reader.readProjectBytes(root, path, limit);
      },
    };
    expect((await loadConversationSkills(flaky, ROOT, SECRETS)).map((s) => s.name)).toEqual([
      '立项流程',
    ]);
    expect(await load({ '正文/第001章.md': '正文' })).toEqual([]);
  });

  it('leaves 写法/ loading as it was', async () => {
    const { reader } = project({
      '技能/立项流程.md': SETUP,
      '写法/开篇.md': '---\n名字：开篇\n---\n要点',
    });
    expect((await loadWritingSkills(reader, ROOT, SECRETS)).map((s) => s.path)).toEqual([
      '写法/开篇.md',
    ]);
  });
});

describe('conversationSkillsBlock', () => {
  it('is null without skills and lists name, path and when-to-use otherwise', () => {
    expect(conversationSkillsBlock([])).toBeNull();
    expect(
      conversationSkillsBlock([
        { path: '技能/立项流程.md', name: '立项流程', when: '作者问「下一步干什么」时' },
        { path: '技能/审稿口径.md', name: '审稿口径', when: '作者让你审稿时' },
      ]),
    ).toBe(
      '[技能 · 作者定的]\n' +
        '作者在「技能/」里为这本书定的流程和口径。判断这一轮用得上哪份，先用 fs_read 读全文再照做；用不上的别读。' +
        '起草、修订工具看不到这些技能，用得上时把要点写进给它们的 instruction。\n' +
        '- 立项流程（技能/立项流程.md）：作者问「下一步干什么」时\n' +
        '- 审稿口径（技能/审稿口径.md）：作者让你审稿时',
    );
  });
});

describe('技能/ is neither manuscript nor setting', () => {
  it('stays out of the chapter order and the knowledge sources', () => {
    expect(isManuscriptPath('技能/立项流程.md')).toBe(false);
    expect(projectKnowledgeSourceType('技能/立项流程.md')).toBeNull();
    expect(setupKindOfPath('技能/立项流程.md')).toBeNull();
  });

  it('does not count as a first chapter for the setup check', async () => {
    const { reader } = project({ '技能/立项流程.md': SETUP });
    expect(await missingSetupBeforeFirstChapter(reader, ROOT, 'windows')).toEqual([
      'outline',
      'character',
      'setting',
    ]);
  });
});
