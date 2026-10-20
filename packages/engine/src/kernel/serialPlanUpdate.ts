import { ProjectReadError, type ProjectReader } from '../readPort';
import type { ProjectWriter } from '../writePort';
import { chapterOrdinals } from './canonRebuild';
import { FsToolError, resolveProjectRoot } from './fsTools';
import { cloneJson, InputDomainError, isJsonObject, type JsonObject, type JsonValue } from './json';
import { pythonStrip } from './pythonText';
import {
  ALLOWED_STATUSES,
  buildPlan,
  cleanText,
  driftedChapters,
  MAX_GOAL_CHARS,
  nextChapter,
  PLAN_RELATIVE_PATH,
  positiveInt,
  readPlan,
  STATUS_DONE,
  STATUS_PENDING,
  writePlan,
  writtenOrdinals,
} from './serialPlan';

export type PlanUpdates = {
  chapters?: readonly JsonValue[] | null;
  premise?: string | null;
  chapterWordCountMin?: number | null;
  chapterWordCountMax?: number | null;
  arcs?: readonly JsonValue[] | null;
  removeOrdinals?: readonly JsonValue[] | null;
};

/**
 * 把一批章节更新并入既有计划：按 ordinal upsert、逐字段合并（未传的字段保留原值）。
 * 纯函数，不读盘不写盘；返回新计划与计数证据。
 */
export function mergePlanPayload(existing: JsonObject, updates: PlanUpdates) {
  const merged = Object.keys(existing).length
    ? cloneJson(existing)
    : ({ version: 1, chapters: [], arcs: [] } as JsonObject);
  if (!('version' in merged)) merged.version = 1;
  const byOrdinal = new Map<number, JsonObject>();
  for (const item of Array.isArray(merged.chapters) ? merged.chapters : []) {
    const ordinal = isJsonObject(item) ? positiveInt(item.ordinal) : null;
    if (ordinal !== null) byOrdinal.set(ordinal, { ...(item as JsonObject) });
  }
  let created = 0;
  let updated = 0;
  let removed = 0;
  let skipped = 0;
  for (const item of updates.chapters ?? []) {
    if (!isJsonObject(item)) {
      skipped += 1;
      continue;
    }
    const ordinal = positiveInt(item.ordinal);
    if (ordinal === null) {
      skipped += 1;
      continue;
    }
    let target = byOrdinal.get(ordinal);
    if (target === undefined) {
      target = { ordinal, status: STATUS_PENDING };
      created += 1;
    } else {
      target = { ...target };
      updated += 1;
    }
    for (const key of ['title', 'goal', 'note', 'path']) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
      const limit = key === 'title' ? 80 : key === 'path' ? 400 : MAX_GOAL_CHARS;
      const value = cleanText(item[key], limit);
      if (value === null) delete target[key];
      else target[key] = value;
    }
    const status = item.status;
    if (typeof status === 'string' && ALLOWED_STATUSES.has(status)) target.status = status;
    byOrdinal.set(ordinal, target);
  }
  for (const ordinal of updates.removeOrdinals ?? []) {
    const value = positiveInt(ordinal);
    if (value !== null && byOrdinal.delete(value)) removed += 1;
  }
  merged.chapters = [...byOrdinal.keys()].sort((a, b) => a - b).map((key) => byOrdinal.get(key)!);
  if (updates.premise != null) {
    const cleaned = cleanText(updates.premise, 300);
    if (cleaned === null) delete merged.premise;
    else merged.premise = cleaned;
  }
  for (const [key, value] of [
    ['chapter_word_count_min', updates.chapterWordCountMin],
    ['chapter_word_count_max', updates.chapterWordCountMax],
  ] as const) {
    if (value != null && positiveInt(value) !== null) merged[key] = value;
  }
  if (updates.arcs != null) merged.arcs = updates.arcs.filter(isJsonObject);
  if (!('arcs' in merged)) merged.arcs = [];
  return {
    merged,
    counts: {
      created_count: created,
      updated_count: updated,
      removed_count: removed,
      skipped_count: skipped,
    },
  };
}

/**
 * 挑出超过上限的字段（与 mergePlanPayload 存盘时的上限相同）：超长的不截短了悄悄存，
 * 整次拒绝并说清是哪一章哪一项，让调用方压缩后重试。
 */
export function overlongPlanFields(updates: PlanUpdates): string[] {
  const over: string[] = [];
  const check = (label: string, value: JsonValue | null | undefined, limit: number) => {
    if (typeof value !== 'string') return;
    const length = Array.from(pythonStrip(value)).length;
    if (length > limit) over.push(`${label}有 ${length} 字（上限 ${limit}）`);
  };
  for (const item of updates.chapters ?? []) {
    if (!isJsonObject(item)) continue;
    const ordinal = positiveInt(item.ordinal);
    const name = ordinal === null ? '没有章序的一项' : `第 ${ordinal} 章`;
    check(`${name}的标题`, item.title, 80);
    check(`${name}的目标`, item.goal, MAX_GOAL_CHARS);
    check(`${name}的备注`, item.note, MAX_GOAL_CHARS);
  }
  check('主线', updates.premise, 300);
  return over;
}

/** 挑出「正文还不存在却要标 done」的章序：起草补丁不等于落盘。 */
export function rejectPrematureDone(
  chapters: readonly JsonValue[] | null | undefined,
  written: ReadonlySet<number>,
): number[] {
  return (chapters ?? [])
    .flatMap((item) => {
      if (!isJsonObject(item) || item.status !== STATUS_DONE) return [];
      const ordinal = positiveInt(item.ordinal);
      return ordinal !== null && !written.has(ordinal) ? [ordinal] : [];
    })
    .sort((a, b) => a - b);
}

/** 给要标 done 的章补盖正文相对路径（后端算，不接受模型传）。 */
function withStampedPaths(updates: PlanUpdates, pathByOrdinal: ReadonlyMap<number, string>) {
  if (!updates.chapters?.length) return updates;
  const chapters = updates.chapters.map((item) => {
    if (!isJsonObject(item)) return item;
    const ordinal = positiveInt(item.ordinal);
    const relative = ordinal === null ? undefined : pathByOrdinal.get(ordinal);
    return item.status === STATUS_DONE && relative ? { ...item, path: relative } : item;
  });
  return { ...updates, chapters };
}

/** 循环工具 project.plan_update：读 → 合并 → 原子写；缺计划文件时按空骨架起步。 */
export async function applyPlanUpdate(
  reader: ProjectReader,
  writer: ProjectWriter,
  root: string,
  updates: PlanUpdates,
  platform: 'windows' | 'posix',
) {
  const pathByOrdinal = await writtenOrdinals(reader, root, platform);
  const premature = rejectPrematureDone(updates.chapters, new Set(pathByOrdinal.keys()));
  if (premature.length) {
    const listed = premature.map((ordinal) => `第 ${ordinal} 章`).join('、');
    throw new FsToolError(
      `${listed}的正文还不存在，不能标 done。起草补丁不等于落盘——` +
        '补丁要作者在界面点接受才写进正文，请等作者接受后再标记；' +
        '本次调用未改动计划，回话时也不要说这章已完成。',
    );
  }
  const overlong = overlongPlanFields(updates);
  if (overlong.length)
    throw new FsToolError(
      `${overlong.join('；')}。计划里只存短句，超长的不会截短了存：请压缩后重试，` +
        '长的设定或约束写进设定文件。本次调用未改动计划。',
    );
  const existing = await readPlan(reader, root);
  const stamped = withStampedPaths(updates, await writtenOrdinals(reader, root, platform));
  const { merged, counts } = mergePlanPayload(existing, stamped);
  const planPath = await writePlan(writer, root, merged, platform);
  const plan = await buildPlan(reader, root, platform);
  const next = plan === null ? null : nextChapter(plan);
  return {
    plan_path: PLAN_RELATIVE_PATH,
    planned_total: plan === null ? 0 : plan.chapters.length,
    next_ordinal: next === null ? null : next.ordinal,
    next_goal: next === null ? null : next.goal,
    drifted_count: plan === null ? 0 : driftedChapters(plan).length,
    written_path: planPath,
    ...counts,
  };
}

async function relativeManuscriptPath(
  reader: ProjectReader,
  root: string,
  filePath: string,
): Promise<string | null> {
  try {
    await resolveProjectRoot(reader, root);
    return (await reader.resolveProjectPath(root, filePath)).resolvedRelativePath;
  } catch (error) {
    if (error instanceof FsToolError || error instanceof ProjectReadError) return null;
    throw error;
  }
}

/** 写盘之后的收尾动作一律不抛异常：失败不该回头污染已经成功的写回。 */
async function readPlanQuietly(reader: ProjectReader, root: string): Promise<JsonObject | null> {
  try {
    return await readPlan(reader, root);
  } catch (error) {
    if (error instanceof FsToolError || error instanceof InputDomainError) return null;
    throw error;
  }
}

async function ordinalsOrNull(reader: ProjectReader, root: string, platform: 'windows' | 'posix') {
  try {
    return await chapterOrdinals(reader, root, '*.md', platform);
  } catch (error) {
    if (error instanceof FsToolError || error instanceof ProjectReadError) return null;
    throw error;
  }
}

/**
 * 作者接受补丁、正文落盘后把对应章标 done。刻意保守：计划不存在不建计划、
 * 该章不在计划里不追加、正文实际不存在不标。
 */
export async function markChapterWritten(
  reader: ProjectReader,
  writer: ProjectWriter,
  root: string,
  filePath: string,
  platform: 'windows' | 'posix',
) {
  const relative = await relativeManuscriptPath(reader, root, filePath);
  if (relative === null) return { updated: false, reason: 'path_outside_project' };
  const ordinals = await ordinalsOrNull(reader, root, platform);
  if (ordinals === null) return { updated: false, reason: 'project_unreadable' };
  const ordinal = ordinals.get(relative);
  if (ordinal === undefined)
    return { updated: false, reason: 'not_a_manuscript_chapter', path: relative };
  const plan = await readPlanQuietly(reader, root);
  if (plan === null) return { updated: false, reason: 'plan_unreadable' };
  const chapters = Array.isArray(plan.chapters) ? plan.chapters : [];
  if (!chapters.length) return { updated: false, reason: 'no_plan', ordinal };
  const target = chapters.find(
    (item) => isJsonObject(item) && positiveInt(item.ordinal) === ordinal,
  ) as JsonObject | undefined;
  if (target === undefined) return { updated: false, reason: 'chapter_not_in_plan', ordinal };
  if (target.status === STATUS_DONE) return { updated: false, reason: 'already_done', ordinal };
  // 这篇正文已被另一条按路径认领（撤销前面的新建会让章序整体前移）：不再把它认到按章序对上的这一条，
  // 否则同一篇正文同时顶着两条计划。
  const owner = chapters.find(
    (item) => isJsonObject(item) && item !== target && cleanText(item.path, 400) === relative,
  ) as JsonObject | undefined;
  if (owner !== undefined)
    return {
      updated: false,
      reason: owner.status === STATUS_DONE ? 'already_done' : 'claimed_by_other_chapter',
      ordinal: positiveInt(owner.ordinal) ?? ordinal,
    };
  // 同时记下路径：撤销一次新建会让后面的章序整体前移，届时只有路径认得出是哪一章。
  const { merged } = mergePlanPayload(plan, {
    chapters: [{ ordinal, status: STATUS_DONE, path: relative }],
  });
  await writePlan(writer, root, merged, platform);
  const built = await buildPlan(reader, root, platform);
  const next = built === null ? null : nextChapter(built);
  return {
    updated: true,
    ordinal,
    path: relative,
    next_ordinal: next === null ? null : next.ordinal,
    next_goal: next === null ? null : next.goal,
    plan_path: PLAN_RELATIVE_PATH,
  };
}

/** 作者撤销一次「新建」、正文被删之后，按记下的路径把对应章从 done 退回 pending。 */
export async function unmarkChapterWritten(
  reader: ProjectReader,
  writer: ProjectWriter,
  root: string,
  filePath: string,
  platform: 'windows' | 'posix',
) {
  const relative = await relativeManuscriptPath(reader, root, filePath);
  if (relative === null) return { updated: false, reason: 'path_outside_project' };
  const ordinals = await ordinalsOrNull(reader, root, platform);
  if (ordinals === null) return { updated: false, reason: 'project_unreadable' };
  if (ordinals.has(relative))
    return { updated: false, reason: 'manuscript_still_exists', path: relative };
  const plan = await readPlanQuietly(reader, root);
  if (plan === null) return { updated: false, reason: 'plan_unreadable' };
  const chapters = Array.isArray(plan.chapters) ? plan.chapters : [];
  const target = chapters.find(
    (item) => isJsonObject(item) && cleanText(item.path, 400) === relative,
  ) as JsonObject | undefined;
  if (target === undefined)
    return { updated: false, reason: 'chapter_not_identifiable', path: relative };
  if (target.status !== STATUS_DONE) return { updated: false, reason: 'not_done', path: relative };
  const ordinal = positiveInt(target.ordinal);
  const { merged } = mergePlanPayload(plan, {
    chapters: [{ ordinal, status: STATUS_PENDING, path: null }],
  });
  await writePlan(writer, root, merged, platform);
  const built = await buildPlan(reader, root, platform);
  const next = built === null ? null : nextChapter(built);
  return {
    updated: true,
    ordinal,
    path: relative,
    next_ordinal: next === null ? null : next.ordinal,
    plan_path: PLAN_RELATIVE_PATH,
  };
}
