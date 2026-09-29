import { useCallback } from 'react';

import type { Observation } from '../shell/ObsPanel';
import { emitLocateInEditor } from '../../lib/assistant-events';
import type { ObservationAnchor } from '../../lib/observations';

type EditorNavigationOptions = {
  activeProject: string | null;
  displayedFile: string | null;
  openFile: (path: string, actionLabel?: string) => Promise<void>;
  showEditor: () => void;
};

/** 编辑器入口导航；不承担搜索采集、权限判断或文件写回。 */
export function useEditorNavigation({
  activeProject,
  displayedFile,
  openFile,
  showEditor,
}: EditorNavigationOptions) {
  // 点大纲标题跳到那一行：与搜索命中同一条定位通道，路径已是绝对路径不必再拼。
  const openOutlineHeading = useCallback(
    (path: string, line: number) => {
      showEditor();
      if (displayedFile !== path) void openFile(path, '打开大纲');
      emitLocateInEditor({ filePath: path, line });
    },
    [showEditor, displayedFile, openFile],
  );

  const openSearchHit = useCallback(
    (path: string, line: number) => {
      showEditor();
      if (displayedFile !== path) void openFile(path, '打开搜索结果');
      emitLocateInEditor({ filePath: path, line });
    },
    [showEditor, displayedFile, openFile],
  );

  // 点观测行 / 台账锚点定位原文：拼项目内绝对路径（沿用项目串的分隔符风格，保证与
  // 页签路径可比），非当前文件先打开，再广播定位事件由 Editor 在模型就绪后消费。
  const locateAnchor = useCallback(
    (anchor: ObservationAnchor) => {
      const project = activeProject;
      if (!project) return;
      // 定位原文要落在中栏编辑器；对话聚焦态隐藏中栏时先落回 balanced，否则定位落空。
      showEditor();
      const separator = project.includes('\\') ? '\\' : '/';
      const relativePath = anchor.path.split('/').join(separator);
      const absolutePath = `${project.replace(/[\\/]+$/, '')}${separator}${relativePath}`;
      if (displayedFile !== absolutePath) void openFile(absolutePath, '定位观测');
      emitLocateInEditor({ filePath: absolutePath, line: anchor.line, snippet: anchor.snippet });
    },
    [showEditor, displayedFile, openFile, activeProject],
  );

  const locateObservation = useCallback(
    (observation: Observation) => {
      if (observation.anchor) locateAnchor(observation.anchor);
    },
    [locateAnchor],
  );

  // 点手稿章节行打开该章：底座给的是 posix 相对路径，拼绝对路径沿用项目串的分隔符风格
  // （与 locateAnchor 同一判据），否则 Windows 下拼出的路径与页签路径不可比、会重复开页签。
  const openManuscriptChapter = useCallback(
    (relativePath: string) => {
      const project = activeProject;
      if (!project) return;
      showEditor();
      const separator = project.includes('\\') ? '\\' : '/';
      const absolutePath = `${project.replace(/[\\/]+$/, '')}${separator}${relativePath
        .split('/')
        .join(separator)}`;
      if (displayedFile !== absolutePath) void openFile(absolutePath, '打开章节');
    },
    [showEditor, displayedFile, openFile, activeProject],
  );

  return {
    openOutlineHeading,
    openSearchHit,
    locateAnchor,
    locateObservation,
    openManuscriptChapter,
  };
}
