import { semanticJudgeWithStatus, type SemanticJudgeCall } from '../../judge/semantic';
import {
  FsToolError,
  iterProjectFiles,
  readBoundedText,
  resolveProjectRoot,
  resolveScopedPath,
} from '../../kernel/fsTools';
import { codePoints, cpSlice, pythonStrip } from '../../kernel/pythonText';
import type { LlmSource } from '../../llm/config';
import type { ProjectReader } from '../../readPort';
import type { ToolHandler } from './execution';
import type { ToolDeps } from './handlerDeps';
import { requiredString } from './runtimeArguments';

type Obj = { [key: string]: unknown };

// 人物目录喂「角色声音约束」槽位，其余设定文件喂「必含事实」槽位，对齐 judge 提示的类别触发条件。
const CHARACTER_DIR = '人物';
const DEFAULT_BIBLE_DIRS = new Set(['人物', '设定']);
const MAX_BIBLE_FILES = 12;
const BIBLE_FILE_CHAR_BUDGET = 2_000;
const BIBLE_TOTAL_CHAR_BUDGET = 12_000;
const CONTENT_CHAR_BUDGET = 24_000;
const MAX_FACTS = 40;
const MAX_FILE_BYTES = 512_000;
const REQUIRED_FACTS_MAX_LENGTH = 100;

type BibleEntry = {
  name: string;
  path: string;
  excerpt: string;
  chars: number;
  truncated: boolean;
};

const lineOf = (content: string[], span: number) =>
  content.slice(0, Math.max(0, Math.min(span, content.length))).filter((char) => char === '\n')
    .length + 1;

function cleanFacts(facts: readonly string[] | null): [string[], boolean] {
  if (!facts || !facts.length) return [[], false];
  const cleaned: string[] = [];
  for (const fact of facts) {
    if (typeof fact !== 'string') continue;
    const stripped = pythonStrip(fact);
    if (stripped && !cleaned.includes(stripped)) cleaned.push(stripped);
  }
  return [cleaned.slice(0, MAX_FACTS), cleaned.length > MAX_FACTS];
}

const stem = (path: string) => {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(0, dot) : name;
};

/** Character Bible 摘录：显式路径优先，否则扫默认的 人物/ 设定/ 目录。 */
async function collectBibleFiles(
  reader: ProjectReader,
  root: string,
  platform: 'windows' | 'posix',
  biblePaths: readonly string[] | null,
  exclude: string,
): Promise<[BibleEntry[], boolean]> {
  const candidates: string[] = [];
  let truncated = false;
  if (biblePaths && biblePaths.length) {
    for (const raw of biblePaths) {
      if (typeof raw !== 'string' || !pythonStrip(raw)) continue;
      const resolved = await resolveScopedPath(reader, root, pythonStrip(raw));
      if ((await reader.inspectProjectPath(root, resolved)).targetKind !== 'file')
        throw new FsToolError(`不是文件：${pythonStrip(raw)}`);
      candidates.push(resolved);
    }
  } else {
    // Path.match('*.md') 只看最后一段；Windows 上不分大小写。
    const isMarkdown = (path: string) =>
      (platform === 'windows' ? path.toLowerCase() : path).endsWith('.md');
    for (const candidate of await iterProjectFiles(reader, root))
      if (DEFAULT_BIBLE_DIRS.has(candidate.split('/')[0]) && isMarkdown(candidate))
        candidates.push(candidate);
  }
  const entries: BibleEntry[] = [];
  let totalChars = 0;
  for (const candidate of candidates) {
    if (candidate === exclude) continue;
    if (entries.length >= MAX_BIBLE_FILES || totalChars >= BIBLE_TOTAL_CHAR_BUDGET) {
      truncated = true;
      break;
    }
    let text: string;
    try {
      text = (await readBoundedText(reader, root, candidate, MAX_FILE_BYTES)).content;
    } catch (error) {
      if (!(error instanceof FsToolError) || (biblePaths && biblePaths.length)) throw error;
      continue;
    }
    const budget = Math.min(BIBLE_FILE_CHAR_BUDGET, BIBLE_TOTAL_CHAR_BUDGET - totalChars);
    const excerpt = cpSlice(text, budget);
    const chars = codePoints(excerpt).length;
    entries.push({
      name: stem(candidate),
      path: candidate,
      excerpt,
      chars,
      truncated: codePoints(text).length > budget,
    });
    totalChars += chars;
  }
  return [entries, truncated];
}

/** 对单个稿件做语义一致性评审，产出 advisory issue 信号；未配置或远程失败显式报错（deep_consistency）。 */
export async function deepConsistencyReview(
  reader: ProjectReader,
  platform: 'windows' | 'posix',
  root: string,
  path: string,
  options: {
    biblePaths?: readonly string[] | null;
    facts?: readonly string[] | null;
    source: LlmSource;
    call: SemanticJudgeCall;
  },
): Promise<Obj> {
  await resolveProjectRoot(reader, root);
  const target = await resolveScopedPath(reader, root, path);
  if ((await reader.inspectProjectPath(root, target)).targetKind !== 'file')
    throw new FsToolError(`不是文件：${path}`);
  const rawContent = (await readBoundedText(reader, root, target, MAX_FILE_BYTES)).content;
  if (!pythonStrip(rawContent)) throw new FsToolError(`文件没有可评审的内容：${path}`);
  const content = cpSlice(rawContent, CONTENT_CHAR_BUDGET);
  const contentTruncated = codePoints(rawContent).length > CONTENT_CHAR_BUDGET;
  const [bibleFiles, bibleTruncated] = await collectBibleFiles(
    reader,
    root,
    platform,
    options.biblePaths ?? null,
    target,
  );
  const [requiredFacts, factsTruncated] = cleanFacts(options.facts ?? null);
  const voiceConstraints: Obj[] = [];
  for (const entry of bibleFiles) {
    if (entry.path.split('/')[0] === CHARACTER_DIR)
      voiceConstraints.push({ name: entry.name, path: entry.path, notes: entry.excerpt });
    else if (requiredFacts.length < REQUIRED_FACTS_MAX_LENGTH)
      requiredFacts.push(`《${entry.path}》设定：${entry.excerpt}`);
  }
  const outcome = await semanticJudgeWithStatus(
    {
      content,
      required_facts: requiredFacts,
      style_rules: [],
      evidence_links: bibleFiles
        .slice(0, 50)
        .map((entry) => ({ source: 'project_file', path: entry.path })),
    },
    {
      source: options.source,
      call: options.call,
      characterVoiceConstraints: voiceConstraints.length ? voiceConstraints : null,
    },
  );
  if (!outcome.configured)
    throw new FsToolError(
      '语义评审未配置 LLM（缺 API key）：请先在设置里配置模型服务，再做深度一致性检查。',
    );
  if (outcome.failed)
    throw new FsToolError(
      '语义评审模型调用失败（网络 / 超时 / 响应异常），本轮没有产出结论；可稍后重试。',
    );
  const chars = codePoints(content);
  const issues = outcome.issues.map((issue) => ({
    category: issue.category,
    severity: issue.severity,
    line_start: lineOf(chars, issue.span_start),
    line_end: lineOf(chars, issue.span_end),
    span_start: issue.span_start,
    span_end: issue.span_end,
    summary: issue.summary,
    matched_text: issue.matched_text,
    expected_text: issue.expected_text,
    replacement_text: issue.replacement_text,
  }));
  return {
    path: target,
    content_chars: chars.length,
    content_truncated: contentTruncated,
    bible_files: bibleFiles.map((entry) => ({
      path: entry.path,
      chars: entry.chars,
      truncated: entry.truncated,
    })),
    bible_truncated: bibleTruncated,
    fact_count: requiredFacts.length,
    facts_truncated: factsTruncated,
    issue_count: issues.length,
    issues,
    note: '语义评审是参考信号：回给作者前请抽读对应行核实；修改仍需走待确认修订流程。',
  };
}

const textItems = (value: unknown): string[] | null =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(pythonStrip(item)))
    : null;

/** project.deep_consistency：语义 judge 走本次 run 的主模型，并挂在 judge.semantic 操作下记证据。 */
export function deepConsistencyToolHandlers(deps: ToolDeps): Record<string, ToolHandler> {
  const deepConsistency: ToolHandler = async (context, payload) => {
    const root = requiredString(payload, 'project_root');
    const path = requiredString(payload, 'path');
    const biblePaths = textItems(payload.bible_paths);
    const facts = textItems(payload.facts);
    const model = context.services.model;
    const output = await deepConsistencyReview(deps.reader, deps.platform, root, path, {
      biblePaths: biblePaths && biblePaths.length ? biblePaths : null,
      facts,
      source: model.source,
      call: (source, options) => model.call('judge.semantic', source, options),
    });
    return {
      status: 'completed',
      output,
      artifacts: [],
      trace: {
        tool_name: 'project.deep_consistency',
        status: 'completed',
        input_summary: {
          path,
          bible_paths: (biblePaths ?? []).slice(0, 10),
          fact_count: (facts ?? []).length,
        },
        output_summary: {
          path: output.path,
          issue_count: output.issue_count,
          bible_file_count: (output.bible_files as unknown[]).length,
        },
      },
    };
  };
  return { 'project.deep_consistency': deepConsistency };
}
