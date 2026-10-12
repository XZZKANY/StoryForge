import { ProjectReadError, type ProjectReader } from '../readPort';
import { formatChapterWindow, renderAssertionMetadata } from './canonAssertions';
import { readCanon, readHooks } from './canonFiles';
import { chapterOrdinals } from './canonRebuild';
import { FsToolError, isSkippedProjectPath } from './fsTools';
import type { GenerationSourceCapture } from './generationSources';
import { compareCodePoints, isJsonObject, type JsonObject, type JsonValue } from './json';
import { isManuscriptPath } from './manuscript';
import { matchPythonPath } from './pathMatch';
import { PYTHON_WHITESPACE, pythonStrip } from './pythonText';

// 正文文件名 `第NNN章.md` 约定；Python 的 \d 是 Unicode 十进制数字。
const CHAPTER_ORDINAL_PATTERN = new RegExp(
  `第${PYTHON_WHITESPACE}*(\\p{Nd}+)${PYTHON_WHITESPACE}*章`,
  'u',
);
const DIGIT = /\p{Nd}/u;
const MAX_DISPLAY_ALIASES = 3;
const ACTIVE_STATUSES = new Set(['active', 'planted']);
const STALE_HOOK_THRESHOLD = 10;

const objects = (value: JsonValue | undefined): JsonObject[] =>
  Array.isArray(value) ? value.filter(isJsonObject) : [];
const isInt = (value: JsonValue | undefined): value is number => typeof value === 'number';
const slicePoints = (text: string, end: number) => Array.from(text).slice(0, end).join('');

/** Unicode 十进制数字串是否大于 0（每段 Nd 都是连续的 0–9）。 */
function positiveDecimal(digits: string): boolean {
  return Array.from(digits).some((char) => {
    let start = char.codePointAt(0)!;
    while (DIGIT.test(String.fromCodePoint(start - 1))) start -= 1;
    return (char.codePointAt(0)! - start) % 10 !== 0;
  });
}

/** 项目相对或绝对路径 → 同一项目内解析后的相对路径；Windows 驱动器相对路径不可冒充项目内文件。 */
async function toRelativePosix(
  reader: ProjectReader,
  root: string,
  current: string,
  platform: 'windows' | 'posix',
): Promise<string | null> {
  const spelling = current.replace(/\\/g, '/');
  const drive = spelling[1] === ':' || /^\/\/[^/]+\/[^/]+/.test(spelling);
  const absolute =
    platform === 'windows' ? /^(?:.:\/|\/\/[^/]+\/[^/]+)/.test(spelling) : spelling.startsWith('/');
  if (drive && !absolute) return null;
  try {
    return (await reader.resolveProjectPath(root, spelling)).resolvedRelativePath;
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
    return null;
  }
}

/**
 * 数字章名只确认这是待写章节；章序仍按全书路径阅读序插入，不能把分卷重置的「第001章」当成全书章序。
 */
async function unwrittenChapterOrdinal(
  reader: ProjectReader,
  root: string,
  relative: string,
  ordinals: ReadonlyMap<string, number>,
  platform: 'windows' | 'posix',
): Promise<number | null> {
  if (
    !matchPythonPath(relative, '*.md', platform) ||
    !isManuscriptPath(relative) ||
    isSkippedProjectPath(relative)
  )
    return null;
  const match = CHAPTER_ORDINAL_PATTERN.exec(relative.split('/').slice(-1)[0]);
  if (match === null || !positiveDecimal(match[1])) return null;
  try {
    if ((await reader.inspectProjectPath(root, relative)).targetKind !== 'missing') return null;
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
    return null;
  }
  return [...ordinals.keys()].filter((path) => compareCodePoints(path, relative) < 0).length + 1;
}

function windowCovers(entry: JsonObject, current: number): boolean {
  const low = isInt(entry.from_chapter) ? entry.from_chapter : 1;
  if (!isInt(entry.to_chapter)) return current >= low;
  return low <= current && current <= entry.to_chapter;
}

/** 本名（又称 别名 / 别名）：让模型认出「老陈」就是「陈默」。 */
function displayName(entity: JsonObject, canonicalName: string): string {
  const aliases = (Array.isArray(entity.aliases) ? entity.aliases : [])
    .filter((alias): alias is string => typeof alias === 'string')
    .map(pythonStrip)
    .filter((alias) => alias && alias !== canonicalName);
  if (!aliases.length) return canonicalName;
  return `${canonicalName}（又称 ${aliases.slice(0, MAX_DISPLAY_ALIASES).join(' / ')}）`;
}

function lastOrdinal(
  hook: JsonObject,
  ordinals: ReadonlyMap<string, number>,
): [number, string] | null {
  for (const [key, label] of [
    ['last_advanced_at', '推进'],
    ['planted_at', '埋'],
  ] as const) {
    const anchor = hook[key];
    if (!isJsonObject(anchor) || typeof anchor.path !== 'string' || !pythonStrip(anchor.path))
      continue;
    const ordinal = ordinals.get(pythonStrip(anchor.path));
    if (ordinal !== undefined && ordinal > 0) return [ordinal, label];
  }
  return null;
}

async function activeHooksBlock(
  reader: ProjectReader,
  root: string,
  current: number | null,
  hooks: JsonObject,
  platform: 'windows' | 'posix',
): Promise<string | null> {
  const active = objects(hooks.hooks).filter(
    (hook) => typeof hook.status === 'string' && ACTIVE_STATUSES.has(hook.status),
  );
  if (!active.length) return null;
  let ordinals = new Map<string, number>();
  if (current !== null) {
    try {
      ordinals = await chapterOrdinals(reader, root, '*.md', platform);
    } catch (error) {
      if (!(error instanceof FsToolError)) throw error;
    }
  }
  const staleDetail: string[] = [];
  let staleCount = 0;
  const lines: string[] = [];
  for (const hook of active) {
    const description = hook.description ?? '';
    if (typeof description !== 'string' || !pythonStrip(description)) continue;
    const planted = hook.planted_at;
    const displayChapter = isJsonObject(planted) ? planted.chapter : undefined;
    const chapterHint = isInt(displayChapter) ? `（第 ${displayChapter} 章埋）` : '';
    let stale = false;
    if (current !== null) {
      const reference = lastOrdinal(hook, ordinals);
      if (reference !== null && current > reference[0]) {
        const diff = current - reference[0];
        if (diff > STALE_HOOK_THRESHOLD) {
          stale = true;
          staleCount += 1;
          staleDetail.push(
            `「${slicePoints(description, 40)}」自第 ${reference[0]} 章${reference[1]}后已沉睡 ${diff} 章`,
          );
        }
      }
    }
    const category = hook.category ?? '';
    const categoryHint =
      typeof category === 'string' && pythonStrip(category) ? `[${category}]` : '';
    const note = hook.note ?? '';
    const noteHint = typeof note === 'string' && pythonStrip(note) ? `——${note}` : '';
    const prefix = categoryHint ? `${categoryHint} ` : '';
    lines.push(`${stale ? '⚠ ' : '· '}${prefix}${description}${chapterHint}${noteHint}`);
  }
  if (!lines.length) return null;
  let block = '[活跃伏笔 · 待回收]\n' + lines.join('\n');
  if (staleDetail.length)
    block += '\n⚠ 伏笔健康：' + staleDetail.join('；') + '。请评估是回收还是延长排期。';
  else if (staleCount)
    block += `\n⚠ ${staleCount} 条伏笔超过 ${STALE_HOOK_THRESHOLD} 章未推进，请注意回收。`;
  return block;
}

/** hooks.json 顶层可选 agenda: {章号: {advance: [hook_id], resolve: [hook_id]}} → 本章伏笔计划。 */
function hookAgendaBlock(current: number | null, hooks: JsonObject): string | null {
  if (current === null) return null;
  const agenda = isJsonObject(hooks.agenda) ? hooks.agenda : null;
  const plan = agenda === null ? null : agenda[String(current)];
  if (!isJsonObject(plan)) return null;
  const advance = Array.isArray(plan.advance) ? plan.advance : [];
  const resolve = Array.isArray(plan.resolve) ? plan.resolve : [];
  if (!advance.length && !resolve.length) return null;
  const byId = new Map<string, JsonObject>();
  for (const hook of objects(hooks.hooks)) if (typeof hook.id === 'string') byId.set(hook.id, hook);
  const describe = (ids: JsonValue[]) =>
    ids
      .map((id) => {
        const hook = byId.get(id as string);
        const description = hook ? hook.description || id : id;
        return `「${slicePoints(description as string, 60)}」`;
      })
      .join('、');
  const lines: string[] = [];
  if (advance.length) lines.push('· 应推进：' + describe(advance));
  if (resolve.length) lines.push('· 应回收：' + describe(resolve));
  return '[本章伏笔计划]\n' + lines.join('\n');
}

/**
 * 确定性拼接场景声明与约束；只读 canon.json / hooks.json + 章序，不扫正文。
 * 读不到返回 null（调用方静默跳过）；作者声明超出输入范围抛 InputDomainError。
 */
export async function buildSceneConstraintBlock(
  reader: ProjectReader,
  root: string,
  currentFile: string | null,
  options: { platform: 'windows' | 'posix'; capture?: GenerationSourceCapture },
): Promise<string | null> {
  const { platform, capture } = options;
  let canon: JsonObject;
  try {
    canon = await readCanon(reader, root, capture);
  } catch (error) {
    if (!(error instanceof FsToolError)) throw error;
    capture?.project('canon_constraints', null, {
      channel: 'user',
      omissionReason: 'unavailable_canon',
    });
    return null;
  }
  const invariants = isJsonObject(canon.invariants) ? canon.invariants : {};

  const nameById = new Map<string, string>();
  for (const entity of objects(canon.entities)) {
    if (typeof entity.id === 'string' && typeof entity.canonical_name === 'string')
      nameById.set(entity.id, displayName(entity, entity.canonical_name));
  }

  let current: number | null = null;
  if (currentFile) {
    const relative = await toRelativePosix(reader, root, currentFile, platform);
    if (relative !== null) {
      let ordinals: Map<string, number> | null = null;
      try {
        ordinals = await chapterOrdinals(reader, root, '*.md', platform);
      } catch (error) {
        if (!(error instanceof FsToolError)) throw error;
      }
      if (ordinals !== null) {
        current =
          ordinals.get(relative) ??
          (await unwrittenChapterOrdinal(reader, root, relative, ordinals, platform));
      }
      await capture?.selectWithHashes(
        'canon_chapter_order',
        { current_file: relative, current_ordinal: current },
        { ordinals: ordinals ?? new Map() },
      );
    }
  }

  const lines: string[] = [];
  const inferredLines: string[] = [];
  for (const entry of objects((invariants as JsonObject).single_holder)) {
    if (current !== null && !windowCovers(entry, current)) continue;
    const { item, holder } = entry;
    if (typeof item !== 'string' || typeof holder !== 'string') continue;
    if (!pythonStrip(item) || !pythonStrip(holder)) continue;
    const inferred = entry.assertion_type === 'model_inference';
    let line = `·「${item}」唯一持有者 = ${nameById.get(holder) ?? holder}（${formatChapterWindow(entry)}）`;
    if (current !== null && !inferred) line += '；本章不得出现第二持有者。';
    line += `；${renderAssertionMetadata(entry)}`;
    (inferred ? inferredLines : lines).push(line);
  }
  for (const entry of objects((invariants as JsonObject).lifespan)) {
    const exitsAfter = entry.exits_after_chapter;
    if (!isInt(exitsAfter)) continue;
    const entityId = entry.entity;
    if (typeof entityId !== 'string' || !pythonStrip(entityId)) continue;
    const display = nameById.get(entityId) ?? entityId;
    const reason = entry.reason;
    const reasonSuffix = typeof reason === 'string' && pythonStrip(reason) ? `（${reason}）` : '';
    if (current !== null && exitsAfter >= current) continue;
    const inferred = entry.assertion_type === 'model_inference';
    let line =
      current === null || inferred
        ? `·声明「${display}」于第 ${exitsAfter} 章退场${reasonSuffix}。`
        : `·「${display}」已于第 ${exitsAfter} 章退场${reasonSuffix}——本章若出现须为回忆 / 提及。`;
    line += `；${renderAssertionMetadata(entry)}`;
    (inferred ? inferredLines : lines).push(line);
  }

  let hooks: JsonObject = {};
  try {
    hooks = await readHooks(reader, root, capture);
  } catch (error) {
    if (!(error instanceof FsToolError)) throw error;
  }
  const hooksBlock = await activeHooksBlock(reader, root, current, hooks, platform);
  const agendaBlock = hookAgendaBlock(current, hooks);

  if (!lines.length && !inferredLines.length && hooksBlock === null && agendaBlock === null) {
    capture?.project('canon_constraints', null, {
      channel: 'user',
      omissionReason: 'no_active_constraints',
    });
    return null;
  }
  const parts: string[] = [];
  const anchor =
    current !== null
      ? `（本文件 = 第 ${current} 章 · 阅读序）`
      : '（全书 · 章序未知；须按各自时间范围判断，不代表同时适用于本章）';
  if (lines.length) {
    const heading = current !== null ? '[canon 硬约束 · 确定性 · 勿违背]' : '[canon 分阶段声明]';
    parts.push(heading + anchor + '\n' + lines.join('\n'));
  }
  if (inferredLines.length)
    parts.push('[canon 模型推断 · 待核实 · 非硬约束]' + anchor + '\n' + inferredLines.join('\n'));
  if (hooksBlock !== null) parts.push(hooksBlock);
  if (agendaBlock !== null) parts.push(agendaBlock);
  const block = parts.join('\n\n');
  capture?.project('canon_constraints', block, {
    channel: 'user',
    sourcePurpose: ['canon_declaration', 'hook_declaration'],
    transformation: 'scene_constraints_and_hook_agenda_v2',
  });
  return block;
}
