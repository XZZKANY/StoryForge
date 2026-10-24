import { readAuthorInstructions } from '../kernel/authorVoice';
import { renderBookContextBlock } from '../kernel/bookContext';
import { buildBookContext } from '../kernel/buildBookContext';
import { buildSceneConstraintBlock } from '../kernel/canonContext';
import { dumpJson } from '../kernel/json';
import { buildPlanBlock } from '../kernel/serialPlan';
import { missingSetupBeforeFirstChapter, setupGapSection } from '../kernel/projectSetup';
import { sha256Hex } from '../kernel/sha256';
import type { ProjectReader } from '../readPort';
import { buildAuthorViewBlock, buildPinnedContextBlock, type AuthorView } from './authorView';
import { projectConversationHistory, type ConversationSources } from './conversationHistory';
import { AUTHOR_INSTRUCTIONS_PREFIX, SYSTEM_PROMPT } from './promptContext';

export type LoopMessage = { role: string; content: string };

/**
 * chat 循环的初始消息：system prompt、作者指令、全书底座、连载计划、场景约束、会话历史、
 * @钉上下文、作者视图、本轮作者消息；同时记下每一段的来源指纹（provenance）。
 */
export async function storyforgeMessages(
  deps: { reader: ProjectReader; conversation: ConversationSources; platform: 'windows' | 'posix' },
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
  const instructions = await readAuthorInstructions(reader, root);
  const viewBlock = input.authorView === null ? null : buildAuthorViewBlock(input.authorView);
  const pinnedBlock = buildPinnedContextBlock(input.pinnedContext);
  const system = (content: string | null): LoopMessage[] =>
    content ? [{ role: 'system', content }] : [];
  const parts: [string, LoopMessage[]][] = [
    ['system_prompt', system(SYSTEM_PROMPT)],
    [
      'author_instructions',
      system(instructions ? AUTHOR_INSTRUCTIONS_PREFIX + instructions : null),
    ],
    ['book_context', system(bookBlock)],
    ['serial_plan', system(planBlock)],
    ['scene_constraints', system(sceneBlock)],
    [
      'conversation_history',
      await projectConversationHistory(deps.conversation, input.assistantSessionId),
    ],
    ['pinned_context', system(pinnedBlock)],
    ['author_view', system(viewBlock)],
    [
      'current_user',
      [
        {
          role: 'user',
          content:
            `[项目已挂载，只读工具可用。${hint}]\n` +
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
