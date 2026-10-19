import { readCanon } from '../../kernel/canonFiles';
import { entitySurfaceForms } from '../../kernel/canonRebuild';
import { consistencyScan } from '../../kernel/consistencyScan';
import { crossChapterReview } from '../../kernel/crossChapter';
import { FsToolError } from '../../kernel/fsTools';
import { isJsonObject, type JsonObject, type JsonValue } from '../../kernel/json';
import { DEFAULT_STALE_AFTER_CHAPTERS, promiseCheck } from '../../kernel/promiseScan';
import { proseStaticScan } from '../../kernel/proseScan';
import { pythonStrip } from '../../kernel/pythonText';
import { collapseScan, entityBudgetScan, type EntityBudgetOptions } from '../../kernel/sceneChecks';
import { applyPlanUpdate } from '../../kernel/serialPlanUpdate';
import { optionalString } from '../runPayloads';
import type { ToolHandler, ToolResult } from './execution';
import type { ToolDeps } from './handlerDeps';
import { requiredString } from './runtimeArguments';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStrictInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);
const has = (payload: Obj, key: string) => Object.prototype.hasOwnProperty.call(payload, key);
const nonBlankStrings = (value: unknown[]) =>
  value.filter((item): item is string => typeof item === 'string' && Boolean(pythonStrip(item)));

const completed = (output: Obj, trace: ToolResult['trace']): ToolResult => ({
  status: 'completed',
  output,
  trace,
  artifacts: [],
});

const ENTITY_LISTS: [string, keyof EntityBudgetOptions][] = [
  ['new_key_characters', 'newKeyCharacters'],
  ['new_core_locations', 'newCoreLocations'],
  ['new_core_evidence', 'newCoreEvidence'],
  ['new_major_reversals', 'newMajorReversals'],
  ['new_mysteries', 'newMysteries'],
  ['new_equipment', 'newEquipment'],
];
const ENTITY_INTS: [string, keyof EntityBudgetOptions | null][] = [
  ['chapter', 'chapter'],
  ['budget_key_characters', 'budgetKeyCharacters'],
  ['budget_core_locations', 'budgetCoreLocations'],
  ['budget_core_evidence', 'budgetCoreEvidence'],
  ['budget_major_reversals', 'budgetMajorReversals'],
  ['budget_new_core_entities_after_chapter_20', 'budgetLateCoreLocations'],
  ['budget_new_mysteries_after_chapter_25', 'budgetLateMysteries'],
];

export function checkToolHandlers(deps: ToolDeps): Record<string, ToolHandler> {
  const { reader, writer, platform } = deps;

  /** 把 canon 实体的本名与别名补进检索词：称谓一致性最该抓的就是别名。 */
  async function withCanonSurfaceForms(root: string, terms: string[]): Promise<string[]> {
    let canon: JsonObject;
    try {
      canon = await readCanon(reader, root);
    } catch (error) {
      if (error instanceof FsToolError) return terms;
      throw error;
    }
    const merged = [...terms];
    const seen = new Set(terms.map(pythonStrip));
    const entities = canon.entities;
    for (const entity of Array.isArray(entities) ? entities : []) {
      if (!isJsonObject(entity)) continue;
      for (const surface of entitySurfaceForms(entity))
        if (surface && !seen.has(surface)) {
          seen.add(surface);
          merged.push(surface);
        }
    }
    return merged;
  }

  const consistency: ToolHandler = async (_context, payload) => {
    const root = requiredString(payload, 'project_root');
    const raw = payload.terms;
    const terms = await withCanonSurfaceForms(root, Array.isArray(raw) ? nonBlankStrings(raw) : []);
    const subpath = optionalString(payload.subpath);
    const glob = optionalString(payload.glob) ?? '*.md';
    const output = await consistencyScan(reader, root, terms, { platform, subpath, glob });
    return completed(output as Obj, {
      tool_name: 'project.consistency',
      status: 'completed',
      input_summary: { terms: terms.slice(0, 10), subpath, glob },
      output_summary: {
        scanned_files: output.scanned_files,
        term_count: output.term_occurrences.length,
        time_marker_count: output.time_markers.length,
        repeated_clause_count: output.repeated_clauses.length,
      },
    });
  };

  const proseCheck: ToolHandler = async (_context, payload) => {
    const root = requiredString(payload, 'project_root');
    const path = requiredString(payload, 'path');
    const output = (await proseStaticScan(reader, root, path)) as Obj;
    return completed(output, {
      tool_name: 'project.prose_check',
      status: 'completed',
      input_summary: { path },
      output_summary: {
        path: output.path,
        issue_count: output.issue_count,
        dimension_count: Object.keys(output.dimension_counts as Obj).length,
      },
    });
  };

  const collapseCheck: ToolHandler = async (_context, payload) => {
    const root = requiredString(payload, 'project_root');
    const path = requiredString(payload, 'path');
    let beats: string[] | null = null;
    if (has(payload, 'beats')) {
      const value = payload.beats;
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
        throw new FsToolError('beats 必须是字符串数组。');
      beats = value as string[];
    }
    const strings: Record<string, string | null> = {};
    for (const key of ['emotion_before', 'emotion_after', 'irreversible_consequence']) {
      if (!has(payload, key)) {
        strings[key] = null;
        continue;
      }
      if (typeof payload[key] !== 'string') throw new FsToolError(`${key} 必须是字符串。`);
      strings[key] = payload[key] as string;
    }
    let deletable: boolean | null = null;
    if (has(payload, 'deletable')) {
      if (typeof payload.deletable !== 'boolean') throw new FsToolError('deletable 必须是布尔值。');
      deletable = payload.deletable;
    }
    const output = (await collapseScan(reader, root, path, {
      beats,
      emotionBefore: strings.emotion_before,
      emotionAfter: strings.emotion_after,
      irreversibleConsequence: strings.irreversible_consequence,
      deletable,
    })) as Obj;
    const verdict = output.verdict as Obj;
    return completed(output, {
      tool_name: 'project.collapse_check',
      status: 'completed',
      input_summary: { path },
      output_summary: {
        path: output.path,
        verdict: verdict.status,
        issue_count: (verdict.issues as unknown[]).length,
      },
    });
  };

  const entityBudgetCheck: ToolHandler = async (_context, payload) => {
    const root = requiredString(payload, 'project_root');
    const path = requiredString(payload, 'path');
    const options: Record<string, unknown> = {};
    for (const [key, field] of ENTITY_LISTS) {
      if (!has(payload, key)) continue;
      const value = payload[key];
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
        throw new FsToolError(`${key} 必须是字符串数组。`);
      options[field] = value;
    }
    for (const [key, field] of ENTITY_INTS) {
      if (!has(payload, key)) continue;
      if (!isStrictInt(payload[key])) throw new FsToolError(`${key} 必须是整数。`);
      if (field !== null) options[field] = payload[key];
    }
    const output = (await entityBudgetScan(
      reader,
      root,
      path,
      options as EntityBudgetOptions,
    )) as Obj;
    const verdict = output.verdict as Obj;
    return completed(output, {
      tool_name: 'project.entity_budget_check',
      status: 'completed',
      input_summary: { path, chapter: output.chapter },
      output_summary: {
        path: output.path,
        chapter: output.chapter,
        verdict: verdict.status,
        issue_count: (verdict.issues as unknown[]).length,
      },
    });
  };

  const promise: ToolHandler = async (_context, payload) => {
    const root = requiredString(payload, 'project_root');
    const stale = has(payload, 'stale_after_chapters')
      ? payload.stale_after_chapters
      : DEFAULT_STALE_AFTER_CHAPTERS;
    if (!isStrictInt(stale) || stale < 1)
      throw new FsToolError('stale_after_chapters 必须是正整数。');
    const output = await promiseCheck(reader, root, { platform, staleAfterChapters: stale });
    return completed(output as unknown as Obj, {
      tool_name: 'project.promise_check',
      status: 'completed',
      input_summary: { stale_after_chapters: stale },
      output_summary: {
        current_chapter: output.current_chapter,
        promise_count: output.promise_count,
        conflict_count: output.conflict_count,
        advisory_count: output.advisory_count,
      },
    });
  };

  const planUpdate: ToolHandler = async (_context, payload) => {
    const root = requiredString(payload, 'project_root');
    const chapters = payload.chapters;
    if (chapters !== undefined && chapters !== null && !Array.isArray(chapters))
      throw new FsToolError('chapters 必须是数组。');
    const arcs = payload.arcs;
    if (arcs !== undefined && arcs !== null && !Array.isArray(arcs))
      throw new FsToolError('arcs 必须是数组。');
    const remove = payload.remove_ordinals;
    if (remove !== undefined && remove !== null && !Array.isArray(remove))
      throw new FsToolError('remove_ordinals 必须是数组。');
    const chapterList = (chapters ?? []) as unknown[];
    const removeList = (remove ?? []) as unknown[];
    if (
      !chapterList.length &&
      !removeList.length &&
      (arcs === undefined || arcs === null) &&
      !['premise', 'chapter_word_count_min', 'chapter_word_count_max'].some((key) =>
        has(payload, key),
      )
    )
      throw new FsToolError(
        '没有任何要更新的内容：至少传 chapters、arcs、remove_ordinals 或计划头字段之一。',
      );
    const output = (await applyPlanUpdate(
      reader,
      writer,
      root,
      {
        chapters: chapterList.filter(isObj) as JsonValue[],
        premise: optionalString(payload.premise),
        chapterWordCountMin: (payload.chapter_word_count_min ?? null) as number | null,
        chapterWordCountMax: (payload.chapter_word_count_max ?? null) as number | null,
        arcs:
          arcs === undefined || arcs === null
            ? null
            : ((arcs as unknown[]).filter(isObj) as JsonValue[]),
        removeOrdinals: removeList.filter(isStrictInt),
      },
      platform,
    )) as Obj;
    return completed(output, {
      tool_name: 'project.plan_update',
      status: 'completed',
      input_summary: { chapter_count: chapterList.length, remove_count: removeList.length },
      output_summary: {
        planned_total: output.planned_total,
        next_ordinal: output.next_ordinal,
        created_count: output.created_count,
        updated_count: output.updated_count,
      },
    });
  };

  const crossChapter: ToolHandler = async (context, payload) => {
    const root = requiredString(payload, 'project_root');
    const raw = payload.paths;
    if (!Array.isArray(raw)) throw new FsToolError('paths 必须是字符串数组（至少两个章节路径）。');
    const focus = optionalString(payload.focus);
    const output = (await crossChapterReview(reader, root, nonBlankStrings(raw), {
      platform,
      focus,
      callLlm: async (prompt) => {
        const result = await context.services.model.complete(prompt);
        return { content: result.content, latency_ms: result.latency_ms };
      },
      model: context.services.model.source.STORYFORGE_LLM_MODEL ?? null,
    })) as Obj;
    return completed(output, {
      tool_name: 'project.cross_chapter_check',
      status: 'completed',
      input_summary: { paths: (output.chapters as Obj[]).map((item) => item.path), focus },
      output_summary: {
        chapter_count: output.chapter_count,
        finding_count: output.finding_count,
        model: output.model,
      },
    });
  };

  return {
    'project.consistency': consistency,
    'project.prose_check': proseCheck,
    'project.collapse_check': collapseCheck,
    'project.entity_budget_check': entityBudgetCheck,
    'project.promise_check': promise,
    'project.cross_chapter_check': crossChapter,
    'project.plan_update': planUpdate,
  };
}
