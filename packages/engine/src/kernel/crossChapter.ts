import { LlmConfigError } from '../llm/config';
import { LlmError } from '../llm/payload';
import type { ProjectReader } from '../readPort';
import { chapterOrdinals } from './canonRebuild';
import { FsToolError, readBoundedText, resolveProjectRoot, resolveScopedPath } from './fsTools';
import { compareCodePoints, isJsonObject, pythonStr } from './json';
import { compactText, PYTHON_WHITESPACE, pythonStrip } from './pythonText';
import { loadsJsonArray } from './reviewReasoning';

const TRAILING_WHITESPACE = new RegExp(`${PYTHON_WHITESPACE}+$`, 'u');

export const PER_CHAPTER_CHAR_BUDGET = 4000;
// 上限是信噪比而非性能：一次塞十几章，模型会退回泛泛而谈。
export const MAX_CHAPTERS = 6;
export const MIN_CHAPTERS = 2;
const MAX_FILE_BYTES = 512_000;
const MAX_FINDINGS = 12;
const VALID_TYPES = new Set([
  'timeline',
  'naming',
  'setting',
  'character_exit',
  'foreshadow',
  'other',
]);
const VALID_SEVERITIES = new Set(['high', 'medium', 'low']);

export const CROSS_CHAPTER_SYSTEM_PROMPT =
  '你是 StoryForge 的跨章一致性审校。给你同一部小说的若干章节正文,' +
  '只找它们**之间**的硬冲突:时间线矛盾、人物姓名/称谓漂移、设定或世界规则前后不一致、' +
  '已死亡或已离场角色再次出场、前文埋下的伏笔后文未回收。' +
  '不要报单章内的文风/节奏问题。每条冲突必须给出涉及的章节和各自的原文片段为证。' +
  '只输出 JSON 数组,不要解释,不要 Markdown,不要代码块标记。';

export type CrossChapterLlmPort = (request: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<{ content: unknown; latency_ms?: unknown }>;

const length = (text: string) => Array.from(text).length;

function truncate(value: string, limit: number): string {
  const text = Array.from(pythonStrip(value));
  if (text.length <= limit) return text.join('');
  return text.slice(0, limit).join('').replace(TRAILING_WHITESPACE, '') + '\n...[已截断]';
}

export function crossChapterUserPrompt(
  chapters: readonly { name?: string | null; content?: string | null }[],
  focus: string | null,
): string {
  const parts = ['以下是同一部小说的若干章节(按顺序):', ''];
  for (const chapter of chapters) {
    const name = pythonStrip(chapter.name || '未命名章');
    parts.push(
      `<<<${name}`,
      truncate(chapter.content || '', PER_CHAPTER_CHAR_BUDGET),
      `${name}>>>`,
      '',
    );
  }
  if (focus && pythonStrip(focus)) parts.push(`作者特别关注:${pythonStrip(focus)}`, '');
  parts.push(
    '只输出 JSON 数组,每项必须是:',
    '{"type":"timeline|naming|setting|character_exit|foreshadow|other",' +
      '"severity":"high|medium|low","chapters":["第N章",...],' +
      '"finding":"跨章冲突说明","evidence":"涉及各章的原文片段"}',
    `最多 ${MAX_FINDINGS} 项;没有任何跨章冲突时输出 []。`,
  );
  return parts.join('\n');
}

export function parseCrossChapterFindings(raw: unknown) {
  if (typeof raw !== 'string' || !pythonStrip(raw)) throw new LlmError('跨章一致性 LLM 返回为空。');
  const parsed = loadsJsonArray(raw);
  if (!Array.isArray(parsed)) throw new LlmError('跨章一致性 LLM 返回的不是 JSON 数组。');
  return parsed
    .slice(0, MAX_FINDINGS)
    .filter(isJsonObject)
    .map((item) => {
      let type = pythonStrip(pythonStr(item.type || 'other')).toLowerCase();
      if (!VALID_TYPES.has(type)) type = 'other';
      let severity = pythonStrip(pythonStr(item.severity || 'medium')).toLowerCase();
      if (!VALID_SEVERITIES.has(severity)) severity = 'medium';
      const chapters = Array.isArray(item.chapters)
        ? item.chapters.map((chapter) => pythonStrip(pythonStr(chapter))).filter(Boolean)
        : [];
      return {
        type,
        severity,
        chapters,
        finding: compactText(item.finding, 280) || '未命名跨章冲突。',
        evidence: compactText(item.evidence, 280) || '未提供原文证据。',
      };
    });
}

type OrderedChapter = {
  path: string;
  chapter: number | null;
  content: string;
  chars: number;
  truncated: boolean;
};

/** 解析路径边界并按阅读序排好章（模型给的顺序不可信，而 prompt 的前提就是「按顺序」）。 */
export async function orderedChapters(
  reader: ProjectReader,
  root: string,
  paths: readonly unknown[],
  platform: 'windows' | 'posix',
): Promise<OrderedChapter[]> {
  await resolveProjectRoot(reader, root);
  const ordinals = await chapterOrdinals(reader, root, '*.md', platform);
  const seen = new Set<string>();
  const chapters: OrderedChapter[] = [];
  for (const raw of paths) {
    if (typeof raw !== 'string' || !pythonStrip(raw)) continue;
    const target = await resolveScopedPath(reader, root, pythonStrip(raw));
    if ((await reader.inspectProjectPath(root, target)).targetKind !== 'file')
      throw new FsToolError(`不是文件：${pythonStrip(raw)}`);
    if (seen.has(target)) continue;
    seen.add(target);
    const text = (await readBoundedText(reader, root, target, MAX_FILE_BYTES)).content;
    if (!pythonStrip(text)) throw new FsToolError(`文件没有可比对的正文：${target}`);
    chapters.push({
      path: target,
      chapter: ordinals.get(target) ?? null,
      content: text,
      chars: length(text),
      truncated: length(pythonStrip(text)) > PER_CHAPTER_CHAR_BUDGET,
    });
  }
  // 非正文文件（大纲 / 设定）没有章序，排在正文之后，而不是当作第 0 章插到最前。
  return chapters.sort(
    (a, b) =>
      Number(a.chapter === null) - Number(b.chapter === null) ||
      (a.chapter ?? 0) - (b.chapter ?? 0) ||
      compareCodePoints(a.path, b.path),
  );
}

/** 对若干章做跨章一致性审校，返回 advisory finding；未配置模型或调用失败显式报错。 */
export async function crossChapterReview(
  reader: ProjectReader,
  root: string,
  paths: unknown,
  options: {
    platform: 'windows' | 'posix';
    focus?: string | null;
    callLlm: CrossChapterLlmPort;
    model: string | null;
  },
) {
  if (!Array.isArray(paths)) throw new FsToolError('paths 必须是字符串数组。');
  if (paths.length > MAX_CHAPTERS)
    throw new FsToolError(
      `一次最多比对 ${MAX_CHAPTERS} 章；章数过多会让结论退回泛泛而谈，请分批。`,
    );
  const chapters = await orderedChapters(reader, root, paths, options.platform);
  if (chapters.length < MIN_CHAPTERS)
    throw new FsToolError(`跨章检查至少需要 ${MIN_CHAPTERS} 个有正文的不同章节。`);
  const payload = chapters.map((item) => ({
    name: item.chapter ? `第${item.chapter}章 ${item.path}` : item.path,
    content: item.content,
  }));
  if (payload.filter((item) => pythonStrip(item.content)).length < 2)
    throw new RangeError('跨章一致性检查至少需要两章有正文的章节。');
  let findings: ReturnType<typeof parseCrossChapterFindings>;
  try {
    const result = await options.callLlm({
      systemPrompt: CROSS_CHAPTER_SYSTEM_PROMPT,
      userPrompt: crossChapterUserPrompt(payload, options.focus ?? null),
    });
    findings = parseCrossChapterFindings(result.content);
  } catch (error) {
    if (error instanceof LlmConfigError)
      throw new FsToolError(
        `跨章一致性未配置 LLM：请先在设置里配置模型服务，再做跨章检查。（${error.message}）`,
      );
    if (error instanceof LlmError)
      throw new FsToolError(
        `跨章一致性模型调用失败，本轮没有产出结论；可稍后重试。（${error.message}）`,
      );
    throw error;
  }
  return {
    chapters: chapters.map(({ path, chapter, chars, truncated }) => ({
      path,
      chapter,
      chars,
      truncated,
    })),
    chapter_count: chapters.length,
    finding_count: findings.length,
    findings,
    model: options.model && pythonStrip(options.model) ? pythonStrip(options.model) : null,
    per_chapter_char_budget: PER_CHAPTER_CHAR_BUDGET,
    note:
      '跨章 finding 是参考信号：每条都给了涉及章节与原文片段，回给作者前请按 path 抽读核实。' +
      '超出每章预算的部分模型没读到（truncated=true），必要时分批再比一次。',
  };
}
