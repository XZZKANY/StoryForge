import { dumpJson, JsonFloat } from '../kernel/json';
import { loopPatchToolSpecs } from './tools/catalog';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof JsonFloat);
const points = (text: string) => Array.from(text);
/** Python `len(x or [])` / `len(x or {})`：容器取长度，空值记 0。 */
const size = (value: unknown) =>
  Array.isArray(value) ? value.length : isObj(value) ? Object.keys(value).length : 0;
const objectOf = (value: unknown): Obj => (isObj(value) ? value : {});

const PATCH_TOOLS = new Set(loopPatchToolSpecs().map((spec) => spec.name));
const TOOL_RESULT_MAX_CHARS = 24_000;
const REVIEW_FEEDBACK_MAX_ISSUES = 20;
const REVIEW_FEEDBACK_ISSUE_KEYS = [
  'id',
  'category',
  'severity',
  'code',
  'message',
  'suggested_action',
];

/** 工具结果回给模型的文本：超过 24,000 字截断并注明。 */
export function serializeToolOutput(output: unknown): string {
  const text = dumpJson(output, { ensureAscii: false });
  const chars = points(text);
  if (chars.length > TOOL_RESULT_MAX_CHARS)
    return chars.slice(0, TOOL_RESULT_MAX_CHARS).join('') + '…[结果过长已截断]';
  return text;
}

const numeric = (value: unknown): number | null =>
  typeof value === 'number' ? value : value instanceof JsonFloat ? value.value : null;

/** Python `float(x or 0.0)`：空值记 0，布尔记 0 / 1。 */
const pythonFloat = (value: unknown): number =>
  !value ? 0 : value === true ? 1 : (numeric(value) ?? Number(value));

export function mergeCostBreakdown(
  current: Obj,
  incoming: unknown,
  totals: { promptTokens: number; completionTokens: number; tokenUsageSource: string },
): Obj {
  if (!isObj(incoming)) return current;
  const merged: Obj = { ...current };
  for (const key of ['input_cny', 'output_cny', 'total_cny']) {
    const value = numeric(incoming[key]);
    if (value !== null) merged[key] = pythonFloat(merged[key]) + value;
  }
  for (const key of [
    'currency',
    'input_cny_per_m_tokens',
    'output_cny_per_m_tokens',
    'cache_hit_input_cny_per_m_tokens',
  ])
    if (Object.prototype.hasOwnProperty.call(incoming, key)) merged[key] = incoming[key];
  merged.prompt_tokens = totals.promptTokens;
  merged.completion_tokens = totals.completionTokens;
  merged.source = totals.tokenUsageSource;
  return merged;
}

/** Python 的 dict.get 缺键给 None：摘要里缺的字段一律写成 null。 */
const filled = (summary: Obj): Obj =>
  Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, value ?? null]));

/** 写进证据链的工具输出摘要：只留计数与定位，正文不进证据。 */
export const toolOutputSummary = (registryName: string, output: Obj): Obj =>
  filled(rawToolOutputSummary(registryName, output));

function rawToolOutputSummary(registryName: string, output: Obj): Obj {
  const verdict = objectOf(output.verdict);
  switch (registryName) {
    case 'fs.list':
      return { entry_count: size(output.entries), truncated: output.truncated };
    case 'fs.read':
      return {
        path: output.path,
        returned_chars: output.returned_chars,
        truncated: output.truncated,
      };
    case 'skill.read':
      return {
        skill_name: output.name,
        plugin: output.plugin,
        path: output.path,
        returned_chars: typeof output.content === 'string' ? points(output.content).length : 0,
        truncated: output.truncated,
      };
    case 'project.consistency':
      return {
        scanned_files: output.scanned_files,
        term_count: size(output.term_occurrences),
        time_marker_count: size(output.time_markers),
        repeated_clause_count: size(output.repeated_clauses),
      };
    case 'project.prose_check':
      return {
        path: output.path,
        issue_count: output.issue_count,
        dimension_count: size(output.dimension_counts),
      };
    case 'project.collapse_check':
      return { path: output.path, verdict: verdict.status, issue_count: size(verdict.issues) };
    case 'project.entity_budget_check':
      return {
        path: output.path,
        chapter: output.chapter,
        verdict: verdict.status,
        issue_count: size(verdict.issues),
      };
    case 'project.promise_check':
      return {
        current_chapter: output.current_chapter,
        promise_count: output.promise_count,
        conflict_count: output.conflict_count,
        advisory_count: output.advisory_count,
      };
    case 'project.plan_update':
      return {
        planned_total: output.planned_total,
        next_ordinal: output.next_ordinal,
        created_count: output.created_count,
        updated_count: output.updated_count,
      };
    case 'project.cross_chapter_check':
      return {
        chapter_count: output.chapter_count,
        finding_count: output.finding_count,
        model: output.model,
      };
    case 'project.deep_consistency':
      return {
        path: output.path,
        issue_count: output.issue_count,
        bible_file_count: size(output.bible_files),
      };
    case 'project.canon':
      return {
        entity_count: output.entity_count,
        conflict_count: output.conflict_count,
        advisory_count: output.advisory_count,
      };
    case 'project.canon_delta': {
      const proposals = objectOf(output.proposals);
      return {
        new_entity_count: size(proposals.new_entities),
        known_entity_count: size(proposals.known_entities),
        alias_conflict_count: size(output.alias_conflicts),
        new_conflict_count: size(output.new_conflicts),
        new_advisory_count: size(output.new_advisories),
      };
    }
    case 'project.hooks_delta':
      return {
        new_hook_count: size(output.new_hooks),
        duplicate_count: size(output.duplicates),
        pattern_hit_count: size(output.pattern_hits),
      };
    case 'file.review': {
      const report = objectOf(output.review_report);
      return { file_path: report.file_path, issue_count: size(report.issues), mode: report.mode };
    }
    case 'project.trim_prose': {
      const audit = objectOf(output.trim_audit);
      return {
        file_path: output.file_path,
        original_chars: audit.original_chars,
        compressed_chars: audit.compressed_chars,
        compression_percent: audit.actual_percent,
        target_percent: audit.target_percent,
        model: output.model,
      };
    }
    case 'prose.continue':
      return {
        file_path: output.file_path,
        anchor_line: output.anchor_line,
        inserted_chars: output.inserted_chars,
        model: output.model,
      };
  }
  if (PATCH_TOOLS.has(registryName)) {
    const patch = objectOf(output.proposed_patch);
    const after = output.after;
    return {
      file_path: output.file_path,
      after_chars: after ? points(typeof after === 'string' ? after : String(after)).length : 0,
      model: output.model,
      patch_id: patch.id,
    };
  }
  return {
    match_count: size(output.matches),
    scanned_files: output.scanned_files,
    truncated: output.truncated,
  };
}

/** 审稿反馈只留结构化 issue 要点，不回灌整包报告。 */
export function reviewFeedback(output: Obj): Obj {
  const report = objectOf(output.review_report);
  const issues = (Array.isArray(report.issues) ? report.issues : []).filter(isObj);
  return filled({
    file_path: report.file_path,
    mode: report.mode,
    issue_count: issues.length,
    issues: issues
      .slice(0, REVIEW_FEEDBACK_MAX_ISSUES)
      .map((issue) =>
        Object.fromEntries(
          REVIEW_FEEDBACK_ISSUE_KEYS.filter(
            (key) => issue[key] !== null && issue[key] !== undefined,
          ).map((key) => [key, issue[key]]),
        ),
      ),
    issues_truncated: issues.length > REVIEW_FEEDBACK_MAX_ISSUES,
    suggested_actions: report.suggested_actions,
  });
}

/** 修订反馈不带 before / after：既省预算，也防模型把未确认补丁当成已写回。 */
export const reviseFeedback = (output: Obj): Obj =>
  output.unchanged === true
    ? filled({
        status: 'unchanged',
        file_path: output.file_path,
        summary: output.summary,
        note: '修订结果与原文一字不差，没有生成补丁。如实告诉作者这次没有改动，不要说「改好了」。',
      })
    : filled({
        status: 'proposed_patch_created',
        file_path: output.file_path,
        summary: output.summary,
        applied_scope: output.applied_scope,
        note: '修订补丁已生成，等待作者在界面确认后才会写盘；不要假设已写回。',
      });
