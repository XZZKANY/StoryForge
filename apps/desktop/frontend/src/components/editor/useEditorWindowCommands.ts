import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type * as monaco from 'monaco-editor';

import {
  EXPORT_CURRENT_FILE_EVENT,
  REQUEST_EDITOR_COMMAND_EVENT,
  REQUEST_SAVE_ACTIVE_FILE_EVENT,
  SAVE_ACTIVE_FILE_DONE_EVENT,
  emitAuthorLoopResult,
  type EditorCommand,
  type SaveActiveFileDoneDetail,
  type SaveActiveFileRequestDetail,
} from '../../lib/assistant-events';
import { exportCurrentFile } from '../../lib/author-loop';
import { emitToast } from '../../lib/toast';
import type { EditorSave } from './useEditorSave';
import type { EditorModelCache } from './useMonacoEditor';

// 别处经窗口事件发来的编辑器命令：读盘前先落盘（含关窗握手）、导出当前文件、切版本历史。

export function useEditorWindowCommands({
  editorRef,
  filePathRef,
  projectPathRef,
  modelCacheRef,
  isDirtyRef,
  saveCurrentFileRef,
  setShowHistory,
}: {
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  filePathRef: MutableRefObject<string | null>;
  projectPathRef: MutableRefObject<string | null>;
  modelCacheRef: MutableRefObject<EditorModelCache>;
  isDirtyRef: MutableRefObject<boolean>;
  saveCurrentFileRef: EditorSave['saveCurrentFileRef'];
  setShowHistory: Dispatch<SetStateAction<boolean>>;
}) {
  // 审稿/修订读盘前，外部请活动编辑器先落盘，避免后端读到未保存的旧内容。
  useEffect(() => {
    const onRequestSave = (event: Event) => {
      const detail = (event as CustomEvent<SaveActiveFileRequestDetail>).detail;
      const respond = (result: SaveActiveFileDoneDetail) =>
        window.dispatchEvent(
          new CustomEvent(SAVE_ACTIVE_FILE_DONE_EVENT, {
            detail: {
              ...result,
              ...(detail?.requestId !== undefined ? { requestId: detail.requestId } : {}),
            },
          }),
        );
      const requestedFilePath = detail?.filePath ?? null;
      if (detail?.forClose) {
        const project = projectPathRef.current;
        const targetEditor = editorRef.current;
        const model = targetEditor?.getModel();
        const target = modelCacheRef.current.get(detail.filePath);
        if (
          !project ||
          !model ||
          detail.filePath !== filePathRef.current ||
          target?.model !== model
        ) {
          respond({ filePath: requestedFilePath, status: 'skipped' });
          return;
        }
        const version = model.getVersionId?.() ?? model.getAlternativeVersionId();
        const canClose = () =>
          projectPathRef.current === project &&
          modelCacheRef.current.get(detail.filePath) === target &&
          filePathRef.current === detail.filePath &&
          editorRef.current === targetEditor &&
          targetEditor?.getModel() === model &&
          !model.isDisposed() &&
          (model.getVersionId?.() ?? model.getAlternativeVersionId()) === version &&
          model.getValue() === target.originalContent &&
          target.diskBaseline.kind === 'content' &&
          model.getValue() === target.diskBaseline.content;
        void saveCurrentFileRef
          .current()
          .then(() => {
            if (!canClose())
              throw new Error('原稿已保存，但等待期间文件又变化；已取消关闭，请确认后重试');
            respond({ filePath: requestedFilePath, status: 'saved', canClose });
          })
          .catch((error) =>
            respond({
              filePath: requestedFilePath,
              status: 'error',
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        return;
      }

      if (
        !detail ||
        detail.filePath !== filePathRef.current ||
        !editorRef.current ||
        !isDirtyRef.current
      ) {
        respond({ filePath: requestedFilePath, status: 'skipped' });
        return;
      }
      void saveCurrentFileRef
        .current()
        .then(() => respond({ filePath: requestedFilePath, status: 'saved' }))
        .catch((error) =>
          respond({
            filePath: requestedFilePath,
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
    };
    window.addEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, onRequestSave);
    return () => window.removeEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, onRequestSave);
    // 挂载期只注册一次；保存逻辑经 ref 读取最新文件和分支闭包。
  }, [editorRef, filePathRef, isDirtyRef, modelCacheRef, projectPathRef, saveCurrentFileRef]);

  const handleExport = async () => {
    const path = filePathRef.current;
    const project = projectPathRef.current;
    if (!path || !project || !editorRef.current) return;

    try {
      const result = await exportCurrentFile({
        projectPath: project,
        filePath: path,
        content: editorRef.current.getValue(),
      });
      emitToast(`已导出到 ${result.exportPath}`, { tone: 'success' });
      emitAuthorLoopResult({
        filePath: path,
        status: 'completed',
        action: 'exported',
        message: `已导出到 ${result.exportPath}`,
        artifactPath: result.exportPath,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitToast(`导出失败：${message}`, { tone: 'error' });
      emitAuthorLoopResult({
        filePath: path,
        status: 'error',
        action: 'exported',
        message,
      });
    }
  };

  useEffect(() => {
    const onExportCurrent = () => {
      if (!filePathRef.current) return;
      void handleExport();
    };
    window.addEventListener(EXPORT_CURRENT_FILE_EVENT, onExportCurrent);
    return () => window.removeEventListener(EXPORT_CURRENT_FILE_EVENT, onExportCurrent);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 拆分前原样：挂载期只注册一次，handleExport 只经 ref 读最新文件
  }, []);

  // Q3a：编辑区工具行已收进 EditorTabs「…」菜单，历史视图切换改由命令事件驱动
  // （保存走 REQUEST_SAVE、导出走 EXPORT_CURRENT_FILE，均沿用既有事件通道）。
  useEffect(() => {
    const onEditorCommand = (event: Event) => {
      const command = (event as CustomEvent<{ command: EditorCommand }>).detail?.command;
      if (command === 'toggle-history') {
        setShowHistory((visible) => !visible);
      }
    };
    window.addEventListener(REQUEST_EDITOR_COMMAND_EVENT, onEditorCommand);
    return () => window.removeEventListener(REQUEST_EDITOR_COMMAND_EVENT, onEditorCommand);
  }, [setShowHistory]);
}
