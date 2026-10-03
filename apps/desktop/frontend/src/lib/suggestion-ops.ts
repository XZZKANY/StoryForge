/**
 * 「不可变 op」合同：把一份修订补丁（before→after）看作若干不可变 op（分块）。
 *
 * 整份接受不再把冻结的 after 整段盖回当前稿，而是把补丁里尚未应用的 op 逐个映射到作者
 * 当前稿——范围外的行一律不动，作者在提交期间的独立改动不会被回退。只有当前稿与 before
 * 逐字一致时才走「直接写 after」的快路径。
 */
import { applyPatchHunkToCurrent, buildPatchHunks, type PatchHunk } from './patch-hunks';

/** 已应用到当前稿的一步 op 及其逆 op（撤销逐步回退用）。 */
export type AppliedSuggestionOp = {
  op: PatchHunk;
  /** 逆 op：把这一步写进去的文本换回原文，即可回退这一步。 */
  inverse: PatchHunk;
};

export type WholeAcceptPlan = {
  content: string;
  applied: AppliedSuggestionOp[];
  /** 当前稿与 before 逐字一致，直接写 after。 */
  fastPath: boolean;
  /** 整份接受后确实在稿内的 op：本次应用的 ∪ 核验已在稿内的；归属判定只认这个集合。 */
  settledOpIds: Set<string>;
};

export function buildSuggestionOps(before: string, after: string): PatchHunk[] {
  return buildPatchHunks(before, after);
}

export function invertPatchHunk(hunk: PatchHunk): PatchHunk {
  return { ...hunk, beforeText: hunk.afterText, afterText: hunk.beforeText };
}

/**
 * 把面板交上来的分块匹配回原始补丁的某一处 op。
 *
 * 分块接受后剩余补丁会按变更后的 before/after 重新推导分块，其 id 未必等于原始 op，
 * 所以按内容签名匹配；匹配到 0 处或多处（不可一一对应）时返回 null，调用方应拒绝该次半选。
 */
export function matchSuggestionOp(ops: readonly PatchHunk[], hunk: PatchHunk): PatchHunk | null {
  const byContent = ops.filter(
    (op) => op.beforeText === hunk.beforeText && op.afterText === hunk.afterText,
  );
  if (byContent.length === 1) return byContent[0];
  if (byContent.length > 1) return null;
  const byId = ops.filter((op) => op.id === hunk.id);
  return byId.length === 1 ? byId[0] : null;
}

/**
 * op 目标前缀在原文里、出现在目标之前的次数，用作前缀重复时的消歧序号。
 *
 * 例如原文有两处相同前缀、op 锚在第二处，序号即 1；只要当前稿里前缀的出现个数足够，
 * 就能取到同一个序号的那一处，而不是靠「全文某处是否出现某文本」猜。
 */
function prefixOrdinal(before: string, op: PatchHunk): number {
  const prefix = op.originalPrefixContext;
  if (!prefix) return 0;
  const target = op.originalStartOffset - prefix.length;
  let ordinal = 0;
  let index = before.indexOf(prefix);
  while (index !== -1 && index < target) {
    ordinal += 1;
    index = before.indexOf(prefix, index + prefix.length);
  }
  return ordinal;
}

type OpAnchor = { kind: 'anchor'; at: number } | { kind: 'fallback' } | { kind: 'ambiguous' };

/** needle 在 text 中不重叠出现的次数。 */
function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

/** 位置 [start,end) 处是否把 op 提供的每一侧上下文都吻合上（未提供的侧不约束）。 */
function anchorFullMatches(
  current: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
): boolean {
  if (
    prefix &&
    !(start >= prefix.length && current.slice(start - prefix.length, start) === prefix)
  ) {
    return false;
  }
  if (suffix && current.slice(end, end + suffix.length) !== suffix) return false;
  return true;
}

/** 收集 needle 在当前稿中两侧上下文都吻合的出现位置（子串巧合会被两侧失配排除）。 */
function collectAnchorCandidates(
  current: string,
  needle: string,
  prefix: string,
  suffix: string,
  out: Set<number>,
): void {
  if (!needle) return;
  let index = current.indexOf(needle);
  while (index !== -1) {
    if (anchorFullMatches(current, index, index + needle.length, prefix, suffix)) out.add(index);
    index = current.indexOf(needle, index + 1);
  }
}

/** 前缀在 text 中每处出现的结束偏移。 */
function prefixEnds(text: string, prefix: string): number[] {
  const ends: number[] = [];
  if (!prefix) return ends;
  let index = text.indexOf(prefix);
  while (index !== -1) {
    ends.push(index + prefix.length);
    index = text.indexOf(prefix, index + prefix.length);
  }
  return ends;
}

/**
 * 把 op 锚定到当前稿中的一个具体内容起点，替换掉「全文某处是否出现该文本」的内容判据——
 * 重复块里后者会把补丁施加到作者没打算改的另一处。
 *
 * 只认「两侧上下文都与原文吻合」的候选（afterText = 已落盘的候选，beforeText = 待施加的
 * 候选），再用前缀出现序号消歧：已落盘候选唯一时取它（幂等跳过，不写盘最安全）；待施加候选
 * 唯一时取它；多个同类候选则要求前缀出现个数与原文一致（序号才有意义），否则判歧义。前缀
 * 为空（文件头 / boundary op）时直接用原始偏移。没有吻合候选时：删除类信前缀锚点，替换类只在
 * 原文全篇唯一时才兜底。ambiguous 表示无法唯一确定——调用方必须拒写，绝不取候选猜着写。
 */
function locateOpAnchor(current: string, op: PatchHunk, before: string): OpAnchor {
  const prefix = op.originalPrefixContext;
  const suffix = op.originalSuffixContext;
  if (!prefix) return { kind: 'anchor', at: Math.min(op.originalStartOffset, current.length) };

  const ends = prefixEnds(current, prefix);
  let primary: number | null = null;
  if (ends.length > 0) {
    const ordinal = prefixOrdinal(before, op);
    if (ordinal >= ends.length) return { kind: 'ambiguous' };
    primary = ends[ordinal];
  }
  // 前缀出现个数与原稿一致时，出现序号才仍是可靠的消歧依据。
  const stable = ends.length === prefixEnds(before, prefix).length;

  const applied = new Set<number>();
  const apply = new Set<number>();
  collectAnchorCandidates(current, op.afterText, prefix, suffix, applied);
  collectAnchorCandidates(current, op.beforeText, prefix, suffix, apply);

  // 已落盘候选唯一：幂等跳过（不写盘最安全）。
  if (applied.size === 1) return { kind: 'anchor', at: [...applied][0] };
  if (applied.size > 1) return { kind: 'ambiguous' };

  // 纯插入没有 beforeText 可核验，只信前缀锚点定位。
  if (!op.beforeText) {
    return primary !== null && stable ? { kind: 'anchor', at: primary } : { kind: 'fallback' };
  }

  // 删除类：优先两侧吻合的候选，其次信前缀锚点（无结果文本可核验）。
  // 删除没有结果文本可核验：重复块里「唯一吻合的候选」或「前缀锚点」都可能指向别处，
  // 删错处就是静默写错。故两种取值都要求前缀出现个数与原文一致（出现序号才仍指向目标），
  // 唯一吻合候选还要求原文出现次数与源文件一致（否则它可能是作者改动后剩下的另一处）。
  if (!op.afterText) {
    const onlyBefore = countOccurrences(current, op.beforeText);
    const multiplicityStable = onlyBefore === op.beforeTextOccurrences;
    if (apply.size === 1) {
      return stable && multiplicityStable
        ? { kind: 'anchor', at: [...apply][0] }
        : { kind: 'ambiguous' };
    }
    if (apply.size > 1) return { kind: 'ambiguous' };
    // 无两侧吻合候选：只信前缀锚点；出现个数已变（作者增删了前缀块）则序号可能落到别处，拒写。
    if (primary !== null) {
      return stable ? { kind: 'anchor', at: primary } : { kind: 'ambiguous' };
    }
    return { kind: 'fallback' };
  }

  // 替换类：原文出现次数与源文件不一致 → 重复块结构已变，位置映射不可信，拒写。
  const multiplicityStable = countOccurrences(current, op.beforeText) === op.beforeTextOccurrences;
  if (apply.size === 1) {
    const only = [...apply][0];
    return primary === null || (primary === only && stable && multiplicityStable)
      ? { kind: 'anchor', at: only }
      : { kind: 'ambiguous' };
  }
  if (apply.size > 1) {
    return primary !== null && stable && multiplicityStable && apply.has(primary)
      ? { kind: 'anchor', at: primary }
      : { kind: 'ambiguous' };
  }
  const onlyBefore = countOccurrences(current, op.beforeText);
  if (primary !== null) {
    // 前缀序号锚点处仍是原文且全篇只此一处，才敢按它施加；否则拒写。
    return multiplicityStable && onlyBefore === 1 && current.indexOf(op.beforeText) === primary
      ? { kind: 'anchor', at: primary }
      : { kind: 'ambiguous' };
  }
  // 前缀锚点已消失（作者改了 op 之前的内容）：原文全篇唯一才交给上下文定位兜底。
  return multiplicityStable && onlyBefore === 1 ? { kind: 'fallback' } : { kind: 'ambiguous' };
}

/** 目标锚点处相对 op 的状态：applied 已完成（幂等跳过）、apply 待施加、conflict 冲突。 */
function classifyAtAnchor(
  current: string,
  op: PatchHunk,
  anchor: number,
): 'applied' | 'apply' | 'conflict' {
  if (op.afterText && current.slice(anchor, anchor + op.afterText.length) === op.afterText) {
    return 'applied';
  }
  if (current.slice(anchor, anchor + op.beforeText.length) === op.beforeText) return 'apply';
  // 删除类已应用：目标处此刻就是原文的后缀上下文。
  const suffix = op.originalSuffixContext;
  if (!op.afterText && suffix && current.slice(anchor, anchor + suffix.length) === suffix) {
    return 'applied';
  }
  return 'conflict';
}

/**
 * 规划一次整份接受：
 * - 当前稿与 before 归一化后一致 → 直接写 after（内容本就是这个结果）；
 * - 否则把尚未应用的原始 op 逐个映射到当前稿（原文 + 前后文定位，冲突即抛错）。
 *
 * 已落盘的 op（例如重复确认同一条已写入的补丁）会幂等跳过；作者改动了 op 覆盖的原文时
 * 定位失败且 after 不在稿内，向上抛错由调用方拒写。
 */
export function planWholeAccept(
  current: string,
  before: string,
  after: string,
  appliedOpIds: ReadonlySet<string>,
  normalizeEol: (text: string) => string,
): WholeAcceptPlan {
  if (normalizeEol(current) === normalizeEol(before)) {
    const settledOpIds = new Set(buildSuggestionOps(before, after).map((op) => op.id));
    return { content: after, applied: [], fastPath: true, settledOpIds };
  }
  const ops = buildSuggestionOps(before, after);
  let content = current;
  const applied: AppliedSuggestionOp[] = [];
  const settledOpIds = new Set<string>();
  for (const op of ops) {
    const located = locateOpAnchor(content, op, before);
    // 前缀仍在但出现序号越界：无法唯一确定目标，拒绝猜着写。
    if (located.kind === 'ambiguous') {
      throw new Error('该修改块的前文在当前文件中出现多次，无法安全定位。');
    }
    const state = located.kind === 'anchor' ? classifyAtAnchor(content, op, located.at) : null;
    // 已落盘的 op 幂等跳过：目标锚点处已是 afterText（或删除类已是后缀上下文）时不重复施加。
    if (state === 'applied') {
      settledOpIds.add(op.id);
      continue;
    }
    // 标记为已应用但实际不在稿内（作者改回原文）时：不重复应用，也不计入归属依据（T07-F3）。
    if (appliedOpIds.has(op.id)) continue;
    if (state === 'apply' && located.kind === 'anchor') {
      const { at } = located;
      content = content.slice(0, at) + op.afterText + content.slice(at + op.beforeText.length);
      applied.push({ op, inverse: invertPatchHunk(op) });
      settledOpIds.add(op.id);
      continue;
    }
    if (state === 'conflict') {
      // 锚点明确但目标处既非结果也非原文：作者改动了该处，拒绝猜着写。
      throw new Error('该修改块在原文中的位置已被改动，无法安全定位。');
    }
    // 前缀锚点已不可用（作者改了 op 之前的正文）：只能退回按原文定位。
    // 原文在当前稿里出现多次时无法消歧——旧的「最佳分」会在重复块里挑错一处并静默写错，
    // 故与分块接受同一策略：出现多次即拒绝；唯一出现时才安全施加。
    if (countOccurrences(content, op.beforeText) !== 1) {
      throw new Error('该修改块之前的正文已被改动，且原文在当前文件中出现多次，无法安全定位。');
    }
    content = applyPatchHunkToCurrent(content, op);
    applied.push({ op, inverse: invertPatchHunk(op) });
    settledOpIds.add(op.id);
  }
  return { content, applied, fastPath: false, settledOpIds };
}

/**
 * 规划一次分块接受：把指定 op 锚定到当前稿并施加。
 *
 * 与整份接受（planWholeAccept）共用同一套「前缀锚定 + 出现序号消歧 + 无法唯一确定即拒绝」
 * 定位器（locateOpAnchor）：旧的分块路径直接用 patch-hunks 的「全部出现里取部分上下文最佳分」，
 * 目标块上下文被作者改过、文中又有重复块时会静默写到另一处。这里定位不到唯一目标即抛冲突，
 * 调用方据此零写入；已落盘的 op 幂等跳过（返回 alreadyApplied，不产生内容变化）。
 */
export function planHunkAccept(
  current: string,
  op: PatchHunk,
  before: string,
): { content: string; alreadyApplied: boolean } {
  const located = locateOpAnchor(current, op, before);
  if (located.kind !== 'anchor') {
    throw new Error(
      located.kind === 'ambiguous'
        ? '这个修改块在当前文件里无法唯一确定位置（可能已被改写或存在重复内容），已拒绝接受以免写错处；请重新生成修订或手动处理。'
        : '这个修改块在当前文件里定位不到，已拒绝接受以免写错处；请重新生成修订或手动处理。',
    );
  }
  const state = classifyAtAnchor(current, op, located.at);
  if (state === 'applied') return { content: current, alreadyApplied: true };
  if (state === 'conflict') {
    throw new Error(
      '这个修改块在原文中的位置已被改动，无法安全定位；已拒绝接受，请重新生成修订或手动处理。',
    );
  }
  return {
    content:
      current.slice(0, located.at) +
      op.afterText +
      current.slice(located.at + op.beforeText.length),
    alreadyApplied: false,
  };
}

/** 审稿问题覆盖的原文行范围（1-based，闭区间）。拿不到行范围的问题不参与归属，绝不臆造。 */
export type IssueScope = { id: string; lineStart: number; lineEnd: number };

/** 问题在本次写回中的归属态：resolved 覆盖它的 op 全被接受；touched 部分接受；open 未接受或无法归属。 */
export type IssueStatus = 'resolved' | 'touched' | 'open';
export type IssueResolution = { id: string; status: IssueStatus };
export type IssueCounts = { observed: number; authorConfirmed: number; resolved: number };

type LineRange = { start: number; end: number };

/** op 覆盖 0-based 半开行区间；插入类 op 无原始行时按覆盖一行计。 */
function opLineRange(op: PatchHunk): LineRange {
  const start = op.originalStartIndex;
  return { start, end: op.originalEndIndex > start ? op.originalEndIndex : start + 1 };
}

/** 问题行范围是 1-based 闭区间，转成 0-based 半开。 */
function issueLineRange(scope: IssueScope): LineRange {
  return { start: scope.lineStart - 1, end: scope.lineEnd };
}

function rangesOverlap(a: LineRange, b: LineRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * 把每个 op 关联到其覆盖行范围内的问题，供接受时按「哪些 op 真的被接受」分列问题状态。
 * 问题行范围是 1-based 闭区间，op 覆盖区间是 0-based 半开；插入类 op 按覆盖一行计。
 * 拿不到行范围（映射不出）的问题不会出现在结果里，调用方让它保持 open。
 */
export function associateIssuesToOps(
  ops: readonly PatchHunk[],
  scopes: readonly IssueScope[],
): Map<string, string[]> {
  const links = new Map<string, string[]>();
  if (ops.length === 0 || scopes.length === 0) return links;
  for (const op of ops) {
    const range = opLineRange(op);
    const ids = scopes
      .filter((scope) => rangesOverlap(range, issueLineRange(scope)))
      .map((scope) => scope.id);
    if (ids.length > 0) links.set(op.id, ids);
  }
  return links;
}

/** 这些问题里是否至少有一个带行范围数据（能匹配到 scope）；有数据才允许报 N/M 计数。 */
export function hasIssueAttribution(
  issueIds: readonly string[],
  scopes: readonly IssueScope[],
): boolean {
  if (issueIds.length === 0 || scopes.length === 0) return false;
  return scopes.some((scope) => issueIds.includes(scope.id));
}

/**
 * 按已接受的 op 集合推断问题归属态：只有被接受的 op 完整覆盖问题行范围才算 resolved，
 * 被接受但在范围内留下缺口算 touched，未覆盖或无法归属算 open。
 */
export function resolveIssueStatuses(
  issueIds: readonly string[],
  scopes: readonly IssueScope[],
  ops: readonly PatchHunk[],
  appliedOpIds: ReadonlySet<string>,
): IssueResolution[] {
  return issueIds.map((id) => {
    const scope = scopes.find((candidate) => candidate.id === id);
    if (!scope) return { id, status: 'open' as const };
    const target = issueLineRange(scope);
    const accepted = ops
      .filter((op) => appliedOpIds.has(op.id) && rangesOverlap(opLineRange(op), target))
      .map(opLineRange)
      .sort((left, right) => left.start - right.start);
    if (accepted.length === 0) return { id, status: 'open' as const };
    let reach = target.start;
    for (const range of accepted) {
      if (range.start > reach) break;
      reach = Math.max(reach, range.end);
    }
    return { id, status: reach >= target.end ? 'resolved' : 'touched' };
  });
}

/** 分列可观测量：observed 全部、author-confirmed 作者已动手、resolved 已完整解决。 */
export function summarizeIssueResolutions(resolutions: readonly IssueResolution[]): IssueCounts {
  return {
    observed: resolutions.length,
    authorConfirmed: resolutions.filter((resolution) => resolution.status !== 'open').length,
    resolved: resolutions.filter((resolution) => resolution.status === 'resolved').length,
  };
}
