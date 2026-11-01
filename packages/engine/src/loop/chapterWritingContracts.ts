import { compareManuscriptPaths, countProseChars } from '@storyforge/project-core';
import { selectWrittenFacts, type WrittenFact } from '../kernel/canonContext';
import { chapterOutlineSource, type ChapterOutline } from '../kernel/chapterOutline';
import { FsToolError, resolveProjectRoot } from '../kernel/fsTools';
import { resolveNewProjectFile } from '../kernel/fsProjectTools';
import { normcase } from '../kernel/generationSources';
import {
  dumpJson,
  escapeStrayQuotes,
  InputDomainError,
  isJsonObject,
  parseJson,
  parseModelJson,
  type JsonObject,
  type JsonValue,
  type Obj,
} from '../kernel/json';
import { iterManuscriptFiles, previousChapterTail } from '../kernel/previousChapter';
import { MAX_READ_BYTES, ProjectTreeError } from '../kernel/projectTree';
import { codePoints, PYTHON_WHITESPACE, pythonStrip } from '../kernel/pythonText';
import { locateQuote } from '../kernel/quoteLocation';
import { buildPlan, nextChapter, type PlannedChapter, type SerialPlan } from '../kernel/serialPlan';
import type { AvailableWritingStyle } from '../kernel/availableWritingStyles';
import { pickWritingSkills, WRITING_SKILL_PICK_MAX } from '../kernel/writingSkills';
import { decodeUtf8, ProjectReadError, type ProjectReader } from '../readPort';
import { AgentOrchestrationError } from './runPayloads';

export const CHAPTER_BRIEF_ARTIFACT_KIND = 'chapter_brief';
export const CHAPTER_CHECK_ARTIFACT_KIND = 'chapter_check';
export const CHAPTER_CANDIDATE_ARTIFACT_KIND = 'chapter_candidate';
export const CHAPTER_WRITE_INTENT = 'chapter.write';
/** 章纲拟好时写进会话的那句话的开头；章纲读对话节选时以它为上一章的分界。 */
export const BRIEF_READY_PREFIX = '章纲已准备：';
/** 10-31 前写进会话的是这个说法，旧会话里还留着，分界照认。 */
const LEGACY_BRIEF_READY_PREFIX = 'Chapter Brief 已准备：';
const isBriefReady = (text: string) =>
  text.startsWith(BRIEF_READY_PREFIX) || text.startsWith(LEGACY_BRIEF_READY_PREFIX);
/** 修复步骤借修订链路写进会话的指令开头：不是作者说的话。 */
export const REPAIR_INSTRUCTION_PREFIX =
  '按已确认 Chapter Brief 修复以下硬失败，只改必要处并输出完整正文：';
const REVISION_SUMMARY = /^已按指令修订 /;

const CONVERSATION_MAX_CHARS = 3000;
const CONVERSATION_MAX_MESSAGES = 8;
const AUTHOR_LINE_MAX_CHARS = 600;
const AI_LINE_MAX_CHARS = 1000;

const MAX_LIST_ITEMS = 12;
const MAX_ITEM_CHARS = 300;

/** Python 的 value.strip()[:limit]，空串视为没有。 */
export function textValue(value: unknown, limit: number): string | null {
  if (typeof value !== 'string' || !pythonStrip(value)) return null;
  return codePoints(pythonStrip(value)).slice(0, limit).join('');
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

export function chapterOrdinalFromPath(relative: string): number | null {
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
      throw new AgentOrchestrationError('目标章节不在当前作品内。');
    }
  }
  return lexicalPosix(text, platform);
}

/** 计划里一章的目标文件：记过落盘路径就用它，没记过按章序取 `正文/第NNN章.md`。批量写章列目标也用这一条。 */
export const plannedChapterPath = (chapter: Pick<PlannedChapter, 'ordinal' | 'declaredPath'>) =>
  chapter.declaredPath || `正文/第${String(chapter.ordinal).padStart(3, '0')}章.md`;

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
  if (relative === null && planned !== null) relative = plannedChapterPath(planned);
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

// 没有连载计划时，章纲默认字数取本书已写的章：写死的 1600–2600 不认书，一章三四千字的书按它起草，
// 检查要么以「字数严重偏离」拦下整章，要么修复把稿子压短。不足 MIN_SAMPLE_CHARS 的占位短章不算样本。
// 取全书最早的章、不取最近几章：稿子常写到目标上限附近，按最近几章定，目标会跟着越抬越高（擂台二只看最近 3 章，
// 第 40 章目标涨到 9900–15000 字；按 E1 的真实比值模拟，看最近 20 章到第 40 章仍涨三成）。
// 只取最早 3 章、写满 3 章后基准不再变：原来取最早 20 章，10-31 实验书前 20 章照样一路抬（2600 → 6700）。
const LENGTH_SAMPLES = 3;
const LENGTH_SCAN = 40;
const MIN_SAMPLE_CHARS = 500;

/** 阅读序上目标章之前、全书最早至多 3 章的字数（早的在前）；读不到、二进制、超预算或太短的跳过。 */
export async function earliestChapterChars(
  reader: ProjectReader,
  root: string,
  targetRelative: string,
  platform: 'windows' | 'posix',
): Promise<number[]> {
  let keys: string[];
  try {
    keys = await iterManuscriptFiles(reader, root, platform);
  } catch (error) {
    if (error instanceof ProjectReadError || error instanceof ProjectTreeError) return [];
    throw error;
  }
  let index = keys.findIndex(
    (key) => normcase(key, platform) === normcase(targetRelative, platform),
  );
  if (index === -1) {
    index = keys.findIndex((key) => compareManuscriptPaths(key, targetRelative) >= 0);
    if (index === -1) index = keys.length;
  }
  const counts: number[] = [];
  for (const key of keys.slice(0, Math.min(index, LENGTH_SCAN))) {
    let bytes: Uint8Array;
    try {
      const resolved = (await reader.resolveProjectPath(root, key)).resolvedRelativePath;
      const read = await reader.readProjectBytes(root, resolved, MAX_READ_BYTES);
      if (read.exceeded || read.bytes.subarray(0, 1024).includes(0)) continue;
      bytes = read.bytes;
    } catch (error) {
      if (error instanceof ProjectReadError || error instanceof FsToolError) continue;
      throw error;
    }
    const count = countProseChars(decodeUtf8(bytes));
    if (count >= MIN_SAMPLE_CHARS) {
      counts.push(count);
      if (counts.length === LENGTH_SAMPLES) break;
    }
  }
  return counts;
}

/** 全书最早至多 3 章的字数中位数下浮两成、上浮两成，分别向下、向上取整到百位；不足两章不下结论。 */
export function bookChapterRange(counts: readonly number[]): readonly [number, number] | null {
  if (counts.length < 2) return null;
  const middle = [...counts].sort((a, b) => a - b)[Math.floor((counts.length - 1) / 2)];
  return [Math.max(100, Math.floor((middle * 4) / 500) * 100), Math.ceil((middle * 6) / 500) * 100];
}

export function buildBriefSeed(input: {
  userMessage: string;
  targetPath: string;
  planned: PlannedChapter | null;
  plan: SerialPlan | null;
  earliestChars?: readonly number[];
}): Obj {
  const { planned, plan } = input;
  const bookRange = bookChapterRange(input.earliestChars ?? []);
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
    target_chars_min:
      (plan !== null ? plan.chapterWordCountMin : null) ||
      (bookRange?.[0] ?? null) ||
      DEFAULT_TARGET_CHARS[0],
    target_chars_max:
      (plan !== null ? plan.chapterWordCountMax : null) ||
      (bookRange?.[1] ?? null) ||
      DEFAULT_TARGET_CHARS[1],
  };
}

const DEFAULT_TARGET_CHARS = [1600, 2600] as const;

/**
 * 模型在章纲里提的目标字数只能落在种子范围内（种子来自连载计划或已写章节）：取两者的交集，交集为空就用种子。
 * 种子还是缺省值（没有计划、已写不足两章）时不钉，开头几章的长短仍由模型定。
 */
function pinnedTargetChars(seed: Obj, minimum: number, maximum: number): [number, number] {
  const low = Number(seed.target_chars_min);
  const high = Number(seed.target_chars_max);
  if (low === DEFAULT_TARGET_CHARS[0] && high === DEFAULT_TARGET_CHARS[1])
    return [minimum, maximum];
  const pinnedLow = Math.max(low, minimum);
  const pinnedHigh = Math.min(high, maximum);
  return pinnedLow < pinnedHigh ? [pinnedLow, pinnedHigh] : [low, high];
}

/** 章纲对照用的已写内容：上一章结尾和挑出的已写事实；第一章、没有台账时是空的。 */
export type BriefWritten = {
  readonly previous: readonly [string, string] | null;
  readonly facts: readonly WrittenFact[];
};

const BRIEF_FACTS_MAX_CHARS = 1000;
const MAX_ADJUSTMENTS = 8;
const MAX_ADJUSTMENT_CHARS = 300;

export async function briefWrittenMaterials(
  reader: ProjectReader,
  root: string,
  targetAbsolute: string,
  platform: 'windows' | 'posix',
  mentionText: string,
): Promise<BriefWritten> {
  const previous = await previousChapterTail(reader, root, targetAbsolute, { platform });
  let facts: WrittenFact[] = [];
  try {
    facts = await selectWrittenFacts(reader, root, targetAbsolute, {
      platform,
      mentionText,
      maxChars: BRIEF_FACTS_MAX_CHARS,
    });
  } catch (error) {
    // 台账坏了只是这次章纲不对照事实；格式错误在下次记账时报给作者。
    if (!(error instanceof FsToolError || error instanceof InputDomainError)) throw error;
  }
  return { previous, facts };
}

const hasWritten = (written: BriefWritten | null | undefined): written is BriefWritten =>
  !!written && (written.previous !== null || written.facts.length > 0);

// 离线回放：章纲顺带对照上一章结尾和已写事实，近六成的章出调整、两端原句 88% 对得上；
// 「上一章已抓到人、计划又要追捕」这类冲突靠它挡（第 205→206 章 4、5 条矛盾 → 1、0 条）。
const ADJUSTMENT_INSTRUCTION =
  '另输出 fact_adjustments 数组：对照下面的「上一章结尾」和「已写事实」，找出作者要求与已经写下的内容相冲突的地方，' +
  '例如要追捕的人上一章已被抓走、已死的人要出场、上一章已经发生的事本章又要发生一遍、' +
  '要用的东西已不在这个人手里、要花的钱超过账上剩的。' +
  '每条写 plan_quote（作者要求或种子 goal 里的原句，逐字复制）、fact_quote（上一章结尾或已写事实里的原句，逐字复制）、' +
  'adjustment（一句话：本章怎样写才不和已写内容矛盾）。' +
  '以已写内容为准；作者要求明确写回忆、误会或反转的不算冲突。没有冲突就给空数组。' +
  '只报事实冲突，不提风格、节奏、写法上的意见。goal 和其他字段仍按作者要求整理，不要把调整写进去。\n';

/**
 * 上一章章纲之后作者与 AI 在对话里说的话（最近的优先，总量有上限），去掉流程自己写进会话的话。
 * 章纲调用本身看不到对话：不读这段节选，作者在对话里谈过的本章要求进不了章纲。
 */
export function briefConversation(
  messages: readonly { role: string; content: string }[],
  userMessage: string,
): string | null {
  const rows = [...messages];
  const last = rows[rows.length - 1];
  if (last?.role === 'user' && pythonStrip(last.content) === pythonStrip(userMessage)) rows.pop();
  const lines: string[] = [];
  let used = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (lines.length >= CONVERSATION_MAX_MESSAGES) break;
    const { role } = rows[index];
    const text = pythonStrip(rows[index].content);
    if (role === 'assistant' && isBriefReady(text)) break;
    if (!text || (role !== 'user' && role !== 'assistant')) continue;
    if (role === 'user' && text.startsWith(REPAIR_INSTRUCTION_PREFIX)) continue;
    if (role === 'assistant' && REVISION_SUMMARY.test(text)) continue;
    const cap = role === 'user' ? AUTHOR_LINE_MAX_CHARS : AI_LINE_MAX_CHARS;
    const body =
      codePoints(text).length > cap ? `${codePoints(text).slice(0, cap).join('')}……` : text;
    const line = `${role === 'user' ? '作者' : 'AI'}：${body}`;
    if (used + codePoints(line).length > CONVERSATION_MAX_CHARS) break;
    used += codePoints(line).length;
    lines.unshift(line);
  }
  return lines.length ? lines.join('\n') : null;
}

/**
 * 本章细纲整份给章纲：只靠摘录时章纲只看得到开头 1200 字，细纲后半的写法要求（谁的视角、哪场重、
 * 哪里不解释、收在哪）进不了章纲，起草照章纲走就全丢了（11-01 择天记对照 F 组：2381 字的细纲只送进 1169 字）。
 */
function briefOutlineBlock(outline: ChapterOutline | null | undefined): string {
  if (!outline) return '';
  return (
    `本章细纲（${chapterOutlineSource(outline)}，作者为这一章写的安排）：` +
    '其中的视角与开场、各场轻重与推进、人物怎么写、叙述方式、不写什么、收在哪，' +
    '都要落进 pov、required_beats、forbidden_items 或 continuity_constraints，不能只留情节步骤；' +
    `和种子里的 goal 冲突时以 goal 为准。\n<<<OUTLINE\n${outline.text}\nOUTLINE>>>\n`
  );
}

export function briefPrompt(
  seed: Obj,
  userMessage: string,
  written?: BriefWritten | null,
  conversation?: string | null,
  skillIndex?: string | null,
  outline?: ChapterOutline | null,
): string {
  const compare = hasWritten(written);
  const previous =
    compare && written.previous
      ? `上一章（${written.previous[0]}）结尾：\n<<<PREVIOUS\n${written.previous[1]}\nPREVIOUS>>>\n`
      : '';
  const facts =
    compare && written.facts.length
      ? `已写事实（来自台账）：\n${written.facts.map((fact) => fact.line).join('\n')}\n`
      : '';
  return (
    '把作者的写章要求整理成 Chapter Brief。只输出 JSON 对象，不要代码块。' +
    '字段必须是 target_path, chapter_ordinal, chapter_title, goal, pov, setting, ' +
    'required_beats, forbidden_items, continuity_constraints, target_chars_min, target_chars_max。' +
    '不得更改 target_path/chapter_ordinal；缺少信息用 null 或空数组，不得编造项目事实。\n' +
    (skillIndex
      ? `另加 writing_skills：从下面的写法 skill 目录里挑这一章用得上的名字，最多 ${WRITING_SKILL_PICK_MAX} 个，` +
        '原样照抄名字；都用不上就给空数组。\n'
      : '') +
    (compare ? ADJUSTMENT_INSTRUCTION : '') +
    `后端确定种子：${dumpJson(seed, { ensureAscii: false })}\n` +
    briefOutlineBlock(outline) +
    previous +
    facts +
    (conversation
      ? '对话节选（上一章章纲之后作者和 AI 在对话里说的话，按时间先后。作者明确提出、跟这一章有关的要求' +
        '写进 goal、required_beats、forbidden_items 或 continuity_constraints；AI 的提议只有作者明确同意的才算；' +
        `和这一章无关的忽略）：\n<<<CONVERSATION\n${conversation}\nCONVERSATION>>>\n`
      : '') +
    (skillIndex ? `写法 skill 目录（作者审过的写法 · 名字：什么时候用）：\n${skillIndex}\n` : '') +
    `作者要求：${userMessage}`
  );
}

const planTextOf = (seed: Obj, userMessage: string) =>
  [userMessage, seed.goal, seed.chapter_title]
    .filter((part) => typeof part === 'string')
    .join('\n');

const writtenTextOf = (written: BriefWritten) =>
  [written.previous?.[1] ?? '', ...written.facts.map((fact) => fact.line)].join('\n');

/** 模型给的调整：三项齐全、两端原句都要在给它的材料里逐字找到，对不上的丢掉。 */
function modelAdjustments(raw: unknown, planText: string, writtenText: string): Obj[] {
  if (!Array.isArray(raw)) return [];
  const kept: Obj[] = [];
  for (const item of raw.slice(0, MAX_ADJUSTMENTS)) {
    if (!isJsonObject(item as never)) continue;
    const entry = item as Obj;
    const plan = textValue(entry.plan_quote, MAX_ADJUSTMENT_CHARS);
    const fact = textValue(entry.fact_quote, MAX_ADJUSTMENT_CHARS);
    const adjustment = textValue(entry.adjustment, MAX_ADJUSTMENT_CHARS);
    if (!plan || !fact || !adjustment) continue;
    if (locateQuote(planText, plan) === null || locateQuote(writtenText, fact) === null) continue;
    if (kept.some((other) => other.adjustment === adjustment)) continue;
    kept.push({ plan_quote: plan, fact_quote: fact, adjustment, source: 'model' });
  }
  return kept;
}

const DEATH = /死|亡|身故|遇害|丧命|殒命|牺牲|毙命/u;
const NOT_DEATH = /未|没|假|诈|险些|差点|几乎|装|濒/u;

/** 计划点到的人在台账里已经死了、模型又没提：程序补一条「只能是回忆或提及」。 */
function deathAdjustments(planText: string, written: BriefWritten, existing: Obj[]): Obj[] {
  const added: Obj[] = [];
  for (const fact of written.facts) {
    if (fact.kind !== '生死' || !DEATH.test(fact.value) || NOT_DEATH.test(fact.value)) continue;
    if (Array.from(fact.subject).length < 2 || !planText.includes(fact.subject)) continue;
    const covered = [...existing, ...added].some(
      (item) =>
        String(item.plan_quote).includes(fact.subject) ||
        String(item.adjustment).includes(fact.subject),
    );
    if (covered) continue;
    const clause = planText.split(/[。！？；\n]/u).find((part) => part.includes(fact.subject));
    added.push({
      plan_quote: textValue(clause, MAX_ADJUSTMENT_CHARS) ?? fact.subject,
      fact_quote: fact.quote,
      adjustment: `「${fact.subject}」已在第 ${fact.ordinal} 章${fact.value}，本章若出现只能是回忆或提及。`,
      source: 'program',
    });
  }
  return added;
}

function jsonObject(raw: unknown): Obj {
  if (isJsonObject(raw as never)) return { ...(raw as Obj) };
  if (typeof raw !== 'string') throw new AgentOrchestrationError('模型未返回可解析的结构化结果。');
  let parsed: JsonValue;
  try {
    parsed = parseModelJson(raw, {
      source: 'chapter brief',
      fence: 'block',
      // 模型把带直引号的计划原文、对白原样抄进字符串时，先用程序转义再解析，不让整份章纲重来。
      locate: (text) => leadingBriefObject(text) ?? repairedBriefObject(text),
    });
  } catch (error) {
    if (!(error instanceof InputDomainError)) throw error;
    throw new AgentOrchestrationError('模型返回的结构化结果不是有效 JSON。');
  }
  if (!isJsonObject(parsed))
    throw new AgentOrchestrationError('模型返回的结构化结果必须是 JSON 对象。');
  return parsed as Obj;
}

const TRAILING_ADJUSTMENTS = /^[\s,]*"?fact_adjustments"?\s*[:：]/u;

/** 开头一个完整 JSON 对象 / 数组的结束下标（不含）；不以 open 开头或括号不配对时为 null。 */
function leadingBracketEnd(text: string, open: '{' | '[', close: '}' | ']'): number | null {
  if (!text.startsWith(open)) return null;
  let depth = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close && --depth === 0) return index + 1;
  }
  return null;
}

/**
 * 模型常在 JSON 对象后面再写东西：带已写事实时提示词先列字段、再「另输出 fact_adjustments」，
 * 它就另起一行写在对象外面；还常补一段说明。只认开头那个完整对象：紧跟的 fact_adjustments
 * 数组并回对象（写坏或与对象里的同名字段重复就不认），再往后的说明文字不要。
 */
function leadingBriefObject(text: string): JsonObject | null {
  const end = leadingBracketEnd(text, '{', '}');
  if (end === null) return null;
  try {
    const object = parseJson(text.slice(0, end), 'chapter brief');
    if (!isJsonObject(object)) return null;
    const tail = TRAILING_ADJUSTMENTS.exec(text.slice(end));
    if (!tail) return { ...object };
    if (Object.prototype.hasOwnProperty.call(object, 'fact_adjustments')) return null;
    const rest = pythonStrip(text.slice(end + tail[0].length));
    const arrayEnd = leadingBracketEnd(rest, '[', ']');
    if (arrayEnd === null) return null;
    const adjustments = parseJson(rest.slice(0, arrayEnd), 'chapter brief');
    if (!Array.isArray(adjustments)) return null;
    return { ...object, fact_adjustments: adjustments };
  } catch (error) {
    if (error instanceof InputDomainError) return null;
    throw error;
  }
}

/** 直引号转义后再解析一次（整份或开头的对象）；仍不成就放弃，交给调用方报错。 */
function repairedBriefObject(text: string): JsonObject | null {
  const repaired = escapeStrayQuotes(text);
  if (repaired === text) return null;
  try {
    const value = parseJson(repaired, 'chapter brief');
    return isJsonObject(value) ? { ...value } : null;
  } catch (error) {
    if (!(error instanceof InputDomainError)) throw error;
    return leadingBriefObject(repaired);
  }
}

export function parseBrief(
  raw: unknown,
  options: {
    seed: Obj;
    provenance: Obj;
    newHex: () => string;
    userMessage?: string;
    written?: BriefWritten | null;
    /** 章纲目录里列的写法（作品的和启用插件的合在一起），模型只能从这里挑。 */
    skills?: readonly AvailableWritingStyle[];
  },
): Obj {
  const { seed, written } = options;
  const payload = jsonObject(raw);
  let adjustments: Obj[] = [];
  if (hasWritten(written)) {
    const planText = planTextOf(seed, options.userMessage ?? '');
    adjustments = modelAdjustments(payload.fact_adjustments, planText, writtenTextOf(written));
    adjustments.push(...deathAdjustments(planText, written, adjustments));
  }
  let minimum = positiveInt(payload.target_chars_min) || Number(seed.target_chars_min);
  let maximum = positiveInt(payload.target_chars_max) || Number(seed.target_chars_max);
  if (minimum > maximum) [minimum, maximum] = [maximum, minimum];
  [minimum, maximum] = pinnedTargetChars(seed, minimum, maximum);
  const skills = pickWritingSkills(payload.writing_skills, options.skills ?? []);
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
    // 没有调整时不出这个键：老 brief 与它的摘要一字不变。
    ...(adjustments.length ? { fact_adjustments: adjustments } : {}),
    // 同上：没挑写法时不出这个键。
    ...(skills.length ? { writing_skills: skills } : {}),
    context_provenance: { ...options.provenance },
  };
}

const sameAdjustment = (a: Obj, b: Obj) =>
  a.plan_quote === b.plan_quote && a.fact_quote === b.fact_quote && a.adjustment === b.adjustment;

/** 作者确认的 brief：必须就是待确认的那一版，可编辑字段逐个重新收口，修订号加一。 */
export function confirmBrief(candidate: unknown, pending: Obj): Obj {
  if (!isJsonObject(candidate as never))
    throw new AgentOrchestrationError('确认写章前需要提交结构化章纲。');
  const edited = candidate as Obj;
  if (edited.brief_id !== pending.brief_id || edited.revision !== pending.revision)
    throw new AgentOrchestrationError('章纲已过期，请重新生成后再确认。');
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
    throw new AgentOrchestrationError('章纲字数范围无效。');
  confirmed.target_chars_min = minimum;
  confirmed.target_chars_max = maximum;
  // 作者只能去掉调整（改回原计划），不能借确认塞进新的；没回传这一项就保留原样。
  if (Array.isArray(edited.fact_adjustments)) {
    const returned = edited.fact_adjustments.filter((item) => isJsonObject(item as never)) as Obj[];
    const kept = (Array.isArray(pending.fact_adjustments) ? pending.fact_adjustments : []).filter(
      (item: Obj) => returned.some((other) => sameAdjustment(item, other)),
    );
    if (kept.length) confirmed.fact_adjustments = kept;
    else delete confirmed.fact_adjustments;
  }
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
  const adjustments = Array.isArray(brief.fact_adjustments)
    ? (brief.fact_adjustments as Obj[])
    : [];
  if (adjustments.length)
    lines.push(
      '按已写内容的调整（优先于上面的章节目标与节拍）：\n' +
        adjustments
          .map((item) => `- ${item.adjustment}（已写：「${item.fact_quote}」）`)
          .join('\n'),
    );
  return lines.join('\n');
}

/**
 * 本章细纲随写作指令整份交给起草：放在立项资料里只算背景，系统提示又说摘录里的命令不算作者授权，
 * 起草只照末尾的章纲走（11-01 择天记对照 F 组）。
 */
export function draftOutlineBlock(outline: ChapterOutline | null): string {
  if (!outline) return '';
  return (
    `\n本章细纲（${chapterOutlineSource(outline)}，作者为这一章写的安排，上面的章纲由它整理而来。` +
    '视角与开场、各场轻重、人物怎么写、叙述方式、不写什么、收在哪，照细纲写；和上面的章节目标冲突时以章节目标为准）：' +
    `\n<<<OUTLINE\n${outline.text}\nOUTLINE>>>`
  );
}

/**
 * 章纲那一步看到的对话节选，原样附给起草：设计只在对话里谈过、没落成文件时，
 * 光靠章纲压出来的目标和节拍，起草几乎看不到谈定的设定（E0：章纲 16/20 个设计点，起草 1/20）。
 */
export function draftConversationBlock(excerpt: string | null): string {
  if (!excerpt) return '';
  return (
    '\n对话里谈定的内容（整理这一章章纲时看到的那段对话节选，按时间先后。作者明确同意的设定、人物、情节照着写；' +
    `和上面的章节目标冲突时以章节目标为准）：\n<<<CONVERSATION\n${excerpt}\nCONVERSATION>>>`
  );
}

export function repairInstruction(check: Obj, brief: Obj): string {
  const findings = Array.isArray(check.findings) ? check.findings : [];
  const issues = findings.filter(
    (item): item is Obj => isJsonObject(item as never) && (item as Obj).severity === 'hard',
  );
  return (
    `${REPAIR_INSTRUCTION_PREFIX}\n` +
    issues.map((item) => `- ${item.rule ?? 'None'}: ${item.message ?? 'None'}`).join('\n') +
    '\n\n' +
    draftInstruction(brief)
  );
}
