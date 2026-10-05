import type { AssistantFileSuggestion } from './assistant-suggestions';
import { createSuggestionChangeSet, type SuggestionChangeSet } from './suggestion-change-set';
import { relativeToProject } from './project-context';
import { TauriFileSystem } from './tauri-fs';
import { verifyReceiptAudit } from './writeback-audit';
import { readRevisionLoopPayload, type RevisionLoopRecord } from './author-loop';
import type { WritebackRequest } from './writeback-receipt-types';
import { relativePathInsideProject } from './project/path';
import { withNativeDelivery } from './native-delivery';

type RequestDescriptor = { request: WritebackRequest; semanticPayload: string };
export type PendingSuggestionDescriptor = {
  version: 1;
  /** Storage ownership only; never a Native operation identity or an approval. */
  owner: string;
  proposal: AssistantFileSuggestion;
  requests: RequestDescriptor[];
};

async function journalPath(project: string, file: string): Promise<string> {
  const relative = relativePathInsideProject(project, file);
  if (!relative) throw new Error('恢复提案的目标不在原项目内');
  const identity = /^[a-z]:[/\\]/i.test(project) ? relative.toLowerCase() : relative;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  const label = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const separator = project.includes('\\') ? '\\' : '/';
  return [
    project.replace(/[/\\]+$/, ''),
    '.storyforge',
    'pending-suggestions',
    `${label}.json`,
  ].join(separator);
}
async function readJournal(
  project: string,
  file: string,
): Promise<{ path: string; raw: string | null }> {
  const path = await journalPath(project, file);
  const raw = (await TauriFileSystem.pathExists(path))
    ? await TauriFileSystem.readProjectFile(project, path)
    : null;
  return { path, raw };
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}
function proposal(value: unknown): value is AssistantFileSuggestion {
  if (!object(value)) return false;
  if (
    !['id', 'filePath', 'title', 'summary', 'before', 'after', 'note'].every(
      (field) => typeof value[field] === 'string',
    ) ||
    !value.id ||
    !value.filePath ||
    !integer(value.createdAt)
  )
    return false;
  if (
    !['model', 'userIntent', 'scopeWarning', 'runId'].every(
      (field) => value[field] === undefined || typeof value[field] === 'string',
    )
  )
    return false;
  if (
    value.assistantSessionId !== undefined &&
    value.assistantSessionId !== null &&
    !integer(value.assistantSessionId)
  )
    return false;
  if (value.requiresConfirmation !== undefined && typeof value.requiresConfirmation !== 'boolean')
    return false;
  if (
    !['issueIds', 'contextFiles'].every(
      (field) => value[field] === undefined || strings(value[field]),
    )
  )
    return false;
  if (
    value.issueScopes !== undefined &&
    (!Array.isArray(value.issueScopes) ||
      !value.issueScopes.every(
        (scope: unknown) =>
          object(scope) &&
          typeof scope.id === 'string' &&
          integer(scope.lineStart) &&
          integer(scope.lineEnd) &&
          scope.lineStart >= 1 &&
          scope.lineEnd >= scope.lineStart,
      ))
  )
    return false;
  if (
    value.knowledgeEntries !== undefined &&
    (!Array.isArray(value.knowledgeEntries) ||
      !value.knowledgeEntries.every(
        (entry: unknown) =>
          object(entry) &&
          ['knowledgeId', 'relativePath', 'snapshotId'].every(
            (field) => typeof entry[field] === 'string',
          ) &&
          (entry.selectionSource === 'author_pinned' ||
            entry.selectionSource === 'auto_retrieved') &&
          (entry.evidenceState === 'current' || entry.evidenceState === 'stale') &&
          integer(entry.warningCount) &&
          entry.warningCount >= 0,
      ))
  )
    return false;
  // Residual previews / consumed IDs have no authority at this boundary.
  return value.operationView === undefined;
}

function decodeDescriptor(raw: string | null, file: string): PendingSuggestionDescriptor | null {
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (value === null) return null; // A durable dismissal, not an applied-op authority.
  if (
    !object(value) ||
    value.version !== 1 ||
    typeof value.owner !== 'string' ||
    !value.owner ||
    !proposal(value.proposal) ||
    value.proposal.filePath !== file ||
    !Array.isArray(value.requests)
  )
    throw new Error('待确认修订的恢复信息损坏，请核对版本或重新生成；未自动写入正文');
  const requests: RequestDescriptor[] = [];
  const keys = new Set<string>();
  for (const item of value.requests) {
    if (!object(item) || !object(item.request) || typeof item.semanticPayload !== 'string')
      throw new Error('待确认修订的请求描述无效；未自动写入正文');
    const fields = item.request;
    if (
      !['operationKey', 'source', 'path', 'content'].every(
        (field) => typeof fields[field] === 'string',
      ) ||
      fields.path !== file ||
      keys.has(String(fields.operationKey))
    )
      throw new Error('待确认修订的请求描述无效；未自动写入正文');
    const request = item.request as WritebackRequest;
    keys.add(request.operationKey);
    requests.push({ request, semanticPayload: item.semanticPayload });
  }
  return { version: 1, owner: value.owner, proposal: value.proposal, requests };
}

export async function loadPendingSuggestion(
  project: string,
  file: string,
): Promise<PendingSuggestionDescriptor | null> {
  return decodeDescriptor((await readJournal(project, file)).raw, file);
}

export function capturePendingSuggestion(
  project: string,
  suggestion: AssistantFileSuggestion,
): PendingSuggestionDescriptor {
  const { operationView: _view, ...original } = suggestion;
  const descriptor: PendingSuggestionDescriptor = {
    version: 1,
    owner: crypto.randomUUID(),
    proposal: original,
    requests: [],
  };
  if (!relativePathInsideProject(project, original.filePath))
    throw new Error('修订目标不在原项目内');
  return descriptor;
}

/** Initial proposal registration uses the original delivery queue and durable Native file primitive. */
export async function persistPendingSuggestion(
  project: string,
  descriptor: PendingSuggestionDescriptor,
  deliveryTicket?: string,
): Promise<void> {
  const { path, raw } = await readJournal(project, descriptor.proposal.filePath);
  const previous = decodeDescriptor(raw, descriptor.proposal.filePath);
  if (previous) await verifyJournalSettled(project, previous);
  await TauriFileSystem.writeFileIfUnchanged(
    project,
    path,
    JSON.stringify(descriptor),
    raw === null ? { kind: 'missing' } : { kind: 'content', content: raw },
    deliveryTicket,
  );
}

/** Register exact inputs before Native admission; never serialize derived acceptance state. */
export async function rememberSuggestionRequest(
  project: string,
  owner: PendingSuggestionDescriptor,
  request: WritebackRequest,
  semanticPayload: string,
  deliveryTicket?: string,
): Promise<void> {
  const { path, raw } = await readJournal(project, owner.proposal.filePath);
  const stored = decodeDescriptor(raw, owner.proposal.filePath);
  // A replacement or explicit dismissal owns the slot; late writes cannot resurrect it.
  if (!stored || stored.owner !== owner.owner || raw === null) return;
  const existing = stored.requests.find(
    (item) => item.request.operationKey === request.operationKey,
  );
  const next = { request, semanticPayload };
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(next))
      throw new Error('同一修订决定的请求内容改变，已拒绝写入');
    return;
  }
  await verifyJournalSettled(project, stored);
  stored.requests.push(next);
  await TauriFileSystem.writeFileIfUnchanged(
    project,
    path,
    JSON.stringify(stored),
    { kind: 'content', content: raw },
    deliveryTicket,
  );
}

export class MissingSuggestionAudit extends Error {
  constructor() {
    super('正文已有持久写回回执，但闭环记录缺失；可以明确补记，不会重写正文');
  }
}

function receiptAuditPath(project: string, operationId: string): string {
  const separator = project.includes('\\') ? '\\' : '/';
  return [project.replace(/[/\\]+$/, ''), '.storyforge', 'author-loop', `${operationId}.md`].join(
    separator,
  );
}

/** A new proposal/dismissal must not erase the only repair descriptor for an admitted write. */
async function verifyJournalSettled(
  project: string,
  descriptor: PendingSuggestionDescriptor,
): Promise<void> {
  for (const { request, semanticPayload } of descriptor.requests) {
    const receipt = await TauriFileSystem.inspectWritebackReceipt(project, request);
    if (!receipt || receipt.state === 'not_written') continue;
    if (receipt.state !== 'applied' || !receipt.receiptPersisted)
      throw new Error('原写回结果尚未确定，已保留恢复记录；请先核对正文与版本');
    const path = receiptAuditPath(project, receipt.operationId);
    if (!(await TauriFileSystem.pathExists(path))) throw new MissingSuggestionAudit();
    await verifyReceiptAudit(project, path, receipt.operationId, semanticPayload);
  }
}

export async function forgetPendingSuggestion(
  project: string,
  owner: PendingSuggestionDescriptor,
): Promise<void> {
  await withNativeDelivery(project, async (ticket) => {
    const { path, raw } = await readJournal(project, owner.proposal.filePath);
    const stored = decodeDescriptor(raw, owner.proposal.filePath);
    if (stored?.owner !== owner.owner || raw === null) return;
    await verifyJournalSettled(project, stored);
    // CAS a tombstone instead of read-then-delete, so a late completion cannot erase a replacement.
    await TauriFileSystem.writeFileIfUnchanged(
      project,
      path,
      'null',
      { kind: 'content', content: raw },
      ticket,
    );
  });
}

/** Outcomes + complete audits derive history. Current bytes are not acceptance evidence. */
export async function recoverSuggestionOperations(
  project: string,
  descriptor: PendingSuggestionDescriptor,
  repairMissingAudit?: (record: RevisionLoopRecord) => Promise<void>,
): Promise<{
  changeSet: SuggestionChangeSet;
  appliedOpIds: Set<string>;
  lastUndoOperationId: string | null;
}> {
  const original = descriptor.proposal;
  const changeSet = createSuggestionChangeSet(original.before, original.after);
  const appliedOpIds = new Set<string>();
  let lastUndoOperationId: string | null = null;
  const history = new Map<string, { consumedBefore: Set<string>; request: WritebackRequest }>();
  const source = JSON.stringify([
    original.id,
    original.before,
    original.after,
    original.runId ?? null,
  ]);
  for (const { request, semanticPayload } of descriptor.requests) {
    const suffix = lastUndoOperationId ? `:after-undo:${lastUndoOperationId}` : '';
    const whole = request.operationKey === `${original.id}:whole${suffix}`;
    const op = changeSet.operations.find(
      (candidate) => request.operationKey === `${original.id}:hunk:${candidate.id}${suffix}`,
    );
    const undoPrefix = `${original.id}-undo:undo:`;
    const forward = request.operationKey.startsWith(undoPrefix)
      ? history.get(request.operationKey.slice(undoPrefix.length))
      : undefined;
    if (
      forward
        ? request.source !==
          JSON.stringify([
            `${original.id}-undo`,
            forward.request.content,
            request.content,
            original.runId ?? null,
          ])
        : !(whole || op) || request.source !== source
    )
      throw new Error('恢复请求与原始修订操作不匹配；未自动写入正文');
    const payload: unknown = JSON.parse(semanticPayload);
    if (
      !object(payload) ||
      payload.file !== relativeToProject(project, original.filePath) ||
      payload.after !== request.content ||
      payload.patchId !== (forward ? `${original.id}-undo` : original.id)
    )
      throw new Error('恢复请求的审计语义不匹配；未自动写入正文');
    const receipt = await TauriFileSystem.inspectWritebackReceipt(project, request);
    if (receipt?.state !== 'applied' || !receipt.receiptPersisted)
      throw new Error('修订写回结果尚未确定，请核对正文与版本；不会自动重放旧决定');
    const auditPath = receiptAuditPath(project, receipt.operationId);
    if (!(await TauriFileSystem.pathExists(auditPath))) {
      if (!repairMissingAudit) throw new MissingSuggestionAudit();
      const record = readRevisionLoopPayload(project, original.filePath, semanticPayload);
      await repairMissingAudit({ ...record, operationId: receipt.operationId });
    }
    await verifyReceiptAudit(project, auditPath, receipt.operationId, semanticPayload);
    if (forward) {
      appliedOpIds.clear();
      for (const id of forward.consumedBefore) appliedOpIds.add(id);
      lastUndoOperationId = receipt.operationId;
    } else {
      history.set(receipt.operationId, { consumedBefore: new Set(appliedOpIds), request });
      if (whole) for (const candidate of changeSet.operations) appliedOpIds.add(candidate.id);
      else if (op) appliedOpIds.add(op.id);
    }
  }
  return { changeSet, appliedOpIds, lastUndoOperationId };
}
