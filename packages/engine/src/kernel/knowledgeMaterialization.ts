import { isJsonObject, type JsonValue } from './json';
import {
  parseKnowledgeMarkdown,
  renderKnowledgeEntry,
  upsertKnowledgeEntry,
  type KnowledgeEntry,
  type KnowledgeSource,
} from './knowledgeEntries';

const SOURCE_KEYS = [
  'type',
  'path',
  'content_sha256',
  'agent_event_id',
  'locator',
  'title',
  'accessed_at',
  'summary_sha256',
] as const;
const sourceKey = (source: KnowledgeSource) =>
  JSON.stringify(SOURCE_KEYS.map((key) => source[key] ?? null));

/** Python 的 str()：缺省 / null 写成 'None'。 */
const pythonStr = (value: JsonValue | undefined) =>
  value === undefined || value === null
    ? 'None'
    : typeof value === 'string'
      ? value
      : String(value);

/** 提案里的来源 → 落入知识块的来源；作者陈述以本次确认事件为证。 */
export function materializedSource(
  payload: JsonValue,
  confirmationEventId: string,
): KnowledgeSource {
  const value = isJsonObject(payload) ? payload : {};
  const type = value.type;
  if (type === 'project_file')
    return {
      type: 'project_file',
      path: pythonStr(value.path),
      content_sha256: pythonStr(value.content_sha256),
    };
  if (type === 'author_statement')
    return { type: 'author_statement', agent_event_id: confirmationEventId };
  if (type === 'external_reference')
    return {
      type: 'external_reference',
      locator: pythonStr(value.locator),
      title: pythonStr(value.title),
      accessed_at: pythonStr(value.accessed_at),
      summary_sha256: pythonStr(value.summary_sha256),
    };
  throw new RangeError(`不支持的 knowledge source type：${pythonStr(type)}`);
}

/**
 * extend 的来源合并：同路径 project_file 保留新哈希（旧哈希必然对不上磁盘，会让条目恒为 stale），
 * 其余取并集去重。
 */
export function replaceSamePathProjectSources(
  current: readonly KnowledgeSource[],
  proposed: readonly KnowledgeSource[],
): KnowledgeSource[] {
  const proposedPaths = new Set(
    proposed
      .filter((source) => source.type === 'project_file' && source.path != null)
      .map((source) => source.path),
  );
  const kept = current.filter(
    (source) => !(source.type === 'project_file' && proposedPaths.has(source.path)),
  );
  const seen = new Set<string>();
  return [...kept, ...proposed].filter((source) => {
    const key = sourceKey(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function withStatus(
  entry: KnowledgeEntry,
  status: string,
  updatedAt: string,
  supersededBy: string | null = null,
) {
  return { ...entry, status, updated_at: updatedAt, superseded_by: supersededBy };
}

/** 把一条已确认的知识提议编译成目标 Markdown 的新全文（确定性，不读不写盘）。 */
export function compileKnowledgeOperation(
  before: string,
  proposed: KnowledgeEntry,
  options: { operation: string; relatedKnowledgeIds: readonly string[]; updatedAt: string },
): [string, KnowledgeEntry] {
  const { operation, relatedKnowledgeIds, updatedAt } = options;
  if (operation === 'create' || operation === 'migrate')
    return [
      before ? upsertKnowledgeEntry(before, proposed) : renderKnowledgeEntry(proposed),
      proposed,
    ];
  const parsed = parseKnowledgeMarkdown(before);
  if (parsed.warnings.length)
    throw new RangeError('Knowledge target 含损坏 block，不能 materialize。');
  const byId = new Map(parsed.entries.map((entry) => [entry.id, entry]));
  const related = relatedKnowledgeIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  if (related.length !== relatedKnowledgeIds.length || !related.length)
    throw new RangeError('Knowledge proposal 关联的既有 entry 已不存在。');
  const current = related[0];
  if (operation === 'extend') {
    const revised: KnowledgeEntry = {
      id: current.id,
      status: 'active',
      kind: proposed.kind,
      evidence_state: 'current',
      title: proposed.title,
      claim: proposed.claim,
      sources: replaceSamePathProjectSources(current.sources, proposed.sources),
      claim_fingerprint: proposed.claim_fingerprint,
      created_at: current.created_at,
      updated_at: updatedAt,
      superseded_by: null,
    };
    return [upsertKnowledgeEntry(before, revised), revised];
  }
  // 多 ID 关联：全部旧条目都要改状态，不能只改第一条。
  const relabel = (status: string, supersededBy: string | null = null) =>
    related.reduce(
      (after, entry) =>
        upsertKnowledgeEntry(after, withStatus(entry, status, updatedAt, supersededBy)),
      before,
    );
  if (operation === 'retire') return [relabel('retired'), related[0]];
  if (operation === 'dispute') {
    const disputed = { ...proposed, status: 'disputed' };
    return [upsertKnowledgeEntry(relabel('disputed'), disputed), disputed];
  }
  if (operation === 'supersede')
    return [upsertKnowledgeEntry(relabel('superseded', proposed.id), proposed), proposed];
  throw new RangeError(`不支持的 Knowledge proposal operation：${operation}`);
}
