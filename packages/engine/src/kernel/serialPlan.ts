import { ProjectReadError, type ProjectReader } from '../readPort';
import { platformTextBytes, type ProjectWriter } from '../writePort';
import { chapterOrdinals } from './canonRebuild';
import { FsToolError, nativeProjectPath, resolveProjectRoot } from './fsTools';
import {
  dumpJson,
  InputDomainError,
  isJsonObject,
  JsonFields,
  parseJsonBytes,
  type JsonObject,
  type JsonValue,
} from './json';
import { MAX_READ_BYTES } from './projectTree';
import { pythonStrip } from './pythonText';

export const PLAN_RELATIVE_PATH = '.storyforge/serial-plan.json';
export const STATUS_PENDING = 'pending';
export const STATUS_DONE = 'done';
export const STATUS_BLOCKED = 'blocked';
export const ALLOWED_STATUSES = new Set([STATUS_PENDING, STATUS_DONE, STATUS_BLOCKED]);
const EMPTY_PLAN = (): JsonObject => ({ version: 1, chapters: [], arcs: [] });
// 计划块只报「下一章 + 紧随其后的几章」：再多就从坐标变成一份目录。
const UPCOMING_PREVIEW_COUNT = 3;
const MAX_DRIFT_LINES = 5;
export const MAX_GOAL_CHARS = 200;

/** 计划里的一章。`written` 来自正文实际存在与否，不是计划自己说的。 */
export type PlannedChapter = {
  ordinal: number;
  title: string | null;
  goal: string | null;
  status: string;
  note: string | null;
  /** 落盘时后端记下的相对路径：章序是「路径序第几个」，正文有空缺时只有路径认得出是哪一章。 */
  declaredPath: string | null;
  written: boolean;
  writtenPath: string | null;
};

export type SerialPlan = {
  premise: string | null;
  chapterWordCountMin: number | null;
  chapterWordCountMax: number | null;
  chapters: PlannedChapter[];
  arcs: JsonObject[];
  writtenOrdinals: ReadonlySet<number>;
};

const displayTitle = (chapter: PlannedChapter) =>
  `第 ${chapter.ordinal} 章` + (chapter.title ? `《${chapter.title}》` : '');
/** 计划声明与正文事实对不上：写了却没标 done，或标了 done 却没正文。 */
const drifted = (chapter: PlannedChapter) => chapter.written !== (chapter.status === STATUS_DONE);
/** 下一章待写：正文里还不存在、且未被作者标记 blocked 的最小章序（以正文为准，不以 status 为准）。 */
export const nextChapter = (plan: SerialPlan) =>
  plan.chapters.find((chapter) => !chapter.written && chapter.status !== STATUS_BLOCKED) ?? null;
export const driftedChapters = (plan: SerialPlan) => plan.chapters.filter(drifted);

export function cleanText(value: JsonValue | undefined, limit = MAX_GOAL_CHARS): string | null {
  if (typeof value !== 'string') return null;
  const text = pythonStrip(value);
  return text ? Array.from(text).slice(0, limit).join('') : null;
}

export function positiveInt(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}

/** serial-plan.json 读到的字段按应用写出的格式校验（迁移计划 §4.3.1）。 */
function checkPlan(plan: JsonObject, source: string) {
  const fields = new JsonFields(source);
  fields.optionalString(fields.member(plan, 'premise'), 'premise');
  for (const key of ['chapter_word_count_min', 'chapter_word_count_max'])
    fields.optionalInteger(fields.member(plan, key), key);
  fields.optionalArray(fields.member(plan, 'chapters'), 'chapters').forEach((value, index) => {
    const at = `chapters[${index}]`;
    const chapter = fields.object(value, at);
    fields.optionalInteger(fields.member(chapter, 'ordinal'), `${at}.ordinal`);
    for (const key of ['title', 'goal', 'status', 'note', 'path'])
      fields.optionalString(fields.member(chapter, key), `${at}.${key}`);
  });
  fields.optionalArray(fields.member(plan, 'arcs'), 'arcs').forEach((value, index) => {
    const at = `arcs[${index}]`;
    const arc = fields.object(value, at);
    fields.optionalString(fields.member(arc, 'title'), `${at}.title`);
    fields.optionalInteger(fields.member(arc, 'payoff_chapter'), `${at}.payoff_chapter`);
    fields
      .optionalArray(fields.member(arc, 'target_chapters'), `${at}.target_chapters`)
      .forEach((target, i) => fields.integer(target, `${at}.target_chapters[${i}]`));
  });
}

/** 读作者的 serial-plan.json；不存在时返回空骨架。读不到报 FsToolError，写错报 InputDomainError。 */
export async function readPlan(reader: ProjectReader, root: string): Promise<JsonObject> {
  await resolveProjectRoot(reader, root);
  let raw: Uint8Array;
  try {
    if ((await reader.inspectProjectPath(root, PLAN_RELATIVE_PATH)).targetKind !== 'file')
      return EMPTY_PLAN();
    const target = await reader.resolveProjectPath(root, PLAN_RELATIVE_PATH);
    const read = await reader.readProjectBytes(root, target.resolvedRelativePath, MAX_READ_BYTES);
    if (read.exceeded) throw new InputDomainError(`${PLAN_RELATIVE_PATH}：文件超过 2 MiB`);
    raw = read.bytes;
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
    throw new FsToolError(`serial-plan.json 无法解析：${error.message}`);
  }
  const plan = new JsonFields(PLAN_RELATIVE_PATH).object(
    parseJsonBytes(raw, PLAN_RELATIVE_PATH),
    '顶层',
  );
  checkPlan(plan, PLAN_RELATIVE_PATH);
  for (const [key, value] of Object.entries(EMPTY_PLAN())) if (!(key in plan)) plan[key] = value;
  return plan;
}

/** 原子写 serial-plan.json（作者所有的连载计划），返回落盘的绝对路径。 */
export async function writePlan(
  writer: ProjectWriter,
  root: string,
  payload: JsonObject,
  platform: 'windows' | 'posix',
): Promise<string> {
  const text = dumpJson(payload, { indent: 2, ensureAscii: false });
  await writer.writeProjectFile(root, PLAN_RELATIVE_PATH, platformTextBytes(text, platform));
  return nativeProjectPath(root, PLAN_RELATIVE_PATH, platform);
}

export async function planExists(reader: ProjectReader, root: string): Promise<boolean> {
  try {
    await resolveProjectRoot(reader, root);
    return (await reader.inspectProjectPath(root, PLAN_RELATIVE_PATH)).targetKind === 'file';
  } catch (error) {
    if (error instanceof FsToolError || error instanceof ProjectReadError) return false;
    throw error;
  }
}

/** 正文实际落盘的章序；口径与作品底座 / canon 闸同一把尺。 */
export async function writtenOrdinals(
  reader: ProjectReader,
  root: string,
  platform: 'windows' | 'posix',
): Promise<Map<number, string>> {
  try {
    const ordinals = await chapterOrdinals(reader, root, '*.md', platform);
    return new Map([...ordinals].map(([relative, ordinal]) => [ordinal, relative]));
  } catch (error) {
    if (error instanceof FsToolError || error instanceof ProjectReadError) return new Map();
    throw error;
  }
}

/** 确定性投影出连载计划；计划文件读不到或没有章节时返回 null。 */
export async function buildPlan(
  reader: ProjectReader,
  root: string,
  platform: 'windows' | 'posix',
): Promise<SerialPlan | null> {
  let raw: JsonObject;
  try {
    raw = await readPlan(reader, root);
  } catch (error) {
    if (error instanceof FsToolError) return null;
    throw error;
  }
  const pathByOrdinal = await writtenOrdinals(reader, root, platform);
  const manuscriptPaths = new Set(pathByOrdinal.values());
  const rawChapters = (Array.isArray(raw.chapters) ? raw.chapters : []).filter(isJsonObject);
  // 已被别的条目按路径认领的正文：章序回退时必须跳过，否则会拿别人的文件当在场证据。
  const claimed = new Set(
    rawChapters.map((item) => cleanText(item.path, 400)).filter((path) => path !== null),
  );
  const chapters: PlannedChapter[] = [];
  for (const item of rawChapters) {
    const ordinal = positiveInt(item.ordinal);
    if (ordinal === null) continue;
    const declaredPath = cleanText(item.path, 400);
    let written: boolean;
    let writtenPath: string | null;
    if (declaredPath) {
      written = manuscriptPaths.has(declaredPath);
      writtenPath = written ? declaredPath : null;
    } else {
      const candidate = pathByOrdinal.get(ordinal);
      written = candidate !== undefined && !claimed.has(candidate);
      writtenPath = written ? candidate! : null;
    }
    const status = item.status;
    chapters.push({
      ordinal,
      title: cleanText(item.title, 80),
      goal: cleanText(item.goal),
      status: typeof status === 'string' && ALLOWED_STATUSES.has(status) ? status : STATUS_PENDING,
      note: cleanText(item.note),
      declaredPath,
      written,
      writtenPath,
    });
  }
  if (!chapters.length) return null;
  chapters.sort((a, b) => a.ordinal - b.ordinal);
  return {
    premise: cleanText(raw.premise, 300),
    chapterWordCountMin: positiveInt(raw.chapter_word_count_min),
    chapterWordCountMax: positiveInt(raw.chapter_word_count_max),
    chapters,
    arcs: (Array.isArray(raw.arcs) ? raw.arcs : []).filter(isJsonObject),
    writtenOrdinals: new Set(pathByOrdinal.keys()),
  };
}

function arcLines(plan: SerialPlan, next: number): string[] {
  const lines: string[] = [];
  for (const arc of plan.arcs) {
    const title = cleanText(arc.title, 60);
    if (!title) continue;
    const targets = (Array.isArray(arc.target_chapters) ? arc.target_chapters : []).filter(
      (target) => typeof target === 'number',
    );
    const payoff = positiveInt(arc.payoff_chapter);
    if (targets.includes(next))
      lines.push(`· 「${title}」本章是推进点` + (payoff ? `，兑现在第 ${payoff} 章` : ''));
    else if (payoff === next) lines.push(`· 「${title}」本章是兑现章`);
  }
  return lines;
}

function driftSection(plan: SerialPlan): string | null {
  const list = driftedChapters(plan);
  if (!list.length) return null;
  const lines = list
    .slice(0, MAX_DRIFT_LINES)
    .map((chapter) =>
      chapter.written
        ? `· ${displayTitle(chapter)}：正文已存在，但计划仍标 ${chapter.status}`
        : `· ${displayTitle(chapter)}：计划标 done，但正文里找不到这一章`,
    );
  if (list.length > MAX_DRIFT_LINES)
    lines.push(`· …另有 ${list.length - MAX_DRIFT_LINES} 章对不上。`);
  lines.push('以正文为准；确认后用 project_plan_update 把计划状态改对，不要照计划重写已有正文。');
  return '[计划与正文对不上]\n' + lines.join('\n');
}

/** 把计划投影拼成 system 块。 */
export function renderPlanBlock(plan: SerialPlan): string {
  const writtenPlanned = plan.chapters.filter((chapter) => chapter.written).length;
  const progress = [`计划共 ${plan.chapters.length} 章`, `其中 ${writtenPlanned} 章正文已落盘`];
  if (plan.chapterWordCountMin && plan.chapterWordCountMax)
    progress.push(`每章目标 ${plan.chapterWordCountMin}–${plan.chapterWordCountMax} 字`);
  const head = ['[连载计划 · 确定性]', '· ' + progress.join('；') + '。'];
  if (plan.premise) head.push(`· 主线：${plan.premise}`);
  const sections = [head.join('\n')];
  const next = nextChapter(plan);
  if (next !== null) {
    const lines = [`· ${displayTitle(next)}`];
    if (next.goal) lines.push(`· 本章目标：${next.goal}`);
    if (next.note) lines.push(`· 备注：${next.note}`);
    lines.push(...arcLines(plan, next.ordinal));
    sections.push('[下一章待写]\n' + lines.join('\n'));
    const upcoming = plan.chapters
      .filter((chapter) => !chapter.written && chapter.status !== STATUS_BLOCKED)
      .slice(1, UPCOMING_PREVIEW_COUNT + 1);
    if (upcoming.length)
      sections.push(
        '[再往后]\n' +
          upcoming
            .map(
              (chapter) => `· ${displayTitle(chapter)}` + (chapter.goal ? `：${chapter.goal}` : ''),
            )
            .join('\n'),
      );
  } else {
    sections.push('[下一章待写]\n· 计划内的章节都已落正文；要继续写得先把新章加进计划。');
  }
  const blocked = plan.chapters.filter(
    (chapter) => chapter.status === STATUS_BLOCKED && !chapter.written,
  );
  if (blocked.length)
    sections.push(
      '[作者标记卡住 · 别自作主张开写]\n' +
        blocked
          .slice(0, MAX_DRIFT_LINES)
          .map(
            (chapter) => `· ${displayTitle(chapter)}` + (chapter.note ? `：${chapter.note}` : ''),
          )
          .join('\n'),
    );
  const drift = driftSection(plan);
  if (drift) sections.push(drift);
  return sections.join('\n\n');
}

/** 「连载计划」system 块；无计划时 null。作者计划写错时报错，不悄悄当作没有计划。 */
export async function buildPlanBlock(
  reader: ProjectReader,
  root: string,
  platform: 'windows' | 'posix',
): Promise<string | null> {
  let plan: SerialPlan | null;
  try {
    plan = await buildPlan(reader, root, platform);
  } catch (error) {
    if (error instanceof FsToolError || error instanceof ProjectReadError) return null;
    throw error;
  }
  return plan === null ? null : renderPlanBlock(plan);
}

/** 交给桌面端的只读投影：作者看见的就是模型看见的那一份。 */
export function toPlanPayload(plan: SerialPlan) {
  const next = nextChapter(plan);
  return {
    planned_total: plan.chapters.length,
    written_count: plan.chapters.filter((chapter) => chapter.written).length,
    premise: plan.premise,
    chapter_word_count_min: plan.chapterWordCountMin,
    chapter_word_count_max: plan.chapterWordCountMax,
    chapters: plan.chapters.map((chapter) => ({
      ordinal: chapter.ordinal,
      title: chapter.title,
      goal: chapter.goal,
      status: chapter.status,
      note: chapter.note,
      written: chapter.written,
      written_path: chapter.writtenPath,
      drifted: drifted(chapter),
    })),
    next_ordinal: next === null ? null : next.ordinal,
    drifted_count: driftedChapters(plan).length,
    prompt_block: renderPlanBlock(plan),
  };
}
