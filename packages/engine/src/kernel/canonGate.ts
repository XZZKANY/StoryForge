import { JsonFields, type JsonObject, type JsonValue } from './json';
import { pythonStrip } from './pythonText';

const CANON_FILE = '.storyforge/canon/canon.json';
const PRESENCE_FILE = '.storyforge/canon/derived/presence.json';
const OPEN_WINDOW = 1_000_000_000;
const MAX_REACH_DEPTH = 64;

type Holder = { item: string; holder: string; from: number; to: number | null };
type Edge = { before: string; after: string };
type Lifespan = { entity: string; exitsAfter: number; reason: string | null };
type Hit = { path: string; chapter: number | null; first_line: number | null };
type PresenceRecord = { canonicalName: string | null; occurrences: Hit[] };

export type CanonIssue = { [key: string]: unknown };
export type CanonGateResult = {
  checked_invariants: string[];
  conflicts: CanonIssue[];
  advisories: CanonIssue[];
  conflict_count: number;
  advisory_count: number;
};

/** 作者声明的不变量：字段类型不对直接报错（迁移计划 §4.3.1）。 */
function readInvariants(canon: JsonValue) {
  const fields = new JsonFields(CANON_FILE);
  const top = fields.object(canon, '顶层');
  const invariants = fields.optionalObject(fields.member(top, 'invariants'), 'invariants');
  const entries = (name: string): [JsonObject, string][] =>
    fields
      .optionalArray(fields.member(invariants, name), `invariants.${name}`)
      .map((value, index) => {
        const path = `invariants.${name}[${index}]`;
        return [fields.object(value, path), path];
      });
  const holders: Holder[] = entries('single_holder').map(([entry, path]) => ({
    item: fields.string(fields.member(entry, 'item'), `${path}.item`),
    holder: fields.string(fields.member(entry, 'holder'), `${path}.holder`),
    from: fields.optionalInteger(fields.member(entry, 'from_chapter'), `${path}.from_chapter`) ?? 1,
    to: fields.optionalInteger(fields.member(entry, 'to_chapter'), `${path}.to_chapter`),
  }));
  const edges: Edge[] = entries('timeline_order').map(([entry, path]) => ({
    before: fields.string(fields.member(entry, 'before'), `${path}.before`),
    after: fields.string(fields.member(entry, 'after'), `${path}.after`),
  }));
  const lifespans: Lifespan[] = entries('lifespan').map(([entry, path]) => ({
    entity: fields.string(fields.member(entry, 'entity'), `${path}.entity`),
    exitsAfter: fields.integer(
      fields.member(entry, 'exits_after_chapter'),
      `${path}.exits_after_chapter`,
    ),
    reason: fields.optionalString(fields.member(entry, 'reason'), `${path}.reason`),
  }));
  return { holders, edges, lifespans };
}

/** 应用写出的出场记录：结构不对同样报错，由调用方决定是否重建缓存。 */
function readPresence(presence: JsonValue): Map<string, PresenceRecord> {
  const fields = new JsonFields(PRESENCE_FILE);
  const top = fields.object(presence, '顶层');
  const records = new Map<string, PresenceRecord>();
  fields.optionalArray(fields.member(top, 'entities'), 'entities').forEach((value, index) => {
    const path = `entities[${index}]`;
    const entry = fields.object(value, path);
    const id = fields.optionalString(fields.member(entry, 'id'), `${path}.id`);
    const record: PresenceRecord = {
      canonicalName: fields.optionalString(
        fields.member(entry, 'canonical_name'),
        `${path}.canonical_name`,
      ),
      occurrences: fields
        .optionalArray(fields.member(entry, 'occurrences'), `${path}.occurrences`)
        .map((item, i) => {
          const at = `${path}.occurrences[${i}]`;
          const occurrence = fields.object(item, at);
          return {
            path: fields.string(fields.member(occurrence, 'path'), `${at}.path`),
            chapter: fields.optionalInteger(fields.member(occurrence, 'chapter'), `${at}.chapter`),
            first_line: fields.optionalInteger(
              fields.member(occurrence, 'first_line'),
              `${at}.first_line`,
            ),
          };
        }),
    };
    if (id !== null) records.set(id, record);
  });
  return records;
}

/** Python 的 sorted(str)：按码点比较，不是 UTF-16 码元。 */
function byCodePoint(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const diff = left[i].codePointAt(0)! - right[i].codePointAt(0)!;
    if (diff) return diff;
  }
  return left.length - right.length;
}

async function issueId(parts: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(parts.join('|')));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'));
  return `canon_${hex.join('').slice(0, 12)}`;
}

async function singleHolder(holders: readonly Holder[]): Promise<CanonIssue[]> {
  const groups = new Map<string, Holder[]>();
  for (const entry of holders) {
    if (!pythonStrip(entry.item)) continue;
    const group = groups.get(entry.item) ?? [];
    group.push(entry);
    groups.set(entry.item, group);
  }
  const issues: CanonIssue[] = [];
  for (const [item, group] of groups) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const left = group[i];
        const right = group[j];
        if (left.holder === right.holder) continue;
        const start = Math.max(left.from, right.from);
        const end = Math.min(left.to ?? OPEN_WINDOW, right.to ?? OPEN_WINDOW);
        if (start > end) continue;
        const pair = [left.holder, right.holder].sort(byCodePoint);
        issues.push({
          id: await issueId(['single_holder', item, ...pair]),
          category: 'single_holder',
          severity: 'blocking',
          item,
          holders: pair,
          message: `唯一持有冲突：「${item}」在交叠章节窗口内同时被 ${pair[0]} 与 ${pair[1]} 持有。`,
        });
      }
    }
  }
  return issues;
}

function timelineCycle(edges: readonly Edge[]): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const { before, after } of edges) {
    if (!pythonStrip(before) || !pythonStrip(after)) continue;
    const next = adjacency.get(before) ?? [];
    next.push(after);
    adjacency.set(before, next);
  }
  const colors = new Map<string, number>();
  function visit(node: string, stack: string[], depth: number): string[] | null {
    if (depth > MAX_REACH_DEPTH) return null;
    colors.set(node, 1);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const state = colors.get(next) ?? 0;
      if (state === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (state === 0) {
        const found = visit(next, stack, depth + 1);
        if (found !== null) return found;
      }
    }
    stack.pop();
    colors.set(node, 2);
    return null;
  }
  for (const start of adjacency.keys()) {
    if ((colors.get(start) ?? 0) !== 0) continue;
    const found = visit(start, [], 0);
    if (found !== null) return found;
  }
  return null;
}

async function lifespan(
  lifespans: readonly Lifespan[],
  presence: Map<string, PresenceRecord>,
): Promise<CanonIssue[]> {
  const issues: CanonIssue[] = [];
  for (const { entity, exitsAfter, reason } of lifespans) {
    const record = presence.get(entity);
    if (!record) continue;
    const hits = record.occurrences
      .filter((occurrence) => occurrence.chapter !== null && occurrence.chapter > exitsAfter)
      .map(({ path, chapter, first_line }) => ({ path, chapter, first_line }));
    if (!hits.length) continue;
    const hint = reason !== null && pythonStrip(reason) ? `（声明原因：${reason}）` : '';
    issues.push({
      id: await issueId(['lifespan', entity, String(exitsAfter)]),
      category: 'lifespan',
      severity: 'medium',
      entity,
      exits_after_chapter: exitsAfter,
      hits,
      message:
        `${record.canonicalName || entity} 声明在第 ${exitsAfter} 章后退场${hint}，` +
        `但正文在其后章节仍出现其表面形（${hits.length} 处）。可能是回忆 / 提及 / 同名，请抽读核实。`,
    });
  }
  return issues;
}

/** Pure gate over decoded declarations/presence. No read, write, cache or command routing.
 * 超出输入范围的声明或出场记录抛 InputDomainError。
 */
export async function checkCanon(canon: JsonValue, presence: JsonValue): Promise<CanonGateResult> {
  const { holders, edges, lifespans } = readInvariants(canon);
  const records = readPresence(presence);
  const conflicts = await singleHolder(holders);
  const cycle = timelineCycle(edges);
  if (cycle !== null) {
    conflicts.push({
      id: await issueId(['timeline_order', ...cycle]),
      category: 'timeline_order',
      severity: 'blocking',
      cycle,
      message: `时间线先后声明成环：${cycle.join(' → ')}，无法确定一致的先后顺序。`,
    });
  }
  const advisories = await lifespan(lifespans, records);
  const checked = [
    ['single_holder', holders.length],
    ['timeline_order', edges.length],
    ['lifespan', lifespans.length],
  ] as const;
  return {
    checked_invariants: checked.filter(([, size]) => size > 0).map(([name]) => name),
    conflicts,
    advisories,
    conflict_count: conflicts.length,
    advisory_count: advisories.length,
  };
}
