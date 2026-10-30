import { ProjectReadError, type ProjectReader } from '../readPort';
import { buildAuthorEditPolicy, type AuthorEditPolicy } from './authorEditPolicy';
import { AUTHOR_INSTRUCTIONS_PATH } from './fsTools';
import type { GenerationSourceCapture } from './generationSources';
import { resolveEnabledPlugins } from './plugins';
import { pythonStrip } from './pythonText';
import type { SecretContext } from './redaction';
import { appendStyleBaselineToSystemPrompt } from './styleBaseline';

export const MAX_INSTRUCTION_CHARS = 4_000;
const MAX_SOURCE_BYTES = 512 * 1024;
const TRUNCATION_MARKER = '…[作者指令过长已截断，保留最近部分]\n';

// 两档措辞：对话路径「尽量遵循」，产字路径「逐条遵循」；同一份文件内容只换注入措辞。
export const CONVERSATION_PREFIX =
  '以下是作者对你的额外偏好与要求，请在不违反上述工具纪律与写入红线' +
  '（后端绝不写进文件，改动一律出成修订交由编辑器写进文件；修订要不要作者逐次点确认，' +
  '由该作品的权限档位决定，不由你决定）的前提下尽量遵循：\n';

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
    budget = MAX_INSTRUCTION_CHARS - Array.from(TRUNCATION_MARKER).length;
    text = TRUNCATION_MARKER + points.slice(-budget).join('');
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

/** `readAuthorInstructions` 的结果拆成正文与是否截断：截断标记只在这里认，界面不自己猜。 */
export function describeAuthorInstructions(text: string): {
  body: string;
  chars: number;
  truncated: boolean;
} {
  const truncated =
    text.startsWith(TRUNCATION_MARKER) && Array.from(text).length === MAX_INSTRUCTION_CHARS;
  const body = truncated ? text.slice(TRUNCATION_MARKER.length) : text;
  return { body, chars: Array.from(body).length, truncated };
}

/** 插件指令片段的合计上限（各插件指令正文的码点数）：放不下的那份和它后面的插件整份不带。 */
export const PLUGIN_INSTRUCTIONS_TOTAL_MAX_CHARS = 8_000;

/** 证据里逐个列出的插件指令上限，其余只记个数，免得启用很多插件时撑破来源证据的字节预算。 */
const PLUGIN_INSTRUCTIONS_EVIDENCE_MAX = 12;

export const PLUGIN_CONVERSATION_PREFIX =
  '以下是作者为这本书启用的插件带来的要求（不是作者本人写的）。' +
  '在不违反上述工具纪律与写回红线的前提下参考遵循；与作者本人的要求冲突时，以作者为准：\n';

export const PLUGIN_GENERATION_PREFIX =
  '以下是作者为这本书启用的插件带来的写作要求（不是作者本人写的）；' +
  '与作者本人的要求冲突时，以作者为准：\n';

/**
 * 插件是别人写的：片段里出现作者要求或文风基线的标记就整份丢弃，免得被
 * {@link editPolicyFromGenerationPrompt} 当成作者本人的要求或文风基线切出来。
 */
const IMPERSONATION_MARKERS = [GENERATION_PREFIX, CONVERSATION_PREFIX, '文风基线（'];

export type PluginInstructionsPart = {
  /** 插件文件夹名。 */
  readonly id: string;
  /** 插件文件夹的绝对路径。 */
  readonly root: string;
  /** 插件内路径。 */
  readonly path: string;
  readonly sha256: string;
  /** 插件读取时已按单份上限截断。 */
  readonly truncated: boolean;
  /**
   * null 是带上了；impersonation_marker 是冒充作者要求或文风基线被丢弃；
   * total_budget 是超出合计长度没带。
   */
  readonly omission: 'impersonation_marker' | 'total_budget' | null;
  readonly text: string;
};

const pluginSection = (id: string, text: string) => `【插件「${id}」】\n${text}`;

/**
 * 作品启用的插件的指令片段，按启用顺序；没有指令的插件不列。没给插件库或没有项目时为空。
 * 合计放不下时，从放不下的那份起后面的都不带（先启用的优先）。
 */
export async function readPluginInstructions(
  reader: ProjectReader,
  projectRoot: string | null,
  libraryRoot: string | null,
  secrets: SecretContext,
): Promise<PluginInstructionsPart[]> {
  if (!libraryRoot || typeof projectRoot !== 'string' || !pythonStrip(projectRoot)) return [];
  const { plugins } = await resolveEnabledPlugins(reader, projectRoot, libraryRoot, secrets);
  const parts: PluginInstructionsPart[] = [];
  let used = 0;
  let full = false;
  for (const plugin of plugins) {
    const instructions = plugin.instructions;
    if (instructions === null) continue;
    // 拼进提示词后片段后面紧跟换行：以「前缀去掉末尾换行」收尾的片段同样会凑出前缀。
    const section = pluginSection(plugin.id, instructions.text) + '\n';
    const chars = Array.from(instructions.text).length;
    let omission: PluginInstructionsPart['omission'] = null;
    if (IMPERSONATION_MARKERS.some((marker) => section.includes(marker)))
      omission = 'impersonation_marker';
    else if (full || used + chars > PLUGIN_INSTRUCTIONS_TOTAL_MAX_CHARS) {
      full = true;
      omission = 'total_budget';
    } else used += chars;
    parts.push({
      id: plugin.id,
      root: plugin.root,
      path: instructions.path,
      sha256: instructions.sha256,
      truncated: instructions.truncated,
      omission,
      text: instructions.text,
    });
  }
  return parts;
}

/** 带上的插件指令拼成一段（开头是 `prefix`）；一份都没带上时为 null。 */
export function pluginInstructionsBlock(
  parts: readonly PluginInstructionsPart[],
  prefix: string,
): string | null {
  const included = parts.filter((part) => part.omission === null);
  if (!included.length) return null;
  const left = parts
    .filter((part) => part.omission === 'total_budget')
    .map((part) => `「${part.id}」`);
  return (
    prefix +
    included.map((part) => pluginSection(part.id, part.text)).join('\n\n') +
    (left.length ? `\n\n还有插件${left.join('、')}的指令没带上（超出长度）。` : '')
  );
}

/**
 * 把插件指令接到通用创作准则后面、文风基线前面：作者要求与文风基线都在它之后，
 * {@link editPolicyFromGenerationPrompt} 切出来的那两段因此不含插件文本。没有插件指令时原样返回、不记证据。
 */
async function appendPluginInstructionsToSystemPrompt(
  reader: ProjectReader,
  systemPrompt: string,
  root: string | null,
  options: GenerationPluginOptions & { capture?: GenerationSourceCapture },
): Promise<string> {
  const { pluginLibraryRoot, secrets, capture } = options;
  if (!pluginLibraryRoot || !secrets) return systemPrompt;
  const parts = await readPluginInstructions(reader, root, pluginLibraryRoot, secrets);
  if (!parts.length) return systemPrompt;
  const block = pluginInstructionsBlock(parts, PLUGIN_GENERATION_PREFIX);
  capture?.select('plugin_instructions', {
    plugin_count: parts.length,
    plugins: parts.slice(0, PLUGIN_INSTRUCTIONS_EVIDENCE_MAX).map((part) => ({
      id: part.id,
      path: part.path,
      sha256: part.sha256,
      truncated: part.truncated,
      omission_reason: part.omission,
    })),
  });
  capture?.project('plugin_instructions', block, {
    truncated: parts.some(
      (part) => part.omission === 'total_budget' || (part.omission === null && part.truncated),
    ),
    omissionReason: block === null ? 'impersonation_marker' : null,
    transformation: 'plugin_instructions_v1',
  });
  return block === null ? systemPrompt : systemPrompt + '\n\n' + block;
}

/** 产字路径要带插件指令时给插件库根目录和脱敏用的密钥；不给（或给 null）就是没有插件。 */
type GenerationPluginOptions =
  | { pluginLibraryRoot?: null; secrets?: SecretContext }
  | { pluginLibraryRoot: string | null; secrets: SecretContext };

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
 * 产字路径 system prompt 的唯一组装点。越靠后越强：通用创作准则（base 自带）→ 作者启用的插件指令
 * （有才有）→ 量自正文的文风基线 → 作者声明的指令。声明高于测量，作者本人高于插件。
 */
export async function buildGenerationSystemPrompt(
  reader: ProjectReader,
  basePrompt: string,
  root: string | null,
  options: {
    platform: 'windows' | 'posix';
    capture?: GenerationSourceCapture;
  } & GenerationPluginOptions,
): Promise<string> {
  const withPlugins = await appendPluginInstructionsToSystemPrompt(
    reader,
    basePrompt,
    root,
    options,
  );
  const withBaseline = await appendStyleBaselineToSystemPrompt(reader, withPlugins, root, options);
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
