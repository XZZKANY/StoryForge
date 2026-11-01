import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type * as monaco from 'monaco-editor';

import { recordDailyProgress, writebackDelta } from '../../lib/daily-progress';
import { invalidateContextBundleCache } from '../../lib/project-context';
import { TauriFileSystem } from '../../lib/host/tauri-fs';
import { snapshotBeforeWrite } from '../../lib/versions';
import { performGuardedWriteback, type WritebackQueue } from '../../lib/writeback';
import { isReadOnlyDerivedProjectPath } from '../../lib/project/entry-visibility';
import type { AppDialogApi } from '../app/AppDialog';
import { canCommitEditorSave, isRetainedEditorModel } from '../app/editor-tabs-state';
import type { useBranchManifest } from './useBranchManifest';
import type { EditorModelCache } from './useMonacoEditor';

type BranchManifest = ReturnType<typeof useBranchManifest>;

export function useEditorSave({
  editorRef,
  filePathRef,
  projectPathRef,
  modelCacheRef,
  originalContentRef,
  cleanVersionIdRef,
  enqueueWriteback,
  getActiveBranchSnapshot,
  advanceBranchHead,
  onDirtyChange,
  setIsDirty,
  dialogs,
}: {
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  filePathRef: MutableRefObject<string | null>;
  projectPathRef: MutableRefObject<string | null>;
  modelCacheRef: MutableRefObject<EditorModelCache>;
  originalContentRef: MutableRefObject<string>;
  cleanVersionIdRef: MutableRefObject<number | null>;
  enqueueWriteback: WritebackQueue;
  getActiveBranchSnapshot: BranchManifest['getActiveBranchSnapshot'];
  advanceBranchHead: BranchManifest['advanceBranchHead'];
  onDirtyChange?: (filePath: string | null, dirty: boolean) => void;
  setIsDirty: (dirty: boolean) => void;
  dialogs: AppDialogApi;
}) {
  // 保存文件：先快照旧内容，再写入新内容。内部函数向上抛错，供 Agent 预读握手阻断读盘。
  // autosave 与 Ctrl+S 可同时发起，故整个「取内容 → 快照 → 写盘 → 结算」串进写回队列，
  // 避免两次写盘乱序完成时旧内容盖掉新内容（内容在任务真正执行时才取，落盘的总是最新稿）。
  const saveCurrentFile = useCallback(async () => {
    // Capture the target at invocation, not after another write's evidence awaits.
    const path = filePathRef.current;
    const projectRoot = projectPathRef.current;
    const savedModel = editorRef.current?.getModel();
    if (!projectRoot || !path || !savedModel || isReadOnlyDerivedProjectPath(path)) return;
    const savedStateAtStart = modelCacheRef.current.get(path);
    if (!savedStateAtStart || savedStateAtStart.model !== savedModel)
      throw new Error('缺少当前文件磁盘基线，请重新读取后保存');
    const branchAtRequest = getActiveBranchSnapshot();
    return enqueueWriteback(async () => {
      if (modelCacheRef.current.get(path) !== savedStateAtStart)
        throw new Error('排队保存的原文件已关闭，请重新打开后保存');
      const expected = savedStateAtStart.diskBaseline;
      const content = savedModel.getValue();
      const previous = savedStateAtStart.originalContent;
      const contentChanged = expected.kind === 'missing' || expected.content !== content;
      const branch =
        projectPathRef.current === projectRoot && filePathRef.current === path
          ? getActiveBranchSnapshot()
          : branchAtRequest;

      await performGuardedWriteback(contentChanged, {
        snapshot: async () =>
          snapshotBeforeWrite(projectRoot, path, previous, {
            source: 'Editor',
            summary: '手动保存前快照',
            branchId: branch?.id,
            branchLabel: branch?.label,
            parentId: branch?.headNodeId,
          }),
        advanceBranchHead: async (timestamp) => {
          await advanceBranchHead(timestamp, {
            projectPath: projectRoot,
            filePath: path,
            branchId: branch.id,
          });
        },
        write: async () => {
          await TauriFileSystem.writeFileIfUnchanged(projectRoot, path, content, expected);
          // C10：保存即失效 context bundle 缓存，30 秒 TTL 内不得把旧摘录发给后端。
          invalidateContextBundleCache(projectRoot);
          if (modelCacheRef.current.get(path) === savedStateAtStart)
            savedStateAtStart.diskBaseline = { kind: 'content', content };
        },
        record: async () => undefined,
      });

      // 日更账本记的是**已落盘**的净增量，故必须在写回成功之后、任何提前 return 之前累加。
      recordDailyProgress(projectRoot, writebackDelta(previous, content));

      const savedState = modelCacheRef.current.get(path);
      if (!savedState || !isRetainedEditorModel(savedModel, savedState.model)) return;
      savedState.originalContent = content;
      const remainsDirty = savedModel.getValue() !== content;
      onDirtyChange?.(path, remainsDirty);
      if (
        canCommitEditorSave(
          path,
          savedModel,
          filePathRef.current,
          editorRef.current?.getModel() ?? null,
        )
      ) {
        originalContentRef.current = content;
        cleanVersionIdRef.current = remainsDirty ? null : savedModel.getAlternativeVersionId();
        setIsDirty(remainsDirty);
      }
    });
  }, [
    advanceBranchHead,
    enqueueWriteback,
    getActiveBranchSnapshot,
    onDirtyChange,
    cleanVersionIdRef,
    editorRef,
    filePathRef,
    modelCacheRef,
    originalContentRef,
    projectPathRef,
    setIsDirty,
  ]);
  const saveCurrentFileRef = useRef(saveCurrentFile);

  useEffect(() => {
    saveCurrentFileRef.current = saveCurrentFile;
  }, [saveCurrentFile]);

  const handleSave = useCallback(async () => {
    try {
      await saveCurrentFile();
    } catch (err) {
      console.error('保存文件失败:', err);
      await dialogs.alert({
        title: '保存文件失败',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [dialogs, saveCurrentFile]);

  return { saveCurrentFileRef, handleSave };
}

export type EditorSave = ReturnType<typeof useEditorSave>;
