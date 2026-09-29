import type { ApiKnowledgeProposalPatch } from '../api/contracts';
import { resolveKnowledgeProposal } from '../api/knowledge-proposals';
import { recordRevisionLoop } from '../author-loop';
import {
  getActiveBranch,
  loadBranchManifest,
  saveBranchManifest,
  setBranchHead,
  type BranchInfo,
} from '../branches';
import { TauriFileSystem, type DiskBaseline } from '../tauri-fs';
import { snapshotBeforeWrite } from '../versions';
import { performReceiptedWriteback } from '../writeback-receipts';
import type { WritebackReceipt } from '../writeback-receipt-types';

export type KnowledgeWritebackEffects = {
  readCurrent: () => Promise<string | null>;
  snapshot: () => ReturnType<typeof snapshotBeforeWrite>;
  advanceBranchHead: (timestamp: number) => Promise<void>;
  inspect: () => Promise<WritebackReceipt | null>;
  write: (checkpointTimestamp: number | null) => Promise<WritebackReceipt>;
  record: (receipt: WritebackReceipt) => Promise<unknown>;
  resolveAccepted: () => Promise<unknown>;
};

export type KnowledgeWritebackResult = 'written' | 'reconciled';

const normalizeEol = (value: string) => value.replace(/\r\n?/g, '\n');

export async function performKnowledgeWriteback(
  patch: ApiKnowledgeProposalPatch,
  effects: KnowledgeWritebackEffects,
): Promise<KnowledgeWritebackResult> {
  if (patch.patch_class !== 'project_knowledge' || patch.requires_confirmation !== true) {
    throw new Error('Project Knowledge patch 缺少强制确认标记');
  }
  const existingReceipt = await effects.inspect();
  // A durable outcome must remain recoverable even when the target cannot be read.
  const current = existingReceipt === null ? await effects.readCurrent() : null;
  const normalizedCurrent = current === null ? null : normalizeEol(current);
  const normalizedBefore = normalizeEol(patch.before);
  const result = await performReceiptedWriteback(current === null || current !== patch.after, {
    // With no prior outcome, recheck after the read and on a lost write reply.
    inspect: existingReceipt === null ? effects.inspect : async () => existingReceipt,
    validate: () => {
      if (
        !(normalizedCurrent === null && patch.before === '') &&
        normalizedCurrent !== normalizedBefore
      ) {
        throw new Error('知识文件已变化，且没有可核对的写回回执，请重新生成 diff 后再确认');
      }
    },
    snapshot: effects.snapshot,
    advanceBranchHead: effects.advanceBranchHead,
    write: effects.write,
    settle: () => {},
    record: effects.record,
  });
  if (result.auditError)
    throw new Error(
      `知识文件已写入，但闭环记录未完成：${result.auditError}。再次确认只补记，不重写正文。`,
    );
  if (!result.receipt.receiptPersisted)
    throw new Error('知识文件已写入，但结果回执未持久化；请核对文件与版本，不要重新应用。');
  if (result.receipt.current === 'unreadable')
    throw new Error('知识提议已写入，但当前文件无法读取核对；请核对文件与版本，不要重新应用。');
  if (result.receipt.current !== 'after')
    throw new Error('知识提议此前已写入，但文件随后已改变；未重写文件，请刷新提议后处理。');
  try {
    await effects.resolveAccepted();
  } catch (error) {
    throw Object.assign(
      new Error(
        `知识文件已写入并留有本地记录，但提议确认回执未收到：${error instanceof Error ? error.message : String(error)}。再次确认只恢复状态，不重写正文。`,
      ),
      { cause: error },
    );
  }
  return result.recovered ? 'reconciled' : 'written';
}

export async function applyKnowledgePatch(
  projectRoot: string,
  patch: ApiKnowledgeProposalPatch,
): Promise<KnowledgeWritebackResult> {
  let diskBaseline: DiskBaseline | undefined;
  const requireDiskBaseline = (): DiskBaseline => {
    if (!diskBaseline) throw new Error('缺少知识文件的磁盘基线，请重新读取后确认');
    return diskBaseline;
  };
  let snapshotBranch: BranchInfo | null = null;
  const request = {
    operationKey: `${patch.id}:knowledge`,
    source: JSON.stringify([
      patch.id,
      patch.before,
      patch.after,
      patch.proposal_revision,
      patch.author_confirmation_event_id,
    ]),
    path: patch.file_path,
    content: patch.after,
  };
  return performKnowledgeWriteback(patch, {
    readCurrent: async () => {
      const exists = await TauriFileSystem.pathExists(patch.file_path);
      const current = exists
        ? await TauriFileSystem.readProjectFile(projectRoot, patch.file_path)
        : null;
      diskBaseline = current === null ? { kind: 'missing' } : { kind: 'content', content: current };
      return current;
    },
    inspect: () => TauriFileSystem.inspectWritebackReceipt(projectRoot, request),
    snapshot: async () => {
      const expected = requireDiskBaseline();
      const current = expected.kind === 'missing' ? null : expected.content;
      const manifest = await loadBranchManifest(projectRoot, patch.file_path);
      snapshotBranch = getActiveBranch(manifest);
      return snapshotBeforeWrite(projectRoot, patch.file_path, current ?? '', {
        source: 'Agent',
        summary: '确认 Project Knowledge 提议',
        patchId: patch.id,
        branchId: snapshotBranch.id,
        branchLabel: snapshotBranch.label,
        parentId: snapshotBranch.headNodeId,
        checkpoint: true,
      });
    },
    advanceBranchHead: async (timestamp) => {
      const manifest = await loadBranchManifest(projectRoot, patch.file_path);
      const branch = snapshotBranch ?? getActiveBranch(manifest);
      await saveBranchManifest(
        projectRoot,
        patch.file_path,
        setBranchHead(manifest, branch.id, timestamp),
      );
    },
    write: (checkpointTimestamp) =>
      TauriFileSystem.writeFileWithReceipt(
        projectRoot,
        request,
        requireDiskBaseline(),
        checkpointTimestamp,
      ),
    record: (receipt) =>
      recordRevisionLoop({
        projectPath: projectRoot,
        filePath: patch.file_path,
        before: patch.before,
        after: patch.after,
        summary: '确认 Project Knowledge 提议',
        note: `Knowledge ID：${patch.knowledge_id}`,
        userIntent: '确认并沉淀 Project Knowledge',
        assistantSessionId: null,
        patchId: patch.id,
        operationId: receipt.operationId,
      }),
    resolveAccepted: () =>
      resolveKnowledgeProposal({
        project_root: projectRoot,
        artifact_id: patch.artifact_id,
        revision: patch.proposal_revision,
        proposal_id: patch.proposal_id,
        resolution: 'accepted',
        patch_identity: patch.id,
        author_confirmation_event_id: patch.author_confirmation_event_id,
      }),
  });
}
