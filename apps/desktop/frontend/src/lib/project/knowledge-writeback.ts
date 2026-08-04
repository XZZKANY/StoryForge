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
import { TauriFileSystem } from '../tauri-fs';
import { snapshotBeforeWrite } from '../versions';
import { performGuardedWriteback } from '../writeback';

export type KnowledgeWritebackEffects = {
  readCurrent: () => Promise<string | null>;
  snapshot: () => ReturnType<typeof snapshotBeforeWrite>;
  advanceBranchHead: (timestamp: number) => Promise<void>;
  write: () => Promise<void>;
  record: () => Promise<unknown>;
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
  const current = await effects.readCurrent();
  const normalizedCurrent = current === null ? null : normalizeEol(current);
  const normalizedBefore = normalizeEol(patch.before);
  const normalizedAfter = normalizeEol(patch.after);
  if (normalizedCurrent === normalizedAfter) {
    await effects.resolveAccepted();
    return 'reconciled';
  }
  if (
    !(normalizedCurrent === null && patch.before === '') &&
    normalizedCurrent !== normalizedBefore
  ) {
    throw new Error('知识文件已变化，请重新生成 diff 后再确认');
  }
  await performGuardedWriteback(normalizedBefore !== normalizedAfter, {
    snapshot: effects.snapshot,
    advanceBranchHead: effects.advanceBranchHead,
    write: effects.write,
    record: effects.record,
  });
  await effects.resolveAccepted();
  return 'written';
}

export async function applyKnowledgePatch(
  projectRoot: string,
  patch: ApiKnowledgeProposalPatch,
): Promise<KnowledgeWritebackResult> {
  const exists = await TauriFileSystem.pathExists(patch.file_path);
  const current = exists ? await TauriFileSystem.readFile(patch.file_path) : null;
  let snapshotBranch: BranchInfo | null = null;
  return performKnowledgeWriteback(patch, {
    readCurrent: async () => current,
    snapshot: async () => {
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
    write: () => TauriFileSystem.writeFile(projectRoot, patch.file_path, patch.after),
    record: () =>
      recordRevisionLoop({
        projectPath: projectRoot,
        filePath: patch.file_path,
        before: current ?? '',
        after: patch.after,
        summary: '确认 Project Knowledge 提议',
        note: `Knowledge ID：${patch.knowledge_id}`,
        userIntent: '确认并沉淀 Project Knowledge',
        assistantSessionId: null,
        patchId: patch.id,
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
