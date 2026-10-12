import type { ProjectReader } from '../readPort';
import type { ProjectWriter } from '../writePort';
import { assertionMetadata, normalizeAssertionMetadata } from './canonAssertions';
import { checkCanonDeclaration } from './canonDeclarations';
import { readCanon, readDerived, scaffoldCanonIfMissing, writeDerived } from './canonFiles';
import { checkCanon, type CanonIssue } from './canonGate';
import { entitySurfaceForms, presenceFromCache, rebuildPresence } from './canonRebuild';
import { UNCACHED_SCAN_NOTE } from './canonService';
import { captureCanonSourceRevision } from './canonStore';
import { FsToolError } from './fsTools';
import {
  cloneJson,
  compareCodePoints,
  InputDomainError,
  isJsonObject,
  pythonEquals,
  type JsonObject,
  type JsonValue,
} from './json';
import { pythonStrip } from './pythonText';

export const INVARIANT_KEYS = ['single_holder', 'lifespan', 'timeline_order', 'promises'] as const;
const PROMISE_STATUSES = new Set(['planted', 'advancing', 'resolved']);

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const own = (entry: JsonObject, key: string) =>
  Object.prototype.hasOwnProperty.call(entry, key) ? entry[key] : undefined;

function requiredText(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || !pythonStrip(value))
    throw new FsToolError(`${label} 必须是非空字符串。`);
  return pythonStrip(value);
}

function optionalText(value: JsonValue | undefined, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new FsToolError(`${label} 必须是字符串。`);
  return pythonStrip(value);
}

function optionalInt(entry: JsonObject, key: string, label: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(entry, key)) return null;
  const value = entry[key];
  if (typeof value !== 'number') throw new FsToolError(`${label} 必须是整数。`);
  return value;
}

function normalizeEntities(entries: readonly JsonObject[]): JsonObject[] {
  return entries.map((entry, index) => {
    const name = requiredText(own(entry, 'name'), `entities[${index}].name`);
    const raw =
      own(entry, 'aliases') ?? (Object.prototype.hasOwnProperty.call(entry, 'aliases') ? null : []);
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string'))
      throw new FsToolError(`entities[${index}].aliases 必须是字符串数组。`);
    const aliases: string[] = [];
    for (const item of raw as string[]) {
      const alias = pythonStrip(item);
      if (alias && alias !== name && !aliases.includes(alias)) aliases.push(alias);
    }
    return { name, aliases, ...normalizeAssertionMetadata(entry, `entities[${index}]`) };
  });
}

function normalizeHolderClaims(entries: readonly JsonObject[]): JsonObject[] {
  return entries.map((entry, index) => {
    const claim: JsonObject = {
      item: requiredText(own(entry, 'item'), `holder_claims[${index}].item`),
      holder: requiredText(own(entry, 'holder'), `holder_claims[${index}].holder`),
    };
    for (const key of ['from_chapter', 'to_chapter']) {
      const value = optionalInt(entry, key, `holder_claims[${index}].${key}`);
      if (value !== null) claim[key] = value;
    }
    return { ...claim, ...normalizeAssertionMetadata(entry, `holder_claims[${index}]`) };
  });
}

function normalizeExitClaims(entries: readonly JsonObject[]): JsonObject[] {
  return entries.map((entry, index) => {
    const exitsAfter = optionalInt(
      entry,
      'exits_after_chapter',
      `exit_claims[${index}].exits_after_chapter`,
    );
    if (exitsAfter === null)
      throw new FsToolError(`exit_claims[${index}].exits_after_chapter 必填。`);
    const claim: JsonObject = {
      entity: requiredText(own(entry, 'entity'), `exit_claims[${index}].entity`),
      exits_after_chapter: exitsAfter,
    };
    const reason = optionalText(own(entry, 'reason'), `exit_claims[${index}].reason`);
    if (reason !== null) claim.reason = reason;
    return { ...claim, ...normalizeAssertionMetadata(entry, `exit_claims[${index}]`) };
  });
}

/** 从标题派生稳定 id：模型每章重复观察同一条伏笔时靠它去重。 */
async function promiseId(title: string): Promise<string> {
  return `promise_${(await sha1Hex(title)).slice(0, 8)}`;
}

async function normalizePromiseClaims(entries: readonly JsonObject[]): Promise<JsonObject[]> {
  const normalized: JsonObject[] = [];
  for (const [index, entry] of entries.entries()) {
    const label = `promise_claims[${index}]`;
    const title = requiredText(own(entry, 'title'), `${label}.title`);
    const planted = optionalInt(entry, 'planted_chapter', `${label}.planted_chapter`);
    if (planted === null)
      throw new FsToolError(`${label}.planted_chapter 必填：不知道埋在第几章就算不了逾期。`);
    if (planted < 1) throw new FsToolError(`${label}.planted_chapter 必须 ≥ 1。`);
    const claim: JsonObject = {
      id: optionalText(own(entry, 'id'), `${label}.id`) || (await promiseId(title)),
      title,
      planted_chapter: planted,
      status: 'planted',
    };
    const status = optionalText(own(entry, 'status'), `${label}.status`);
    if (status) {
      if (!PROMISE_STATUSES.has(status))
        throw new FsToolError(
          `${label}.status 只能是 planted / advancing / resolved，收到 ${status}。`,
        );
      claim.status = status;
    }
    // 显式 null 表示开放窗口，与省略不同：保留它以免下次又被问一遍。
    if (Object.prototype.hasOwnProperty.call(entry, 'due_chapter')) {
      const due = entry.due_chapter;
      if (due !== null) {
        if (typeof due !== 'number')
          throw new FsToolError(`${label}.due_chapter 必须是整数或 null。`);
        if (due < planted) throw new FsToolError(`${label}.due_chapter 不能早于 planted_chapter。`);
      }
      claim.due_chapter = due;
    }
    for (const key of ['resolved_chapter', 'cadence_chapters']) {
      const value = optionalInt(entry, key, `${label}.${key}`);
      if (value !== null) {
        if (value < 1) throw new FsToolError(`${label}.${key} 必须 ≥ 1。`);
        claim[key] = value;
      }
    }
    const kind = optionalText(own(entry, 'kind'), `${label}.kind`);
    if (kind) claim.kind = kind;
    normalized.push({ ...claim, ...normalizeAssertionMetadata(entry, label) });
  }
  return normalized;
}

function normalizeTimelineClaims(entries: readonly JsonObject[]): JsonObject[] {
  return entries.map((entry, index) => {
    const before = requiredText(own(entry, 'before'), `timeline_claims[${index}].before`);
    const after = requiredText(own(entry, 'after'), `timeline_claims[${index}].after`);
    return { before, after, ...normalizeAssertionMetadata(entry, `timeline_claims[${index}]`) };
  });
}

function mergeEntityMetadata(target: JsonObject, proposed: JsonObject) {
  const incoming = assertionMetadata(proposed);
  if (!Object.keys(incoming).length) return;
  const current = assertionMetadata(target);
  // 按 id 归并，不能用后一次观测静默覆盖另一份依据或来源类型。
  if (Object.keys(current).length && !pythonEquals(current, incoming))
    throw new FsToolError('同一待确认实体的来源类型或依据不同，请先整合为一条实体提案。');
  Object.assign(target, incoming);
}

async function classifyEntities(
  proposed: readonly JsonObject[],
  canonEntities: readonly JsonObject[],
) {
  const surfaceIndex = new Map<string, Set<string>>();
  for (const entity of canonEntities) {
    const id = entity.id;
    if (typeof id !== 'string' || !pythonStrip(id)) continue;
    for (const surface of entitySurfaceForms(entity)) {
      const ids = surfaceIndex.get(surface) ?? new Set();
      ids.add(pythonStrip(id));
      surfaceIndex.set(surface, ids);
    }
  }
  const newById = new Map<string, JsonObject>();
  const known: JsonObject[] = [];
  const conflicts: JsonObject[] = [];
  for (const entity of proposed) {
    const surfaces = [entity.name as string, ...(entity.aliases as string[])];
    const matched = [
      ...new Set(surfaces.flatMap((surface) => [...(surfaceIndex.get(surface) ?? [])])),
    ].sort(compareCodePoints);
    if (matched.length > 1) {
      conflicts.push({
        rule: 'alias_conflict',
        severity: 'advisory',
        detail: '同一提议实体的名称或别名命中多个既有实体，请作者核实身份归属。',
        snippet: surfaces.join('、'),
        matched_ids: matched,
      });
      known.push({ ...entity, matched_ids: matched });
      continue;
    }
    if (matched.length) {
      known.push({ ...entity, matched_id: matched[0] });
      continue;
    }
    const id = `ent_${(await sha1Hex(entity.name as string)).slice(0, 8)}`;
    const existing = newById.get(id);
    if (existing === undefined) {
      newById.set(id, {
        id,
        canonical_name: entity.name as string,
        aliases: [...(entity.aliases as string[])],
        ...assertionMetadata(entity),
      });
      continue;
    }
    mergeEntityMetadata(existing, entity);
    const aliases = existing.aliases as string[];
    for (const alias of entity.aliases as string[])
      if (!aliases.includes(alias)) aliases.push(alias);
  }
  return { newEntities: [...newById.values()], known, conflicts };
}

function appendInvariantClaims(
  merged: JsonObject,
  claimsByKey: Partial<Record<(typeof INVARIANT_KEYS)[number], readonly JsonObject[]>>,
) {
  if (!Object.prototype.hasOwnProperty.call(merged, 'invariants')) merged.invariants = {};
  const invariants = merged.invariants;
  if (!isJsonObject(invariants)) throw new FsToolError('canon.json invariants 必须是 JSON 对象。');
  for (const key of INVARIANT_KEYS) {
    const claims = claimsByKey[key] ?? [];
    if (!claims.length) continue;
    if (!Object.prototype.hasOwnProperty.call(invariants, key)) invariants[key] = [];
    const existing = invariants[key];
    if (!Array.isArray(existing))
      throw new FsToolError(`canon.json invariants.${key} 必须是数组。`);
    // 同一条声明被模型每章重复观察时，草稿不该越攒越长。
    for (const claim of claims)
      if (!existing.some((item) => pythonEquals(item, claim))) existing.push(cloneJson(claim));
  }
}

function mergedEntities(merged: JsonObject): JsonValue[] {
  if (!Object.prototype.hasOwnProperty.call(merged, 'entities')) merged.entities = [];
  const entities = merged.entities;
  if (!Array.isArray(entities)) throw new FsToolError('canon.json entities 必须是数组。');
  return entities;
}

/** 把上一轮草稿里作者还没并入的提案接回本轮草稿（proposals.json 是整文件覆盖写）。 */
function carryOverPending(merged: JsonObject, canon: JsonObject, previous: JsonObject) {
  const canonIds = new Set(
    (Array.isArray(canon.entities) ? canon.entities : [])
      .filter(isJsonObject)
      .map((entity) => entity.id ?? null),
  );
  const entities = mergedEntities(merged);
  const mergedIds = new Set(entities.filter(isJsonObject).map((entity) => entity.id ?? null));
  for (const entity of Array.isArray(previous.entities) ? previous.entities : []) {
    if (!isJsonObject(entity)) continue;
    const id = entity.id ?? null;
    if (canonIds.has(id) || mergedIds.has(id)) continue;
    entities.push(cloneJson(entity));
    mergedIds.add(id);
  }
  const drafted = previous.invariants;
  if (!isJsonObject(drafted)) return;
  const pending: Partial<Record<(typeof INVARIANT_KEYS)[number], JsonObject[]>> = {};
  for (const key of INVARIANT_KEYS) {
    const list = drafted[key];
    pending[key] = Array.isArray(list) ? list.filter(isJsonObject) : [];
  }
  appendInvariantClaims(merged, pending);
}

/** proposals.json 是应用写出的草稿（合并后的 canon）：结构不合视为缓存失效。 */
async function readDraft(reader: ProjectReader, root: string): Promise<JsonObject | null> {
  const draft = await readDerived(reader, root, 'proposals.json');
  if (draft === null) return null;
  try {
    checkCanonDeclaration(draft, '.storyforge/canon/derived/proposals.json');
  } catch (error) {
    if (error instanceof InputDomainError) return null;
    throw error;
  }
  return draft;
}

/** 把 proposals.json 草稿与作者 canon 差读出仍待确认的提议（只读）。 */
export async function readPendingProposals(reader: ProjectReader, root: string) {
  const draft = await readDraft(reader, root);
  if (draft === null)
    return { available: false, new_entities: [], new_invariants: {}, pending_count: 0 };
  const canon = await readCanon(reader, root);
  const knownIds = new Set(
    (Array.isArray(canon.entities) ? canon.entities : [])
      .filter(isJsonObject)
      .map((entity) => entity.id ?? null),
  );
  const newEntities = (Array.isArray(draft.entities) ? draft.entities : []).filter(
    (entity): entity is JsonObject => isJsonObject(entity) && !knownIds.has(entity.id ?? null),
  );
  const canonInvariants = isJsonObject(canon.invariants) ? canon.invariants : {};
  const draftInvariants = isJsonObject(draft.invariants) ? draft.invariants : {};
  const newInvariants: { [key: string]: JsonObject[] } = {};
  for (const key of INVARIANT_KEYS) {
    const list = (value: JsonValue | undefined) =>
      Array.isArray(value) ? value.filter(isJsonObject) : [];
    const existing = list((canonInvariants as JsonObject)[key]);
    const pending = list((draftInvariants as JsonObject)[key]).filter(
      (entry) => !existing.some((item) => pythonEquals(item, entry)),
    );
    if (pending.length) newInvariants[key] = pending;
  }
  const pendingCount =
    newEntities.length + Object.values(newInvariants).reduce((sum, items) => sum + items.length, 0);
  return {
    available: true,
    new_entities: newEntities,
    new_invariants: newInvariants,
    pending_count: pendingCount,
  };
}

function newGateIssues(baseline: CanonIssue[], merged: CanonIssue[]): CanonIssue[] {
  const ids = new Set<unknown>(baseline.map((issue) => issue.id).filter((id) => id != null));
  return merged.filter((issue) => !ids.has(issue.id));
}

export type CanonDeltaInput = {
  entities?: readonly JsonObject[] | null;
  holderClaims?: readonly JsonObject[] | null;
  exitClaims?: readonly JsonObject[] | null;
  timelineClaims?: readonly JsonObject[] | null;
  promiseClaims?: readonly JsonObject[] | null;
};

/** 把结构化正文观察值合并成可审阅的 canon 草稿（proposals.json），不写回作者 canon。 */
export async function canonDelta(
  reader: ProjectReader,
  writer: ProjectWriter,
  root: string,
  input: CanonDeltaInput,
  platform: 'windows' | 'posix',
) {
  const entities = normalizeEntities(input.entities ?? []);
  const holders = normalizeHolderClaims(input.holderClaims ?? []);
  const exits = normalizeExitClaims(input.exitClaims ?? []);
  const timeline = normalizeTimelineClaims(input.timelineClaims ?? []);
  const promises = await normalizePromiseClaims(input.promiseClaims ?? []);

  await scaffoldCanonIfMissing(reader, writer, root, platform);
  const sourceRevision = await captureCanonSourceRevision(reader, root);
  const canon = await readCanon(reader, root);
  const canonEntities = canon.entities ?? [];
  if (!Array.isArray(canonEntities) || !canonEntities.every(isJsonObject))
    throw new FsToolError('canon.json entities 必须是对象数组。');

  const cached = sourceRevision === null ? null : await readDerived(reader, root, 'presence.json');
  let presence = cached === null ? null : presenceFromCache(cached);
  if (presence === null) {
    presence = await rebuildPresence(reader, root, canonEntities, { platform });
    if (sourceRevision !== null)
      await writeDerived(reader, writer, root, 'presence.json', presence, {
        sourceRevision,
        platform,
      });
  }

  const {
    newEntities,
    known,
    conflicts: aliasConflicts,
  } = await classifyEntities(entities, canonEntities);
  const proposals = {
    new_entities: newEntities,
    known_entities: known,
    holder_claims: holders,
    exit_claims: exits,
    timeline_claims: timeline,
    promise_claims: promises,
  };
  const baseline = await checkCanon(canon, presence);
  const merged = cloneJson(canon);
  const previous = await readDraft(reader, root);
  if (previous !== null) carryOverPending(merged, canon, previous);
  const draftEntities = mergedEntities(merged);
  const carriedById = new Map(
    draftEntities.filter(isJsonObject).map((entity) => [entity.id ?? null, entity]),
  );
  for (const entity of newEntities) {
    const existing = carriedById.get(entity.id as string);
    if (existing === undefined) draftEntities.push(cloneJson(entity));
    else mergeEntityMetadata(existing, entity);
  }
  appendInvariantClaims(merged, {
    single_holder: holders,
    lifespan: exits,
    timeline_order: timeline,
    promises,
  });
  const after = await checkCanon(merged, presence);
  const newConflicts = newGateIssues(baseline.conflicts, after.conflicts);
  const newAdvisories = newGateIssues(baseline.advisories, after.advisories);

  if (
    sourceRevision !== null &&
    (await captureCanonSourceRevision(reader, root)) !== sourceRevision
  )
    throw new FsToolError('派生缓存来源已变化或无法确认，请确认写回结果后重新扫描。');
  await writeDerived(reader, writer, root, 'proposals.json', merged, {
    sourceRevision: null,
    platform,
  });
  const proposalCount = Object.values(proposals).reduce((sum, items) => sum + items.length, 0);
  let summary =
    proposalCount === 0 && !aliasConflicts.length
      ? '本章没有 canon 事实提议；canon.json 未改动。'
      : `canon_delta 生成 ${proposalCount} 条提议，发现 ${aliasConflicts.length} 个别名冲突、` +
        `${newConflicts.length} 个新增硬矛盾、${newAdvisories.length} 个新增 advisory；` +
        'canon.json 未改动，请审阅 proposals.json 草稿。';
  const result: { [key: string]: unknown } = {
    cache_status: sourceRevision === null ? 'uncached_unverified' : 'verified',
    proposals,
    alias_conflicts: aliasConflicts,
    new_conflicts: newConflicts,
    new_advisories: newAdvisories,
    summary,
  };
  if (sourceRevision === null) {
    result.note = UNCACHED_SCAN_NOTE;
    summary += UNCACHED_SCAN_NOTE;
    result.summary = summary;
  }
  return result;
}
