import type { ProjectReader } from '../readPort';
import { FsToolError, normalizeProjectRelativePath } from './fsTools';
import { normcase } from './generationSources';
import { dumpJson, pythonTruthy } from './json';
import {
  collectProjectKnowledgeContext,
  mergeProjectKnowledgeEntries,
  type CollectedProjectKnowledge,
} from './knowledgeContext';
import {
  CONTEXT_FILE_TEXT_LIMIT,
  UNSAFE_CONTEXT_KEYS,
  looksLikeHarnessPayload,
  sourceDeliveryManifest,
  type ContextFileRequest,
} from './ordinaryContext';
import {
  CHAPTER_CONTEXT_KEYS,
  CHAPTER_TEXT_LIMIT,
  MAX_CONTEXT_FILES,
  MAX_REVIEW_ISSUES,
  MAX_STORY_MEMORY_ITEMS,
  MEMORY_TEXT_LIMIT,
  REVIEW_TEXT_LIMIT,
  SELECTED_FILE_TEXT_LIMIT,
  SNAPSHOT_VERSION,
  artifactKind,
  artifactPayload,
  cpLen,
  firstString,
  get,
  hasKey,
  isObj,
  pythonStrValue,
  storyMemoryCount,
  type Obj,
} from './contextValues';
import { syntheticContextDelivery } from './llmPromptContext';
import { compactText, pythonStrip } from './pythonText';
import {
  redactSensitive,
  redactSensitiveText,
  type PlainJson,
  type SecretContext,
} from './redaction';
import { sha256Hex } from './sha256';

type Platform = 'windows' | 'posix';
type Options = { platform: Platform; secrets: SecretContext };

const UNSAFE_FILE_KINDS = new Set([
  'artifact',
  'debug',
  'event',
  'export',
  'patch',
  'permission',
  'quality',
]);

function safeContextValue(value: PlainJson | undefined): PlainJson | undefined {
  if (typeof value === 'string') return compactText(value, CHAPTER_TEXT_LIMIT);
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value))
    return value
      .slice(0, 12)
      .map(safeContextValue)
      .filter((item): item is PlainJson => item !== undefined);
  return undefined;
}

function normalizeSelectedPath(path: string): string {
  return pythonStrip(path.replace(/\\/g, '/'))
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

function matchesSelectedFile(path: string | null, selectedRefs: readonly string[]): boolean {
  if (path === null) return false;
  const normalized = normalizeSelectedPath(path);
  if (!normalized) return false;
  for (const selected of selectedRefs) {
    const selectedNormalized = normalizeSelectedPath(selected);
    if (!selectedNormalized) continue;
    if (normalized === selectedNormalized) return true;
    if (
      selectedNormalized.endsWith(`/${normalized}`) ||
      normalized.endsWith(`/${selectedNormalized}`)
    )
      return true;
  }
  return false;
}

function normalizedRelativeContextPath(path: string | null): string | null {
  if (path === null) return null;
  const normalized = pythonStrip(path.replace(/\\/g, '/'));
  const points = Array.from(normalized);
  if (!normalized || normalized.startsWith('/') || (points.length > 1 && points[1] === ':'))
    return null;
  const parts: string[] = [];
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') return null;
    parts.push(part);
  }
  return parts.join('/') || null;
}

function orderedUnique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function stringList(values: readonly PlainJson[] | null | undefined): string[] {
  if (values === null || values === undefined) return [];
  return orderedUnique(
    values
      .filter((value): value is string => typeof value === 'string' && Boolean(pythonStrip(value)))
      .map(pythonStrip),
  );
}

function stringOrDefault(value: PlainJson | undefined, fallback: string): string {
  return typeof value === 'string' && pythonStrip(value) ? pythonStrip(value) : fallback;
}

// ---- context_channel_requests：有损选择前的请求记账，只记哈希不记正文 ----

export function reviewChannelSource(
  report: PlainJson | undefined,
  artifacts: readonly PlainJson[] | null,
): Obj | null {
  if (isObj(report)) return report;
  for (const artifact of artifacts ?? []) {
    if (artifactKind(artifact) !== 'review_report') continue;
    const payload = artifactPayload(artifact);
    if (payload !== null) return payload;
  }
  return null;
}

function digest(value: PlainJson): string {
  return sha256Hex(dumpJson(value, { ensureAscii: false, sortKeys: true, separators: [',', ':'] }));
}

function clipped(value: PlainJson | undefined, secrets: SecretContext): boolean {
  if (typeof value === 'string')
    return cpLen(redactSensitiveText(pythonStrip(value), secrets)) > CHAPTER_TEXT_LIMIT;
  if (Array.isArray(value))
    return value.length > 12 || value.slice(0, 12).some((item) => clipped(item, secrets));
  return false;
}

function memoryChannel(bundle: Obj): PlainJson | undefined {
  const key = ['story_memory', 'storyMemory', 'memory', 'memories'].find((k) => hasKey(bundle, k));
  return key === undefined ? undefined : bundle[key];
}

function chapterChannel(bundle: Obj): Obj | null {
  for (const key of [
    'chapter_context',
    'chapterContext',
    'chapter',
    'scene_packet',
    'scenePacket',
  ]) {
    const value = get(bundle, key);
    if (isObj(value)) return value;
  }
  return null;
}

export function contextChannelRequests(
  bundle: Obj | null,
  report: Obj | null,
  secrets: SecretContext,
): Obj {
  const source = bundle ?? {};
  const result: Obj = {};
  const memory = memoryChannel(source);
  let items: PlainJson[] | null = Array.isArray(memory) ? memory : null;
  if (isObj(memory)) {
    const key = ['items', 'atoms', 'memories'].find((k) => Array.isArray(get(memory, k)));
    items = key === undefined ? null : (memory[key] as PlainJson[]);
  }
  if (items !== null) {
    result.story_memory = {
      requested_count: items.length,
      supplied_value_sha256: digest(items),
      selection_truncated: items.some(
        (item) =>
          isObj(item) &&
          cpLen(
            redactSensitiveText(
              firstString(item, 'fact', 'content', 'text', 'summary') ?? '',
              secrets,
            ),
          ) > MEMORY_TEXT_LIMIT,
      ),
      selection_omission_reasons: items.length > MAX_STORY_MEMORY_ITEMS ? ['item_budget'] : [],
    };
  }
  const chapter = chapterChannel(source);
  if (chapter !== null) {
    const supplied: Obj = {};
    for (const key of CHAPTER_CONTEXT_KEYS) if (hasKey(chapter, key)) supplied[key] = chapter[key];
    result.chapter_context = {
      requested_count: Object.keys(supplied).length,
      supplied_value_sha256: digest(supplied),
      selection_truncated: Object.values(supplied).some((value) => clipped(value, secrets)),
    };
  }
  if (report !== null) {
    const issues = get(report, 'issues');
    const actions = get(report, 'suggested_actions');
    const long = (text: string) => cpLen(redactSensitiveText(text, secrets)) > REVIEW_TEXT_LIMIT;
    result.review_report = {
      requested_count: Array.isArray(issues) ? issues.length : 0,
      requested_action_count: Array.isArray(actions) ? actions.length : 0,
      supplied_value_sha256: digest(report),
      selection_truncated:
        (Array.isArray(issues) ? issues : []).some(
          (item) =>
            isObj(item) &&
            ['message', 'evidence', 'suggested_action'].some((key) => {
              const value = get(item, key);
              return long(pythonStrip(pythonTruthy(value) ? pythonStrValue(value) : ''));
            }),
        ) ||
        (Array.isArray(actions) ? actions : []).some(
          (item) => typeof item === 'string' && long(pythonStrip(item)),
        ),
    };
  }
  return result;
}

// ---- context_provenance ----

export function llmContextSnapshotTraceSummary(snapshot: Obj): Obj {
  const contextFiles = get(snapshot, 'context_files');
  const items = Array.isArray(contextFiles) ? contextFiles : [];
  const chapterContext = get(snapshot, 'chapter_context');
  const reviewReport = get(snapshot, 'review_report');
  const includedSections = get(snapshot, 'included_sections');
  const warnings = get(snapshot, 'warnings');
  const selectedFile = get(snapshot, 'selected_file');
  const pick = (item: Obj, key: string) => get(item, key) ?? null;
  return {
    snapshot_id: get(snapshot, 'snapshot_id') ?? null,
    source_manifest: pythonTruthy(get(snapshot, 'source_manifest'))
      ? get(snapshot, 'source_manifest')!
      : [],
    selected_content_sha256: isObj(selectedFile) ? pick(selectedFile, 'content_sha256') : null,
    section_count: Array.isArray(includedSections) ? includedSections.length : 0,
    context_file_count: items.length,
    context_files: items
      .filter(isObj)
      .map((item) => firstString(item, 'relative_path'))
      .filter((path): path is string => path !== null),
    knowledge_entries: items
      .filter((item): item is Obj => isObj(item) && typeof get(item, 'knowledge_id') === 'string')
      .map((item) => ({
        knowledge_id: pick(item, 'knowledge_id'),
        relative_path: pick(item, 'relative_path'),
        selection_source: pick(item, 'selection_source'),
        evidence_state: pick(item, 'evidence_state'),
        warning_count: get(item, 'warning_count') ?? 0,
      })),
    story_memory_count: storyMemoryCount(get(snapshot, 'story_memory')),
    has_chapter_context: pythonTruthy(chapterContext),
    has_review_report: isObj(reviewReport) && pythonTruthy(reviewReport),
    warning_count: Array.isArray(warnings) ? warnings.length : 0,
  };
}

function withSnapshotId(snapshot: Obj): Obj {
  const encoded = dumpJson(snapshot, {
    ensureAscii: false,
    sortKeys: true,
    separators: [',', ':'],
  });
  return { ...snapshot, snapshot_id: `llmctx-${sha256Hex(encoded).slice(0, 16)}` };
}

export type RunState = {
  public_id?: PlainJson;
  run_id?: PlainJson;
  goal?: PlainJson;
  status?: PlainJson;
  current_step?: PlainJson;
};

function snapshotRunState(runState: RunState | null): Obj {
  if (runState === null) return {};
  const publicId = pythonTruthy(runState.public_id ?? null)
    ? runState.public_id
    : (runState.run_id ?? null);
  const result: Obj = {};
  const stripped = (value: PlainJson | undefined) =>
    typeof value === 'string' && pythonStrip(value) ? pythonStrip(value) : null;
  if (stripped(publicId) !== null) result.run_id = stripped(publicId);
  if (stripped(runState.goal) !== null) result.goal = compactText(runState.goal, 2000);
  if (stripped(runState.status) !== null) result.status = stripped(runState.status);
  if (stripped(runState.current_step) !== null)
    result.current_step = stripped(runState.current_step);
  return result;
}

// ---- llm_context：live 入口与确定性组装 ----

export type SnapshotInput = {
  intent: string;
  userMessage: string;
  filePath: string;
  content: string;
  contextBundle?: PlainJson;
  roleHints?: readonly PlainJson[] | null;
  roleMentions?: readonly PlainJson[] | null;
  reviewReport?: PlainJson;
  artifacts?: readonly PlainJson[] | null;
  eventHistory?: readonly PlainJson[] | null;
  extraContextFiles?: readonly PlainJson[] | null;
};

function contextFiles(
  bundle: Obj | null,
  filePath: string,
  maxFiles: number,
  secrets: SecretContext,
): [Obj[], string[], number] {
  if (bundle === null) return [[], [], 0];
  const files = get(bundle, 'files');
  if (files === undefined || files === null) return [[], [], 0];
  if (!Array.isArray(files))
    return [[], ['context_bundle.files ignored because it was not a list'], 0];
  const currentFile = firstString(bundle, 'current_file', 'currentFile');
  const selectedRefs = [filePath, currentFile ?? ''];
  const result: Obj[] = [];
  const warnings: string[] = [];
  let unsafeCount = 0;
  for (const item of files) {
    if (!isObj(item)) {
      warnings.push('context_bundle.files item ignored because it was not an object');
      continue;
    }
    const kind = firstString(item, 'kind') ?? 'other';
    const excerpt = firstString(item, 'excerpt') ?? '';
    if (UNSAFE_FILE_KINDS.has(kind) || looksLikeHarnessPayload(excerpt)) {
      unsafeCount += 1;
      continue;
    }
    const relativePath = normalizedRelativeContextPath(
      firstString(item, 'relative_path', 'relativePath', 'path'),
    );
    const path = firstString(item, 'path');
    if (matchesSelectedFile(relativePath, selectedRefs) || matchesSelectedFile(path, selectedRefs))
      continue;
    if (relativePath === null) {
      warnings.push('context_bundle.files item ignored because its relative path was unsafe');
      continue;
    }
    if (result.length >= maxFiles) {
      warnings.push('context_bundle files truncated by count limit');
      break;
    }
    const title = firstString(item, 'title', 'name');
    const contextFile: Obj = { relative_path: relativePath, kind, title: title || relativePath };
    if (excerpt) {
      const redacted = redactSensitiveText(excerpt, secrets);
      if (redacted !== excerpt) warnings.push(`context_bundle file redacted: ${relativePath}`);
      contextFile.excerpt = compactText(redacted, CONTEXT_FILE_TEXT_LIMIT);
      contextFile.excerpt_chars = cpLen(redacted);
      contextFile.truncated =
        cpLen(compactText(redacted, Number.POSITIVE_INFINITY)) > CONTEXT_FILE_TEXT_LIMIT;
    }
    result.push(contextFile);
  }
  return [result, warnings, unsafeCount];
}

function contextFilesWithLoopReads(
  bundle: Obj | null,
  filePath: string,
  extra: readonly PlainJson[] | null,
  { platform, secrets }: Options,
  maxFiles = MAX_CONTEXT_FILES,
): [Obj[], string[], number] {
  const [files, warnings, unsafeCount] = contextFiles(bundle, filePath, maxFiles, secrets);
  if (extra === null) return [files, warnings, unsafeCount];
  // 循环读到的文件与请求上下文同走路径、脱敏、选中文件与预算检查，然后才做结构化准入。
  const extraItems: Obj[] = [];
  for (const item of extra) {
    if (!isObj(item)) continue;
    const excerpt = get(item, 'excerpt');
    if (typeof excerpt !== 'string' || !pythonStrip(excerpt)) continue;
    const raw = get(item, 'relative_path');
    let path: string;
    try {
      path = normalizeProjectRelativePath(pythonTruthy(raw) ? pythonStrValue(raw) : '');
    } catch (error) {
      if (!(error instanceof FsToolError)) throw error;
      warnings.push('loop read context ignored because its relative path was unsafe');
      continue;
    }
    extraItems.push({ ...item, relative_path: path, kind: 'setting' });
  }
  const [extraFiles, extraWarnings, extraUnsafe] = contextFiles(
    { files: extraItems },
    filePath,
    maxFiles,
    secrets,
  );
  warnings.push(...extraWarnings);
  const existing = new Set(files.map((item) => normcase(item.relative_path as string, platform)));
  for (const item of extraFiles) {
    const key = normcase(item.relative_path as string, platform);
    if (existing.has(key)) continue;
    if (files.length >= maxFiles) {
      warnings.push('loop read context files truncated by count limit');
      break;
    }
    item.selection_source = 'loop_fs_read';
    files.push(item);
    existing.add(key);
  }
  return [files, warnings, unsafeCount + extraUnsafe];
}

function reviewIssueSummary(issue: Obj): Obj {
  const result: Obj = {};
  for (const key of ['id', 'category', 'severity', 'agent', 'code']) {
    const value = firstString(issue, key);
    if (value !== null) result[key] = value;
  }
  for (const key of ['message', 'evidence', 'suggested_action']) {
    const value = firstString(issue, key);
    if (value !== null) result[key] = compactText(value, REVIEW_TEXT_LIMIT);
  }
  return result;
}

function reviewReportSummary(report: PlainJson | null): Obj | null {
  if (!isObj(report)) return null;
  const issues = get(report, 'issues');
  const actions = get(report, 'suggested_actions');
  const summary: Obj = {
    kind: firstString(report, 'kind') ?? 'review_report',
    issue_count: Array.isArray(issues) ? issues.length : 0,
    issues: Array.isArray(issues)
      ? issues.slice(0, MAX_REVIEW_ISSUES).filter(isObj).map(reviewIssueSummary)
      : [],
    suggested_actions: Array.isArray(actions)
      ? actions
          .slice(0, MAX_REVIEW_ISSUES)
          .filter((item): item is string => typeof item === 'string' && Boolean(pythonStrip(item)))
          .map((item) => compactText(item, REVIEW_TEXT_LIMIT))
      : [],
  };
  const filePath = firstString(report, 'file_path', 'filePath');
  const mode = firstString(report, 'mode');
  for (const key of ['content_sha256', 'report_id']) {
    const value = firstString(report, key);
    if (value !== null) summary[key] = value;
  }
  if (filePath !== null) summary.file_path = filePath;
  if (mode !== null) summary.mode = mode;
  return summary;
}

function memoryItemSummary(item: Obj): Obj {
  const result: Obj = {};
  const fields: [string, string[]][] = [
    ['memory_id', ['memory_id', 'memoryId', 'id']],
    ['kind', ['kind', 'category', 'type']],
    ['entity', ['entity', 'name', 'subject']],
  ];
  for (const [outputKey, keys] of fields) {
    const value = firstString(item, ...keys);
    if (value !== null) result[outputKey] = value;
  }
  const text = firstString(item, 'fact', 'content', 'text', 'summary');
  if (text !== null) {
    if (cpLen(text) > MEMORY_TEXT_LIMIT) result.text_truncated = true;
    else result.text = compactText(text, MEMORY_TEXT_LIMIT);
  }
  for (const key of ['source_chapter_id', 'valid_from_chapter', 'valid_to_chapter']) {
    const value = get(item, key);
    // Python 的 bool 是 int 子类，也会被收下。
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isInteger(value)))
      result[key] = value;
  }
  return result;
}

function storyMemorySummary(bundle: Obj | null): Obj {
  const source = bundle === null ? undefined : memoryChannel(bundle);
  if (source === undefined || source === null) return { items: [] };
  let items: PlainJson | undefined = Array.isArray(source) ? source : undefined;
  if (isObj(source)) {
    for (const key of ['items', 'atoms', 'memories']) {
      const value = get(source, key);
      if (Array.isArray(value)) {
        items = value;
        break;
      }
    }
  }
  if (!Array.isArray(items)) return { items: [] };
  const safe = items.slice(0, MAX_STORY_MEMORY_ITEMS).filter(isObj).map(memoryItemSummary);
  return { items: safe.filter((item) => Object.keys(item).length > 0) };
}

function chapterContextSummary(bundle: Obj | null): Obj {
  if (bundle === null) return {};
  const source = chapterChannel(bundle);
  if (source === null) return {};
  const result: Obj = {};
  for (const key of CHAPTER_CONTEXT_KEYS) {
    const safe = safeContextValue(get(source, key));
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}

function projectSummary(bundle: Obj | null): Obj {
  if (bundle === null) return {};
  const result: Obj = {};
  const projectRoot = firstString(bundle, 'project_root', 'projectRoot');
  const currentFile = firstString(bundle, 'current_file', 'currentFile');
  if (projectRoot !== null) result.project_root = projectRoot;
  if (currentFile !== null) result.current_file = currentFile;
  const summary = get(bundle, 'summary');
  if (isObj(summary)) {
    const hasStoryStructure = get(summary, 'hasStoryStructure');
    if (typeof hasStoryStructure === 'boolean') result.has_story_structure = hasStoryStructure;
    const counts = get(summary, 'counts');
    if (isObj(counts)) {
      // Python 按 str(key) 的码点序挑出数（bool 是 int 子类）；快照只按排序键哈希，输出键序无关。
      const safeCounts: Obj = {};
      for (const [key, value] of Object.entries(counts)) {
        if (typeof value === 'number' || typeof value === 'boolean') safeCounts[key] = value;
      }
      if (Object.keys(safeCounts).length) result.counts = safeCounts;
    }
  }
  return result;
}

function omittedSummary(
  bundle: Obj | null,
  eventHistory: readonly PlainJson[] | null,
  artifacts: readonly PlainJson[] | null,
  unsafeFileCount: number,
): Obj {
  return {
    raw_event_count: eventHistory === null ? 0 : eventHistory.length,
    unsafe_context_key_count:
      bundle === null
        ? 0
        : Object.keys(bundle).filter((key) => UNSAFE_CONTEXT_KEYS.has(key)).length,
    unsafe_context_file_count: unsafeFileCount,
    artifact_payload_count:
      artifacts === null
        ? 0
        : artifacts.filter((artifact) => artifactKind(artifact) !== 'review_report').length,
  };
}

function includedSections(parts: {
  project: Obj;
  contextFiles: Obj[];
  reviewReport: Obj | null;
  storyMemory: Obj;
  chapterContext: Obj;
}): string[] {
  const sections = ['run', 'selected_file'];
  if (Object.keys(parts.project).length) sections.push('project');
  if (parts.contextFiles.length) sections.push('context_files');
  if (parts.reviewReport !== null && Object.keys(parts.reviewReport).length)
    sections.push('review_report');
  if (storyMemoryCount(parts.storyMemory)) sections.push('story_memory');
  if (Object.keys(parts.chapterContext).length) sections.push('chapter_context');
  return sections;
}

/** live 入口：此时采集项目知识，再交给确定性快照组装。 */
export async function buildLlmContextSnapshot(
  reader: ProjectReader,
  input: SnapshotInput & { runState?: RunState | null },
  options: Options,
): Promise<Obj> {
  const bundle = isObj(input.contextBundle) ? input.contextBundle : null;
  const [requested] = contextFilesWithLoopReads(
    bundle,
    input.filePath,
    input.extraContextFiles ?? null,
    options,
  );
  const knowledge = await collectProjectKnowledgeContext(reader, bundle, {
    contextFiles: requested as ContextFileRequest[],
    query: `${input.userMessage}\n${input.filePath}`,
    platform: options.platform,
    secrets: options.secrets,
  });
  const runState = input.runState ?? null;
  return buildLlmContextSnapshotFromCollected(
    knowledge,
    {
      ...input,
      runState:
        runState === null
          ? null
          : {
              public_id: runState.public_id ?? null,
              run_id: runState.run_id ?? null,
              goal: runState.goal ?? null,
              status: runState.status ?? null,
              current_step: runState.current_step ?? null,
            },
    },
    options,
  );
}

/** 从已物化的上下文值组装快照；即使 knowledge 为空也不隐式采集。 */
export function buildLlmContextSnapshotFromCollected(
  knowledge: CollectedProjectKnowledge,
  input: SnapshotInput & { runState: RunState | null },
  options: Options,
): Obj {
  const { platform, secrets } = options;
  const extra = input.extraContextFiles ?? null;
  const artifacts = input.artifacts ?? null;
  const events = input.eventHistory ?? null;
  const bundle = isObj(input.contextBundle) ? input.contextBundle : null;
  const warnings: string[] = [];
  if (input.contextBundle !== undefined && input.contextBundle !== null && bundle === null)
    warnings.push('context_bundle ignored because it was not an object');

  const [collected, fileWarnings, unsafeFileCount] = contextFilesWithLoopReads(
    bundle,
    input.filePath,
    extra,
    options,
  );
  warnings.push(...fileWarnings);
  const [merged, knowledgeWarnings] = mergeProjectKnowledgeEntries(knowledge, {
    contextFiles: collected,
    maxContextFiles: MAX_CONTEXT_FILES,
    platform,
    secrets,
  });
  const files = merged as Obj[];
  warnings.push(...knowledgeWarnings);
  const reviewSource = reviewChannelSource(input.reviewReport, artifacts);
  const reviewReport = reviewReportSummary(
    reviewSource === null ? null : redactSensitive(reviewSource, secrets),
  );
  const safeChannels = bundle === null ? null : (redactSensitive(bundle, secrets) as Obj);
  const storyMemory = storyMemorySummary(safeChannels);
  const chapterContext = chapterContextSummary(safeChannels);
  const project = projectSummary(bundle);
  const omitted = omittedSummary(bundle, events, artifacts, unsafeFileCount);
  const sections = includedSections({
    project,
    contextFiles: files,
    reviewReport,
    storyMemory,
    chapterContext,
  });
  const [requestedSources] = contextFilesWithLoopReads(bundle, input.filePath, extra, options, 64);
  const budget = bundle === null ? undefined : get(bundle, 'budget');
  const sourceManifest = sourceDeliveryManifest(
    knowledge.ordinary,
    files as unknown as Parameters<typeof sourceDeliveryManifest>[1],
    { requested: requestedSources as ContextFileRequest[], platform, secrets },
  ) as Obj[];
  const contextBudget: Obj = {
    truncated:
      (bundle !== null &&
        Object.keys(bundle).length > 0 &&
        isObj(budget) &&
        get(budget, 'truncated') === true) ||
      files.some((item) => item.truncated === true) ||
      warnings.some((warning) => warning.includes('truncated by')),
  };
  const snapshot: Obj = {
    kind: 'llm_context_snapshot',
    version: SNAPSHOT_VERSION,
    intent: stringOrDefault(input.intent, 'unknown'),
    run: snapshotRunState(input.runState),
    user_goal: compactText(input.userMessage, 2000),
    selected_file: {
      file_path: stringOrDefault(input.filePath, 'unknown'),
      content_chars: cpLen(input.content),
      content_sha256: sha256Hex(input.content),
      content_excerpt: compactText(input.content, SELECTED_FILE_TEXT_LIMIT),
    },
    role_hints: stringList(input.roleHints),
    role_mentions: stringList(input.roleMentions),
    project,
    context_files: files,
    source_manifest: sourceManifest,
    knowledge_recovery: knowledge.recoveryJson ? JSON.parse(knowledge.recoveryJson) : null,
    channel_requests: contextChannelRequests(bundle, reviewSource, secrets),
    context_budget: contextBudget,
    review_report: reviewReport,
    story_memory: storyMemory,
    chapter_context: chapterContext,
    included_sections: sections,
    warnings,
    omitted,
  };
  const [, syntheticRefs] = syntheticContextDelivery(snapshot, secrets);
  sourceManifest.push(...syntheticRefs);
  if (syntheticRefs.some((ref) => ref.truncated)) contextBudget.truncated = true;
  return withSnapshotId(snapshot);
}
