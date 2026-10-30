import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-tool-catalog.json';
import type { AssistantStore } from '../assistant/service';
import type { EncodedFile } from '../kernel/contextFixture.test-support';
import { loadAvailableSkills, PLUGIN_SKILLS_MAX } from '../kernel/conversationSkills';
import { AUTHOR_INSTRUCTIONS_PATH, FsToolError } from '../kernel/fsTools';
import { memoryProject } from '../kernel/memoryProject.test-support';
import { chatResponse, ToolCall, type ChatRequest } from '../llm/contracts';
import { ProjectReadError, type ProjectReader } from '../readPort';
import { runChatLoop } from './chatLoop';
import { LoopCheckpointStore, sourcesUnchanged, sourceVersions } from './chatLoopCheckpoints';
import type { ConversationSources } from './conversationHistory';
import { storyforgeMessages } from './loopMessages';
import { RunControlScope } from './runControl';
import { toolOutputSummary } from './toolFeedback';
import { listLoopToolSpecs } from './tools/catalog';
import { toolDefinitionFromSpec } from './tools/execution';
import type { ToolDeps } from './tools/handlerDeps';
import { SKILL_READ_MAX_CHARS, skillToolHandlers } from './tools/skillHandlers';
import type { AgentToolTrace } from './traces';

const BOOK = 'D:\\book';
const LIB = 'C:\\Users\\author\\AppData\\Roaming\\com.storyforge.ide\\plugins';
const SECRET = 'sk-plugin-skill-secret-123456';
const SECRETS = { values: [SECRET] };
const at = (id: string) => `${LIB}\\${id}`;

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

/** 作品、插件库、每个插件文件夹各是一个根，按 root 分派；插件可以改文件或整个移走。 */
function machine(book: Files, plugins: Record<string, Files> = {}) {
  const roots = new Map<string, ReturnType<typeof memoryProject>>();
  roots.set(BOOK, memoryProject(BOOK, encodeAll(book)));
  const library: Files = {};
  for (const [id, files] of Object.entries(plugins)) {
    roots.set(at(id), memoryProject(at(id), encodeAll(files)));
    for (const [path, text] of Object.entries(files)) library[`${id}/${path}`] = text;
  }
  roots.set(LIB, memoryProject(LIB, encodeAll(library)));
  const pick = (root: string) => {
    const project = roots.get(root);
    if (!project) throw new ProjectReadError('Unknown fixture root');
    return project.reader;
  };
  const reader: ProjectReader = {
    resolveProjectPath: async (root, path) => pick(root).resolveProjectPath(root, path),
    inspectProjectPath: async (root, path) => pick(root).inspectProjectPath(root, path),
    readProjectDirectory: async (root, path, cap) =>
      pick(root).readProjectDirectory(root, path, cap),
    readProjectBytes: async (root, path, cap) => pick(root).readProjectBytes(root, path, cap),
  };
  return {
    reader,
    editPlugin: (id: string, path: string, text: string) =>
      roots.get(at(id))!.apply({ [path]: encode(text) }),
    removePlugin: (id: string) => roots.delete(at(id)),
  };
}

const manifest = (name: string) =>
  JSON.stringify({ name, version: '1.0.0', description: '一组写网文的技能' });
const enabled = (...ids: string[]) => ({
  '.storyforge/plugins.json': JSON.stringify({ version: 1, enabled: ids }),
});

const NO_HISTORY: ConversationSources = {
  messages: async () => [],
  toolCalls: async () => [],
  runEvents: async () => [],
  runArtifacts: async () => [],
  artifact: async () => null,
};

const BOOK_FILES: Files = {
  '.storyforge/agent-instructions.md': '对话用简体中文。',
  '大纲/总纲.md': '# 总纲\n主角去北方。',
  '正文/第001章.md': '第一章正文。',
  '技能/立项流程.md':
    '---\n名字：立项流程\n什么时候用：作者问「下一步干什么」时\n---\n# 立项流程\n先立项。',
  '技能/审稿口径.md': `---\n名字：审稿口径\n什么时候用：审稿时\n---\n先说最要紧的。钥匙 ${SECRET}`,
};

const PLUGINS: Record<string, Files> = {
  网文包: {
    'storyforge-plugin.json': manifest('网文包'),
    '技能/立项流程.md': '---\n名字：立项流程\n什么时候用：插件里的同名技能\n---\n插件的立项。',
    '技能/爽点.md': `---\n名字：爽点\n什么时候用：写打脸时\n---\n先压后扬。钥匙 ${SECRET}`,
    '技能/审稿/SKILL.md': '---\nwhen: 交稿前\n---\n逐段过一遍。',
  },
  审稿包: {
    'storyforge-plugin.json': manifest('审稿包'),
    '技能/审稿.md': '---\n名字：审稿\n什么时候用：同名的后启用插件\n---\n不该出现。',
    '技能/口径.md': '---\n名字：口径\n什么时候用：统一称呼时\n---\n称呼用全名。',
  },
};

/** 改动前（master）作品技能目录的原文。 */
const MASTER_SKILLS_INDEX = [
  '[技能 · 作者定的]',
  '作者在「技能/」里为这本书定的流程和口径。判断这一轮用得上哪份，先用 fs_read 读全文再照做；用不上的别读。' +
    '起草、修订工具看不到这些技能，用得上时把要点写进给它们的 instruction。',
  '- 审稿口径（技能/审稿口径.md）：审稿时',
  '- 立项流程（技能/立项流程.md）：作者问「下一步干什么」时',
].join('\n');

const PLUGIN_INTRO =
  '作者为这本书定的流程和口径（作品「技能/」里的，和作者启用的插件里的）。判断这一轮用得上哪份，先读全文再照做' +
  '（作品里的用 fs_read，插件里的用 skill_read 按名字读）；用不上的别读。' +
  '起草、修订工具看不到这些技能，用得上时把要点写进给它们的 instruction。';

type Section = { section: string; message_indices: number[]; sha256: string };

async function assemble(
  reader: ProjectReader,
  userMessage: string,
  pluginLibraryRoot?: string | null,
) {
  const provenance: { [key: string]: unknown } = {};
  const skillUse = { pluginSkills: false };
  const deps = {
    reader,
    conversation: NO_HISTORY,
    platform: 'windows' as const,
    secrets: SECRETS,
    ...(pluginLibraryRoot === undefined ? {} : { pluginLibraryRoot }),
  };
  const messages = await storyforgeMessages(
    deps,
    {
      assistantSessionId: 1,
      userMessage,
      projectPath: BOOK,
      currentFile: null,
      authorView: null,
      pinnedContext: null,
    },
    provenance,
    skillUse,
  );
  const sections = provenance.sections as Section[];
  const block = (name: string) => {
    const found = sections.find((item) => item.section === name);
    return found ? messages[found.message_indices[0]].content : null;
  };
  return { messages, sections, skillUse, block };
}

describe('没有插件技能时与改动前逐字一致', () => {
  it('给了插件库但没启用、没给插件库、启用的插件不在库里或没有技能：消息、段指纹与续跑指纹都和不带插件库时一样', async () => {
    const message = '/立项流程 下一步干什么';
    const args = { project_path: BOOK, file_path: null };
    const variants: [ProjectReader, string | null][] = [
      [machine(BOOK_FILES).reader, LIB],
      [machine({ ...BOOK_FILES, ...enabled('网文包') }, PLUGINS).reader, null],
      [
        machine(
          { ...BOOK_FILES, ...enabled('不在库里', '空插件') },
          { 空插件: { 'storyforge-plugin.json': manifest('空插件') } },
        ).reader,
        LIB,
      ],
    ];
    for (const [reader, library] of variants) {
      const plain = await assemble(reader, message);
      expect(plain.block('skills_index')).toBe(MASTER_SKILLS_INDEX);
      expect(plain.block('invoked_skills')).toContain(
        '### 立项流程（技能/立项流程.md）\n# 立项流程\n先立项。',
      );
      const current = await assemble(reader, message, library);
      expect(current.messages).toEqual(plain.messages);
      expect(current.sections).toEqual(plain.sections);
      expect(current.skillUse.pluginSkills).toBe(false);

      const plainSources = await sourceVersions({ reader }, [], { user_message: message, args });
      expect(Object.keys(plainSources.files)).toEqual([
        AUTHOR_INSTRUCTIONS_PATH,
        '技能/立项流程.md',
      ]);
      expect(
        await sourceVersions({ reader, pluginLibraryRoot: library }, [], {
          user_message: message,
          args,
        }),
      ).toEqual(plainSources);
    }
  });
});

describe('有插件技能时的技能目录', () => {
  it('首句换成带插件的说法，作品技能行不变，插件技能行标插件名；作品优先、先启用的插件优先', async () => {
    const { reader } = machine({ ...BOOK_FILES, ...enabled('网文包', '审稿包') }, PLUGINS);
    const plain = await assemble(reader, '下一步');
    const withPlugins = await assemble(reader, '下一步', LIB);

    expect(withPlugins.skillUse.pluginSkills).toBe(true);
    expect(withPlugins.block('skills_index')).toBe(
      [
        '[技能 · 作者定的]',
        PLUGIN_INTRO,
        '- 审稿口径（技能/审稿口径.md）：审稿时',
        '- 立项流程（技能/立项流程.md）：作者问「下一步干什么」时',
        '- 审稿（插件「网文包」）：交稿前',
        '- 爽点（插件「网文包」）：写打脸时',
        '- 口径（插件「审稿包」）：统一称呼时',
      ].join('\n'),
    );
    expect(withPlugins.block('skills_index')).not.toContain(SECRET);
    // 只有技能目录这一段变了。
    const indexAt = (sections: Section[]) =>
      sections.find((item) => item.section === 'skills_index')!.message_indices[0];
    expect(indexAt(withPlugins.sections)).toBe(indexAt(plain.sections));
    const others = (messages: { content: string }[]) =>
      messages.filter((_, index) => index !== indexAt(plain.sections));
    expect(others(withPlugins.messages)).toEqual(others(plain.messages));
  });

  it('作品里没有技能、只有插件技能时也有这一段', async () => {
    const { reader } = machine({ '正文/第001章.md': '第一章。', ...enabled('审稿包') }, PLUGINS);
    const { block, skillUse } = await assemble(reader, '下一步', LIB);
    expect(skillUse.pluginSkills).toBe(true);
    expect(block('skills_index')).toBe(
      [
        '[技能 · 作者定的]',
        PLUGIN_INTRO,
        '- 口径（插件「审稿包」）：统一称呼时',
        '- 审稿（插件「审稿包」）：同名的后启用插件',
      ].join('\n'),
    );
  });

  it('所有插件的技能合计最多 20 份：按启用顺序取，重名丢掉的不占名额', async () => {
    const numbered = (prefix: string, count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => {
          const name = `${prefix}${String(index + 1).padStart(2, '0')}`;
          return [`技能/${name}.md`, `${name} 的做法。`];
        }),
      );
    const { reader } = machine(
      { '技能/a03.md': '作品里的 a03。', ...enabled('甲', '乙') },
      {
        甲: { 'storyforge-plugin.json': manifest('甲'), ...numbered('a', 16) },
        乙: { 'storyforge-plugin.json': manifest('乙'), ...numbered('b', 10) },
      },
    );
    const skills = await loadAvailableSkills(reader, BOOK, LIB, SECRETS);
    expect(skills.map((skill) => `${skill.plugin?.id ?? '作品'}:${skill.name}`)).toEqual([
      '作品:a03',
      ...['01', '02', ...Array.from({ length: 13 }, (_, i) => String(i + 4).padStart(2, '0'))].map(
        (n) => `甲:a${n}`,
      ),
      ...['01', '02', '03', '04', '05'].map((n) => `乙:b${n}`),
    ]);
    expect(skills.filter((skill) => skill.plugin !== null)).toHaveLength(PLUGIN_SKILLS_MAX);
    expect(skills[1]).toMatchObject({ path: '技能/a01.md', plugin: { id: '甲', root: at('甲') } });
  });
});

describe('/ 点名插件技能', () => {
  it('附全文（脱敏），标题写插件名与插件内路径；作品技能照旧', async () => {
    const { reader } = machine({ ...BOOK_FILES, ...enabled('网文包') }, PLUGINS);
    const block = (await assemble(reader, '/爽点 /立项流程 写下一章', LIB)).block(
      'invoked_skills',
    )!;
    const plugin = block.indexOf(
      '### 爽点（插件「网文包」：技能/爽点.md）\n先压后扬。钥匙 [REDACTED]',
    );
    const own = block.indexOf('### 立项流程（技能/立项流程.md）\n# 立项流程\n先立项。');
    expect(plugin).toBeGreaterThan(0);
    expect(own).toBeGreaterThan(plugin);
    expect(block).not.toContain(SECRET);
  });

  it('插件技能过长时截断，提示用 skill_read 读', async () => {
    const long = '长'.repeat(4_100);
    const { reader } = machine(
      { ...BOOK_FILES, ...enabled('长包') },
      { 长包: { '技能/长技能.md': `---\n名字：长技能\n---\n${long}` } },
    );
    const block = (await assemble(reader, '/长技能', LIB)).block('invoked_skills')!;
    expect(block).toContain(
      `### 长技能（插件「长包」：技能/长技能.md）\n${'长'.repeat(4_000)}\n……（后面还有，需要时用 skill_read 读）`,
    );
    expect(block).not.toContain('长'.repeat(4_001));
  });
});

const skillRead = (reader: ProjectReader, pluginLibraryRoot: string | null = LIB) =>
  skillToolHandlers({ reader, secrets: SECRETS, pluginLibraryRoot } as unknown as ToolDeps)[
    'skill.read'
  ];

describe('skill_read', () => {
  const { reader } = machine({ ...BOOK_FILES, ...enabled('网文包', '审稿包') }, PLUGINS);

  it('读作品技能：plugin 为 null，path 是项目相对路径', async () => {
    const result = await skillRead(reader)({} as never, { project_root: BOOK, name: '立项流程' });
    expect(result.output).toEqual({
      name: '立项流程',
      plugin: null,
      path: '技能/立项流程.md',
      content: '# 立项流程\n先立项。',
      truncated: false,
    });
    expect(result.trace).toMatchObject({
      tool_name: 'skill.read',
      status: 'completed',
      input_summary: { name: '立项流程' },
      output_summary: {
        skill_name: '立项流程',
        plugin: null,
        path: '技能/立项流程.md',
        returned_chars: Array.from('# 立项流程\n先立项。').length,
        truncated: false,
      },
    });
  });

  it('读插件技能（脱敏）；循环证据里的输出摘要与处理器自己的一致', async () => {
    const result = await skillRead(reader)({} as never, { project_root: BOOK, name: '爽点' });
    expect(result.output).toEqual({
      name: '爽点',
      plugin: '网文包',
      path: '技能/爽点.md',
      content: '先压后扬。钥匙 [REDACTED]',
      truncated: false,
    });
    expect(toolOutputSummary('skill.read', result.output)).toEqual(result.trace.output_summary);
  });

  it('没有这个名字时报工具错误，列出可用的名字', async () => {
    await expect(
      skillRead(reader)({} as never, { project_root: BOOK, name: '不存在' }),
    ).rejects.toThrow(
      new FsToolError(
        '没有叫「不存在」的技能。可用的技能：「审稿口径」、「立项流程」、「审稿」、「爽点」、「口径」。',
      ),
    );
    // 没给插件库时插件技能读不到。
    await expect(
      skillRead(reader, null)({} as never, { project_root: BOOK, name: '爽点' }),
    ).rejects.toThrow('没有叫「爽点」的技能。可用的技能：「审稿口径」、「立项流程」。');
    await expect(
      skillRead(machine({}).reader)({} as never, { project_root: BOOK, name: '爽点' }),
    ).rejects.toThrow('没有叫「爽点」的技能。这本书现在没有可用的技能。');
  });

  it('超过 20000 码点截断', async () => {
    const long = '𠀀'.repeat(SKILL_READ_MAX_CHARS + 5);
    const { reader: longReader } = machine(
      { ...enabled('长包') },
      { 长包: { '技能/长.md': `---\n名字：长\n---\n${long}` } },
    );
    const result = await skillRead(longReader)({} as never, { project_root: BOOK, name: '长' });
    expect(result.output.truncated).toBe(true);
    expect(result.output.content).toBe('𠀀'.repeat(SKILL_READ_MAX_CHARS));
    expect(result.trace.output_summary).toMatchObject({
      returned_chars: SKILL_READ_MAX_CHARS,
      truncated: true,
    });
    expect(toolOutputSummary('skill.read', result.output)).toEqual(result.trace.output_summary);
  });
});

/** 跑一轮循环：第一轮模型按 `calls` 调工具（skill_read 走真处理器），第二轮回话；记下每次请求。 */
async function loopRun(reader: ProjectReader, pluginLibraryRoot: string | null, calls: ToolCall[]) {
  const requests: ChatRequest[] = [];
  const traces: AgentToolTrace[] = [];
  const checkpoints = new LoopCheckpointStore();
  const handlers = skillToolHandlers({
    reader,
    secrets: SECRETS,
    pluginLibraryRoot,
  } as unknown as ToolDeps);
  const unexpected = async (): Promise<never> => {
    throw new Error('unexpected');
  };
  const assistant = {
    createToolCall: async (_id: number, input: { input_summary: unknown }) => ({
      id: 1,
      input_summary: input.input_summary,
    }),
    updateToolCall: async (id: number, patch: { input_summary?: unknown }) => ({
      id,
      input_summary: patch.input_summary ?? {},
    }),
  } as unknown as AssistantStore;
  const outcome = await runChatLoop(
    {
      reader,
      conversation: NO_HISTORY,
      platform: 'windows',
      assistant,
      secrets: SECRETS,
      buildProvider: () => ({
        streaming: false,
        complete: async (request: ChatRequest) => {
          requests.push(request);
          return requests.length === 1 && calls.length
            ? chatResponse({ content: '', toolCalls: calls })
            : chatResponse({ content: '回答' });
        },
        stream: (): never => {
          throw new Error('unexpected');
        },
      }),
      checkpoints,
      scope: new RunControlScope(() => null, { clock: () => 1000, wait: async () => {} }),
      newStreamId: () => 'stream',
      pluginLibraryRoot,
    },
    {
      run: { public_id: 'run-1', permission_profile: 'ask', assistant_session_id: 1 },
      definitions: listLoopToolSpecs().map((spec) => toolDefinitionFromSpec(spec, unexpected)),
      source: { STORYFORGE_LLM_MODEL: 'm-1' },
      assistantSessionId: 1,
      userMessage: '下一步',
      projectPath: BOOK,
      currentFile: null,
      executeTool: async (name, args) =>
        handlers[name]({} as never, { ...args, project_root: BOOK }),
      onTrace: (trace) => {
        traces.push(trace);
      },
    },
  );
  return { requests, traces, outcome, saved: checkpoints.latest('run-1') };
}

describe('skill_read 只在有插件技能时交给模型', () => {
  const pythonTools = Object.keys(golden.loop_name_map);

  it('没有插件技能时，交给模型的工具与 Python 时期的目录逐个一致', async () => {
    for (const [reader, library] of [
      [machine(BOOK_FILES).reader, null],
      [machine(BOOK_FILES).reader, LIB],
      [machine({ ...BOOK_FILES, ...enabled('网文包') }, PLUGINS).reader, null],
    ] as const) {
      const { requests } = await loopRun(reader, library, []);
      expect(requests.map((request) => request.tools.map((tool) => tool.name))).toEqual([
        pythonTools,
      ]);
    }
  });

  it('有插件技能时多给 skill_read，读过的插件技能进续跑指纹', async () => {
    const { reader } = machine({ ...BOOK_FILES, ...enabled('网文包') }, PLUGINS);
    const { requests, traces, outcome, saved } = await loopRun(reader, LIB, [
      new ToolCall('c1', 'skill_read', JSON.stringify({ name: '爽点' })),
    ]);
    const offered = requests.map((request) => request.tools.map((tool) => tool.name));
    const after = pythonTools.indexOf('knowledge_propose') + 1;
    const expected = [...pythonTools.slice(0, after), 'skill_read', ...pythonTools.slice(after)];
    expect(offered).toEqual([expected, expected]);
    expect(outcome.answer).toBe('回答');
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      tool_name: 'skill.read',
      status: 'completed',
      input_summary: { name: '爽点' },
      output_summary: {
        skill_name: '爽点',
        plugin: '网文包',
        path: '技能/爽点.md',
        returned_chars: Array.from('先压后扬。钥匙 [REDACTED]').length,
        truncated: false,
      },
    });
    expect(saved!.sources.files['plugin:网文包/技能/爽点.md']).toMatchObject({
      path: '技能/爽点.md',
      plugin_root: at('网文包'),
    });
  });

  it('没交给模型时调用 skill_read 当未知工具，与没有这个工具时一样', async () => {
    const { traces } = await loopRun(machine(BOOK_FILES).reader, LIB, [
      new ToolCall('c1', 'skill_read', JSON.stringify({ name: '立项流程' })),
    ]);
    expect(traces).toEqual([
      {
        tool_name: 'skill_read',
        status: 'failed',
        input_summary: { arguments: '{"name":"立项流程"}' },
        error_message: '未知工具：skill_read，可用工具为 fs_list / fs_read / fs_search。',
      },
    ]);
  });
});

describe('续跑指纹里的插件技能', () => {
  const args = { project_path: BOOK, file_path: null };
  const readCalls = (...names: string[]) =>
    [
      {
        toolCalls: names.map((name, index) => ({
          id: `c${index}`,
          name: 'skill_read',
          argumentsJson: JSON.stringify({ name }),
        })),
      },
    ] as never;

  it('点名或 skill_read 读过的插件技能记 plugin: 键，作品技能记项目相对路径', async () => {
    const { reader } = machine({ ...BOOK_FILES, ...enabled('网文包', '审稿包') }, PLUGINS);
    const sources = await sourceVersions(
      { reader, pluginLibraryRoot: LIB, secrets: SECRETS },
      readCalls('口径', '审稿口径', '不存在'),
      { user_message: '/爽点 写下一章', args },
    );
    expect(Object.keys(sources.files).sort()).toEqual(
      [
        '.storyforge/agent-instructions.md',
        '技能/审稿口径.md',
        'plugin:网文包/技能/爽点.md',
        'plugin:审稿包/技能/口径.md',
      ].sort(),
    );
    expect(sources.files['plugin:审稿包/技能/口径.md']).toMatchObject({
      path: '技能/口径.md',
      plugin_root: at('审稿包'),
    });
    expect(sources.files['技能/审稿口径.md'].plugin_root).toBeUndefined();
    // 没给插件库时只认作品技能。
    const own = await sourceVersions({ reader }, readCalls('口径', '审稿口径'), {
      user_message: '/爽点 写下一章',
      args,
    });
    expect(Object.keys(own.files).filter((key) => key.startsWith('plugin:'))).toEqual([]);
  });

  it('插件没动时能续跑；插件技能改了或插件被移走就算来源已变', async () => {
    const fixture = () => machine({ ...BOOK_FILES, ...enabled('网文包', '审稿包') }, PLUGINS);
    const record = async (reader: ProjectReader) =>
      sourceVersions({ reader, pluginLibraryRoot: LIB }, readCalls('口径'), {
        user_message: '/爽点 写下一章',
        args,
      });

    const calm = fixture();
    const calmSources = await record(calm.reader);
    // 核对不靠插件库根：指纹里记着插件文件夹（保存点的只读依赖里没有插件库）。
    expect(await sourcesUnchanged({ reader: calm.reader }, calmSources, { args })).toBe(true);

    const edited = fixture();
    const editedSources = await record(edited.reader);
    edited.editPlugin('网文包', '技能/爽点.md', '---\n名字：爽点\n---\n改过了。');
    expect(await sourcesUnchanged({ reader: edited.reader }, editedSources, { args })).toBe(false);

    const removed = fixture();
    const removedSources = await record(removed.reader);
    removed.removePlugin('审稿包');
    expect(await sourcesUnchanged({ reader: removed.reader }, removedSources, { args })).toBe(
      false,
    );
  });
});
