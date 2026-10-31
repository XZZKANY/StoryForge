import {
  MAX_PROMPT_CONTEXT_FILES,
  MAX_STORY_MEMORY_ITEMS,
  firstString,
  get,
  getOr,
  hasKey,
  isObj,
  pythonInt,
  pythonStrValue,
  type Obj,
} from './contextValues';
import { dumpJson, pythonTruthy } from './json';
import { PROMPT_EXCERPT_TEXT_LIMIT } from './ordinaryContext';
import { cpLen, cpSlice, pythonSplitlines } from './pythonText';
import { redactSensitiveText, type PlainJson, type SecretContext } from './redaction';
import { sha256Hex } from './sha256';

export { MAX_PROMPT_CONTEXT_FILES };

/** 送进旧版 Assistant 提示的上下文文件（含内部标记，交付前剥离）。 */
type PromptFile = Obj & {
  path: string;
  relative_path: string;
  kind: string;
  title: string;
  excerpt: string;
};
type Projected = {
  file: PromptFile;
  truncated: boolean;
  deliveredCount?: number;
  deliveredActionCount?: number;
  selectedItems?: Obj[];
  selectedValues?: Obj;
};

function syntheticPromptFile(
  relativePath: string,
  kind: string,
  excerpt: string,
  secrets: SecretContext,
): { file: PromptFile; truncated: boolean } {
  const redacted = redactSensitiveText(excerpt, secrets);
  return {
    file: {
      path: `storyforge://llm-context/${kind}`,
      relative_path: relativePath,
      kind,
      title: relativePath,
      excerpt: cpSlice(redacted, PROMPT_EXCERPT_TEXT_LIMIT) || '无摘录。',
    },
    truncated: cpLen(redacted) > PROMPT_EXCERPT_TEXT_LIMIT,
  };
}

function promptContextFile(item: Obj, secrets: SecretContext): Projected {
  const relativePath = firstString(item, 'relative_path') ?? 'unknown';
  const redacted = redactSensitiveText(firstString(item, 'excerpt') ?? '', secrets);
  return {
    file: {
      path: relativePath,
      relative_path: relativePath,
      kind: firstString(item, 'kind') ?? 'other',
      title: firstString(item, 'title') ?? relativePath,
      excerpt: cpSlice(redacted, PROMPT_EXCERPT_TEXT_LIMIT) || '无摘录。',
    },
    truncated: cpLen(redacted) > PROMPT_EXCERPT_TEXT_LIMIT,
  };
}

function storyMemoryPromptFile(
  storyMemory: PlainJson | undefined,
  secrets: SecretContext,
): Projected | null {
  if (!isObj(storyMemory)) return null;
  const items = get(storyMemory, 'items');
  if (!Array.isArray(items) || !items.length) return null;
  const lines: string[] = [];
  const selected: Obj[] = [];
  for (const item of items.slice(0, MAX_STORY_MEMORY_ITEMS)) {
    if (!isObj(item) || get(item, 'text_truncated') === true) continue;
    const label = [firstString(item, 'entity'), firstString(item, 'kind')]
      .filter((part) => part)
      .join(' / ');
    const text = firstString(item, 'text');
    if (text === null) continue;
    const line = label ? `- ${label}: ${text}` : `- ${text}`;
    // 整条记忆要么全送要么不送，边界上不给半条断言。
    if (
      cpLen(redactSensitiveText([...lines, line].join('\n'), secrets)) > PROMPT_EXCERPT_TEXT_LIMIT
    )
      break;
    lines.push(line);
    selected.push(item);
  }
  if (!lines.length) return null;
  return {
    ...syntheticPromptFile('Story Memory', 'story_memory', lines.join('\n'), secrets),
    deliveredCount: lines.length,
    selectedItems: selected,
  };
}

function chapterContextPromptFile(
  chapterContext: PlainJson | undefined,
  secrets: SecretContext,
): Projected | null {
  if (!isObj(chapterContext) || !Object.keys(chapterContext).length) return null;
  const lines: string[] = [];
  const selected: Obj = {};
  for (const [key, value] of Object.entries(chapterContext)) {
    if (value === null || (typeof value === 'object' && !Array.isArray(value))) continue;
    const line = `- ${key}: ${pythonStrValue(value)}`;
    if (
      cpLen(redactSensitiveText([...lines, line].join('\n'), secrets)) > PROMPT_EXCERPT_TEXT_LIMIT
    )
      break;
    lines.push(line);
    selected[key] = value;
  }
  if (!lines.length) return null;
  return {
    ...syntheticPromptFile('Chapter Context', 'chapter_context', lines.join('\n'), secrets),
    deliveredCount: lines.length,
    selectedValues: selected,
  };
}

function reviewReportPromptFile(report: Obj, secrets: SecretContext): Projected {
  // 删整条问题 / 建议，而不是交出截断的 JSON 或半句证据；计数让写手看见省略了多少。
  const issues = [
    ...((pythonTruthy(get(report, 'issues')) ? get(report, 'issues') : []) as PlainJson[]),
  ];
  const originalActions = (
    pythonTruthy(get(report, 'suggested_actions')) ? get(report, 'suggested_actions') : []
  ) as PlainJson[];
  const actions = [...originalActions];
  const delivered: Obj = { ...report, issues, suggested_actions: actions };
  let omitted = false;
  let encoded: string;
  for (;;) {
    const issueCount = get(report, 'issue_count');
    delivered.omitted_issue_count = Math.max(
      pythonInt(pythonTruthy(issueCount) ? issueCount : issues.length) - issues.length,
      0,
    );
    const actionCount = get(report, 'requested_action_count');
    delivered.omitted_action_count =
      pythonInt(pythonTruthy(actionCount) ? actionCount : originalActions.length) - actions.length;
    encoded = redactSensitiveText(
      dumpJson(delivered, { ensureAscii: false, sortKeys: true }),
      secrets,
    );
    if (cpLen(encoded) <= PROMPT_EXCERPT_TEXT_LIMIT || !(issues.length || actions.length)) break;
    (actions.length ? actions : issues).pop();
    omitted = true;
  }
  const projected = syntheticPromptFile('Review Report', 'review_report', encoded, secrets);
  return {
    ...projected,
    truncated: projected.truncated || omitted || (delivered.omitted_issue_count as number) > 0,
    deliveredCount: issues.length,
    deliveredActionCount: actions.length,
  };
}

const CHANNEL_PATHS: Record<string, string> = {
  story_memory: 'Story Memory',
  chapter_context: 'Chapter Context',
  review_report: 'Review Report',
};

/**
 * 合成通道的最终预算投影：同一处产出送达文本与安全的送达证据。
 * 注入值没有正文版本证明；元数据里不含原文。旧快照缺请求记账时照样可读。
 */
export function syntheticContextDelivery(
  snapshot: Obj,
  secrets: SecretContext,
): [PromptFile[], Obj[]] {
  const rawRequests = get(snapshot, 'channel_requests');
  const requests: Obj = isObj(rawRequests) ? rawRequests : {};
  let report = get(snapshot, 'review_report');
  const reportRequestValue = get(requests, 'review_report');
  const reportRequest: Obj =
    isObj(reportRequestValue) && pythonTruthy(reportRequestValue) ? reportRequestValue : {};
  if (isObj(report) && pythonTruthy(report)) {
    const actions = get(report, 'suggested_actions');
    report = {
      ...report,
      issue_count: getOr(reportRequest, 'requested_count', getOr(report, 'issue_count', 0)),
      requested_action_count: hasKey(reportRequest, 'requested_action_count')
        ? reportRequest.requested_action_count
        : (pythonTruthy(actions) ? (actions as PlainJson[]) : []).length,
    };
  }
  const reportObj = isObj(report) ? report : null;
  const projected: [string, Projected | null][] = [
    ['story_memory', storyMemoryPromptFile(get(snapshot, 'story_memory'), secrets)],
    ['chapter_context', chapterContextPromptFile(get(snapshot, 'chapter_context'), secrets)],
    [
      'review_report',
      reportObj !== null && pythonTruthy(reportObj)
        ? reviewReportPromptFile(reportObj, secrets)
        : null,
    ],
  ];
  const files: PromptFile[] = [];
  const refs: Obj[] = [];
  for (const [kind, item] of projected) {
    const requestValue = get(requests, kind);
    const request: Obj = isObj(requestValue) && pythonTruthy(requestValue) ? requestValue : {};
    if (item === null && !Object.keys(request).length) continue;
    const chapterContext = get(snapshot, 'chapter_context');
    let fallbackCount =
      kind === 'chapter_context' && pythonTruthy(chapterContext)
        ? isObj(chapterContext)
          ? Object.keys(chapterContext).length
          : (chapterContext as PlainJson[]).length
        : 0;
    let deliveredCount = item === null ? 0 : (item.deliveredCount ?? fallbackCount);
    // 旧版记忆快照没有选择记账，按实际行数计。
    if (item !== null && kind === 'story_memory' && !deliveredCount)
      deliveredCount = pythonSplitlines(item.file.excerpt).length;
    if (kind === 'story_memory') {
      const memory = get(snapshot, 'story_memory');
      if (isObj(memory)) {
        const memoryItems = get(memory, 'items');
        fallbackCount = (pythonTruthy(memoryItems) ? (memoryItems as PlainJson[]) : []).length;
      } else fallbackCount = deliveredCount;
    } else if (kind !== 'chapter_context') fallbackCount = deliveredCount;
    const deliveredActions = item === null ? 0 : (item.deliveredActionCount ?? 0);
    const isReport = kind === 'review_report' && reportObj !== null;
    const requestedCount = getOr(
      request,
      'requested_count',
      isReport ? getOr(reportObj!, 'issue_count', deliveredCount) : fallbackCount,
    ) as number;
    const requestedActions = getOr(
      request,
      'requested_action_count',
      isReport ? getOr(reportObj!, 'requested_action_count', deliveredActions) : 0,
    ) as number;
    const omitted = Math.max(requestedCount - deliveredCount, 0);
    const truncated = Boolean(
      pythonTruthy(get(request, 'selection_truncated')) ||
      omitted ||
      requestedActions > deliveredActions ||
      (item !== null && item.truncated),
    );
    const excerpt = item === null ? '' : item.file.excerpt;
    const ref: Obj = {
      relative_path: item === null ? CHANNEL_PATHS[kind] : item.file.relative_path,
      purpose: kind,
      selection_source: 'supplied_channel',
      source_state: 'unverified',
      supplied_value_sha256: get(request, 'supplied_value_sha256') ?? null,
      excerpt_sha256: item === null ? null : sha256Hex(excerpt),
      delivered_chars: cpLen(excerpt),
      requested_count: requestedCount,
      delivered_count: deliveredCount,
      omitted_count: omitted,
      disposition: item === null ? 'omitted' : 'delivered',
      truncated,
    };
    if (kind === 'review_report') {
      ref.requested_action_count = requestedActions;
      ref.delivered_action_count = deliveredActions;
      ref.omitted_action_count = Math.max(requestedActions - deliveredActions, 0);
    }
    if (truncated || item === null) {
      ref.omission_reason = truncated
        ? 'channel_selection_or_projection'
        : 'empty_or_invalid_channel';
      const reasons = [
        ...(getOr(request, 'selection_omission_reasons', []) as PlainJson[]),
        ...(pythonTruthy(get(request, 'selection_truncated')) ? ['text_or_list_budget'] : []),
        ...(omitted || requestedActions > deliveredActions ? ['selection_or_projection'] : []),
      ];
      ref.omission_reasons = reasons.length ? reasons : ['empty_or_invalid_channel'];
    }
    refs.push(ref);
    if (item !== null) {
      item.truncated = truncated;
      files.push(Object.assign(item.file, { _truncated: truncated }));
    }
  }
  return [files, refs];
}

/** 取值方（润色守卫）拿不回送达时被省略的条目。 */
export function syntheticContextSelectedValues(
  snapshot: Obj,
  secrets: SecretContext,
): [Obj[], Obj] {
  const memory = storyMemoryPromptFile(get(snapshot, 'story_memory'), secrets);
  const chapter = chapterContextPromptFile(get(snapshot, 'chapter_context'), secrets);
  return [
    memory === null ? [] : (JSON.parse(JSON.stringify(memory.selectedItems)) as Obj[]),
    chapter === null ? {} : (JSON.parse(JSON.stringify(chapter.selectedValues)) as Obj),
  ];
}

const SOURCE_STATE_HEADER = [
  '来源状态：stale 表示支撑证据已漂移，请核实，不能当作已确认的当前约束；' +
    'current 仅表示来源版本匹配，不表示事实已独立核验。',
  '普通来源以当前文件重新采集；omitted 不得作为当前约束；unverified 是未回读资料。',
];
const KNOWLEDGE_FIELDS = [
  'knowledge_id',
  'relative_path',
  'selection_source',
  'evidence_state',
  'warning_count',
];

/** 把快照还原成现有提示使用的旧版 context_bundle 形状。 */
export function llmContextSnapshotToPromptContextBundle(
  snapshot: Obj,
  secrets: SecretContext,
): Obj {
  const selectedValue = get(snapshot, 'selected_file');
  const selectedFile: Obj = isObj(selectedValue) ? selectedValue : {};
  const projectValue = get(snapshot, 'project');
  const project: Obj = isObj(projectValue) ? projectValue : {};
  const contextValue = get(snapshot, 'context_files');
  const contextFiles = (Array.isArray(contextValue) ? contextValue : []).filter(isObj);
  const projected: { file: PromptFile; truncated: boolean }[] = contextFiles.map((item) =>
    promptContextFile(item, secrets),
  );
  const [syntheticFiles] = syntheticContextDelivery(snapshot, secrets);
  for (const file of syntheticFiles) {
    const truncated = file._truncated === true;
    delete file._truncated;
    projected.push({ file, truncated });
  }
  const knowledgeEntries = contextFiles.filter((item) => pythonTruthy(get(item, 'knowledge_id')));
  const sourcesValue = get(snapshot, 'source_manifest');
  const sources = Array.isArray(sourcesValue) ? sourcesValue : [];
  if (knowledgeEntries.length || sources.length) {
    // 元数据不占断言的 4000 字槽位，状态标签本身挤不掉作者钉住的尾部约束。
    const lines = [
      ...SOURCE_STATE_HEADER,
      ...sources.map((item) =>
        dumpJson(item, { ensureAscii: false, sortKeys: true, separators: [',', ':'] }),
      ),
      ...(sources.length ? [] : knowledgeEntries).map((item) =>
        dumpJson(Object.fromEntries(KNOWLEDGE_FIELDS.map((key) => [key, get(item, key) ?? null])), {
          ensureAscii: false,
          sortKeys: true,
        }),
      ),
    ];
    const sourcesFile = syntheticPromptFile(
      'Context Sources',
      'context_sources',
      lines.join('\n'),
      secrets,
    );
    if (sourcesFile.truncated)
      throw new Error('LLM context source metadata exceeds delivery budget');
    projected.push(sourcesFile);
  }
  const currentFile =
    firstString(project, 'current_file') ?? firstString(selectedFile, 'file_path') ?? 'unknown';
  const summary: Obj = {};
  const counts = get(project, 'counts');
  if (isObj(counts)) summary.counts = { ...counts };
  const hasStoryStructure = get(project, 'has_story_structure');
  if (typeof hasStoryStructure === 'boolean') summary.hasStoryStructure = hasStoryStructure;
  const contextBudget = get(snapshot, 'context_budget');
  const truncated =
    (isObj(contextBudget) && get(contextBudget, 'truncated') === true) ||
    contextFiles.some((item) => get(item, 'truncated') === true) ||
    projected.some((item) => item.truncated);
  // 不为了让 DTO 通过而静默丢掉钉住的条目。
  if (projected.length > MAX_PROMPT_CONTEXT_FILES)
    throw new Error('LLM context exceeds Assistant bundle file budget');
  const files = projected.map((item) => item.file);
  return {
    project_root: firstString(project, 'project_root') ?? 'storyforge://llm-context',
    current_file: currentFile,
    files,
    summary,
    budget: {
      file_count: files.length,
      char_count: files.reduce(
        (sum, item) => sum + cpLen(pythonTruthy(item.excerpt) ? pythonStrValue(item.excerpt) : ''),
        0,
      ),
      max_files: MAX_PROMPT_CONTEXT_FILES,
      max_excerpt_chars: PROMPT_EXCERPT_TEXT_LIMIT,
      truncated,
    },
  };
}
