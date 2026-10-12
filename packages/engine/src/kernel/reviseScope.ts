import { pythonEquals, type JsonValue } from './json';
import { pythonFixed } from './math';
import { canonicalPunctuation } from './punctuation';
import { PYTHON_WHITESPACE, pythonStrip } from './pythonText';
import { AgentOrchestrationError, composeScopedInstruction } from './reviseDelivery';
import type { SecretContext } from './redaction';
import { REVIEW_AGENT_KEYS } from './reviewReasoning';
import { REVIEW_SKILLS } from './reviewSkills';
import { sequenceOpcodes } from './sequenceMatcher';

// revise 默认整文件进出，模型容易顺手重写未点名处；narrow 修订统一附最小改动契约。
export const MINIMAL_EDIT_CONTRACT = [
  '最小改动约束（必须严格遵守）：',
  '1. 只改动与本次指令直接相关的字句；其余段落、句子、标题与空行必须逐字原样保留，不得改写、润色、重排或调整标点。',
  '2. 不要改动文件开头的标题、frontmatter 或导出元信息。',
  '3. 仍输出修订后的完整正文，但未点名处必须与原文逐字一致。',
].join('\n');

/** narrow 修订却改动了大半原文，多半是越界重写：超过该比例挂 scope_warning 让作者逐块复核。 */
const NARROW_REVISE_DRIFT_WARN_RATIO = 0.5;
// Python 的 \d 是 Unicode 十进制数字、\s 是 Unicode 空白。
const ISSUE_ORDINAL = new RegExp(
  `第${PYTHON_WHITESPACE}*([一二两三四五六七八九十\\p{Nd}]+)${PYTHON_WHITESPACE}*[条项个]`,
  'gu',
);
const CATEGORIES = new Set<string>([...REVIEW_AGENT_KEYS, 'continuity']);

type Issue = { [key: string]: unknown };
type Report = { [key: string]: unknown } | null | undefined;
export type ReviseScope = {
  issues: Issue[];
  issue_ids: string[];
  categories: string[];
  constraints: string[];
  dropped_unknown_ids: string[];
  narrow: boolean;
};

const orderedUnique = (values: readonly string[]) => [...new Set(values)];
const optionalString = (value: unknown) =>
  typeof value === 'string' && pythonStrip(value) ? pythonStrip(value) : null;
/** _text.string_arg_list：只取非空字符串并去空白。 */
export function stringArgList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && Boolean(pythonStrip(item)))
        .map(pythonStrip)
    : [];
}
const isObject = (value: unknown): value is Issue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function reviewReportIssues(report: Report): Issue[] {
  if (!report) return [];
  return Array.isArray(report.issues) ? report.issues.filter(isObject) : [];
}

function reviewReportActions(report: Report): string[] {
  if (!report) return [];
  const actions = report.suggested_actions;
  return Array.isArray(actions)
    ? actions.filter(
        (item): item is string => typeof item === 'string' && Boolean(pythonStrip(item)),
      )
    : [];
}

export function scopeIssues(scope: { [key: string]: unknown }): Issue[] {
  return Array.isArray(scope.issues) ? scope.issues.filter(isObject) : [];
}

export function issueCategory(issue: Issue): string | null {
  const category = issue.category;
  if (typeof category === 'string' && CATEGORIES.has(category)) return category;
  const agent = issue.agent;
  if (typeof agent === 'string') {
    for (const key of REVIEW_AGENT_KEYS) if (agent === REVIEW_SKILLS[key].agent) return key;
    if (agent === 'continuity-agent') return 'continuity';
  }
  return null;
}

const validCategories = (values: readonly string[]) =>
  orderedUnique(values.filter((value) => CATEGORIES.has(value)));

/** 序号可能是作者随手打的长串数字：用 BigInt，报错文案里的数字与输入一致。 */
export function parseOrdinal(raw: string): bigint | null {
  if (/^\p{Nd}+$/u.test(raw)) {
    const value = BigInt(Array.from(raw, digitValue).join(''));
    return value > 0n ? value : null;
  }
  const digits = new Map(
    Object.entries({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }),
  );
  const digit = (char: string | undefined) => digits.get(char ?? '') ?? 0;
  const chars = Array.from(raw);
  if (raw === '十') return 10n;
  if (raw.startsWith('十') && chars.length === 2) return BigInt(10 + digit(chars[1]));
  if (raw.endsWith('十') && chars.length === 2) return BigInt(digit(chars[0]) * 10);
  if (raw.includes('十') && chars.length === 3)
    return BigInt(digit(chars[0]) * 10 + digit(chars[2]));
  return digits.has(raw) ? BigInt(digits.get(raw)!) : null;
}

/** Unicode 十进制数字的数值（每段 Nd 都是连续的 0–9）。 */
function digitValue(char: string): string {
  let start = char.codePointAt(0)!;
  while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start -= 1;
  return String((char.codePointAt(0)! - start) % 10);
}

function selectedIssueIdsFromInstruction(
  instruction: string,
  issues: readonly Issue[],
): [string[], string[]] {
  const selected: string[] = [];
  const unknown: string[] = [];
  for (const match of instruction.matchAll(ISSUE_ORDINAL)) {
    const raw = match[1];
    const index = parseOrdinal(raw);
    if (index === null) {
      unknown.push(`第${raw}条`);
      continue;
    }
    const issue = index > 0n && index <= BigInt(issues.length) ? issues[Number(index) - 1] : null;
    const id = issue ? issue.id : undefined;
    if (typeof id === 'string' && pythonStrip(id)) selected.push(id);
    else unknown.push(`第${index}条`);
  }
  return [orderedUnique(selected), orderedUnique(unknown)];
}

function includedCategoriesFromInstruction(instruction: string): string[] {
  const has = (words: string[]) => words.some((word) => instruction.includes(word));
  const categories: string[] = [];
  if (has(['剧情', '结构', '冲突', '钩子', '主线'])) categories.push('plot');
  if (has(['人物', '角色', '动机', '称谓', '关系'])) categories.push('character');
  if (has(['文风', '语言', '行文', '润色', '节奏', '信息密度', '解释性'])) categories.push('prose');
  if (has(['一致性', '设定', '伏笔', '时间线', '前后文', '连续性'])) categories.push('continuity');
  if (!instruction.includes('只') && !instruction.includes('仅') && !instruction.includes('单独'))
    return [];
  return orderedUnique(categories);
}

function excludedCategoriesFromInstruction(instruction: string): string[] {
  const patterns: [string, string[]][] = [
    ['plot', ['不改剧情', '别改剧情', '不要改剧情', '不动剧情', '不改结构', '不要动结构']],
    ['character', ['不改人物', '别改人物', '不要改人物', '不动人物', '不改角色']],
    ['prose', ['不改文风', '别改文风', '不要改文风', '不动文风', '不改语言', '不动语言']],
    ['continuity', ['不改设定', '不要改设定', '不动时间线', '不改伏笔']],
  ];
  return patterns
    .filter(([, words]) => words.some((word) => instruction.includes(word)))
    .map(([category]) => category);
}

function revisionConstraintsFromInstruction(instruction: string): string[] {
  const constraints: string[] = [];
  for (const match of instruction.matchAll(
    /(保留|不动|不要改|别改)([^，。；;,.!?！？\n]{1,20})/gu,
  )) {
    const constraint = pythonStrip(match[1] + match[2]);
    if (constraint) constraints.push(constraint);
  }
  return orderedUnique(constraints.slice(0, 8));
}

/** 识别明确要求全文 / 通篇重写的指令；这类指令不受最小改动契约约束。 */
export function isBroadRevise(instruction: string): boolean {
  return [
    '全文',
    '通篇',
    '整篇',
    '整体重写',
    '全部重写',
    '重写全文',
    '逐段重写',
    '推倒重来',
    '大改',
  ].some((keyword) => instruction.includes(keyword));
}

export function revisionReferencesReview(instruction: string): boolean {
  return (
    new RegExp(ISSUE_ORDINAL.source, 'u').test(instruction) ||
    ['审稿报告', '审稿问题', '审稿意见', '上轮问题', '上一轮问题'].some((phrase) =>
      instruction.includes(phrase),
    )
  );
}

export function resolveReviseScope(
  report: Report,
  args: { [key: string]: unknown },
  options: { authorInstruction?: string | null } = {},
): ReviseScope {
  const authorInstruction = options.authorInstruction ?? null;
  const issues = reviewReportIssues(report);
  const instruction =
    authorInstruction !== null ? authorInstruction : optionalString(args.instruction) || '';
  if (authorInstruction !== null && new RegExp(ISSUE_ORDINAL.source, 'u').test(authorInstruction))
    // 作者明说的序号也压过模型给的类别排除。
    args = { ...args, selected_issue_ids: [], included_categories: [], excluded_categories: [] };
  const validById = new Map<string, Issue>();
  for (const issue of issues)
    if (typeof issue.id === 'string' && pythonStrip(issue.id)) validById.set(issue.id, issue);
  const explicitSelected = stringArgList(args.selected_issue_ids);
  const ordinalCategories =
    authorInstruction !== null ? includedCategoriesFromInstruction(instruction) : [];
  const ordinalIssues = ordinalCategories.length
    ? issues.filter((issue) => ordinalCategories.includes(issueCategory(issue) as string))
    : issues;
  const [inferredSelected, unknownOrdinals] = selectedIssueIdsFromInstruction(
    instruction,
    ordinalIssues,
  );
  if (authorInstruction !== null && unknownOrdinals.length)
    throw new AgentOrchestrationError('选中的审稿问题不存在，请按当前报告重新选择；未生成补丁。');
  const selected =
    authorInstruction !== null && inferredSelected.length
      ? inferredSelected
      : explicitSelected.length
        ? explicitSelected
        : inferredSelected;
  const dropped = [...selected.filter((id) => !validById.has(id)), ...unknownOrdinals];
  const explicitIncluded = validCategories(stringArgList(args.included_categories));
  const included = explicitIncluded.length
    ? explicitIncluded
    : includedCategoriesFromInstruction(instruction);
  const excluded = orderedUnique([
    ...validCategories(stringArgList(args.excluded_categories)),
    ...excludedCategoriesFromInstruction(instruction),
  ]);
  const constraints = orderedUnique([
    ...stringArgList(args.revision_constraints),
    ...revisionConstraintsFromInstruction(instruction),
  ]);
  let scoped: Issue[];
  if (selected.length)
    scoped = selected.filter((id) => validById.has(id)).map((id) => validById.get(id)!);
  else if (included.length)
    scoped = issues.filter((issue) => included.includes(issueCategory(issue) as string));
  else scoped = issues;
  if (excluded.length)
    scoped = scoped.filter((issue) => !excluded.includes(issueCategory(issue) as string));
  const hasExplicitScope = Boolean(
    selected.length || included.length || excluded.length || constraints.length,
  );
  return {
    issues: scoped,
    issue_ids: scoped
      .map((issue) => issue.id)
      .filter((id): id is string => typeof id === 'string' && Boolean(pythonStrip(id))),
    categories: [...REVIEW_AGENT_KEYS, 'continuity'].filter((category) =>
      scoped.some((issue) => issueCategory(issue) === category),
    ),
    constraints,
    dropped_unknown_ids: orderedUnique(dropped),
    narrow: hasExplicitScope || !isBroadRevise(instruction),
  };
}

/** 把指令、最小改动契约、硬约束与选中的审稿问题拼成本轮修订指令。 */
export function scopedReviseInstruction(
  instruction: string,
  report: Report,
  scope: { [key: string]: unknown },
  secrets: SecretContext,
): string {
  const issues = scopeIssues(scope);
  const constraints = stringArgList(scope.constraints);
  const narrow = Boolean(scope.narrow);
  if (!narrow && !report && !constraints.length) return instruction;
  const blocks = [instruction];
  if (narrow) blocks.push(MINIMAL_EDIT_CONTRACT);
  if (constraints.length)
    blocks.push(
      [
        '硬约束（必须遵守）：',
        ...constraints.map((constraint, index) => `${index + 1}. ${constraint}`),
      ].join('\n'),
    );
  // 全局建议没有问题归属：只有明确全文、未筛选的重写才吃它们；选中的问题自带建议。
  const all = reviewReportIssues(report);
  const unfiltered = pythonEquals(issues as unknown as JsonValue, all as unknown as JsonValue);
  const actions = !narrow && unfiltered ? reviewReportActions(report) : [];
  return composeScopedInstruction(blocks, issues, actions, secrets);
}

export function publicReviseScope(scope: { [key: string]: unknown }) {
  return {
    issue_ids: stringArgList(scope.issue_ids),
    categories: stringArgList(scope.categories),
    constraints: stringArgList(scope.constraints),
    dropped_unknown_ids: stringArgList(scope.dropped_unknown_ids),
  };
}

/** 按非空行统计（被改动的原文行, 纯新增行, 非空原文总行数）；比较前折叠易漂移的标点形态。 */
export function reviseDriftCounts(before: string, after: string): [number, number, number] {
  const lines = (text: string) =>
    canonicalPunctuation(text)
      .split('\n')
      .filter((line) => pythonStrip(line));
  const beforeLines = lines(before);
  const afterLines = lines(after);
  if (!beforeLines.length) return [0, 0, 0];
  let touched = 0;
  let inserted = 0;
  for (const [tag, beforeStart, beforeEnd, afterStart, afterEnd] of sequenceOpcodes(
    beforeLines,
    afterLines,
  )) {
    if (tag === 'equal') continue;
    touched += beforeEnd - beforeStart;
    if (tag === 'insert') inserted += afterEnd - afterStart;
  }
  return [touched, inserted, beforeLines.length];
}

export function reviseDriftRatio(before: string, after: string): [number, number, number] {
  const [touched, inserted, total] = reviseDriftCounts(before, after);
  const changed = touched + inserted;
  return [changed, total, total ? changed / total : 0];
}

/** narrow 修订改动比例超阈值时给出可见的越界提醒（不阻断）。 */
export function scopeWarning(scope: { [key: string]: unknown }, before: string, after: string) {
  if (!scope.narrow) return null;
  const [touched, inserted, total] = reviseDriftCounts(before, after);
  const changed = touched + inserted;
  const ratio = total ? changed / total : 0;
  if (ratio <= NARROW_REVISE_DRIFT_WARN_RATIO) return null;
  const percent = Math.min(pythonRoundHalfEven(ratio * 100), 100);
  const insertedSuffix = inserted ? `+ 新增 ${inserted} 行` : '';
  return {
    message:
      `本次定向修订改动了约 ${percent}% 的原文行（${Math.min(changed, total)}/${total} 行）${insertedSuffix}，` +
      '可能超出指定范围，请在 diff 面板逐块核对后再接受。',
    drift_ratio: Number(pythonFixed(ratio, 4)),
    changed_lines: changed,
    total_lines: total,
    narrow: true,
  };
}

/** Python round(x)：到最近整数，恰好一半时取偶数。 */
function pythonRoundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function reviseSummaryWithScope(summary: string, scope: { [key: string]: unknown }): string {
  const dropped = stringArgList(scope.dropped_unknown_ids);
  return dropped.length ? `${summary} 已忽略不存在的审稿条目：${dropped.join(', ')}。` : summary;
}
