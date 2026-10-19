import type { ProjectReader } from '../readPort';
import { platformTextBytes, type ProjectWriter } from '../writePort';
import { DocxReadError, readDocxText } from './docx';
import { iterProjectFiles, resolveProjectRoot } from './fsTools';
import {
  compareCodePoints,
  dumpJson,
  InputDomainError,
  isJsonObject,
  JsonFloat,
  parseJson,
  parseJsonBytes,
  pythonFloatRepr,
  pythonTruthy,
  type JsonValue,
} from './json';
import { PYTHON_WHITESPACE, pythonSplitlines, pythonStrip } from './pythonText';
import { sha256Hex } from './sha256';

export const ANALYSIS_SCHEMA_VERSION = 'storyforge.breakdown.v1';
export const SELECTION_STRATEGY_VERSION = 'anchors.v1';
const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.docx']);
/** 参考文本单文件上限；Python 不设限，超出即不在输入范围内。 */
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const WORD = '[\\p{L}\\p{N}_]';
const CHAPTER_RE = new RegExp(
  `^${PYTHON_WHITESPACE}*(?:#{1,6}${PYTHON_WHITESPACE}*)?(?:(?:第${PYTHON_WHITESPACE}*)?` +
    `([0-9]{1,5}|[零〇一二两三四五六七八九十百千万]+)${PYTHON_WHITESPACE}*(?:章|节|回)(?!${WORD})` +
    `|Chapter${PYTHON_WHITESPACE}+([0-9]{1,5})(?!${WORD}))(.*)$`,
  'isu',
);
const JSON_CONTENT_KEYS = ['content', 'text', 'body', '正文', '内容'];
export const ANALYSIS_KEYS = [
  'story_structure',
  'characters_and_relations',
  'conflict_and_rhythm',
  'setting_and_world',
  'craft_methods',
  'transferable_insights',
] as const;
export const BREAKDOWN_SYSTEM_PROMPT =
  '你是小说拆书分析师。只根据提供的代表章节分析写作方法，不复述完整剧情，不补写未提供的事实。' +
  '每个字段说明为什么有效、可以如何迁移到新作品；证据不足时明确写信息不足。' +
  '只输出 JSON 对象，不要 Markdown、代码块或额外解释。';
const REPORT_PATH = '.storyforge/analysis/book-breakdown.json';
const MARKDOWN_PATH = '.storyforge/analysis/book-breakdown.md';

/** 拆书输入、解析或持久化失败（消息原样给作者）。 */
export class BookBreakdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookBreakdownError';
  }
}

export class BookBreakdownCancelled extends BookBreakdownError {
  constructor() {
    super('结构化拆书已取消。');
    this.name = 'BookBreakdownCancelled';
  }
}

/** 进程内取消登记（Python 的 threading.Event 注册表）：拆书在检查点读取，取消命令置位。 */
export class BreakdownCancellations {
  private readonly tokens = new Map<string, { cancelled: boolean }>();
  prepare(analysisId: string) {
    const token = { cancelled: false };
    this.tokens.set(analysisId, token);
    return { isCancelled: () => token.cancelled };
  }
  request(analysisId: string): boolean {
    const token = this.tokens.get(analysisId);
    if (token === undefined) return false;
    token.cancelled = true;
    return true;
  }
  release(analysisId: string): void {
    this.tokens.delete(analysisId);
  }
}

export type BreakdownLlmPort = (request: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<{ content: unknown }>;

export type Chapter = {
  chapter_id: string;
  ordinal: number;
  title: string;
  source_path: string;
  start_line: number;
  end_line: number;
  content?: string;
  degraded_single_chapter: boolean;
  global_index?: number;
};
export type SelectedChapter = {
  chapter_id: string;
  global_index: number;
  title: string;
  source_path: string;
  reason: string;
};
type Source = { path: string; sha256: string; chars: number; chapter_count: number };
type AnalysisField = {
  status: string;
  summary: string;
  evidence_refs: string[];
  confidence: string;
};

const length = (text: string) => Array.from(text).length;
const normalizeText = (raw: string) => pythonStrip(raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));

/** PurePath.suffix（保留原大小写）。 */
function rawSuffix(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot) : '';
}

function parseOrdinal(value: string | undefined): number | null {
  if (!value) return null;
  if (/^[0-9]+$/.test(value)) return Number(value);
  const digits = new Map(
    Object.entries({
      零: 0,
      〇: 0,
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    }),
  );
  const digit = (text: string) => digits.get(text) ?? 0;
  if (digits.has(value)) return digits.get(value)!;
  if (value === '十') return 10;
  if (value.startsWith('十')) return 10 + digit(value.slice(1));
  if (value.endsWith('十')) return digit(value.slice(0, -1)) * 10;
  const ten = value.indexOf('十');
  if (ten >= 0) return digit(value.slice(0, ten)) * 10 + digit(value.slice(ten + 1));
  return null;
}

/** JSON 参考文本里取正文：优先常见正文键，否则逐键展开；标量按 Python str()。 */
function jsonText(value: JsonValue): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(jsonText).join('\n');
  if (isJsonObject(value)) {
    for (const key of JSON_CONTENT_KEYS)
      if (Object.prototype.hasOwnProperty.call(value, key)) return jsonText(value[key]);
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${jsonText(item)}`)
      .join('\n');
  }
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  return value instanceof JsonFloat ? pythonFloatRepr(value.value) : String(value);
}

/** Python 的 json.loads 还认 NaN / Infinity；含这类字面量的文件属于范围外而不是「解析不了」。 */
function hasPythonOnlyLiteral(text: string): boolean {
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (text.startsWith('NaN', i) || text.startsWith('Infinity', i)) return true;
  }
  return false;
}

const DECODER = new TextDecoder('utf-8', { ignoreBOM: true });

export async function readBreakdownSource(
  reader: ProjectReader,
  root: string,
  relative: string,
  platform: 'windows' | 'posix',
): Promise<string> {
  const name = relative.split('/').slice(-1)[0];
  let read: { bytes: Uint8Array; exceeded: boolean };
  try {
    read = await reader.readProjectBytes(root, relative, MAX_SOURCE_BYTES);
  } catch {
    throw new BookBreakdownError(
      rawSuffix(name).toLowerCase() === '.docx'
        ? `DOCX 无法读取：${name}`
        : `文件无法读取：${name}`,
    );
  }
  if (read.exceeded)
    throw new InputDomainError(
      `${relative}：超过 ${MAX_SOURCE_BYTES / 1024 / 1024} MiB，不在拆书输入范围内`,
    );
  const raw = read.bytes;
  const suffix = rawSuffix(name).toLowerCase();
  if (suffix === '.docx') {
    try {
      return normalizeText(await readDocxText(raw, relative, platform));
    } catch (error) {
      if (error instanceof DocxReadError) throw new BookBreakdownError(`${error.message}：${name}`);
      throw error;
    }
  }
  if (raw.subarray(0, 1024).includes(0))
    throw new BookBreakdownError(`文件不是可解析文本：${name}`);
  let text = DECODER.decode(raw);
  if (suffix === '.json') {
    try {
      JSON.parse(text);
    } catch {
      if (hasPythonOnlyLiteral(text))
        throw new InputDomainError(`${relative}：含 NaN / Infinity，不在拆书输入范围内`);
      throw new BookBreakdownError(`JSON 无法解析：${name}`);
    }
    text = jsonText(parseJson(text, relative));
  }
  return normalizeText(text);
}

/** PurePath(source_path).stem。 */
function stemOf(path: string): string {
  const name = path.split('/').slice(-1)[0];
  const suffix = rawSuffix(name);
  return suffix ? name.slice(0, -suffix.length) : name;
}

/** 按常见中英文章节标题拆分；没有标题时明确退化为单章。 */
export function parseChapters(text: string, sourcePath: string): Chapter[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const lines = normalized.split('\n');
  const headings: [number, string, number | null][] = [];
  lines.forEach((line, index) => {
    const match = CHAPTER_RE.exec(line);
    if (!match) return;
    const title = pythonStrip(pythonStrip(line).replace(/^#+/, ''));
    headings.push([index, title, parseOrdinal(match[1] ?? match[2])]);
  });
  if (!headings.length)
    return [
      {
        chapter_id: `${sourcePath}:1`,
        ordinal: 1,
        title: stemOf(sourcePath) || '全文',
        source_path: sourcePath,
        start_line: 1,
        end_line: lines.length,
        content: normalized,
        degraded_single_chapter: true,
      },
    ];
  const chapters: Chapter[] = [];
  headings.forEach(([start, title, explicit], position) => {
    const end = position + 1 < headings.length ? headings[position + 1][0] : lines.length;
    const body = pythonStrip(lines.slice(start + 1, end).join('\n'));
    if (!body) return;
    chapters.push({
      chapter_id: `${sourcePath}:${position + 1}`,
      ordinal: explicit || position + 1,
      title,
      source_path: sourcePath,
      start_line: start + 1,
      end_line: end,
      content: body,
      degraded_single_chapter: false,
    });
  });
  return chapters;
}

export async function loadProjectChapters(
  reader: ProjectReader,
  root: string,
  platform: 'windows' | 'posix',
): Promise<[Chapter[], Source[]]> {
  await resolveProjectRoot(reader, root);
  const chapters: Chapter[] = [];
  const sources: Source[] = [];
  for (const relative of await iterProjectFiles(reader, root)) {
    if (!SUPPORTED_EXTENSIONS.has(rawSuffix(relative.split('/').slice(-1)[0]).toLowerCase()))
      continue;
    let text: string;
    try {
      text = await readBreakdownSource(reader, root, relative, platform);
    } catch (error) {
      if (error instanceof BookBreakdownError) continue;
      throw error;
    }
    const parsed = parseChapters(text, relative);
    if (!parsed.length) continue;
    sources.push({
      path: relative,
      sha256: sha256Hex(text),
      chars: length(text),
      chapter_count: parsed.length,
    });
    chapters.push(...parsed);
  }
  if (!chapters.length)
    throw new BookBreakdownError('项目内没有可解析的 TXT、Markdown、JSON 或 DOCX 正文。');
  chapters.sort(
    (a, b) =>
      compareCodePoints(a.source_path, b.source_path) ||
      a.start_line - b.start_line ||
      compareCodePoints(a.chapter_id, b.chapter_id),
  );
  chapters.forEach((chapter, index) => {
    chapter.global_index = index + 1;
    delete chapter.content;
  });
  return [chapters, sources];
}

async function chapterContent(
  reader: ProjectReader,
  root: string,
  chapter: { chapter_id: unknown; source_path: unknown },
  platform: 'windows' | 'posix',
): Promise<string> {
  const source = String(chapter.source_path);
  const parsed = parseChapters(await readBreakdownSource(reader, root, source, platform), source);
  return parsed.find((item) => item.chapter_id === chapter.chapter_id)?.content ?? '';
}

/** Python round()：恰好一半时取偶数。 */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

export function selectRepresentativeChapters(
  chapters: readonly Chapter[],
  targetCount = 8,
): SelectedChapter[] {
  if (!chapters.length) return [];
  const last = chapters.length - 1;
  const target = Math.max(3, Math.min(targetCount, 12, chapters.length));
  const positions = new Set([0, Math.min(1, last), Math.min(2, last), last]);
  for (const fraction of [0.25, 0.5, 0.75]) positions.add(roundHalfEven(last * fraction));
  const selected: SelectedChapter[] = [];
  for (const position of [...positions].sort((a, b) => a - b)) {
    if (selected.length >= target) break;
    const chapter = chapters[position];
    const reason =
      position <= 2
        ? '结构锚点：开篇'
        : position === last
          ? '结构锚点：结尾'
          : '结构锚点：全书位置';
    selected.push({
      chapter_id: chapter.chapter_id,
      global_index: chapter.global_index!,
      title: chapter.title,
      source_path: chapter.source_path,
      reason,
    });
  }
  return selected;
}

function pendingAnalysis(selected: readonly SelectedChapter[]): Record<string, AnalysisField> {
  const refs = selected.map((item) => item.chapter_id);
  const summary = '已生成代表章节索引；在线模型分析尚未运行，需在后续阶段补充。';
  return Object.fromEntries(
    ANALYSIS_KEYS.map((key) => [
      key,
      { status: 'pending', summary, evidence_refs: refs, confidence: 'unavailable' },
    ]),
  );
}

const sourcesHash = (sources: readonly Source[]) =>
  sha256Hex(dumpJson(sources, { ensureAscii: false, sortKeys: true }));

/** 报告 Markdown；报告由本模块生成，字段类型固定。 */
export function renderBreakdownMarkdown(report: { [key: string]: unknown }): string {
  const selected = (report.selected_chapters ?? []) as { [key: string]: unknown }[];
  const lines = [
    '# 结构化拆书报告',
    '',
    `- 状态：${report.status ?? 'unknown'}`,
    `- 输入指纹：\`${report.input_sha256 ?? ''}\``,
    `- 章节：${report.chapter_count ?? 0}，代表章：${selected.length}`,
    '',
    '## 代表章节',
    '',
  ];
  for (const item of selected)
    lines.push(
      `- 第${item.global_index ?? '?'}章 ${item.title ?? '未命名'}：${item.reason ?? '结构锚点'}`,
    );
  lines.push('', '## 分析字段', '');
  for (const [key, value] of Object.entries(
    (report.analysis ?? {}) as Record<string, AnalysisField>,
  ))
    lines.push(`### ${key}`, '', String(value.summary ?? '待补充。'), '');
  if (report.notice) lines.push('## 说明', '', String(report.notice), '');
  return lines.join('\n');
}

function stripJsonFence(raw: string): string {
  let text = pythonStrip(raw);
  if (text.startsWith('```')) {
    let lines = pythonSplitlines(text);
    if (lines.length && lines[0].startsWith('```')) lines = lines.slice(1);
    if (lines.length && pythonStrip(lines[lines.length - 1]).startsWith('```'))
      lines = lines.slice(0, -1);
    text = pythonStrip(lines.join('\n'));
  }
  return text;
}

export function parseModelAnalysis(
  raw: unknown,
  selected: readonly SelectedChapter[],
): Record<string, AnalysisField> {
  if (typeof raw !== 'string' || !pythonStrip(raw))
    throw new BookBreakdownError('模型分析返回为空。');
  const text = stripJsonFence(raw);
  let parsed: JsonValue;
  try {
    parsed = parseJson(text, 'model output');
  } catch (error) {
    if (!(error instanceof InputDomainError)) throw error;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new BookBreakdownError('模型分析不是有效 JSON。');
    parsed = parseJson(text.slice(start, end + 1), 'model output');
  }
  if (!isJsonObject(parsed)) throw new BookBreakdownError('模型分析顶层必须是 JSON 对象。');
  const refs = selected.map((item) => item.chapter_id);
  const result: Record<string, AnalysisField> = {};
  for (const key of ANALYSIS_KEYS) {
    const value = Object.prototype.hasOwnProperty.call(parsed, key) ? parsed[key] : undefined;
    let summary: JsonValue | undefined;
    let evidence: JsonValue | undefined;
    if (isJsonObject(value)) {
      summary = [value.summary, value.analysis, value['内容']].find(pythonTruthy) ?? value['内容'];
      evidence = value.evidence_refs;
    } else summary = value;
    if (typeof summary !== 'string' || !pythonStrip(summary)) {
      result[key] = {
        status: 'pending',
        summary: '模型未提供该字段，待补充。',
        evidence_refs: refs,
        confidence: 'unavailable',
      };
      continue;
    }
    const collapsed = summary
      .split(new RegExp(`${PYTHON_WHITESPACE}+`, 'u'))
      .filter(Boolean)
      .join(' ');
    result[key] = {
      status: 'completed',
      summary: Array.from(collapsed).slice(0, 1600).join(''),
      evidence_refs: Array.isArray(evidence)
        ? evidence.filter((item): item is string => typeof item === 'string').slice(0, 20)
        : refs,
      confidence: 'model',
    };
  }
  return result;
}

/** 组装带来源标签的有限上下文（只含代表章）。 */
export async function selectedContext(
  reader: ProjectReader,
  root: string,
  report: { selected_chapters?: unknown },
  options: { platform: 'windows' | 'posix'; maxChars?: number },
): Promise<string> {
  await resolveProjectRoot(reader, root);
  const maxChars = options.maxChars ?? 120_000;
  const chunks: string[] = [];
  let used = 0;
  for (const item of (report.selected_chapters ?? []) as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const chapter = item as { [key: string]: unknown };
    const content = await chapterContent(
      reader,
      root,
      { chapter_id: chapter.chapter_id, source_path: chapter.source_path },
      options.platform,
    );
    if (!content) continue;
    const block = `### ${chapter.title ?? '未命名'} [${chapter.reason ?? '结构锚点'}]\n${content}\n`;
    // 放不进预算的章跳过，后面短的章照样带上。
    if (used + length(block) > maxChars) continue;
    chunks.push(block);
    used += length(block);
  }
  return chunks.join('\n---\n');
}

export type BreakdownModel = {
  provider: string | null;
  model: string | null;
  callLlm: BreakdownLlmPort;
};

async function modelAnalysis(
  reader: ProjectReader,
  root: string,
  selected: readonly SelectedChapter[],
  model: BreakdownModel,
  platform: 'windows' | 'posix',
  checkpoint: () => void,
): Promise<
  [
    Record<string, AnalysisField>,
    { provider: string | null; model: string | null; retries: number },
  ]
> {
  const context = await selectedContext(
    reader,
    root,
    { selected_chapters: selected },
    { platform },
  );
  // 一章都放不进预算：模型什么都读不到，不发请求，报告也不能写成分析完成。
  if (!context) throw new BookBreakdownError('selected_context_empty');
  const userPrompt =
    '请分析以下代表章节。输出字段必须包含：' +
    ANALYSIS_KEYS.join(', ') +
    '。每个字段可以是字符串，也可以是 {summary, evidence_refs} 对象。\n\n' +
    context;
  const meta = (retries: number) => ({ provider: model.provider, model: model.model, retries });
  try {
    const response = await model.callLlm({ systemPrompt: BREAKDOWN_SYSTEM_PROMPT, userPrompt });
    return [parseModelAnalysis(response.content, selected), meta(0)];
  } catch {
    checkpoint();
    try {
      const response = await model.callLlm({
        systemPrompt: BREAKDOWN_SYSTEM_PROMPT,
        userPrompt: userPrompt + '\n\n再次强调：只输出完整 JSON 对象，缺失字段也必须输出空字符串。',
      });
      return [parseModelAnalysis(response.content, selected), meta(1)];
    } catch {
      throw new BookBreakdownError('structured_analysis_failed');
    }
  }
}

const REPORT_FILES = [
  REPORT_PATH,
  '.storyforge/analysis/chapters.json',
  '.storyforge/analysis/selection.json',
  MARKDOWN_PATH,
];

async function persistReport(
  writer: ProjectWriter,
  root: string,
  report: { [key: string]: unknown },
  sources: readonly Source[],
  chapters: readonly Chapter[],
  selected: readonly SelectedChapter[],
  platform: 'windows' | 'posix',
) {
  const inputHash = String(report.input_sha256 || '');
  const write = (path: string, text: string) =>
    writer.writeProjectFile(root, path, platformTextBytes(text, platform));
  const json = (value: unknown) => dumpJson(value, { indent: 2, ensureAscii: false });
  await write(REPORT_FILES[0], json(report));
  await write(
    REPORT_FILES[1],
    json({ schema_version: ANALYSIS_SCHEMA_VERSION, input_sha256: inputHash, sources, chapters }),
  );
  await write(
    REPORT_FILES[2],
    json({ strategy_version: SELECTION_STRATEGY_VERSION, input_sha256: inputHash, selected }),
  );
  await write(REPORT_FILES[3], renderBreakdownMarkdown(report));
  return { ...report, paths: [...REPORT_FILES] };
}

/** 结构化拆书：确定性章节索引与代表章选择；配置了模型时再对代表章做一次结构化分析。 */
export async function runBookBreakdown(
  reader: ProjectReader,
  writer: ProjectWriter,
  root: string,
  options: {
    platform: 'windows' | 'posix';
    targetCount?: number;
    model: BreakdownModel | null;
    analysisId?: string | null;
    cancellation?: { isCancelled(): boolean } | null;
    cancellations: BreakdownCancellations;
    newAnalysisId: () => string;
  },
) {
  await resolveProjectRoot(reader, root);
  const { platform } = options;
  const targetCount = options.targetCount ?? 8;
  const analysisId = options.analysisId || options.newAnalysisId();
  const cancellation = options.cancellation ?? options.cancellations.prepare(analysisId);
  const checkpoint = () => {
    if (cancellation.isCancelled()) throw new BookBreakdownCancelled();
  };
  let chapters: Chapter[] = [];
  let sources: Source[] = [];
  let selected: SelectedChapter[] = [];
  const limits = { target_count: targetCount, model_context: 'selected_chapters_only' };
  try {
    try {
      checkpoint();
      [chapters, sources] = await loadProjectChapters(reader, root, platform);
      checkpoint();
      selected = selectRepresentativeChapters(chapters, targetCount);
      checkpoint();
      const inputHash = sourcesHash(sources);
      let analysis = pendingAnalysis(selected);
      let meta: { provider: string | null; model: string | null; retries: number } = {
        provider: null,
        model: null,
        retries: 0,
      };
      let modelError: string | null = null;
      if (options.model !== null)
        try {
          [analysis, meta] = await modelAnalysis(
            reader,
            root,
            selected,
            options.model,
            platform,
            checkpoint,
          );
        } catch (error) {
          if (!(error instanceof BookBreakdownError)) throw error;
          modelError = error.message;
        }
      checkpoint();
      const report: { [key: string]: unknown } = {
        analysis_id: analysisId,
        status:
          options.model !== null && modelError === null ? 'completed' : 'completed_deterministic',
        schema_version: ANALYSIS_SCHEMA_VERSION,
        selection_strategy_version: SELECTION_STRATEGY_VERSION,
        input_sha256: inputHash,
        source_count: sources.length,
        chapter_count: chapters.length,
        selected_chapters: selected,
        analysis,
        model: meta.model,
        provider: meta.provider,
        retries: meta.retries,
        limits,
        notice: '分析结果只基于选定章节，不能替代人工通读。',
      };
      if (modelError) report.model_error = modelError;
      return await persistReport(writer, root, report, sources, chapters, selected, platform);
    } catch (error) {
      if (!(error instanceof BookBreakdownCancelled)) throw error;
      const report = {
        analysis_id: analysisId,
        status: 'cancelled',
        schema_version: ANALYSIS_SCHEMA_VERSION,
        selection_strategy_version: SELECTION_STRATEGY_VERSION,
        input_sha256: sourcesHash(sources),
        source_count: sources.length,
        chapter_count: chapters.length,
        selected_chapters: selected,
        analysis: pendingAnalysis(selected),
        model: null,
        provider: null,
        retries: 0,
        limits,
        notice: '本次拆书已取消，报告只包含取消前已生成的确定性底稿。',
      };
      return await persistReport(writer, root, report, sources, chapters, selected, platform);
    }
  } finally {
    options.cancellations.release(analysisId);
  }
}

/** 读取已有报告并用当前可解析来源重新计算指纹，显式报告是否过期。 */
export async function readBookBreakdownStatus(
  reader: ProjectReader,
  root: string,
  platform: 'windows' | 'posix',
) {
  await resolveProjectRoot(reader, root);
  if ((await reader.inspectProjectPath(root, REPORT_PATH)).targetKind !== 'file')
    return { status: 'missing', stale: false, report_path: REPORT_PATH };
  let report: JsonValue;
  try {
    const read = await reader.readProjectBytes(root, REPORT_PATH, MAX_REPORT_BYTES);
    if (read.exceeded) throw new InputDomainError('report too large');
    report = parseJsonBytes(read.bytes, REPORT_PATH);
  } catch {
    throw new BookBreakdownError('已有拆书报告无法解析。');
  }
  if (!isJsonObject(report)) throw new BookBreakdownError('已有拆书报告顶层必须是 JSON 对象。');
  // 报告由本模块写出：status / analysis_id 是字符串或缺省，其余形态视为报告损坏。
  const { status, analysis_id: analysisId, input_sha256: recorded } = report;
  if ([status, analysisId, recorded].some((value) => value != null && typeof value !== 'string'))
    throw new BookBreakdownError('已有拆书报告无法解析。');
  const [, sources] = await loadProjectChapters(reader, root, platform);
  const current = sourcesHash(sources);
  const stale = typeof recorded !== 'string' || recorded !== current;
  return {
    status: stale ? 'stale' : status || 'fresh',
    stale,
    input_sha256: recorded ?? null,
    current_input_sha256: current,
    analysis_id: analysisId ?? null,
    report_path: REPORT_PATH,
    markdown_path: MARKDOWN_PATH,
  };
}
