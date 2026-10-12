import type { ProjectReader } from '../readPort';
import { readCanon } from './canonFiles';
import { chapterOrdinals } from './canonRebuild';
import { isJsonObject, type JsonObject, type JsonValue } from './json';
import { pythonStrip } from './pythonText';

export const DEFAULT_STALE_AFTER_CHAPTERS = 30;
const ACTIVE_UNRESOLVED_STATUSES = new Set(['planted', 'advancing']);

type Issue = { [key: string]: JsonValue };

async function issueId(parts: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(parts.join('|')));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'));
  return `promise_${hex.join('').slice(0, 12)}`;
}

function promiseId(entry: JsonObject): string | null {
  const value = entry.id;
  return typeof value === 'string' && pythonStrip(value) ? pythonStrip(value) : null;
}

/** 合法章号：正整数；其它整数（0、负数）不参与依赖它的规则。 */
function chapter(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && value >= 1 ? value : null;
}

function title(entry: JsonObject): string | null {
  const value = entry.title;
  return typeof value === 'string' && pythonStrip(value) ? pythonStrip(value) : null;
}

function lastTouch(entry: JsonObject, planted: number): number {
  const touches = entry.touches;
  const last =
    Array.isArray(touches) && touches.length ? chapter(touches[touches.length - 1]) : null;
  return Math.max(planted, last ?? planted);
}

async function makeIssue(
  category: string,
  severity: string,
  id: string,
  message: string,
  options: { idParts?: string[]; title?: string | null; fields?: Issue } = {},
): Promise<Issue> {
  const output: Issue = {
    id: await issueId([category, id, ...(options.idParts ?? [])]),
    category,
    severity,
    promise_id: id,
    message,
    ...options.fields,
  };
  if (options.title != null) output.title = options.title;
  return output;
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<JsonValue>();
  return issues.filter((issue) => {
    if (seen.has(issue.id)) return false;
    seen.add(issue.id);
    return true;
  });
}

function promisesOf(canon: JsonObject): JsonObject[] {
  const invariants = canon.invariants;
  const raw = isJsonObject(invariants) ? invariants.promises : undefined;
  return Array.isArray(raw)
    ? raw.filter((entry): entry is JsonObject => isJsonObject(entry) && promiseId(entry) !== null)
    : [];
}

export type PromiseCheckResult = {
  current_chapter: number;
  promise_count: number;
  checked_promises: string[];
  conflicts: Issue[];
  advisories: Issue[];
  conflict_count: number;
  advisory_count: number;
  summary: string;
};

/** 检查 canon.json 的 promises 声明：blocking 只描述声明内部结构事实，advisory 由作者核实。 */
export async function checkPromises(
  canon: JsonObject,
  currentChapter: number,
  staleAfterChapters = DEFAULT_STALE_AFTER_CHAPTERS,
): Promise<PromiseCheckResult> {
  if (!Number.isSafeInteger(currentChapter) || currentChapter < 0)
    throw new RangeError('current_chapter 必须是非负整数。');
  if (!Number.isSafeInteger(staleAfterChapters) || staleAfterChapters < 1)
    throw new RangeError('stale_after_chapters 必须是正整数。');
  const promises = promisesOf(canon);
  const ids = promises.map((entry) => promiseId(entry)!);
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

  const conflicts: Issue[] = [];
  const advisories: Issue[] = [];
  for (const [id, count] of counts) {
    if (count < 2) continue;
    conflicts.push(
      await makeIssue(
        'duplicate_id',
        'blocking',
        id,
        `伏笔承诺 id「${id}」重复声明（${count} 条），稳定 id 必须唯一。`,
        { fields: { occurrences: count } },
      ),
    );
  }
  for (const entry of promises) {
    const id = promiseId(entry)!;
    const name = title(entry);
    const label = name || id;
    const status = entry.status;
    const planted = chapter(entry.planted_chapter);
    const due = chapter(entry.due_chapter);
    const resolved = chapter(entry.resolved_chapter);
    if (status === 'resolved' && resolved === null)
      conflicts.push(
        await makeIssue(
          'resolved_chapter',
          'blocking',
          id,
          `伏笔承诺「${label}」标记为 resolved，但 resolved_chapter 缺失或非法。`,
          { title: name, fields: { status: 'resolved' } },
        ),
      );
    if (planted !== null && resolved !== null && resolved < planted)
      conflicts.push(
        await makeIssue(
          'resolved_before_planted',
          'blocking',
          id,
          `伏笔承诺「${label}」在第 ${resolved} 章兑现，早于第 ${planted} 章埋设。`,
          {
            idParts: [String(planted), String(resolved)],
            title: name,
            fields: { planted_chapter: planted, resolved_chapter: resolved },
          },
        ),
      );
    if (planted !== null && due !== null && due < planted)
      conflicts.push(
        await makeIssue(
          'due_before_planted',
          'blocking',
          id,
          `伏笔承诺「${label}」的截止章 ${due} 早于埋设章 ${planted}。`,
          {
            idParts: [String(planted), String(due)],
            title: name,
            fields: { planted_chapter: planted, due_chapter: due },
          },
        ),
      );
    if (
      typeof status === 'string' &&
      ACTIVE_UNRESOLVED_STATUSES.has(status) &&
      due !== null &&
      currentChapter > due
    )
      advisories.push(
        await makeIssue(
          'overdue',
          'medium',
          id,
          `伏笔承诺「${label}」已超过第 ${due} 章截止窗口，当前正文到第 ${currentChapter} 章仍未兑现。`,
          {
            idParts: [String(due)],
            title: name,
            fields: { status, due_chapter: due, current_chapter: currentChapter },
          },
        ),
      );
    const dueExplicitlyOpen = 'due_chapter' in entry && entry.due_chapter === null;
    if (status === 'planted' && dueExplicitlyOpen && planted !== null) {
      const touch = lastTouch(entry, planted);
      const gap = currentChapter - touch;
      if (gap >= staleAfterChapters)
        advisories.push(
          await makeIssue(
            'stalled',
            'medium',
            id,
            `伏笔承诺「${label}」已有 ${gap} 章未推进，请核实是否遗忘或仍需保留。`,
            {
              idParts: [String(touch), String(staleAfterChapters)],
              title: name,
              fields: {
                status: 'planted',
                last_touch_chapter: touch,
                current_chapter: currentChapter,
                gap_chapters: gap,
                stale_after_chapters: staleAfterChapters,
              },
            },
          ),
        );
    }
    const cadence = chapter(entry.cadence_chapters);
    if (entry.kind === 'recurring' && planted !== null && cadence !== null) {
      const touch = lastTouch(entry, planted);
      const gap = currentChapter - touch;
      if (gap > cadence)
        advisories.push(
          await makeIssue(
            'cadence_gap',
            'medium',
            id,
            `循环承诺「${label}」已间隔 ${gap} 章未推进，超过每 ${cadence} 章一次的 cadence。`,
            {
              idParts: [String(touch), String(cadence)],
              title: name,
              fields: {
                kind: 'recurring',
                last_touch_chapter: touch,
                current_chapter: currentChapter,
                gap_chapters: gap,
                cadence_chapters: cadence,
              },
            },
          ),
        );
    }
  }
  const uniqueConflicts = dedupe(conflicts);
  const uniqueAdvisories = dedupe(advisories);
  let summary: string;
  if (!promises.length)
    summary = 'canon.json 尚无有效 promises 声明；本次没有可检查项，也未补造伏笔数据。';
  else if (uniqueConflicts.length || uniqueAdvisories.length)
    summary =
      `已检查 ${promises.length} 条伏笔承诺：发现 ${uniqueConflicts.length} 个 blocking 声明矛盾、` +
      `${uniqueAdvisories.length} 个 advisory 提醒；advisory 需结合原文核实。`;
  else summary = `已检查 ${promises.length} 条伏笔承诺，未发现 blocking 矛盾或 advisory 提醒。`;
  return {
    current_chapter: currentChapter,
    promise_count: promises.length,
    checked_promises: [...counts.keys()],
    conflicts: uniqueConflicts,
    advisories: uniqueAdvisories,
    conflict_count: uniqueConflicts.length,
    advisory_count: uniqueAdvisories.length,
    summary,
  };
}

/** 把 promises 声明投影成台账并挂上关联 issue；不重算规则、不自造状态结论。 */
export function buildPromiseLedger(canon: JsonObject, output: PromiseCheckResult) {
  const byPromise = new Map<string, Issue[]>();
  for (const issue of [...output.conflicts, ...output.advisories]) {
    if (typeof issue.promise_id !== 'string') continue;
    const list = byPromise.get(issue.promise_id) ?? [];
    list.push({
      id: issue.id ?? null,
      category: issue.category ?? null,
      severity: issue.severity ?? null,
      message: issue.message ?? null,
    });
    byPromise.set(issue.promise_id, list);
  }
  return promisesOf(canon).map((entry) => {
    const id = promiseId(entry)!;
    const planted = chapter(entry.planted_chapter);
    return {
      id,
      title: title(entry),
      status: typeof entry.status === 'string' ? entry.status : null,
      kind: typeof entry.kind === 'string' ? entry.kind : null,
      planted_chapter: planted,
      due_chapter: chapter(entry.due_chapter),
      resolved_chapter: chapter(entry.resolved_chapter),
      last_touch_chapter: planted !== null ? lastTouch(entry, planted) : null,
      issues: byPromise.get(id) ?? [],
    };
  });
}

/** 只读：读取 canon，按正文阅读序求当前最大章。 */
export async function promiseCheck(
  reader: ProjectReader,
  root: string,
  options: { platform: 'windows' | 'posix'; staleAfterChapters?: number },
): Promise<PromiseCheckResult> {
  const canon = await readCanon(reader, root);
  const ordinals = await chapterOrdinals(reader, root, '*.md', options.platform);
  const current = Math.max(0, ...ordinals.values());
  return checkPromises(canon, current, options.staleAfterChapters);
}
