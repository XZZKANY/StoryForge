import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type * as monaco from 'monaco-editor';

import { type GraphNode } from '../../lib/branches';
import { unmarkChapterWrittenInPlan } from '../../lib/serial-plan';
import { TauriFileSystem } from '../../lib/host/tauri-fs';
import { emitToast } from '../../lib/toast';
import { readVersionState, snapshotBeforeWrite, type VersionEntry } from '../../lib/versions';
import { performGuardedWriteback } from '../../lib/writeback';
import type { AppDialogApi } from '../app/AppDialog';
import type { useBranchManifest } from './useBranchManifest';
import type { EditorSave } from './useEditorSave';
import type { EditorModelCache } from './useMonacoEditor';
import { formatTimestamp } from './VersionHistory';

type BranchManifest = ReturnType<typeof useBranchManifest>;

// 版本恢复 / 检出节点 / 从节点开分支。与拆分前一样是每次渲染重建的闭包，里面不调用任何 React hook。

export function useVersionRestore({
  projectPath,
  filePath,
  editorReady,
  loadedFilePath,
  dropOpenFilePath,
  dialogs,
  editorRef,
  projectPathRef,
  filePathRef,
  modelCacheRef,
  restoreOperationRef,
  isDirtyRef,
  originalContentRef,
  dropOpenFilePathRef,
  saveCurrentFileRef,
  getActiveBranchSnapshot,
  advanceBranchHead,
  createBranchFromNode,
  setLoadedContentPreview,
  setIsDirty,
  setShowHistory,
}: {
  projectPath: string | null;
  filePath: string | null;
  editorReady: boolean;
  loadedFilePath: string | null;
  dropOpenFilePath?: (path: string) => void;
  dialogs: AppDialogApi;
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  filePathRef: MutableRefObject<string | null>;
  projectPathRef: MutableRefObject<string | null>;
  modelCacheRef: MutableRefObject<EditorModelCache>;
  restoreOperationRef: MutableRefObject<number>;
  isDirtyRef: MutableRefObject<boolean>;
  originalContentRef: MutableRefObject<string>;
  dropOpenFilePathRef: MutableRefObject<((path: string) => void) | undefined>;
  saveCurrentFileRef: EditorSave['saveCurrentFileRef'];
  getActiveBranchSnapshot: BranchManifest['getActiveBranchSnapshot'];
  advanceBranchHead: BranchManifest['advanceBranchHead'];
  createBranchFromNode: BranchManifest['createBranchFromNode'];
  setLoadedContentPreview: (preview: string) => void;
  setIsDirty: (dirty: boolean) => void;
  setShowHistory: Dispatch<SetStateAction<boolean>>;
}) {
  // 恢复操作在读取版本前冻结归属；不能在 await 后重新认领当前标签页。
  const beginVersionRestore = () => {
    const project = projectPath;
    const path = filePath;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (
      !project ||
      !path ||
      !editor ||
      !model ||
      !editorReady ||
      loadedFilePath !== path ||
      projectPathRef.current !== project ||
      filePathRef.current !== path ||
      modelCacheRef.current.get(path)?.model !== model
    ) {
      throw new Error('恢复目标尚未就绪或活动文件已变化，已取消恢复');
    }
    const operation = ++restoreOperationRef.current;
    const version = () => model.getVersionId?.() ?? model.getAlternativeVersionId();
    let expectedVersion = version();
    const current = () =>
      restoreOperationRef.current === operation &&
      projectPathRef.current === project &&
      filePathRef.current === path &&
      editorRef.current === editor &&
      editor.getModel() === model &&
      modelCacheRef.current.get(path)?.model === model &&
      !model.isDisposed() &&
      version() === expectedVersion;
    const assertCurrent = () => {
      if (!current()) throw new Error('恢复期间切换了文件、换了模型或文件内容已变化，已取消恢复');
    };
    return {
      project,
      path,
      model,
      current,
      assertCurrent,
      acceptOwnVersion: () => {
        expectedVersion = version();
      },
    };
  };

  // 读取、确认、保存、快照、分支推进和最终修改是同一个有归属的操作。
  const handleRestore = async (
    entry: VersionEntry,
    owner = beginVersionRestore(),
    // 作者确认恢复之后才做的前置动作（从节点开分支）：取消恢复就什么都不留下。
    afterConfirm?: () => Promise<void>,
  ) => {
    const { project, path, model, assertCurrent } = owner;
    assertCurrent();
    const state = await readVersionState(project, entry);
    assertCurrent();
    const dirty = isDirtyRef.current;
    if (!state.exists && !dropOpenFilePath)
      throw new Error('当前编辑器无法安全摘除已删除文件的页签');
    const confirmed = await dialogs.confirm(
      state.exists
        ? {
            title: '恢复到此版本？',
            message: dirty
              ? '当前文件有未保存的修改，恢复会用所选版本覆盖编辑区。将先保存这些修改并记录完整作品版本，之后仍可从版本记录找回当前内容。'
              : '恢复会用所选版本覆盖当前编辑区。将先为当前内容记录完整作品版本，之后仍可从版本记录找回。',
            confirmLabel: '覆盖并恢复',
            cancelLabel: '取消',
            tone: dirty ? 'danger' : 'default',
          }
        : {
            title: '恢复到文件不存在的版本？',
            message:
              '将先保存当前编辑内容并记录完整作品版本，然后删除该文件。之后仍可从版本记录恢复。',
            confirmLabel: '删除并恢复',
            cancelLabel: '取消',
            tone: 'danger',
          },
    );
    if (!confirmed) return;
    assertCurrent();
    if (afterConfirm) {
      await afterConfirm();
      assertCurrent();
    }
    if (dirty) {
      await saveCurrentFileRef.current();
      assertCurrent();
    }
    const currentContent = model.getValue();
    const branch = getActiveBranchSnapshot();
    const targetState = modelCacheRef.current.get(path);
    const targetVersion = model.getVersionId?.() ?? model.getAlternativeVersionId();
    const baseline = targetState?.diskBaseline;
    const checkDeleteBaseline = async () => {
      assertCurrent();
      if (!baseline || baseline.kind !== 'content')
        throw new Error('缺少可核对的磁盘基线，已取消删除恢复');
      const disk = await TauriFileSystem.readProjectFile(project, path);
      assertCurrent();
      if (disk !== baseline.content) throw new Error('磁盘内容已变化，已取消删除恢复');
    };
    if (!state.exists) await checkDeleteBaseline();
    await performGuardedWriteback(true, {
      snapshot: async () => {
        assertCurrent();
        return await snapshotBeforeWrite(project, path, currentContent, {
          source: 'Editor',
          summary: state.exists ? '恢复历史版本前快照' : '恢复“文件不存在”版本前快照',
          branchId: branch.id,
          branchLabel: branch.label,
          parentId: branch.headNodeId,
        });
      },
      advanceBranchHead: async (timestamp) => {
        assertCurrent();
        await advanceBranchHead(timestamp, {
          projectPath: project,
          filePath: path,
          branchId: branch.id,
        });
        assertCurrent();
      },
      write: async () => {
        assertCurrent();
        if (state.exists) {
          // 写已冻结的 model，不通过可能已换页的 editorRef 寻找目标。
          model.setValue(state.content);
          owner.acceptOwnVersion();
        } else {
          // 原生 delete_path 尚非 compare-delete；此复核挡住已观察到的磁盘漂移，
          // 不能宣称消除了复核与原生删除之间的外部进程 TOCTOU。
          await checkDeleteBaseline();
          await TauriFileSystem.deletePath(project, path);
        }
      },
      // 已完成删除的原目标仍需结算计划；这里不读取新的活动文件。
      record: async () => {
        if (!state.exists) await unmarkChapterWrittenInPlan(project, path);
      },
    });
    if (!state.exists) {
      // 已完成删除须清理原目标页签；换到 B 只取消活动界面结算，不取消 A 的清理。
      // 但后来输入、新模型或同路径重建的文件不能被这次迟到完成关掉。
      const canRetireTarget = () =>
        projectPathRef.current === project &&
        modelCacheRef.current.get(path) === targetState &&
        targetState?.model === model &&
        !model.isDisposed() &&
        (model.getVersionId?.() ?? model.getAlternativeVersionId()) === targetVersion &&
        (filePathRef.current !== path || editorRef.current?.getModel() === model);
      if (
        !canRetireTarget() ||
        (await TauriFileSystem.projectPathExists(project, path)) ||
        !canRetireTarget()
      )
        return;
      const settleActive = owner.current();
      // 页签回调本身也含活动文件闭包，必须使用最新已提交的回调。
      dropOpenFilePathRef.current?.(path);
      if (!settleActive) return;
    } else {
      if (!owner.current()) return;
      setLoadedContentPreview(state.content.slice(0, 120));
      setIsDirty(state.content !== originalContentRef.current);
    }
    setShowHistory(false);
    emitToast(
      state.exists
        ? '已恢复到所选版本，覆盖前的当前内容已留版本快照'
        : '已恢复到“文件不存在”，删除前作品版本已保留',
      { tone: 'success' },
    );
  };

  const handleCheckoutNode = async (node: GraphNode) => {
    try {
      await handleRestore(node.version);
    } catch (err) {
      emitToast(`恢复到此节点失败：${err instanceof Error ? err.message : String(err)}`, {
        tone: 'error',
      });
    }
  };

  // 分支名称对话也属于原文件操作，不能在等待期间把新标签页当作目标。
  const handleBranchFromNode = async (node: GraphNode) => {
    try {
      const owner = beginVersionRestore();
      const label = await dialogs.prompt({
        title: '新分支',
        message: '输入新分支名称：',
        defaultValue: `分支 @ ${formatTimestamp(node.timestamp)}`,
        confirmLabel: '创建',
      });
      if (label === null) return;
      owner.assertCurrent();
      await handleRestore(node.version, owner, () => createBranchFromNode(node.id, label));
    } catch (error) {
      emitToast(`创建分支或恢复失败：${error instanceof Error ? error.message : String(error)}`, {
        tone: 'error',
      });
    }
  };

  return { handleRestore, handleCheckoutNode, handleBranchFromNode };
}
