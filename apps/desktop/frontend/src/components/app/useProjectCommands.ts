import { useCallback, useEffect, useState } from 'react';

import { executeIdeCommand } from '../../lib/api-client';
import {
  APPLY_FILE_SUGGESTION_EVENT,
  flushActiveEditorToDisk,
  REQUEST_OPEN_FILE_EVENT,
  type OpenFileRequest,
} from '../../lib/assistant-events';
import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import {
  createNewBookProject,
  createSampleStoryProject,
  initializeStoryProject,
  relativePathInsideProject,
} from '../../lib/project-context';
import { registerSmokeFileLoader, registerSmokeProjectLoader } from '../../lib/smoke';
import { FS_MUTATION_EVENT, invalidateFileSystemCache } from '../../lib/tauri-fs';
import { emitToast } from '../../lib/toast';
import type { AppDialogApi } from './AppDialog';
import { useBookBreakdown } from './useBookBreakdown';
import { useNewProject } from './useNewProject';
import { normalizePathForMatch, normalizeRoot } from '../../lib/project/path';

export type { BookBreakdownPreview } from './useBookBreakdown';

type UseProjectCommandsOptions = {
  activeProject: string | null;
  currentFile: string | null;
  dirtyFiles: Set<string>;
  openFiles: string[];
  dialogs: AppDialogApi;
  selectProject: (path: string) => void;
  selectProjectSafely: (path: string) => Promise<boolean>;
  openFile: (path: string, actionLabel?: string) => Promise<void>;
  confirmDiscardFiles: (paths: string[], actionLabel: string) => Promise<boolean>;
  resetEditorFiles: () => void;
  onShowEditor: () => void;
  cancelPendingNavigation?: () => void;
  onResumeProject?: () => void;
};

export function useProjectCommands({
  activeProject,
  currentFile,
  dirtyFiles,
  openFiles,
  dialogs,
  selectProject,
  selectProjectSafely,
  openFile,
  confirmDiscardFiles,
  resetEditorFiles,
  onShowEditor,
  cancelPendingNavigation,
  onResumeProject,
}: UseProjectCommandsOptions) {
  const [projectRefreshVersion, setProjectRefreshVersion] = useState(0);
  const [welcomeDraft, setWelcomeDraft] = useState('');
  const [pendingWelcomePrompt, setPendingWelcomePrompt] = useState<string | null>(null);
  const onBlankProjectCreated = useCallback(
    (projectPath: string) => {
      setPendingWelcomePrompt(null);
      resetEditorFiles();
      selectProject(projectPath);
      setProjectRefreshVersion((version) => version + 1);
    },
    [resetEditorFiles, selectProject],
  );
  const newProject = useNewProject({
    activeProject,
    openFiles,
    confirmDiscardFiles,
    onCreated: onBlankProjectCreated,
  });
  const { open: openNewProject } = newProject;
  const handleNewProjectOpen = useCallback(() => {
    cancelPendingNavigation?.();
    openNewProject();
  }, [cancelPendingNavigation, openNewProject]);

  // 补丁写回、Agent 起草、新建/删除/改名后刷新资源树；短时间内多次写入合并一次重拉。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFsMutation = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setProjectRefreshVersion((version) => version + 1), 120);
    };
    window.addEventListener(FS_MUTATION_EVENT, onFsMutation);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(FS_MUTATION_EVENT, onFsMutation);
    };
  }, []);

  const handleOpenProject = useCallback(async () => {
    cancelPendingNavigation?.();
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title: '选择作品文件夹' });
      if (!selected || typeof selected !== 'string') return;
      if (
        activeProject &&
        normalizePathForMatch(normalizeRoot(selected)) ===
          normalizePathForMatch(normalizeRoot(activeProject))
      ) {
        // 同一本作品只是返回当前现场；不能重置页签/脏稿或再次走切换确认。
        onResumeProject?.();
        return;
      }
      await selectProjectSafely(selected);
    } catch (error) {
      console.error('打开作品失败', error);
      await dialogs.alert({
        title: '打开作品失败',
        message: `请检查目录是否仍存在、是否有访问权限，然后重新选择作品文件夹。\n\n${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [activeProject, cancelPendingNavigation, dialogs, onResumeProject, selectProjectSafely]);

  // 发送即开书：建立显式项目骨架后由 ChatWindow 自动发送首句；失败时回落到手选目录。
  const handleWelcomeSend = useCallback(() => {
    const prompt = welcomeDraft.trim();
    if (!prompt) return;
    void (async () => {
      if (!(await confirmDiscardFiles(openFiles, '开新书'))) return;
      try {
        const { projectPath, seedFilePath } = await createNewBookProject(prompt);
        // pendingWelcomePrompt 必须在项目创建成功后才置位：否则 createNewBookProject 抛错（Win11/OneDrive
        // Documents 重定向等）时 stale prompt 泄漏，下一个打开的项目 ChatWindow 首挂载会自动发一次真·LLM run（UF-11）。
        setPendingWelcomePrompt(prompt);
        resetEditorFiles();
        onShowEditor();
        selectProject(projectPath);
        setProjectRefreshVersion((version) => version + 1);
        await openFile(seedFilePath);
      } catch (error) {
        console.error('发送即开书失败，回落到打开作品文件夹', error);
        await handleOpenProject();
      }
    })();
  }, [
    confirmDiscardFiles,
    handleOpenProject,
    onShowEditor,
    openFile,
    openFiles,
    resetEditorFiles,
    selectProject,
    welcomeDraft,
  ]);

  const handlePendingWelcomePromptConsumed = useCallback(() => {
    setPendingWelcomePrompt(null);
    setWelcomeDraft('');
  }, []);

  const handleCreateSampleProject = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择示例作品保存位置',
      });
      if (!selected || typeof selected !== 'string') return;
      if (!(await confirmDiscardFiles(openFiles, '创建示例作品'))) return;
      const projectPath = await createSampleStoryProject(selected);
      resetEditorFiles();
      selectProject(projectPath);
      setProjectRefreshVersion((version) => version + 1);
    } catch (error) {
      console.error('创建示例作品失败', error);
      await dialogs.alert({
        title: '创建示例作品失败',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [confirmDiscardFiles, dialogs, openFiles, resetEditorFiles, selectProject]);

  useEffect(
    () => registerSmokeProjectLoader((path) => void selectProjectSafely(path)),
    [selectProjectSafely],
  );

  useEffect(() => registerSmokeFileLoader((path) => void openFile(path)), [openFile]);

  // 补丁可指向未打开或尚不存在的文件；先打开目标，再由 Editor 领取待确认补丁。
  useEffect(() => {
    const normalize = (path: string) => path.replace(/\\/g, '/');
    const onSuggestion = (event: Event) => {
      const suggestion = (event as CustomEvent<AssistantFileSuggestion>).detail;
      if (!suggestion?.filePath || !activeProject) return;
      if (relativePathInsideProject(activeProject, suggestion.filePath) === null) return;
      // P1：补丁到达即确保中栏可见（对话聚焦 Ctrl+3 态隐藏中栏，补丁面板挂在里面看不见）；
      // 须在「已是当前文件」早返回之前调用，覆盖补丁指向当前打开文件的情形。
      onShowEditor();
      if (currentFile && normalize(currentFile) === normalize(suggestion.filePath)) return;
      void openFile(suggestion.filePath);
    };
    window.addEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
    return () => window.removeEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
  }, [activeProject, currentFile, onShowEditor, openFile]);

  // 对话栏「上下文」点文件：只开项目里的文件；对话聚焦态先把中栏放出来，否则打开了也看不见。
  useEffect(() => {
    const normalize = (path: string) => path.replace(/\\/g, '/');
    const onOpenRequest = (event: Event) => {
      const filePath = (event as CustomEvent<OpenFileRequest>).detail?.filePath;
      if (!filePath || !activeProject) return;
      if (relativePathInsideProject(activeProject, filePath) === null) return;
      onShowEditor();
      if (currentFile && normalize(currentFile) === normalize(filePath)) return;
      void openFile(filePath, '打开上下文文件');
    };
    window.addEventListener(REQUEST_OPEN_FILE_EVENT, onOpenRequest);
    return () => window.removeEventListener(REQUEST_OPEN_FILE_EVENT, onOpenRequest);
  }, [activeProject, currentFile, onShowEditor, openFile]);

  const handleInitializeStoryProject = useCallback(
    async (projectOverride?: string) => {
      const targetProject = projectOverride ?? activeProject;
      if (!targetProject) {
        await handleOpenProject();
        return;
      }
      try {
        await initializeStoryProject(targetProject);
        setProjectRefreshVersion((version) => version + 1);
        onShowEditor();
        emitToast('作品目录已补齐，原有的文件和文件夹都没动。');
      } catch (error) {
        console.error('初始化作品结构失败', error);
        await dialogs.alert({
          title: '初始化作品结构失败',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeProject, dialogs, handleOpenProject, onShowEditor],
  );

  // 确定性重建 canon 投影；结果仍是参考信号，不提升为质量判定。
  const handleRefreshCanon = useCallback(async () => {
    if (!activeProject) {
      await handleOpenProject();
      return;
    }
    try {
      if (currentFile && dirtyFiles.has(currentFile)) await flushActiveEditorToDisk(currentFile);
      const result = await executeIdeCommand('canon.refresh', { project_root: activeProject });
      const payload = (result.payload ?? {}) as Record<string, unknown>;
      const canon = (payload.canon ?? {}) as Record<string, unknown>;
      const dossier = (canon.dossier ?? {}) as Record<string, unknown>;
      const dossierPath = typeof dossier.path === 'string' ? dossier.path : null;
      const cached = canon.cache_status !== 'uncached_unverified' && dossierPath !== null;
      invalidateFileSystemCache(activeProject);
      setProjectRefreshVersion((version) => version + 1);
      // 引擎的 note 是给 Agent 看的术语版，这里按同一组字段说人话。
      const checked =
        Array.isArray(canon.checked_invariants) && canon.checked_invariants.length > 0;
      const lines = [
        `设定里登记的条目（人物、物件等）：${canon.entity_count ?? 0} 个`,
        checked
          ? `设定之间互相矛盾：${canon.conflict_count ?? 0} 处；可能和正文对不上、要翻原文核对：${canon.advisory_count ?? 0} 处`
          : '设定里还没写可核对的约束（比如某人第几章后退场），这次只统计了各条目出现在哪些章。',
        cached && dossierPath
          ? `事实卡已更新：${relativePathInsideProject(activeProject, dossierPath) ?? dossierPath}`
          : '这次只扫描了一遍，没有更新事实卡：改动记录核对不上，结果仅供参考。',
        '',
        '这些只是提示，不是质量结论。',
      ];
      await dialogs.alert({
        title: cached ? '设定事实卡已刷新' : '设定扫描完成（没有更新事实卡）',
        message: lines.join('\n'),
      });
    } catch (error) {
      await dialogs.alert({
        title: '刷新设定事实卡失败',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [activeProject, currentFile, dialogs, dirtyFiles, handleOpenProject]);

  const onReportGenerated = useCallback(() => {
    setProjectRefreshVersion((version) => version + 1);
  }, []);
  const {
    handleBookBreakdown,
    handleOpenBookBreakdown,
    handleAdoptBreakdownSkills,
    bookBreakdown,
    bookBreakdownRunning,
    bookBreakdownCancelling,
    handleCancelBookBreakdown,
  } = useBookBreakdown({
    activeProject,
    currentFile,
    dirtyFiles,
    dialogs,
    openProject: handleOpenProject,
    openFile,
    onReportGenerated,
  });

  return {
    newProject: { ...newProject, open: handleNewProjectOpen },
    projectRefreshVersion,
    welcomeDraft,
    setWelcomeDraft,
    pendingWelcomePrompt,
    handlePendingWelcomePromptConsumed,
    handleOpenProject,
    handleWelcomeSend,
    handleCreateSampleProject,
    handleInitializeStoryProject,
    handleRefreshCanon,
    handleBookBreakdown,
    handleOpenBookBreakdown,
    handleAdoptBreakdownSkills,
    bookBreakdown,
    bookBreakdownRunning,
    bookBreakdownCancelling,
    handleCancelBookBreakdown,
  };
}

export type ProjectCommands = ReturnType<typeof useProjectCommands>;
