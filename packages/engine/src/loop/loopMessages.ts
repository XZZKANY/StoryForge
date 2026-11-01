import {
  PLUGIN_CONVERSATION_PREFIX,
  pluginInstructionsBlock,
  readAuthorInstructions,
  readPluginInstructions,
} from '../kernel/authorVoice';
import { renderBookContextBlock } from '../kernel/bookContext';
import { buildBookContext } from '../kernel/buildBookContext';
import { buildSceneConstraintBlock } from '../kernel/canonContext';
import {
  conversationSkillsBlock,
  hasPluginSkills,
  invokedConversationSkills,
  invokedSkillsBlock,
  loadAvailableSkills,
} from '../kernel/conversationSkills';
import { dumpJson } from '../kernel/json';
import { buildPlanBlock } from '../kernel/serialPlan';
import { missingSetupBeforeFirstChapter, setupGapSection } from '../kernel/projectSetup';
import type { SecretContext } from '../kernel/redaction';
import { sha256Hex } from '../kernel/sha256';
import type { ProjectReader } from '../readPort';
import { buildAuthorViewBlock, buildPinnedContextBlock, type AuthorView } from './authorView';
import { projectConversationHistory, type ConversationSources } from './conversationHistory';
import { AUTHOR_INSTRUCTIONS_PREFIX, SYSTEM_PROMPT } from './promptContext';

export type LoopMessage = { role: string; content: string };

/**
 * chat 循环的初始消息：system prompt、插件指令（启用的插件带了指令才有）、作者指令、技能目录（有技能才有）、
 * 全书底座、连载计划、场景约束、会话历史、@钉上下文、作者视图、点名技能全文（作者用 /技能名 点名才有）、
 * 本轮作者消息；同时记下每一段的来源指纹（provenance）。
 */
export async function storyforgeMessages(
  deps: {
    reader: ProjectReader;
    conversation: ConversationSources;
    platform: 'windows' | 'posix';
    secrets: SecretContext;
    /** 本机插件库根目录；缺省或 null 是没有插件。 */
    pluginLibraryRoot?: string | null;
  },
  input: {
    assistantSessionId: number;
    userMessage: string;
    projectPath: string;
    currentFile: string | null;
    authorView: AuthorView | null;
    pinnedContext: string | null;
    setupNote?: string | null;
  },
  provenance: { [key: string]: unknown } | null = null,
  /** 回报这一轮的可用技能里有没有插件技能（决定 skill_read 交不交给模型）。 */
  skillUse: { pluginSkills: boolean } | null = null,
): Promise<LoopMessage[]> {
  const { reader, platform } = deps;
  const { projectPath: root, currentFile } = input;
  const hint = currentFile ? `当前打开文件：${currentFile}` : '当前没有打开文件';
  const book = await buildBookContext(reader, root, currentFile, platform);
  const rendered = book === null ? null : renderBookContextBlock(book);
  const missing =
    book === null ? null : await missingSetupBeforeFirstChapter(reader, root, platform);
  const bookBlock =
    missing === null
      ? rendered
      : `${rendered ?? '[作品底座 · 确定性]'}\n\n${setupGapSection(missing)}`;
  const planBlock = await buildPlanBlock(reader, root, platform);
  const sceneBlock = await buildSceneConstraintBlock(reader, root, currentFile, { platform });
  const pluginInstructions = pluginInstructionsBlock(
    await readPluginInstructions(reader, root, deps.pluginLibraryRoot ?? null, deps.secrets),
    PLUGIN_CONVERSATION_PREFIX,
  );
  const instructions = await readAuthorInstructions(reader, root);
  const skills = await loadAvailableSkills(
    reader,
    root,
    deps.pluginLibraryRoot ?? null,
    deps.secrets,
  );
  if (skillUse !== null) skillUse.pluginSkills = hasPluginSkills(skills);
  const skillsBlock = conversationSkillsBlock(skills);
  const invokedBlock = invokedSkillsBlock(invokedConversationSkills(skills, input.userMessage));
  const viewBlock = input.authorView === null ? null : buildAuthorViewBlock(input.authorView);
  const pinnedBlock = buildPinnedContextBlock(input.pinnedContext);
  const system = (content: string | null): LoopMessage[] =>
    content ? [{ role: 'system', content }] : [];
  const parts: [string, LoopMessage[]][] = [
    ['system_prompt', system(SYSTEM_PROMPT)],
    // 插件不是作者本人：放在作者指令前面，作者的话在后、更近更强。没有时连段名都不记（同技能目录）。
    ...(pluginInstructions
      ? [['plugin_instructions', system(pluginInstructions)] as [string, LoopMessage[]]]
      : []),
    [
      'author_instructions',
      system(instructions ? AUTHOR_INSTRUCTIONS_PREFIX + instructions : null),
    ],
    // 没有技能时连段名都不记：没有技能的作品，消息与来源指纹和以前逐字一致。
    ...(skillsBlock ? [['skills_index', system(skillsBlock)] as [string, LoopMessage[]]] : []),
    ['book_context', system(bookBlock)],
    ['serial_plan', system(planBlock)],
    ['scene_constraints', system(sceneBlock)],
    [
      'conversation_history',
      await projectConversationHistory(
        deps.conversation,
        input.assistantSessionId,
        root ? { reader, root } : null,
      ),
    ],
    ['pinned_context', system(pinnedBlock)],
    ['author_view', system(viewBlock)],
    ...(invokedBlock ? [['invoked_skills', system(invokedBlock)] as [string, LoopMessage[]]] : []),
    [
      'current_user',
      [
        {
          role: 'user',
          content:
            `[作品已挂载。${hint}]\n` +
            (input.setupNote ? `${input.setupNote}\n` : '') +
            `作者：${input.userMessage}`,
        },
      ],
    ],
  ];
  const messages: LoopMessage[] = [];
  const sections: { [key: string]: unknown }[] = [];
  for (const [name, entries] of parts) {
    const indices = entries.map((_, offset) => messages.length + offset);
    messages.push(...entries);
    sections.push({
      section: name,
      message_indices: indices,
      sha256: sha256Hex(dumpJson(entries, { ensureAscii: false, sortKeys: true })),
      omission_reason: entries.length ? null : 'context_builder_returned_empty',
    });
  }
  if (provenance !== null)
    Object.assign(provenance, {
      projection_version: 1,
      assistant_session_id: input.assistantSessionId,
      sections,
      current_file: currentFile,
      source_basis: 'compiled_context_not_current_disk_verification',
    });
  return messages;
}
