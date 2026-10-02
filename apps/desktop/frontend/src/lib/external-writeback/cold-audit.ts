import type { ExternalWriteback } from '../api/managed-agent-host';
import { createRemoteFileSuggestion } from '../assistant-suggestions';
import { recordRevisionLoop } from '../author-loop';
import { withNativeDelivery } from '../native-delivery';
import { resolveProjectRelativePath } from '../project-context';
import { TauriFileSystem } from '../tauri-fs';

/** Existing operation audit only: no editor, snapshot, branch, or body writer. */
export async function repairColdAudit(wait: ExternalWriteback, guard: () => void) {
  guard();
  const path = resolveProjectRelativePath(wait.project_path, wait.requested_path);
  if (!path || !wait.identity) throw new Error('原审计操作身份缺失');
  const request = {
    path,
    operationKey: wait.operation_key,
    source: wait.source,
    content: wait.proposal.after,
  };
  const identity = await TauriFileSystem.describeWritebackOperation(wait.project_path, request);
  const receipt = await TauriFileSystem.inspectWritebackReceipt(wait.project_path, request);
  guard();
  if (
    !receipt ||
    receipt.state !== 'applied' ||
    receipt.current !== 'after' ||
    !receipt.receiptPersisted ||
    receipt.operationId !== wait.identity.operationId ||
    identity.operationId !== wait.identity.operationId ||
    identity.fingerprint !== wait.identity.fingerprint ||
    identity.relativePath !== wait.identity.relativePath
  )
    throw new Error('已写入事实不能独立核验，已拒绝补记与重写');
  const suggestion = createRemoteFileSuggestion({
    id: String(wait.proposal.id),
    filePath: path,
    before: wait.proposal.before,
    after: wait.proposal.after,
    summary: '整章修订',
    model: '',
    userIntent: '按已确认的整版提案修订',
    assistantSessionId: wait.assistant_session_id,
    requiresConfirmation: true,
    runId: wait.run_id,
  });
  await withNativeDelivery(wait.project_path, async (ticket) => {
    guard();
    await recordRevisionLoop({
      projectPath: wait.project_path,
      filePath: path,
      before: suggestion.before,
      after: suggestion.after,
      summary: suggestion.summary,
      note: suggestion.note,
      userIntent: '按已确认的整版提案修订',
      assistantSessionId: wait.assistant_session_id,
      patchId: suggestion.id,
      operationId: wait.identity!.operationId,
      deliveryTicket: ticket,
    });
  });
}
