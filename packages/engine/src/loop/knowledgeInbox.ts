import type { JsonObject, JsonValue } from '../kernel/json';
import { KnowledgeEntryError, type KnowledgeEntry } from '../kernel/knowledgeEntries';
import { compileKnowledgeOperation, materializedSource } from '../kernel/knowledgeMaterialization';
import {
  buildKnowledgeProposalGroup,
  KNOWLEDGE_PROPOSAL_ARTIFACT_KIND,
  projectFingerprint,
  type ProposalEnvironment,
} from '../kernel/knowledgeProposals';
import { knowledgeEntryEvidenceState } from '../kernel/knowledgeRetrieval';
import { resolveNewProjectFile } from '../kernel/fsProjectTools';
import { nativeProjectPath, resolveProjectRoot } from '../kernel/fsTools';
import {
  loadProjectKnowledgeDocument,
  projectKnowledgeEntryIndex,
  validateProjectKnowledgeMarkdownTarget,
} from '../kernel/projectKnowledgeFiles';
import type { SecretContext } from '../kernel/redaction';
import { sha256Hex } from '../kernel/sha256';
import type { ProjectReader } from '../readPort';
import type { ArtifactRecord, RunRecord, RunStore } from '../store/runs';
import { recordAgentArtifact, recordAgentEvent, type RunServices } from './runEvents';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const KNOWLEDGE_PROPOSAL_REVISED = 'knowledge_proposal_revised';
export const KNOWLEDGE_PROPOSAL_MATERIALIZED = 'knowledge_proposal_materialized';
export const KNOWLEDGE_PROPOSAL_INVALIDATED = 'knowledge_proposal_invalidated';
export const KNOWLEDGE_PROPOSAL_ACCEPTED = 'knowledge_proposal_accepted';
export const KNOWLEDGE_PROPOSAL_REJECTED = 'knowledge_proposal_rejected';
export const KNOWLEDGE_EVIDENCE_STALE = 'knowledge_evidence_stale';

const EVENT_STATE: Record<string, string> = {
  [KNOWLEDGE_PROPOSAL_ACCEPTED]: 'accepted',
  [KNOWLEDGE_PROPOSAL_REJECTED]: 'rejected',
  [KNOWLEDGE_EVIDENCE_STALE]: 'stale',
  [KNOWLEDGE_PROPOSAL_INVALIDATED]: 'invalidated',
};
const PENDING_STATES = new Set(['pending', 'conflict', 'stale']);

/** Python 路由把服务里的 ValueError 回成 409，detail 就是这句话。 */
export class KnowledgeInboxConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeInboxConflictError';
  }
}

/** 请求体不合格（Python 路由在服务之前就回 422 的那些）。 */
export class KnowledgeInboxRequestError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeInboxRequestError';
  }
}

export type KnowledgeInboxDeps = {
  store: RunStore;
  secrets: SecretContext;
  reader: ProjectReader;
  platform: 'windows' | 'posix';
  proposals: ProposalEnvironment;
};

const conflict = (message: string): never => {
  throw new KnowledgeInboxConflictError(message);
};
const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);
/** Python 的 str()：只会遇到字符串、None 与少量原始值。 */
const pyStr = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : value === null || value === undefined
      ? 'None'
      : value === true
        ? 'True'
        : value === false
          ? 'False'
          : String(value);
const stateKey = (artifactId: number, proposalId: string) => `${artifactId}\u0000${proposalId}`;

async function fingerprintOf(deps: KnowledgeInboxDeps, root: string): Promise<string> {
  await resolveProjectRoot(deps.reader, root);
  return projectFingerprint(root, deps.platform);
}

/** 逐条提议的状态：取自接受 / 拒绝 / 证据漂移 / 失效事件，后来的覆盖先前的。 */
export async function knowledgeProposalStates(store: RunStore): Promise<Map<string, string>> {
  const states = new Map<string, string>();
  for (const event of await store.eventsOfTypes(Object.keys(EVENT_STATE))) {
    const payload = isObj(event.payload) ? event.payload : {};
    const artifactId = payload.artifact_id;
    const proposalId = payload.proposal_id;
    if (isInt(artifactId) && typeof proposalId === 'string')
      states.set(stateKey(artifactId, proposalId), EVENT_STATE[event.event_type]);
    const proposalIds = payload.proposal_ids;
    if (event.event_type === KNOWLEDGE_PROPOSAL_INVALIDATED && Array.isArray(proposalIds))
      for (const item of proposalIds)
        if (isInt(artifactId) && typeof item === 'string')
          states.set(stateKey(artifactId, item), 'invalidated');
  }
  return states;
}

/** 整组失效（失效事件不带逐条 id 时）。 */
async function knowledgeArtifactStates(store: RunStore): Promise<Map<number, string>> {
  const states = new Map<number, string>();
  for (const event of await store.eventsOfTypes([KNOWLEDGE_PROPOSAL_INVALIDATED])) {
    const payload = isObj(event.payload) ? event.payload : {};
    if (isInt(payload.artifact_id) && !Array.isArray(payload.proposal_ids))
      states.set(payload.artifact_id, 'invalidated');
  }
  return states;
}

async function proposalArtifacts(store: RunStore) {
  const rows: { artifact: ArtifactRecord; run: RunRecord }[] = [];
  for (const artifact of await store.artifactsOfKind(KNOWLEDGE_PROPOSAL_ARTIFACT_KIND))
    rows.push({ artifact, run: await store.getRun(artifact.run_id) });
  return rows;
}

// ---- HTTP 响应模型的投影（只留声明过的字段、去掉 None：response_model_exclude_none） ----

const SOURCE_FIELDS = [
  'type',
  'path',
  'content_sha256',
  'agent_event_id',
  'locator',
  'title',
  'accessed_at',
  'summary_sha256',
];
const ITEM_FIELDS = [
  'proposal_id',
  'knowledge_id',
  'target_path',
  'operation',
  'title',
  'claim',
  'kind',
  'confidence',
  'sources',
  'related_knowledge_ids',
  'reason',
  'claim_fingerprint',
  'state',
  'conflicts',
];
const CONFLICT_FIELDS = [
  'knowledge_id',
  'relative_path',
  'title',
  'claim',
  'status',
  'evidence_state',
  'sources',
];

function pick(value: unknown, fields: readonly string[]): Obj {
  const source = isObj(value) ? value : {};
  const output: Obj = {};
  for (const field of fields)
    if (source[field] !== undefined && source[field] !== null) output[field] = source[field];
  return output;
}
const sourcesRead = (value: unknown) =>
  Array.isArray(value) ? value.map((source) => pick(source, SOURCE_FIELDS)) : value;

function inboxRead(inbox: { items: Obj[]; pending_count: number }): JsonObject {
  return {
    items: inbox.items.map((group) => ({
      ...pick(group, [
        'proposal_group_id',
        'artifact_id',
        'run_id',
        'revision',
        'state',
        'created_at',
      ]),
      proposals: (group.proposals as Obj[]).map((item) => {
        const read = pick(item, ITEM_FIELDS);
        if ('sources' in read) read.sources = sourcesRead(read.sources);
        read.conflicts = (Array.isArray(item.conflicts) ? item.conflicts : []).map((entry) => {
          const conflictRead = pick(entry, CONFLICT_FIELDS);
          conflictRead.sources = sourcesRead(conflictRead.sources);
          return conflictRead;
        });
        return read;
      }),
    })),
    pending_count: inbox.pending_count,
  } as JsonObject;
}

function conflictEntry(relativePath: string, entry: KnowledgeEntry): Obj {
  return {
    knowledge_id: entry.id,
    relative_path: relativePath,
    title: entry.title,
    claim: entry.claim,
    status: entry.status,
    evidence_state: entry.evidence_state,
    sources: entry.sources.map((source) => pick(source, SOURCE_FIELDS)),
  };
}

async function queryInbox(deps: KnowledgeInboxDeps, root: string) {
  const fingerprint = await fingerprintOf(deps, root);
  const index = await projectKnowledgeEntryIndex(deps.reader, root);
  const entriesById = new Map<string, [string, KnowledgeEntry]>();
  for (const indexed of index.entries)
    entriesById.set(indexed.entry.id, [indexed.relativePath, indexed.entry]);
  const artifactStates = await knowledgeArtifactStates(deps.store);
  const proposalStates = await knowledgeProposalStates(deps.store);
  const items: Obj[] = [];
  for (const { artifact, run } of await proposalArtifacts(deps.store)) {
    const payload = isObj(artifact.payload) ? artifact.payload : {};
    if (payload.project_fingerprint !== fingerprint) continue;
    if (!Array.isArray(payload.proposals)) continue;
    const projected: Obj[] = [];
    for (const item of payload.proposals) {
      if (!isObj(item)) continue;
      const related = item.related_knowledge_ids;
      const conflicts = Array.isArray(related)
        ? related
            .filter((id): id is string => typeof id === 'string' && entriesById.has(id))
            .map((id) => conflictEntry(...entriesById.get(id)!))
        : [];
      projected.push({
        ...item,
        state:
          artifactStates.get(artifact.id) ||
          proposalStates.get(stateKey(artifact.id, pyStr(item.proposal_id))) ||
          (item.operation === 'conflict' ? 'conflict' : 'pending'),
        conflicts: item.operation === 'conflict' ? conflicts : [],
      });
    }
    const states = new Set(projected.map((item) => item.state as string));
    const state = states.has('conflict')
      ? 'conflict'
      : states.has('stale')
        ? 'stale'
        : states.has('pending')
          ? 'pending'
          : states.size === 1
            ? [...states][0]
            : 'history';
    items.push({
      proposal_group_id: payload.proposal_group_id,
      artifact_id: artifact.id,
      run_id: run.public_id,
      revision: payload.revision === undefined ? 1 : payload.revision,
      state,
      created_at: payload.created_at,
      proposals: projected,
    });
  }
  return {
    items,
    pending_count: items.reduce(
      (count, item) =>
        count +
        (item.proposals as Obj[]).filter((proposal) => PENDING_STATES.has(proposal.state as string))
          .length,
      0,
    ),
  };
}

/** 按项目读收件箱（`/api/agent-runs/knowledge-proposals/query`）。 */
export async function queryKnowledgeInbox(
  deps: KnowledgeInboxDeps,
  projectRoot: string,
): Promise<JsonObject> {
  return inboxRead(await queryInbox(deps, projectRoot));
}

/** 已接受提议的来源证据漂移了：记一条 stale 事件，等作者复核。 */
export async function refreshKnowledgeEvidence(
  deps: KnowledgeInboxDeps,
  projectRoot: string,
): Promise<JsonObject> {
  const fingerprint = await fingerprintOf(deps, projectRoot);
  const index = await projectKnowledgeEntryIndex(deps.reader, projectRoot);
  const entriesById = new Map(index.entries.map((item) => [item.entry.id, item.entry]));
  const states = await knowledgeProposalStates(deps.store);
  const services: RunServices = { store: deps.store, secrets: deps.secrets };
  for (const { artifact, run } of await proposalArtifacts(deps.store)) {
    const payload = isObj(artifact.payload) ? artifact.payload : {};
    if (payload.project_fingerprint !== fingerprint) continue;
    if (!Array.isArray(payload.proposals)) continue;
    for (const proposal of payload.proposals) {
      if (!isObj(proposal)) continue;
      const proposalId = proposal.proposal_id;
      const knowledgeId = proposal.knowledge_id;
      if (typeof proposalId !== 'string' || typeof knowledgeId !== 'string') continue;
      if (states.get(stateKey(artifact.id, proposalId)) !== 'accepted') continue;
      const entry = entriesById.get(knowledgeId);
      if (
        entry === undefined ||
        (await knowledgeEntryEvidenceState(deps.reader, projectRoot, entry)) !== 'stale'
      )
        continue;
      await recordAgentEvent(services, run, {
        eventType: KNOWLEDGE_EVIDENCE_STALE,
        actor: 'knowledge-evidence',
        message: 'Project Knowledge 来源证据已漂移，等待作者复核。',
        payload: {
          artifact_id: artifact.id,
          revision: payload.revision === undefined ? null : payload.revision,
          proposal_id: proposalId,
          knowledge_id: knowledgeId,
          target_path: proposal.target_path === undefined ? null : proposal.target_path,
        },
      });
      states.set(stateKey(artifact.id, proposalId), 'stale');
    }
  }
  return queryKnowledgeInbox(deps, projectRoot);
}

async function validatedPendingArtifact(
  deps: KnowledgeInboxDeps,
  projectRoot: string,
  artifactId: number,
  revision: number,
) {
  const artifact = await deps.store.artifact(artifactId);
  if (artifact === null || artifact.kind !== KNOWLEDGE_PROPOSAL_ARTIFACT_KIND)
    conflict('Knowledge proposal 不存在。');
  const run = await deps.store.getRun(artifact!.run_id);
  const payload = isObj(artifact!.payload) ? artifact!.payload : {};
  if (payload.project_fingerprint !== (await fingerprintOf(deps, projectRoot)))
    conflict('Knowledge proposal 不属于当前作品。');
  if (payload.revision !== revision) conflict('Knowledge proposal revision 已失效，请刷新 Inbox。');
  const state = (await knowledgeArtifactStates(deps.store)).get(artifact!.id);
  if (state !== undefined) conflict(`Knowledge proposal 已处于 ${state} 状态。`);
  return { artifact: artifact!, run, payload };
}

// ---- 请求体（照 pydantic：声明的字段、None 去掉；必填缺失或类型不对回 422） ----

const SOURCE_EDIT_FIELDS = ['type', 'path', 'locator', 'title', 'summary', 'summary_sha256'];
const ITEM_EDIT_REQUIRED = [
  'target_path',
  'operation',
  'title',
  'claim',
  'kind',
  'confidence',
  'reason',
];

function invalid(field: string): never {
  throw new KnowledgeInboxRequestError(`请求字段不合法：${field}`);
}
const requiredText = (value: unknown, field: string): string =>
  typeof value === 'string' ? value : invalid(field);
const requiredInt = (value: unknown, field: string): number =>
  isInt(value) ? value : invalid(field);

function editedProposal(value: unknown, index: number): JsonObject {
  if (!isObj(value)) invalid(`proposals.${index}`);
  const item = value as Obj;
  const output: JsonObject = {};
  for (const field of ITEM_EDIT_REQUIRED.slice(0, 6))
    output[field] = requiredText(item[field], `proposals.${index}.${field}`);
  if (!Array.isArray(item.sources)) invalid(`proposals.${index}.sources`);
  output.sources = (item.sources as unknown[]).map((source, at) => {
    if (!isObj(source)) invalid(`proposals.${index}.sources.${at}`);
    const read: JsonObject = {
      type: requiredText((source as Obj).type, `proposals.${index}.sources.${at}.type`),
    };
    for (const field of SOURCE_EDIT_FIELDS.slice(1)) {
      const raw = (source as Obj)[field];
      if (raw === undefined || raw === null) continue;
      read[field] = requiredText(raw, `proposals.${index}.sources.${at}.${field}`);
    }
    return read;
  });
  const related = item.related_knowledge_ids ?? [];
  if (!Array.isArray(related) || related.some((id) => typeof id !== 'string'))
    invalid(`proposals.${index}.related_knowledge_ids`);
  output.related_knowledge_ids = related as string[];
  output.reason = requiredText(item.reason, `proposals.${index}.reason`);
  return output;
}

/** 作者编辑提议：未决条目重建成新 revision，旧的逐条失效。 */
export async function reviseKnowledgeProposalGroup(
  deps: KnowledgeInboxDeps,
  input: { projectRoot: string; artifactId: number; revision: number; proposals: unknown },
): Promise<JsonObject> {
  const projectRoot = requiredText(input.projectRoot, 'project_root');
  const artifactId = requiredInt(input.artifactId, 'artifact_id');
  const revision = requiredInt(input.revision, 'revision');
  if (!Array.isArray(input.proposals)) invalid('proposals');
  const proposals = (input.proposals as unknown[]).map(editedProposal);
  const { artifact, run, payload } = await validatedPendingArtifact(
    deps,
    projectRoot,
    artifactId,
    revision,
  );
  const original = payload.proposals;
  if (!Array.isArray(original) || original.length !== proposals.length)
    conflict('Knowledge proposal 编辑项与当前 revision 不匹配。');
  const states = await knowledgeProposalStates(deps.store);
  const unresolved = (original as unknown[])
    .map((item, index) => [item, proposals[index]] as const)
    .filter(([item]) => {
      if (!isObj(item)) return false;
      const state = states.get(stateKey(artifact.id, pyStr(item.proposal_id)));
      return state === undefined || state === 'conflict' || state === 'stale';
    }) as [Obj, JsonObject][];
  if (!unresolved.length) conflict('Knowledge proposal 没有可编辑的未决条目。');
  const built = await buildKnowledgeProposalGroup(
    deps.reader,
    projectRoot,
    { proposals: unresolved.map(([, edited]) => edited) },
    { ...deps.proposals, platform: deps.platform },
  );
  const revisedPayload = {
    ...built,
    proposal_group_id: payload.proposal_group_id as JsonValue,
    revision: revision + 1,
    supersedes_artifact_id: artifact.id,
  };
  const services: RunServices = { store: deps.store, secrets: deps.secrets };
  const { artifact: revised } = await recordAgentArtifact(services, run, {
    kind: KNOWLEDGE_PROPOSAL_ARTIFACT_KIND,
    payload: revisedPayload,
    requiresConfirmation: false,
  });
  await recordAgentEvent(services, run, {
    eventType: KNOWLEDGE_PROPOSAL_INVALIDATED,
    actor: 'author',
    message: '作者编辑了 Project Knowledge 提议，旧 revision 已失效。',
    payload: {
      artifact_id: artifact.id,
      revision,
      superseded_by_artifact_id: revised.id,
      proposal_ids: unresolved
        .filter(([item]) => typeof item.proposal_id === 'string')
        .map(([item]) => item.proposal_id as string),
    },
  });
  await recordAgentEvent(services, run, {
    eventType: KNOWLEDGE_PROPOSAL_REVISED,
    actor: 'author',
    message: '作者更新了 Project Knowledge 提议。',
    payload: {
      artifact_id: revised.id,
      revision: revision + 1,
      supersedes_artifact_id: artifact.id,
    },
  });
  return queryKnowledgeInbox(deps, projectRoot);
}

function proposalItem(payload: Obj, proposalId: string): Obj {
  const proposals = payload.proposals;
  const proposal = Array.isArray(proposals)
    ? proposals.find((item) => isObj(item) && item.proposal_id === proposalId)
    : undefined;
  if (proposal === undefined) conflict('Knowledge proposal item 不存在。');
  return proposal as Obj;
}

async function latestMaterialized(store: RunStore, runId: number) {
  return (
    [...(await store.events(runId))]
      .filter((event) => event.event_type === KNOWLEDGE_PROPOSAL_MATERIALIZED)
      .sort((a, b) => b.id - a.id)[0] ?? null
  );
}

async function validateAcceptedWriteback(
  deps: KnowledgeInboxDeps,
  projectRoot: string,
  artifact: ArtifactRecord,
  proposal: Obj,
  patchIdentity: string | null,
  confirmationEventId: string | null,
) {
  if (!patchIdentity || !confirmationEventId)
    conflict('accepted resolution 缺少 patch identity 或作者确认 event id。');
  const materialized = await latestMaterialized(deps.store, artifact.run_id);
  const payload = materialized !== null && isObj(materialized.payload) ? materialized.payload : {};
  const expected: Obj = {
    artifact_id: artifact.id,
    proposal_id: proposal.proposal_id,
    patch_identity: patchIdentity,
    author_confirmation_event_id: confirmationEventId,
  };
  if (Object.entries(expected).some(([key, value]) => payload[key] !== value))
    conflict('accepted resolution 与最新 materialized patch 不匹配。');
  const index = await projectKnowledgeEntryIndex(deps.reader, projectRoot);
  const matching = index.entries.filter(
    (item) =>
      item.relativePath === proposal.target_path &&
      item.entry.id === proposal.knowledge_id &&
      item.entry.claim_fingerprint === proposal.claim_fingerprint,
  );
  if (!matching.length) conflict('磁盘上未找到与确认 patch 对应的 Project Knowledge entry。');
}

/** 作者接受（写回之后）或拒绝一条提议。 */
export async function resolveKnowledgeProposal(
  deps: KnowledgeInboxDeps,
  input: {
    projectRoot: string;
    artifactId: number;
    revision: number;
    proposalId: string;
    resolution: string;
    patchIdentity?: string | null;
    authorConfirmationEventId?: string | null;
  },
): Promise<JsonObject> {
  const projectRoot = requiredText(input.projectRoot, 'project_root');
  const artifactId = requiredInt(input.artifactId, 'artifact_id');
  const revision = requiredInt(input.revision, 'revision');
  const proposalId = requiredText(input.proposalId, 'proposal_id');
  if (input.resolution !== 'accepted' && input.resolution !== 'rejected') invalid('resolution');
  const patchIdentity = input.patchIdentity ?? null;
  const confirmationEventId = input.authorConfirmationEventId ?? null;
  if (patchIdentity !== null) requiredText(patchIdentity, 'patch_identity');
  if (confirmationEventId !== null)
    requiredText(confirmationEventId, 'author_confirmation_event_id');
  const { artifact, run, payload } = await validatedPendingArtifact(
    deps,
    projectRoot,
    artifactId,
    revision,
  );
  const proposal = proposalItem(payload, proposalId);
  const existing = (await knowledgeProposalStates(deps.store)).get(
    stateKey(artifact.id, proposalId),
  );
  if (existing === input.resolution) return queryKnowledgeInbox(deps, projectRoot);
  if (existing !== undefined) conflict(`Knowledge proposal item 已处于 ${existing} 状态。`);
  let eventType: string;
  let message: string;
  if (input.resolution === 'accepted') {
    await validateAcceptedWriteback(
      deps,
      projectRoot,
      artifact,
      proposal,
      patchIdentity,
      confirmationEventId,
    );
    eventType = KNOWLEDGE_PROPOSAL_ACCEPTED;
    message = '作者确认并把 Project Knowledge 提议写进了文件。';
  } else {
    eventType = KNOWLEDGE_PROPOSAL_REJECTED;
    message = '作者拒绝了 Project Knowledge 提议。';
  }
  await recordAgentEvent({ store: deps.store, secrets: deps.secrets }, run, {
    eventType,
    actor: 'author',
    message,
    payload: {
      artifact_id: artifact.id,
      revision,
      proposal_id: proposalId,
      ...(patchIdentity ? { patch_identity: patchIdentity } : {}),
      ...(confirmationEventId ? { author_confirmation_event_id: confirmationEventId } : {}),
    },
  });
  return queryKnowledgeInbox(deps, projectRoot);
}

const sha256 = (text: string) => sha256Hex(text);

/** 把一条提议编译成强制确认的知识文件补丁（引擎不写盘，作者确认后由写回链路落盘）。 */
export async function materializeKnowledgeProposal(
  deps: KnowledgeInboxDeps,
  input: { projectRoot: string; artifactId: number; revision: number; proposalId: string },
): Promise<JsonObject> {
  const projectRoot = requiredText(input.projectRoot, 'project_root');
  const artifactId = requiredInt(input.artifactId, 'artifact_id');
  const revision = requiredInt(input.revision, 'revision');
  const proposalId = requiredText(input.proposalId, 'proposal_id');
  const { artifact, run, payload } = await validatedPendingArtifact(
    deps,
    projectRoot,
    artifactId,
    revision,
  );
  const proposal = proposalItem(payload, proposalId);
  const state = (await knowledgeProposalStates(deps.store)).get(stateKey(artifact.id, proposalId));
  if (state !== undefined) conflict(`Knowledge proposal item 已处于 ${state} 状态。`);
  const [relativePath] = validateProjectKnowledgeMarkdownTarget(pyStr(proposal.target_path));
  const operation = pyStr(proposal.operation);
  let filePath: string;
  let before: string;
  if (operation === 'create') {
    filePath = nativeProjectPath(
      projectRoot,
      await resolveNewProjectFile(deps.reader, projectRoot, relativePath),
      deps.platform,
    );
    before = '';
  } else {
    const document = await loadProjectKnowledgeDocument(
      deps.reader,
      projectRoot,
      relativePath,
      deps.platform,
    );
    filePath = document.absolutePath;
    before = document.content;
  }
  if (operation === 'conflict') conflict('冲突提议必须先由作者裁决为 extend 或 supersede。');
  const confirmationEventId = pyStr(proposal.author_confirmation_event_id);
  const createdAt = pyStr(payload.created_at);
  let after: string;
  let entry: KnowledgeEntry;
  try {
    const proposed: KnowledgeEntry = {
      id: pyStr(proposal.knowledge_id),
      status: 'active',
      kind: pyStr(proposal.kind),
      evidence_state: 'current',
      title: pyStr(proposal.title),
      claim: pyStr(proposal.claim),
      sources: (Array.isArray(proposal.sources) ? proposal.sources : [])
        .filter(isObj)
        .map((source) => materializedSource(source as JsonValue, confirmationEventId)),
      claim_fingerprint: pyStr(proposal.claim_fingerprint),
      created_at: createdAt,
      updated_at: createdAt,
      superseded_by: null,
    };
    [after, entry] = compileKnowledgeOperation(before, proposed, {
      operation,
      relatedKnowledgeIds: (Array.isArray(proposal.related_knowledge_ids)
        ? proposal.related_knowledge_ids
        : []
      ).map(pyStr),
      updatedAt: createdAt,
    });
  } catch (error) {
    // 编译与知识块校验在 Python 里抛 ValueError（含 KnowledgeEntryError），路由回 409。
    if (error instanceof RangeError || error instanceof KnowledgeEntryError)
      conflict(error.message);
    throw error;
  }
  const baselineHash = `sha256:${sha256(before)}`;
  const seed = `${artifact.id}:${revision}:${proposalId}:${baselineHash}:${sha256(after)}`;
  const patch = {
    id: `knowledge-patch-${sha256(seed)}`,
    artifact_id: artifact.id,
    kind: 'project_knowledge',
    patch_class: 'project_knowledge',
    proposal_id: proposalId,
    proposal_revision: revision,
    knowledge_id: entry.id,
    author_confirmation_event_id: confirmationEventId,
    file_path: filePath,
    relative_path: relativePath,
    before,
    after,
    baseline_hash: baselineHash,
    requires_confirmation: true,
    created_by_tool: 'knowledge.propose',
  };
  const latest = await latestMaterialized(deps.store, run.id);
  const latestPayload = latest !== null && isObj(latest.payload) ? latest.payload : {};
  if (latestPayload.patch_identity !== patch.id)
    await recordAgentEvent({ store: deps.store, secrets: deps.secrets }, run, {
      eventType: KNOWLEDGE_PROPOSAL_MATERIALIZED,
      actor: 'knowledge-materializer',
      message: 'Project Knowledge 提议已生成强制确认 patch。',
      payload: {
        artifact_id: artifact.id,
        revision: payload.revision === undefined ? null : payload.revision,
        proposal_id: proposal.proposal_id,
        knowledge_id: proposal.knowledge_id,
        patch_identity: patch.id,
        baseline_hash: patch.baseline_hash,
        after_hash: `sha256:${sha256(after)}`,
        target_path: patch.relative_path,
        author_confirmation_event_id: patch.author_confirmation_event_id,
      },
    });
  return patch as JsonObject;
}
