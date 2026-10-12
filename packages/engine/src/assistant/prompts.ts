import { craftPromptClause, sceneDisciplineClause } from '../kernel/craft';
import type { AssistantContextBundle } from '../kernel/writingContext';

export const CHAT_SYSTEM_PROMPT =
  '你是 StoryForge 的中文长篇小说创作助手，在作者的整个项目上协作。' +
  '作者会围绕这个项目（大纲、人物、设定、时间线、各章正文）跟你对话——提问、讨论走向、让你审读或出主意。' +
  '依据提供的项目上下文回答；上下文不足以支撑结论时，直说你还需要看哪些文件或章节，不要编造情节、人物或设定。' +
  '回答用简洁自然的中文，直接说事，不堆前后缀，也不要整段回抄原文。';

export function buildChatPrompt(userMessage: string, contextBlock: string): string {
  if (contextBlock)
    return (
      '以下是当前项目的上下文摘录（可能不完整，仅供理解作者在写什么）：\n' +
      `${contextBlock}\n\n` +
      `作者：${userMessage}`
    );
  return `（暂无项目上下文摘录。）\n\n作者：${userMessage}`;
}

export const DRAFT_SYSTEM_PROMPT =
  '你是 StoryForge 的中文长篇小说作者。' +
  '用户会给你一个新文件的路径与写作指令，请为这个文件起草完整初稿。' +
  '严格贴合指令与随附的项目上下文，保持既有人物、设定与大纲的连贯性，不要引入项目里不存在的设定。' +
  craftPromptClause() +
  sceneDisciplineClause() +
  '只输出正文内容，不要输出解释、前后缀或代码块标记。';

export function buildDraftPrompt(
  payload: {
    file_path: string;
    instruction: string;
    project_name?: string | null;
    context_bundle?: AssistantContextBundle | null;
  },
  sceneConstraints: string | null,
  previousChapter: readonly [string, string] | null,
): string {
  const projectLine = payload.project_name ? `项目：${payload.project_name}\n` : '';
  const files = payload.context_bundle?.files ?? [];
  const contextBlock = files.length
    ? '\n项目上下文摘录：这些文件来自同一小说项目，起草时保持大纲、人物、设定与既有正文连贯。\n' +
      files
        .map((item) =>
          [
            `### ${item.relative_path}`,
            `- 类型：${item.kind}`,
            '<<<CONTEXT',
            item.excerpt,
            'CONTEXT>>>',
          ].join('\n'),
        )
        .join('\n\n') +
      '\n'
    : '';
  const constraintBlock = sceneConstraints ? `\n${sceneConstraints}\n` : '';
  const previousBlock = previousChapter
    ? `\n上一章（${previousChapter[0]}）的结尾：\n<<<PREVIOUS\n${previousChapter[1]}\nPREVIOUS>>>\n`
    : '';
  return (
    `${projectLine}新文件路径：${payload.file_path}\n` +
    contextBlock +
    previousBlock +
    constraintBlock +
    `写作指令：${payload.instruction}\n` +
    '请输出该文件的完整初稿正文。'
  );
}
