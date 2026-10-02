import { useEffect, type MutableRefObject } from 'react';
import type { EditorModelCache } from './useMonacoEditor';
import type { BranchInfo } from '../../lib/branches';
import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import { createRemoteFileSuggestion } from '../../lib/assistant-suggestions';
import type { WritebackReceipt, WritebackRequest } from '../../lib/writeback-receipt-types';
import { resolveProjectRelativePath } from '../../lib/project-context';
import { useExternalWritebackCoordinator } from '../app/ExternalWritebackProvider';

export type ExternalWriteOverrides = {
  admissionGuard?: () => void;
  beforeNativeAdmission?: () => Promise<void>;
  frozenBranch?: BranchInfo;
  externalRequest?: WritebackRequest;
};
type Params = {
  projectPathRef: MutableRefObject<string | null>;
  filePathRef: MutableRefObject<string | null>;
  modelCacheRef: MutableRefObject<EditorModelCache>;
  mountedRef: MutableRefObject<boolean>;
  isBusy: () => boolean;
  branch: () => BranchInfo;
  normalize: (content: string) => string;
  write: (
    suggestion: AssistantFileSuggestion,
    path: string,
    before: string,
    after: string,
    overrides: ExternalWriteOverrides,
  ) => Promise<{
    receipt: WritebackReceipt;
    warning: string | null;
    retryAudit: (() => Promise<void>) | null;
  }>;
};

/** Register the original guarded writer; this adapter never snapshots or writes itself. */
export function useExternalWritebackEditor(params: Params) {
  const coordinator = useExternalWritebackCoordinator();
  const {
    projectPathRef,
    filePathRef,
    modelCacheRef,
    mountedRef,
    isBusy,
    branch,
    normalize,
    write,
  } = params;
  useEffect(() => {
    if (!coordinator) return;
    return coordinator.registerEditor({
      acquire(wait) {
        const project = projectPathRef.current;
        const path = project ? resolveProjectRelativePath(project, wait.requested_path) : null;
        const state = path ? modelCacheRef.current.get(path) : null;
        if (
          !project ||
          project !== wait.project_path ||
          !path ||
          filePathRef.current !== path ||
          !state
        )
          throw new Error('请在原项目打开补丁目标文件');
        if (state.diskBaseline.kind !== 'content' || state.diskBaseline.content !== wait.raw_before)
          throw new Error('原始磁盘基线已变化；不能用规范化 before 代替');
        const initialBranch = branch();
        const version = state.model.getAlternativeVersionId();
        const validate = () => {
          if (
            !mountedRef.current ||
            isBusy() ||
            projectPathRef.current !== project ||
            filePathRef.current !== path ||
            modelCacheRef.current.get(path) !== state ||
            state.model.isDisposed() ||
            state.model.getAlternativeVersionId() !== version ||
            normalize(state.model.getValue()) !== normalize(wait.proposal.before) ||
            normalize(state.originalContent) !== normalize(wait.proposal.before) ||
            branch().id !== initialBranch.id
          )
            throw new Error('目标缓冲、分支或编辑器作用域已变化，已阻止写入');
        };
        validate();
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
        return {
          validate,
          execute: (guard, beforeNativeAdmission) =>
            write(suggestion, path, state.model.getValue(), wait.proposal.after, {
              admissionGuard: guard,
              beforeNativeAdmission,
              frozenBranch: initialBranch,
              externalRequest: {
                operationKey: wait.operation_key,
                source: wait.source,
                path,
                content: wait.proposal.after,
              },
            }),
        };
      },
    });
  }, [
    coordinator,
    projectPathRef,
    filePathRef,
    modelCacheRef,
    mountedRef,
    isBusy,
    branch,
    normalize,
    write,
  ]);
}
