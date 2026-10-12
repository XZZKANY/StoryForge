import { ProjectReadError, type ProjectReader } from '../readPort';
import { buildAuthorEditPolicy, type AuthorEditPolicy } from './authorEditPolicy';
import { AUTHOR_INSTRUCTIONS_PATH } from './fsTools';
import type { GenerationSourceCapture } from './generationSources';
import { pythonStrip } from './pythonText';
import { appendStyleBaselineToSystemPrompt } from './styleBaseline';

export const MAX_INSTRUCTION_CHARS = 4_000;
const MAX_SOURCE_BYTES = 512 * 1024;

// 两档措辞：对话路径「尽量遵循」，产字路径「逐条遵循」；同一份文件内容只换注入措辞。
export const CONVERSATION_PREFIX =
  '以下是作者对你的额外偏好与要求，请在不违反上述工具纪律与写回红线' +
  '（后端绝不写盘，改动一律出成补丁交由编辑器写回；补丁要不要作者逐次点确认，' +
  '由该项目的权限档位决定，不由你决定）的前提下尽量遵循：\n';

export const GENERATION_PREFIX =
  '以下是作者对自己作品的写作偏好与要求。你正在为这位作者的正文落笔，' +
  '请逐条遵循；与上述通用创作准则冲突时，以作者本人的要求为准：\n';

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * 读 `.storyforge/agent-instructions.md`；不存在 / 读不到 / 空内容一律 null。每次重读不缓存；
 * 超长保尾截断（作者指令是追加语义，新要求在文件尾部）。
 */
export async function readAuthorInstructions(
  reader: ProjectReader,
  root: string | null,
  capture?: GenerationSourceCapture,
): Promise<string | null> {
  if (typeof root !== 'string' || !pythonStrip(root)) {
    capture?.project('author_instructions', null, { omissionReason: 'missing_project' });
    return null;
  }
  let target: string | null = null;
  let raw: Uint8Array | null = null;
  let text: string;
  const unreadable = async (outsideProject = false) => {
    await capture?.observe('author_instructions', target, {
      raw,
      omissionReason: 'unreadable_source',
      outsideProject,
    });
    capture?.project('author_instructions', null, { omissionReason: 'unreadable_source' });
    return null;
  };
  try {
    await reader.resolveProjectPath(root, '.');
    if ((await reader.inspectProjectPath(root, '.')).targetKind !== 'directory') return null;
    target = (await reader.resolveProjectPath(root, AUTHOR_INSTRUCTIONS_PATH)).resolvedRelativePath;
    if ((await reader.inspectProjectPath(root, target)).targetKind !== 'file') {
      await capture?.observe('author_instructions', target, { omissionReason: 'missing_source' });
      capture?.project('author_instructions', null, { omissionReason: 'missing_source' });
      return null;
    }
    const read = await reader.readProjectBytes(root, target, MAX_SOURCE_BYTES);
    raw = read.bytes;
    if (read.exceeded || raw.subarray(0, 1024).includes(0)) {
      const reason = read.exceeded ? 'source_byte_budget' : 'binary_source';
      await capture?.observe('author_instructions', target, {
        raw,
        complete: false,
        omissionReason: reason,
      });
      capture?.project('author_instructions', null, { omissionReason: reason });
      return null;
    }
  } catch (error) {
    // 链接逃出项目时 Python 已拿到解析后的路径，观察记为 outside_project。
    if (error instanceof ProjectReadError) return unreadable(error.kind === 'outside-project');
    throw error;
  }
  try {
    text = pythonStrip(UTF8.decode(raw).replace(/\r\n?/g, '\n'));
  } catch {
    return unreadable();
  }
  await capture?.observe('author_instructions', target, { raw, text, complete: true });
  if (!text) {
    capture?.project('author_instructions', null, { omissionReason: 'empty_source' });
    return null;
  }
  const points = Array.from(text);
  const originalLength = points.length;
  let budget = 0;
  if (originalLength > MAX_INSTRUCTION_CHARS) {
    const marker = '…[作者指令过长已截断，保留最近部分]\n';
    budget = MAX_INSTRUCTION_CHARS - Array.from(marker).length;
    text = marker + points.slice(-budget).join('');
  }
  capture?.project('author_instructions', text, {
    truncated: originalLength > MAX_INSTRUCTION_CHARS,
    sourceSpan: {
      start: originalLength > MAX_INSTRUCTION_CHARS ? Math.max(0, originalLength - budget) : 0,
      end: originalLength,
      basis: 'normalized_text',
      unit: 'chars',
    },
    transformation: 'author_tail_with_notice_v1',
  });
  return text;
}

/** 把作者指令接到产字路径的 system prompt 末尾（近因位置最强）；无指令原样返回。 */
export async function appendAuthorInstructionsToSystemPrompt(
  reader: ProjectReader,
  systemPrompt: string,
  root: string | null,
  capture?: GenerationSourceCapture,
): Promise<string> {
  const instructions = await readAuthorInstructions(reader, root, capture);
  return instructions === null
    ? systemPrompt
    : systemPrompt + '\n\n' + GENERATION_PREFIX + instructions;
}

/**
 * 产字路径 system prompt 的唯一组装点。越靠后越强：通用创作准则（base 自带）→ 量自正文的
 * 文风基线 → 作者声明的指令。声明高于测量。
 */
export async function buildGenerationSystemPrompt(
  reader: ProjectReader,
  basePrompt: string,
  root: string | null,
  options: { platform: 'windows' | 'posix'; capture?: GenerationSourceCapture },
): Promise<string> {
  const withBaseline = await appendStyleBaselineToSystemPrompt(reader, basePrompt, root, options);
  return appendAuthorInstructionsToSystemPrompt(reader, withBaseline, root, options.capture);
}

/** 投影已经准备好的声音：不二次读盘，也不从通用 system 指令推导授权。 */
export function editPolicyFromGenerationPrompt(
  original: string,
  options: {
    instruction: string;
    systemPrompt: string;
    admittedAuthorRequirements?: readonly string[];
  },
): AuthorEditPolicy {
  const { systemPrompt } = options;
  const split = systemPrompt.indexOf(GENERATION_PREFIX);
  const beforeAuthor = split < 0 ? systemPrompt : systemPrompt.slice(0, split);
  const author = split < 0 ? '' : systemPrompt.slice(split + GENERATION_PREFIX.length);
  const baselineStart = beforeAuthor.indexOf('\n\n文风基线（');
  return buildAuthorEditPolicy(original, {
    instruction: options.instruction,
    authorRequirements: split >= 0 ? [author] : (options.admittedAuthorRequirements ?? []),
    baseline: baselineStart >= 0 ? beforeAuthor.slice(baselineStart + 2) : '',
  });
}
