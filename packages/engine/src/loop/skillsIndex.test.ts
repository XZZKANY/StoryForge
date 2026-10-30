import { describe, expect, it } from 'vitest';
import type { EncodedFile } from '../kernel/contextFixture.test-support';
import { memoryProject } from '../kernel/memoryProject.test-support';
import { sourceVersions } from './chatLoopCheckpoints';
import type { ConversationSources } from './conversationHistory';
import { storyforgeMessages } from './loopMessages';

const ROOT = 'D:\\book';
const SECRET = 'sk-skill-secret-123456';

function encode(text: string): EncodedFile {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { chunks: [{ base64: btoa(binary), repeat: 1 }] };
}

const NO_HISTORY: ConversationSources = {
  messages: async () => [],
  toolCalls: async () => [],
  runEvents: async () => [],
  runArtifacts: async () => [],
  artifact: async () => null,
};

const BOOK = {
  '.storyforge/agent-instructions.md': '对话用简体中文。',
  '大纲/总纲.md': '# 总纲\n主角去北方。',
  '正文/第001章.md': '第一章正文。',
};

async function assemble(files: Record<string, string>, userMessage = '下一步干什么') {
  const { reader } = memoryProject(
    ROOT,
    Object.fromEntries(Object.entries(files).map(([path, text]) => [path, encode(text)])),
  );
  const provenance: { [key: string]: unknown } = {};
  const messages = await storyforgeMessages(
    { reader, conversation: NO_HISTORY, platform: 'windows', secrets: { values: [SECRET] } },
    {
      assistantSessionId: 1,
      userMessage,
      projectPath: ROOT,
      currentFile: null,
      authorView: null,
      pinnedContext: null,
    },
    provenance,
  );
  const sections = provenance.sections as { section: string; message_indices: number[] }[];
  return { messages, sections };
}

describe('对话每轮的技能目录', () => {
  it('作品里有技能时，在作者指令之后多一段 skills_index，其余各段不变', async () => {
    const plain = await assemble(BOOK);
    const withSkills = await assemble({
      ...BOOK,
      '技能/立项流程.md':
        '---\n名字：立项流程\n什么时候用：作者问「下一步干什么」时\n---\n# 立项流程\n先立项。',
      '技能/审稿口径.md': `---\n名字：审稿口径\n什么时候用：审稿时，钥匙 ${SECRET}\n---\n先说最要紧的。`,
    });

    const names = (sections: { section: string }[]) => sections.map((item) => item.section);
    expect(names(withSkills.sections)).toEqual([
      'system_prompt',
      'author_instructions',
      'skills_index',
      ...names(plain.sections).slice(2),
    ]);
    expect(names(plain.sections)).not.toContain('skills_index');

    const index = withSkills.sections.find((item) => item.section === 'skills_index')!;
    expect(index.message_indices).toEqual([2]);
    const block = withSkills.messages[2];
    expect(block.role).toBe('system');
    expect(block.content.startsWith('[技能 · 作者定的]\n')).toBe(true);
    expect(block.content).toContain('- 审稿口径（技能/审稿口径.md）：审稿时，钥匙 [REDACTED]');
    expect(block.content).toContain('- 立项流程（技能/立项流程.md）：作者问「下一步干什么」时');
    expect(block.content).not.toContain(SECRET);
    expect(block.content).not.toContain('先立项。');

    expect([...withSkills.messages.slice(0, 2), ...withSkills.messages.slice(3)]).toEqual(
      plain.messages,
    );
  });

  it('技能文件不算正文：只有技能、没有正文时立项检查照常提醒', async () => {
    const { messages } = await assemble({
      '技能/立项流程.md': '---\n名字：立项流程\n---\n先立项。',
    });
    expect(messages.some((message) => message.content.includes('[立项 · 确定性]'))).toBe(true);
  });
});

const SKILLS = {
  ...BOOK,
  '技能/立项流程.md':
    '---\n名字：立项流程\n什么时候用：作者问「下一步干什么」时\n---\n# 立项流程\n先立项。',
  '技能/审稿口径.md': `---\n名字：审稿口径\n什么时候用：审稿时\n---\n先说最要紧的。钥匙 ${SECRET}`,
};
const sectionNames = (sections: { section: string }[]) => sections.map((item) => item.section);

describe('消息开头 /技能名 点名', () => {
  it('点名的技能在作者消息前多一段全文（脱敏），其余各段与没点名时一致', async () => {
    const message = '/审稿口径 /立项流程 看看第一章';
    const invoked = await assemble(SKILLS, message);
    const plain = await assemble(SKILLS, '/不存在 看看第一章');

    expect(sectionNames(invoked.sections)).toEqual([
      ...sectionNames(plain.sections).slice(0, -1),
      'invoked_skills',
      'current_user',
    ]);
    expect(sectionNames(plain.sections)).not.toContain('invoked_skills');

    const at = invoked.sections.find((item) => item.section === 'invoked_skills')!.message_indices;
    expect(at).toHaveLength(1);
    const block = invoked.messages[at[0]];
    expect(block.role).toBe('system');
    expect(block.content.startsWith('[技能 · 作者这一轮点名]\n')).toBe(true);
    const review = block.content.indexOf(
      '### 审稿口径（技能/审稿口径.md）\n先说最要紧的。钥匙 [REDACTED]',
    );
    const setup = block.content.indexOf('### 立项流程（技能/立项流程.md）\n# 立项流程\n先立项。');
    expect(review).toBeGreaterThan(0);
    expect(setup).toBeGreaterThan(review);
    expect(block.content).not.toContain(SECRET);

    expect(invoked.messages.slice(0, at[0])).toEqual(plain.messages.slice(0, at[0]));
    expect(invoked.messages[invoked.messages.length - 1].content.endsWith(`作者：${message}`)).toBe(
      true,
    );
  });

  it('不在开头、认不出或作品里没有技能时，不加这一段', async () => {
    for (const [files, message] of [
      [SKILLS, '按 /立项流程 来'],
      [SKILLS, '/立项 下一步'],
      [BOOK, '/立项流程'],
    ] as const) {
      const { sections } = await assemble(files, message);
      expect(sectionNames(sections)).not.toContain('invoked_skills');
    }
  });

  it('全文过长时截断并提示去读', async () => {
    const long = '长'.repeat(4_100);
    const { messages, sections } = await assemble(
      { ...BOOK, '技能/长技能.md': `---\n名字：长技能\n---\n${long}` },
      '、长技能',
    );
    const at = sections.find((item) => item.section === 'invoked_skills')!.message_indices[0];
    expect(messages[at].content).toContain(
      `${'长'.repeat(4_000)}\n……（后面还有，需要时用 fs_read 读 技能/长技能.md）`,
    );
    expect(messages[at].content).not.toContain('长'.repeat(4_001));
  });

  it('续跑核对的来源指纹带上点名的技能文件', async () => {
    const { reader } = memoryProject(
      ROOT,
      Object.fromEntries(Object.entries(SKILLS).map(([path, text]) => [path, encode(text)])),
    );
    const args = { project_path: ROOT, file_path: null };
    const invoked = await sourceVersions({ reader }, [], {
      user_message: '/立项流程 下一步',
      args,
    });
    expect(Object.keys(invoked.files)).toContain('技能/立项流程.md');
    expect(Object.keys(invoked.files)).not.toContain('技能/审稿口径.md');
    const plain = await sourceVersions({ reader }, [], { user_message: '下一步', args });
    expect(Object.keys(plain.files).some((path) => path.startsWith('技能/'))).toBe(false);
  });
});
