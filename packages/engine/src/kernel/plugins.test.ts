import { describe, expect, it } from 'vitest';
import { ProjectReadError, type ProjectReader } from '../readPort';
import type { EncodedFile } from './contextFixture.test-support';
import { memoryProject } from './memoryProject.test-support';
import { CODEX_CONNECTORS_IGNORED } from './pluginManifest';
import {
  describePlugin,
  listInstalledPlugins,
  readEnabledPluginNames,
  resolveEnabledPlugins,
} from './plugins';
import { sha256Hex } from './sha256';
import { parseWritingSkill } from './writingSkills';

const BOOK = 'D:\\book';
const LIB = 'C:\\Users\\author\\AppData\\Roaming\\com.storyforge.ide\\plugins';
const SECRET = 'sk-plugin-secret-123456';
const SECRETS = { values: [SECRET] };
const at = (id: string) => `${LIB}\\${id}`;
const redact = (text: string) => text.split(SECRET).join('[REDACTED]');

type Files = Record<string, string>;

function encode(text: string): EncodedFile {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { chunks: [{ base64: btoa(binary), repeat: 1 }] };
}

const encodeAll = (files: Files) =>
  Object.fromEntries(Object.entries(files).map(([path, text]) => [path, encode(text)]));

/**
 * 作品、插件库、每个插件文件夹各是一个根，按 root 分派给各自的内存项目；没登记的根当不存在。
 * 插件库根的内存项目同时装着所有插件的文件，列目录才看得见它们。
 */
function machine(
  options: {
    book?: Files;
    plugins?: Record<string, Files>;
    libraryFiles?: Files;
    roots?: Record<string, Files>;
  } = {},
): ProjectReader {
  const roots = new Map<string, ProjectReader>();
  const add = (root: string, files: Files) =>
    roots.set(root, memoryProject(root, encodeAll(files)).reader);
  if (options.book) add(BOOK, options.book);
  if (options.plugins || options.libraryFiles) {
    const library: Files = { ...options.libraryFiles };
    for (const [id, files] of Object.entries(options.plugins ?? {})) {
      add(at(id), files);
      for (const [path, text] of Object.entries(files)) library[`${id}/${path}`] = text;
    }
    add(LIB, library);
  }
  for (const [root, files] of Object.entries(options.roots ?? {})) add(root, files);
  const pick = (root: string) => {
    const reader = roots.get(root);
    if (!reader) throw new ProjectReadError('Unknown fixture root');
    return reader;
  };
  return {
    async resolveProjectPath(root, path) {
      return pick(root).resolveProjectPath(root, path);
    },
    async inspectProjectPath(root, path) {
      return pick(root).inspectProjectPath(root, path);
    },
    async readProjectDirectory(root, path, cap) {
      return pick(root).readProjectDirectory(root, path, cap);
    },
    async readProjectBytes(root, path, cap) {
      return pick(root).readProjectBytes(root, path, cap);
    },
  };
}

const manifest = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name, version: '1.0.0', description: '一组写网文的技能', ...extra });

async function describeOne(
  id: string,
  files: Files,
  options: { expectedId?: string } = { expectedId: id },
) {
  return describePlugin(machine({ plugins: { [id]: files } }), at(id), SECRETS, options);
}

const brief = (entries: { path: string; name: string; when: string }[]) =>
  entries.map(({ path, name, when }) => ({ path, name, when }));

describe('StoryForge 格式的插件', () => {
  it('读清单、两种技能布局（.md / .markdown）、写法和指令片段，其余文件不算', async () => {
    const files = {
      'storyforge-plugin.json': manifest('网文写法', {
        version: '1.2.0',
        description: '  一组写网文的技能  ',
        author: '作者甲',
        homepage: 'https://example.com/plugin',
      }),
      '技能/立项流程.md': '---\n名字：立项流程\n什么时候用：开书前\n---\n先立项。',
      '技能/大纲.MARKDOWN': '先列大纲。',
      '技能/审稿/SKILL.md': '---\nwhen: 审稿时\n---\n先说最要紧的。',
      '技能/审稿/参考.md': '参考资料不算技能。',
      '技能/审稿/深一层/SKILL.md': '更深的不算。',
      '技能/小写/skill.md': 'SKILL.md 要精确匹配。',
      '技能/换扩展名/SKILL.markdown': 'SKILL.md 要精确匹配。',
      '技能/说明.txt': '不是 Markdown。',
      '技能/.草稿.md': '点开头的不算。',
      '写法/短句.md': '---\n名字：短句\n---\n多用短句。',
      '写法/对话.markdown': '对话要短。',
      '写法/子目录/长句.md': '只取一层。',
      'skills/foo/SKILL.md': 'Codex 布局在 StoryForge 插件里不读。',
      '指令.md': '这个插件的规矩：先读设定。\n',
    };
    const plugin = await describeOne('网文写法', files);

    expect(plugin.id).toBe('网文写法');
    expect(plugin.root).toBe(at('网文写法'));
    expect(plugin.manifest).toEqual({
      name: '网文写法',
      version: '1.2.0',
      description: '一组写网文的技能',
      author: '作者甲',
      homepage: 'https://example.com/plugin',
      displayName: null,
      format: 'storyforge',
    });
    expect(brief(plugin.skills)).toEqual([
      { path: '技能/大纲.MARKDOWN', name: '大纲', when: '先列大纲。' },
      { path: '技能/审稿/SKILL.md', name: '审稿', when: '审稿时' },
      { path: '技能/立项流程.md', name: '立项流程', when: '开书前' },
    ]);
    expect(plugin.skills[1].body).toBe('先说最要紧的。');
    expect(plugin.skills[1].sha256).toBe(sha256Hex(files['技能/审稿/SKILL.md']));
    expect(brief(plugin.styles)).toEqual([
      { path: '写法/对话.markdown', name: '对话', when: '对话要短。' },
      { path: '写法/短句.md', name: '短句', when: '多用短句。' },
    ]);
    expect(plugin.instructions).toEqual({
      path: '指令.md',
      text: '这个插件的规矩：先读设定。',
      sha256: sha256Hex(files['指令.md']),
      truncated: false,
    });
    expect(plugin.problems).toEqual([]);
  });

  it('两份清单都在时用 StoryForge 的，按 StoryForge 布局读技能', async () => {
    const plugin = await describeOne('双清单', {
      'storyforge-plugin.json': manifest('双清单'),
      '.codex-plugin/plugin.json': manifest('双清单', { mcpServers: './.mcp.json' }),
      '技能/甲.md': '甲技能。',
      'skills/乙/SKILL.md': '乙技能。',
    });
    expect(plugin.manifest?.format).toBe('storyforge');
    expect(plugin.skills.map((skill) => skill.path)).toEqual(['技能/甲.md']);
    expect(plugin.problems).toEqual([]);
  });
});

describe('Codex 格式的插件', () => {
  it('取 author.name 与 interface.displayName，技能只认 <skills>/<名>/SKILL.md，连接器记一句', async () => {
    const plugin = await describeOne('novel-kit', {
      '.codex-plugin/plugin.json': JSON.stringify({
        name: 'novel-kit',
        version: '0.3.0',
        description: 'Codex 写的插件',
        author: { name: 'Someone', email: 'someone@example.com' },
        homepage: 'https://example.com/kit',
        interface: { displayName: 'Novel Kit', category: 'Writing' },
        skills: './skills/',
        apps: './.app.json',
        mcpServers: './.mcp.json',
        keywords: ['novel'],
      }),
      'skills/outline/SKILL.md':
        '---\nname: outline-helper\ndescription: Use when outlining\n---\n# Outline\nDo it.',
      'skills/review/SKILL.md': 'Review body.',
      'skills/review/references/notes.md': 'not a skill',
      'skills/flat.md': 'flat files are not Codex skills',
      '技能/中文.md': 'Codex 插件不读 技能/。',
      '写法/节奏.md': '节奏要快。',
    });
    expect(plugin.manifest).toEqual({
      name: 'novel-kit',
      version: '0.3.0',
      description: 'Codex 写的插件',
      author: 'Someone',
      homepage: 'https://example.com/kit',
      displayName: 'Novel Kit',
      format: 'codex',
    });
    expect(brief(plugin.skills)).toEqual([
      { path: 'skills/outline/SKILL.md', name: 'outline-helper', when: 'Use when outlining' },
      { path: 'skills/review/SKILL.md', name: 'review', when: 'Review body.' },
    ]);
    expect(brief(plugin.styles)).toEqual([
      { path: '写法/节奏.md', name: '节奏', when: '节奏要快。' },
    ]);
    expect(plugin.problems).toEqual([CODEX_CONNECTORS_IGNORED]);
  });

  it('没写 skills 时读 skills/；没有连接器就不记', async () => {
    const plugin = await describeOne('plain', {
      '.codex-plugin/plugin.json': manifest('plain', { author: 'Plain Author' }),
      'skills/a/SKILL.md': '---\nname: a\n---\nA.',
    });
    expect(plugin.manifest?.author).toBe('Plain Author');
    expect(plugin.skills.map((skill) => skill.name)).toEqual(['a']);
    expect(plugin.problems).toEqual([]);
  });

  it('自定义技能目录照读；绝对路径、.. 和不是文字的都拒绝且不读技能', async () => {
    const custom = await describeOne('custom', {
      '.codex-plugin/plugin.json': manifest('custom', { skills: './prompts/skills' }),
      'prompts/skills/a/SKILL.md': 'A 技能。',
      'skills/b/SKILL.md': '缺省目录这时不读。',
    });
    expect(custom.skills.map((skill) => skill.path)).toEqual(['prompts/skills/a/SKILL.md']);
    expect(custom.problems).toEqual([]);

    const atRoot = await describeOne('at-root', {
      '.codex-plugin/plugin.json': manifest('at-root', { skills: '.' }),
      'alpha/SKILL.md': '插件根下的技能。',
      'skills/b/SKILL.md': '再深一层的不算。',
    });
    expect(atRoot.skills.map((skill) => skill.path)).toEqual(['alpha/SKILL.md']);

    for (const skills of [
      '../outside',
      'skills/../../x',
      '/abs/skills',
      'C:\\skills',
      'D:/x',
      42,
    ]) {
      const plugin = await describeOne('rejected', {
        '.codex-plugin/plugin.json': manifest('rejected', { skills }),
        'skills/b/SKILL.md': '不读。',
      });
      expect(plugin.manifest?.name, String(skills)).toBe('rejected');
      expect(plugin.skills, String(skills)).toEqual([]);
      expect(plugin.problems, String(skills)).toEqual([
        '.codex-plugin/plugin.json 的 skills 应是插件内的相对路径（不能用 ..），技能不读。',
      ]);
    }

    const missing = await describeOne('missing-dir', {
      '.codex-plugin/plugin.json': manifest('missing-dir', { skills: './nowhere/' }),
    });
    expect(missing.problems).toEqual(['清单里写的技能目录不存在：nowhere']);
  });
});

describe('SKILL.md 头部的 YAML 值', () => {
  async function entries(skills: Files, styles: Files = {}) {
    const plugin = await describeOne('yaml', {
      '.codex-plugin/plugin.json': manifest('yaml'),
      ...Object.fromEntries(
        Object.entries(skills).map(([name, text]) => [`skills/${name}/SKILL.md`, text]),
      ),
      ...Object.fromEntries(
        Object.entries(styles).map(([name, text]) => [`写法/${name}.md`, text]),
      ),
    });
    expect(plugin.problems).toEqual([]);
    return { skills: brief(plugin.skills), styles: brief(plugin.styles) };
  }
  const only = async (text: string) => (await entries({ s: text })).skills[0];

  it('双引号包着的去掉引号，里面的 \\" 还原', async () => {
    expect(
      await only(
        '---\nname: "outline: helper"\ndescription: "Use when the author says \\"outline\\""\n---\nBody.',
      ),
    ).toEqual({
      path: 'skills/s/SKILL.md',
      name: 'outline: helper',
      when: 'Use when the author says "outline"',
    });
  });

  it("单引号包着的去掉引号，里面的 '' 还原", async () => {
    expect(await only("---\nname: 'it''s mine'\ndescription: 'Don''t rush'\n---\nBody.")).toEqual({
      path: 'skills/s/SKILL.md',
      name: "it's mine",
      when: "Don't rush",
    });
  });

  it('>- 多行：取后面缩进更深的连续行，去缩进用空格连；块里的冒号行不当字段', async () => {
    expect(
      await only(
        [
          '---',
          'name: folded',
          'description: >-',
          '  Use when the chapter',
          '    needs a cliffhanger.',
          '  name: not-a-key',
          'metadata:',
          '  short-description: ignored',
          '---',
          'Body.',
        ].join('\n'),
      ),
    ).toEqual({
      path: 'skills/s/SKILL.md',
      name: 'folded',
      when: 'Use when the chapter needs a cliffhanger. name: not-a-key',
    });
  });

  it('| 多行同样用空格连；名字也认块标量', async () => {
    expect(
      await only(
        '---\nname: |\n  block-name\ndescription: |\n  Line one.\n  Line two.\n---\nBody.',
      ),
    ).toEqual({ path: 'skills/s/SKILL.md', name: 'block-name', when: 'Line one. Line two.' });
  });

  it('归一后为空就退回缺省：名字用文件夹名，什么时候用取正文第一行', async () => {
    expect(await only('---\nname: ""\ndescription: >\n---\n# 第一行\n正文。')).toEqual({
      path: 'skills/s/SKILL.md',
      name: 's',
      when: '第一行',
    });
  });

  it('归一后照原规则截断：名字 40、什么时候用 80', async () => {
    expect(
      await only(
        `---\nname: "${'名'.repeat(41)}"\ndescription: >-\n  ${'长'.repeat(81)}\n---\nBody.`,
      ),
    ).toEqual({
      path: 'skills/s/SKILL.md',
      name: `${'名'.repeat(40)}……`,
      when: `${'长'.repeat(80)}……`,
    });
  });

  it('没引号、引号不成对或只在中间时照旧，与 parseWritingSkill 一致', async () => {
    const texts = [
      '---\nname: plain name\ndescription: it\'s "fine" here\n---\nBody.',
      '---\nname: "half\ndescription: \'also half\n---\nBody.',
      '---\n名字：中文名\n什么时候用：开书前\n---\n正文。',
      '没有头部的第一行。\n正文。',
    ];
    const { skills } = await entries(Object.fromEntries(texts.map((text, i) => [`p${i}`, text])));
    expect(skills).toEqual(
      texts.map((text, i) => {
        const { name, when } = parseWritingSkill(`skills/p${i}`, text);
        return { path: `skills/p${i}/SKILL.md`, name, when };
      }),
    );
    expect(skills[0]).toMatchObject({ name: 'plain name', when: 'it\'s "fine" here' });
    expect(skills[1]).toMatchObject({ name: '"half', when: "'also half" });
  });

  it('写法也一样归一', async () => {
    const { styles } = await entries({}, { 引号: '---\n名字: "引号写法"\n---\n正文。' });
    expect(styles).toEqual([{ path: '写法/引号.md', name: '引号写法', when: '正文。' }]);
  });
});

describe('上限、截断与空正文', () => {
  const many = (dir: string, count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `${dir}/s${String(index + 1).padStart(2, '0')}.md`,
        `第 ${index + 1} 份。`,
      ]),
    );

  it('技能、写法各取按路径序的前 20 份，超出说明', async () => {
    const plugin = await describeOne('many', {
      'storyforge-plugin.json': manifest('many'),
      ...many('技能', 22),
      ...many('写法', 23),
    });
    expect(plugin.skills).toHaveLength(20);
    expect(plugin.skills[19].path).toBe('技能/s20.md');
    expect(plugin.styles).toHaveLength(20);
    expect(plugin.problems).toEqual([
      '技能超过 20 份，只取按路径序的前 20 份，后面 2 个文件没有读。',
      '写法超过 20 份，只取按路径序的前 20 份，后面 3 个文件没有读。',
    ]);
  });

  it('正文为空的技能、写法跳过且不占名额，空指令片段当没有', async () => {
    const plugin = await describeOne('empty', {
      'storyforge-plugin.json': manifest('empty'),
      ...many('技能', 20),
      '技能/s00.md': '---\n名字：空的\n什么时候用：从不\n---\n\n',
      '写法/空.md': '   \n',
      '写法/有.md': '有内容。',
      '指令.md': '\n  \n',
    });
    expect(plugin.skills).toHaveLength(20);
    expect(plugin.skills.map((skill) => skill.name)).not.toContain('空的');
    expect(plugin.styles.map((style) => style.path)).toEqual(['写法/有.md']);
    expect(plugin.instructions).toBeNull();
    expect(plugin.problems).toEqual([]);
  });

  it('指令片段按码点保留开头 4000 个，超出标 truncated', async () => {
    const long = '😀'.repeat(4001);
    const cut = await describeOne('long', {
      'storyforge-plugin.json': manifest('long'),
      '指令.md': long,
    });
    expect(cut.instructions).toEqual({
      path: '指令.md',
      text: '😀'.repeat(4000),
      sha256: sha256Hex(long),
      truncated: true,
    });

    const exact = await describeOne('exact', {
      'storyforge-plugin.json': manifest('exact'),
      '指令.md': '长'.repeat(4000),
    });
    expect(exact.instructions?.truncated).toBe(false);
    expect(exact.instructions?.text).toBe('长'.repeat(4000));
  });
});

describe('脱敏', () => {
  it('清单、技能、写法、指令片段里的密钥都换成 [REDACTED]，sha256 按脱敏后的算', async () => {
    const files = {
      'storyforge-plugin.json': manifest('keys', { description: `钥匙 ${SECRET}` }),
      '技能/钥匙.md': `---\n名字：钥匙\n什么时候用：用 ${SECRET} 时\n---\n正文 ${SECRET}`,
      '写法/钥匙.md': `写法里也有 ${SECRET}。`,
      '指令.md': `指令 ${SECRET}`,
    };
    const plugin = await describeOne('keys', files);
    expect(plugin.manifest?.description).toBe('钥匙 [REDACTED]');
    expect(plugin.skills[0]).toMatchObject({
      when: '用 [REDACTED] 时',
      body: '正文 [REDACTED]',
      sha256: sha256Hex(redact(files['技能/钥匙.md'])),
    });
    expect(plugin.skills[0].sha256).not.toBe(sha256Hex(files['技能/钥匙.md']));
    expect(plugin.styles[0].sha256).toBe(sha256Hex(redact(files['写法/钥匙.md'])));
    expect(plugin.instructions).toMatchObject({
      text: '指令 [REDACTED]',
      sha256: sha256Hex(redact(files['指令.md'])),
    });
    expect(JSON.stringify(plugin)).not.toContain(SECRET);
  });
});

describe('清单缺失或不合法', () => {
  it('没有清单：manifest 为 null 并说明，技能照 StoryForge 布局读', async () => {
    const plugin = await describeOne('bare', { '技能/甲.md': '甲技能。' });
    expect(plugin.manifest).toBeNull();
    expect(plugin.skills.map((skill) => skill.path)).toEqual(['技能/甲.md']);
    expect(plugin.problems).toEqual([
      '没有找到插件清单（storyforge-plugin.json 或 .codex-plugin/plugin.json），按 StoryForge 插件的布局读。',
    ]);
  });

  it('坏 JSON、不是对象、缺必填字段：manifest 为 null，其余照读', async () => {
    const cases: [Files, string][] = [
      [{ 'storyforge-plugin.json': '{"name":' }, 'storyforge-plugin.json 不是合法的 JSON。'],
      [{ 'storyforge-plugin.json': '["a"]' }, 'storyforge-plugin.json 应是一个 JSON 对象。'],
      [
        { 'storyforge-plugin.json': JSON.stringify({ name: 'x', version: ' ', description: 3 }) },
        'storyforge-plugin.json 缺少 version、description（必须是非空文字）。',
      ],
      [
        { '.codex-plugin/plugin.json': JSON.stringify({ name: 'x', description: 'd' }) },
        '.codex-plugin/plugin.json 缺少 version（必须是非空文字）。',
      ],
    ];
    for (const [files, problem] of cases) {
      const plugin = await describeOne('broken', {
        ...files,
        '技能/甲.md': '甲技能。',
        'skills/乙/SKILL.md': '乙技能。',
        '指令.md': '指令。',
      });
      expect(plugin.manifest, problem).toBeNull();
      expect(plugin.problems, problem).toEqual([problem]);
      expect(plugin.skills, problem).toHaveLength(1);
      expect(plugin.instructions?.text, problem).toBe('指令。');
    }

    const codex = await describeOne('broken-codex', {
      '.codex-plugin/plugin.json': '{oops',
      'skills/乙/SKILL.md': '乙技能。',
    });
    expect(codex.manifest).toBeNull();
    expect(codex.problems).toEqual(['.codex-plugin/plugin.json 不是合法的 JSON。']);
    expect(codex.skills.map((skill) => skill.path)).toEqual(['skills/乙/SKILL.md']);
  });

  it('插件文件夹不存在：全空并说明', async () => {
    const plugin = await describePlugin(machine({ plugins: {} }), at('nope'), SECRETS);
    expect(plugin).toEqual({
      id: 'nope',
      root: at('nope'),
      manifest: null,
      skills: [],
      styles: [],
      instructions: null,
      problems: [`插件文件夹不存在或读不到：${at('nope')}`],
    });
  });
});

describe('清单里的插件名', () => {
  it('给了 expectedId 才比对文件夹名；暂存目录预览不比对', async () => {
    const files = { 'storyforge-plugin.json': manifest('other') };
    expect((await describeOne('mine', files)).problems).toEqual([
      '清单里的插件名「other」和插件文件夹名「mine」不一致。',
    ]);
    expect((await describeOne('mine', files, {})).problems).toEqual([]);

    const staging = `${LIB}\\.staging\\stage-1`;
    const preview = await describePlugin(
      machine({ roots: { [staging]: { 'storyforge-plugin.json': manifest('写法包') } } }),
      staging,
      SECRETS,
    );
    expect(preview.id).toBe('stage-1');
    expect(preview.manifest?.name).toBe('写法包');
    expect(preview.problems).toEqual([]);
  });

  it('名字不过插件名规则时说明', async () => {
    expect(
      (await describeOne('CON', { 'storyforge-plugin.json': manifest('CON') })).problems,
    ).toEqual(['清单里的插件名「CON」不合规：「CON」是 Windows 保留名，不能当插件名。']);
    expect(
      (await describeOne('pad', { 'storyforge-plugin.json': manifest(' pad') }, {})).problems,
    ).toEqual(['清单里的插件名「 pad」不合规：插件名开头和结尾不能有空白。']);
  });
});

describe('插件库', () => {
  it('列出库根下不以点开头的文件夹，按码点序，各自比对文件夹名', async () => {
    const reader = machine({
      plugins: {
        'b-plugin': { 'storyforge-plugin.json': manifest('b-other') },
        'a-plugin': { 'storyforge-plugin.json': manifest('a-plugin') },
        '😀表情': { 'storyforge-plugin.json': manifest('😀表情') },
        '～宽': { 'storyforge-plugin.json': manifest('～宽') },
      },
      libraryFiles: {
        '.staging/stage-1/storyforge-plugin.json': manifest('暂存'),
        '.trash/old/storyforge-plugin.json': manifest('old'),
        'README.txt': '库根下的文件不算插件。',
      },
    });
    const plugins = await listInstalledPlugins(reader, LIB, SECRETS);
    expect(plugins.map((plugin) => plugin.id)).toEqual(['a-plugin', 'b-plugin', '～宽', '😀表情']);
    expect(plugins.map((plugin) => plugin.root)).toEqual(
      ['a-plugin', 'b-plugin', '～宽', '😀表情'].map(at),
    );
    expect(plugins[1].problems).toEqual([
      '清单里的插件名「b-other」和插件文件夹名「b-plugin」不一致。',
    ]);
    expect(plugins.filter((plugin) => plugin.problems.length)).toHaveLength(1);
  });

  it('库根不存在时为空', async () => {
    expect(await listInstalledPlugins(machine({ book: {} }), LIB, SECRETS)).toEqual([]);
  });
});

describe('作品启用的插件', () => {
  it('没有启用文件就是一个都没启用', async () => {
    expect(
      await readEnabledPluginNames(machine({ book: { '正文/第001章.md': '正文。' } }), BOOK),
    ).toEqual({ enabled: [], problem: null });
  });

  it('读启用文件（带 BOM、CRLF 也认）；各种坏法都不抛', async () => {
    const read = (text: string) =>
      readEnabledPluginNames(machine({ book: { '.storyforge/plugins.json': text } }), BOOK);
    expect(await read('\uFEFF{\r\n  "version": 1,\r\n  "enabled": ["甲", "乙"]\r\n}\r\n')).toEqual({
      enabled: ['甲', '乙'],
      problem: null,
    });
    expect(await read('{oops')).toEqual({
      enabled: [],
      problem: '插件启用文件不是合法的 JSON，当作一个插件都没启用。',
    });
    expect(await read('{"version":3,"enabled":["甲"]}')).toEqual({
      enabled: [],
      problem: '插件启用文件的 version 应是 1，当作一个插件都没启用。',
    });
    expect(
      await readEnabledPluginNames(
        machine({ book: { '.storyforge/plugins.json/里面.txt': '不是文件而是目录' } }),
        BOOK,
      ),
    ).toEqual({
      enabled: [],
      problem: '读不到 .storyforge/plugins.json：只允许读取普通文件。',
    });
    expect(await readEnabledPluginNames(machine(), BOOK)).toEqual({
      enabled: [],
      problem: '读不到 .storyforge/plugins.json。',
    });
  });

  it('按启用顺序读出，本机库里没有的进 missing；没给插件库时全部算 missing', async () => {
    const options = {
      book: {
        '.storyforge/plugins.json': JSON.stringify({
          version: 1,
          enabled: ['b-plugin', 'gone', 'a-plugin', '.staging', 'README.txt', 'b-plugin'],
        }),
      },
      plugins: {
        'a-plugin': { 'storyforge-plugin.json': manifest('a-plugin') },
        'b-plugin': { 'storyforge-plugin.json': manifest('b-plugin'), '技能/甲.md': '甲技能。' },
      },
      libraryFiles: { 'README.txt': '不是文件夹。' },
    };
    const problem = '插件启用文件里有不合规的名字，已忽略：「.staging」（插件名不能以「.」开头）。';

    const resolved = await resolveEnabledPlugins(machine(options), BOOK, LIB, SECRETS);
    expect(resolved.plugins.map((plugin) => plugin.id)).toEqual(['b-plugin', 'a-plugin']);
    expect(resolved.plugins[0].skills.map((skill) => skill.path)).toEqual(['技能/甲.md']);
    expect(resolved.plugins.every((plugin) => plugin.problems.length === 0)).toBe(true);
    expect(resolved.missing).toEqual(['gone', 'README.txt']);
    expect(resolved.problems).toEqual([problem]);

    expect(await resolveEnabledPlugins(machine(options), BOOK, null, SECRETS)).toEqual({
      plugins: [],
      missing: ['b-plugin', 'gone', 'a-plugin', 'README.txt'],
      problems: [problem],
    });

    const noLibrary = await resolveEnabledPlugins(
      machine({ book: options.book }),
      BOOK,
      LIB,
      SECRETS,
    );
    expect(noLibrary.missing).toEqual(['b-plugin', 'gone', 'a-plugin', 'README.txt']);
    expect(noLibrary.plugins).toEqual([]);
  });

  it('没有启用文件时什么都不读', async () => {
    expect(await resolveEnabledPlugins(machine({ book: {} }), BOOK, LIB, SECRETS)).toEqual({
      plugins: [],
      missing: [],
      problems: [],
    });
  });
});
