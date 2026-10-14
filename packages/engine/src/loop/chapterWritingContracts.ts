import { FsToolError, resolveProjectRoot } from '../kernel/fsTools';
import { resolveNewProjectFile } from '../kernel/fsProjectTools';
import { dumpJson, InputDomainError, isJsonObject, parseJson } from '../kernel/json';
import { PYTHON_WHITESPACE, pythonStrip } from '../kernel/pythonText';
import { buildPlan, nextChapter, type PlannedChapter, type SerialPlan } from '../kernel/serialPlan';
import { ProjectReadError, type ProjectReader } from '../readPort';
import { AgentOrchestrationError } from './runPayloads';

type Obj = { [key: string]: unknown };
const points = (text: string) => Array.from(text);

export const CHAPTER_BRIEF_ARTIFACT_KIND = 'chapter_brief';
export const CHAPTER_CHECK_ARTIFACT_KIND = 'chapter_check';
export const CHAPTER_CANDIDATE_ARTIFACT_KIND = 'chapter_candidate';
export const CHAPTER_WRITE_INTENT = 'chapter.write';

const MAX_LIST_ITEMS = 12;
const MAX_ITEM_CHARS = 300;

/** Python 的 value.strip()[:limit]，空串视为没有。 */
export function textValue(value: unknown, limit: number): string | null {
  if (typeof value !== 'string' || !pythonStrip(value)) return null;
  return points(pythonStrip(value)).slice(0, limit).join('');
}

export function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const text = textValue(item, MAX_ITEM_CHARS);
    if (text && !result.includes(text)) result.push(text);
    if (result.length >= MAX_LIST_ITEMS) break;
  }
  return result;
}

export const positiveInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

const ORDINAL = new RegExp(`第${PYTHON_WHITESPACE}*(\\p{Nd}+)${PYTHON_WHITESPACE}*章`, 'u');
const DIGIT = /\p{Nd}/u;

/** Unicode 十进制数字串的值（Python int() 认全角等十进制数字）。 */
function decimalValue(digits: string): number {
  let value = 0;
  for (const char of digits) {
    let zero = char.codePointAt(0)!;
    while (DIGIT.test(String.fromCodePoint(zero - 1))) zero -= 1;
    value = value * 10 + ((char.codePointAt(0)! - zero) % 10);
  }
  return value;
}

function chapterOrdinalFromPath(relative: string): number | null {
  const match = ORDINAL.exec(relative.split('/').pop() ?? relative);
  if (match === null) return null;
  const value = decimalValue(match[1]);
  return value > 0 ? value : null;
}

/** 显式目标是不是计划的下一章：记过落盘路径就按路径认，没记过才退到章号。 */
function targetMatchesPlanned(relative: string, planned: PlannedChapter | null): boolean {
  if (planned === null) return false;
  if (planned.declaredPath) return planned.declaredPath === relative;
  const ordinal = chapterOrdinalFromPath(relative);
  return ordinal !== null && ordinal === planned.ordinal;
}

const isAbsolute = (path: string, platform: 'windows' | 'posix') =>
  platform === 'windows'
    ? /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/]/.test(path)
    : path.startsWith('/');

/** Path(text).as_posix()：词法规范化，保留 `..`。 */
function lexicalPosix(text: string, platform: 'windows' | 'posix'): string {
  const spelling = platform === 'windows' ? text.replace(/\\/g, '/') : text;
  const leading = spelling.startsWith('/') ? '/' : '';
  return (
    leading +
    spelling
      .split('/')
      .filter((part) => part !== '' && part !== '.')
      .join('/')
  );
}

async function relativePath(
  reader: ProjectReader,
  root: string,
  value: unknown,
  platform: 'windows' | 'posix',
): Promise<string | null> {
  const text = textValue(value, 1024);
  if (text === null) return null;
  if (isAbsolute(text, platform)) {
    try {
      return (await reader.resolveProjectPath(root, text)).resolvedRelativePath;
    } catch (error) {
      if (!(error instanceof ProjectReadError)) throw error;
      throw new AgentOrchestrationError('目标章节不在当前项目内。');
    }
  }
  return lexicalPosix(text, platform);
}

export type ResolvedTarget = {
  readonly relative: string;
  /** 新文件的项目相对路径（调用方按平台拼成绝对路径）。 */
  readonly target: string;
  readonly planned: PlannedChapter | null;
};

/** 写章目标：显式目标优先，否则连载计划声明的下一章；显式目标不是计划下一章时不借用计划的标题 / 目标。 */
export async function resolveTarget(
  reader: ProjectReader,
  root: string,
  requested: unknown,
  platform: 'windows' | 'posix',
): Promise<ResolvedTarget> {
  await resolveProjectRoot(reader, root);
  const requestedRelative = await relativePath(reader, root, requested, platform);
  const plan = await buildPlan(reader, root, platform);
  let planned = plan !== null ? nextChapter(plan) : null;
  let relative = requestedRelative;
  if (relative === null && planned !== null)
    relative = planned.declaredPath || `正文/第${String(planned.ordinal).padStart(3, '0')}章.md`;
  if (relative === null)
    throw new AgentOrchestrationError(
      '写一章需要目标文件：请先打开空章节文件，或在连载计划中声明下一章。',
    );
  let target: string;
  try {
    target = await resolveNewProjectFile(reader, root, relative);
  } catch (error) {
    if (error instanceof FsToolError) throw new AgentOrchestrationError(error.message);
    throw error;
  }
  if (requestedRelative !== null && !targetMatchesPlanned(relative, planned)) planned = null;
  return { relative, target, planned };
}

export function buildBriefSeed(input: {
  userMessage: string;
  targetPath: string;
  planned: PlannedChapter | null;
  plan: SerialPlan | null;
}): Obj {
  const { planned, plan } = input;
  return {
    target_path: input.targetPath,
    chapter_ordinal: planned !== null ? planned.ordinal : null,
    chapter_title: planned !== null ? planned.title : null,
    goal: planned !== null && planned.goal ? planned.goal : input.userMessage,
    pov: null,
    setting: null,
    required_beats: [],
    forbidden_items: [],
    continuity_constraints: [],
    target_chars_min: (plan !== null ? plan.chapterWordCountMin : null) || 1600,
    target_chars_max: (plan !== null ? plan.chapterWordCountMax : null) || 2600,
  };
}

export function briefPrompt(seed: Obj, userMessage: string): string {
  return (
    '把作者的写章要求整理成 Chapter Brief。只输出 JSON 对象，不要代码块。' +
    '字段必须是 target_path, chapter_ordinal, chapter_title, goal, pov, setting, ' +
    'required_beats, forbidden_items, continuity_constraints, target_chars_min, target_chars_max。' +
    '不得更改 target_path/chapter_ordinal；缺少信息用 null 或空数组，不得编造项目事实。\n' +
    `后端确定种子：${dumpJson(seed, { ensureAscii: false })}\n作者要求：${userMessage}`
  );
}

const STRUCTURED_FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

function jsonObject(raw: unknown): Obj {
  if (isJsonObject(raw as never)) return { ...(raw as Obj) };
  if (typeof raw !== 'string') throw new AgentOrchestrationError('模型未返回可解析的结构化结果。');
  let text = pythonStrip(raw);
  const fence = STRUCTURED_FENCE.exec(text);
  if (fence) text = fence[1];
  let parsed: unknown;
  try {
    parsed = parseJson(text, 'chapter brief');
  } catch (error) {
    if (error instanceof InputDomainError)
      throw new AgentOrchestrationError('模型返回的结构化结果不是有效 JSON。');
    throw error;
  }
  if (!isJsonObject(parsed as never))
    throw new AgentOrchestrationError('模型返回的结构化结果必须是 JSON 对象。');
  return parsed as Obj;
}

export function parseBrief(
  raw: unknown,
  options: { seed: Obj; provenance: Obj; newHex: () => string },
): Obj {
  const { seed } = options;
  const payload = jsonObject(raw);
  let minimum = positiveInt(payload.target_chars_min) || Number(seed.target_chars_min);
  let maximum = positiveInt(payload.target_chars_max) || Number(seed.target_chars_max);
  if (minimum > maximum) [minimum, maximum] = [maximum, minimum];
  return {
    brief_id: `chapter-brief-${options.newHex()}`,
    revision: 1,
    target_path: String(seed.target_path),
    chapter_ordinal: seed.chapter_ordinal ?? null,
    chapter_title: textValue(payload.chapter_title, 100) || (seed.chapter_title ?? null),
    goal: textValue(payload.goal, 1000) || String(seed.goal),
    pov: textValue(payload.pov, 100),
    setting: textValue(payload.setting, 200),
    required_beats: textList(payload.required_beats),
    forbidden_items: textList(payload.forbidden_items),
    continuity_constraints: textList(payload.continuity_constraints),
    target_chars_min: minimum,
    target_chars_max: maximum,
    context_provenance: { ...options.provenance },
  };
}

/** 作者确认的 brief：必须就是待确认的那一版，可编辑字段逐个重新收口，修订号加一。 */
export function confirmBrief(candidate: unknown, pending: Obj): Obj {
  if (!isJsonObject(candidate as never))
    throw new AgentOrchestrationError('确认写章前需要提交结构化 Chapter Brief。');
  const edited = candidate as Obj;
  if (edited.brief_id !== pending.brief_id || edited.revision !== pending.revision)
    throw new AgentOrchestrationError('Chapter Brief 已过期，请重新生成后再确认。');
  const confirmed: Obj = { ...pending };
  for (const [key, limit] of [
    ['chapter_title', 100],
    ['goal', 1000],
    ['pov', 100],
    ['setting', 200],
  ] as const)
    confirmed[key] = textValue(edited[key], limit);
  for (const key of ['required_beats', 'forbidden_items', 'continuity_constraints'])
    confirmed[key] = textList(edited[key]);
  const minimum = positiveInt(edited.target_chars_min);
  const maximum = positiveInt(edited.target_chars_max);
  if (minimum === null || maximum === null || minimum > maximum)
    throw new AgentOrchestrationError('Chapter Brief 字数范围无效。');
  confirmed.target_chars_min = minimum;
  confirmed.target_chars_max = maximum;
  confirmed.revision = Math.trunc(Number(pending.revision)) + 1;
  confirmed.status = 'confirmed';
  return confirmed;
}

export function draftInstruction(brief: Obj): string {
  const lines = [
    `章节目标：${brief.goal || '按已确认 brief 写作'}`,
    `目标字数：${brief.target_chars_min}–${brief.target_chars_max} 字`,
  ];
  for (const [label, key] of [
    ['视角', 'pov'],
    ['场景', 'setting'],
    ['必达节拍', 'required_beats'],
    ['禁写事项', 'forbidden_items'],
    ['连续性约束', 'continuity_constraints'],
  ]) {
    const value = brief[key];
    if (Array.isArray(value) && value.length)
      lines.push(`${label}：${value.map(String).join('；')}`);
    else if (typeof value === 'string' && value) lines.push(`${label}：${value}`);
  }
  return lines.join('\n');
}

export function repairInstruction(check: Obj, brief: Obj): string {
  const findings = Array.isArray(check.findings) ? check.findings : [];
  const issues = findings.filter(
    (item): item is Obj => isJsonObject(item as never) && (item as Obj).severity === 'hard',
  );
  return (
    '按已确认 Chapter Brief 修复以下硬失败，只改必要处并输出完整正文：\n' +
    issues.map((item) => `- ${item.rule ?? 'None'}: ${item.message ?? 'None'}`).join('\n') +
    '\n\n' +
    draftInstruction(brief)
  );
}
