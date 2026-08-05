import { useCallback, useEffect, useState } from 'react';

import { executeIdeCommand } from '../../lib/api-client';
import { APPLY_FILE_SUGGESTION_EVENT, flushActiveEditorToDisk } from '../../lib/assistant-events';
import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import {
  createNewBookProject,
  createSampleStoryProject,
  initializeStoryProject,
  relativePathInsideProject,
  resolveProjectRelativePath,
} from '../../lib/project-context';
import { registerSmokeFileLoader, registerSmokeProjectLoader } from '../../lib/smoke';
import { FS_MUTATION_EVENT, invalidateFileSystemCache, TauriFileSystem } from '../../lib/tauri-fs';
import type { AppDialogApi } from './AppDialog';
import { normalizeMarkdownFileName } from './helpers';

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
}: UseProjectCommandsOptions) {
  const [projectRefreshVersion, setProjectRefreshVersion] = useState(0);
  const [welcomeDraft, setWelcomeDraft] = useState('');
  const [pendingWelcomePrompt, setPendingWelcomePrompt] = useState<string | null>(null);
  const [bookBreakdown, setBookBreakdown] = useState<BookBreakdownPreview | null>(null);
  const [bookBreakdownRunning, setBookBreakdownRunning] = useState(false);
  const [bookBreakdownCancelId, setBookBreakdownCancelId] = useState<string | null>(null);
  const [bookBreakdownCancelling, setBookBreakdownCancelling] = useState(false);

  const loadBookBreakdown = useCallback(async (projectPath: string) => {
    try {
      const raw = await TauriFileSystem.readProjectFile(
        projectPath,
        '.storyforge/analysis/book-breakdown.json',
      );
      const report = JSON.parse(raw) as BookBreakdownPreview;
      const statusResult = await executeIdeCommand('book.breakdown.status', {
        project_root: projectPath,
      });
      const statusPayload = (statusResult.payload ?? {}) as Record<string, unknown>;
      const status = (statusPayload.breakdown ?? {}) as Record<string, unknown>;
      setBookBreakdown({
        ...report,
        stale: status.stale === true,
        status: typeof status.status === 'string' ? status.status : report.status,
        markdown_path:
          typeof status.markdown_path === 'string'
            ? status.markdown_path
            : '.storyforge/analysis/book-breakdown.md',
      });
    } catch {
      setBookBreakdown(null);
    }
  }, []);

  useEffect(() => {
    if (!activeProject) {
      setBookBreakdown(null);
      return;
    }
    void loadBookBreakdown(activeProject);
  }, [activeProject, loadBookBreakdown]);

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
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title: '选择项目目录' });
      if (!selected || typeof selected !== 'string') return;
      await selectProjectSafely(selected);
    } catch (error) {
      console.error('打开项目失败', error);
    }
  }, [selectProjectSafely]);

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
        console.error('发送即开书失败，回落到打开项目目录', error);
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
        title: '选择示例项目保存位置',
      });
      if (!selected || typeof selected !== 'string') return;
      if (!(await confirmDiscardFiles(openFiles, '创建示例项目'))) return;
      const projectPath = await createSampleStoryProject(selected);
      resetEditorFiles();
      selectProject(projectPath);
      setProjectRefreshVersion((version) => version + 1);
      onShowEditor();
    } catch (error) {
      console.error('创建示例项目失败', error);
      await dialogs.alert({
        title: '创建示例项目失败',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [confirmDiscardFiles, dialogs, onShowEditor, openFiles, resetEditorFiles, selectProject]);

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

  const handleNewFile = useCallback(
    async (projectOverride?: string) => {
      const targetProject = projectOverride ?? activeProject;
      if (!targetProject) {
        await handleOpenProject();
        return;
      }
      const input = await dialogs.prompt({
        title: '新建文件',
        message: '输入文件名（带 .md 扩展名）：',
        defaultValue: 'untitled.md',
        confirmLabel: '创建',
      });
      if (input === null) return;
      const relativePath = normalizeMarkdownFileName(input);
      if (!relativePath) return;
      const filePath = resolveProjectRelativePath(targetProject, relativePath);
      if (!filePath) {
        await dialogs.alert({
          title: '新建文件失败',
          message: '文件名必须位于当前项目内，不能使用绝对路径或 .. 跳出项目。',
        });
        return;
      }
      try {
        const exists = await TauriFileSystem.pathExists(filePath);
        if (exists) {
          const shouldOpen = await dialogs.confirm({
            title: '文件已存在',
            message: '是否直接打开这个文件？',
            confirmLabel: '打开',
          });
          if (!shouldOpen) return;
        } else {
          await TauriFileSystem.writeFile(targetProject, filePath, '# 新建文件\n\n');
        }
        await openFile(filePath, '打开新文件');
      } catch (error) {
        console.error('新建文件失败', error);
        await dialogs.alert({
          title: '新建文件失败',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeProject, dialogs, handleOpenProject, openFile],
  );

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
      } catch (error) {
        console.error('初始化项目结构失败', error);
        await dialogs.alert({
          title: '初始化项目结构失败',
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
      const dossierPath =
        typeof dossier.path === 'string' ? dossier.path : '.storyforge/canon/derived/dossier.md';
      invalidateFileSystemCache(activeProject);
      setProjectRefreshVersion((version) => version + 1);
      const lines = [
        `实体声明：${canon.entity_count ?? 0} 个`,
        `硬矛盾（blocking）：${canon.conflict_count ?? 0}，advisory：${canon.advisory_count ?? 0}`,
        `已写出事实卡：${dossierPath}`,
        '',
        typeof canon.note === 'string'
          ? canon.note
          : '结果为派生参考信号，非质量判定；advisory 须抽读原文核实。',
      ];
      await dialogs.alert({ title: 'Canon 事实卡已刷新（参考信号）', message: lines.join('\n') });
    } catch (error) {
      await dialogs.alert({
        title: '刷新 Canon 事实卡失败',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [activeProject, currentFile, dialogs, dirtyFiles, handleOpenProject]);

  const handleBookBreakdown = useCallback(async () => {
    if (!activeProject) {
      await handleOpenProject();
      return;
    }
    if (bookBreakdownRunning) return;
    const analysisId = crypto.randomUUID();
    setBookBreakdownCancelId(analysisId);
    setBookBreakdownCancelling(false);
    setBookBreakdownRunning(true);
    try {
      if (currentFile && dirtyFiles.has(currentFile)) await flushActiveEditorToDisk(currentFile);
      const result = await executeIdeCommand('book.breakdown', {
        project_root: activeProject,
        target_count: 8,
        analysis_id: analysisId,
      });
      const payload = (result.payload ?? {}) as Record<string, unknown>;
      const breakdown = (payload.breakdown ?? {}) as Record<string, unknown>;
      setBookBreakdown(breakdown as BookBreakdownPreview);
      invalidateFileSystemCache(activeProject);
      setProjectRefreshVersion((version) => version + 1);
      await dialogs.alert({
        title: breakdown.status === 'cancelled' ? '拆书已取消' : '结构化拆书报告已生成',
        message: [
          `章节：${breakdown.chapter_count ?? 0}`,
          `代表章：${Array.isArray(breakdown.selected_chapters) ? breakdown.selected_chapters.length : (breakdown.selected_count ?? 0)}`,
          `状态：${breakdown.status ?? '未知'}`,
          typeof breakdown.model === 'string' && breakdown.model
            ? `模型：${breakdown.model}`
            : '模型：未配置，保留确定性拆书底稿',
          '',
          breakdown.status === 'cancelled'
            ? '已保存取消前生成的部分底稿，可重新运行。'
            : breakdown.status === 'completed'
              ? '报告已保存到 .storyforge/analysis/，可在侧栏预览或打开 Markdown。'
              : '报告已保存到 .storyforge/analysis/，当前为结构化底稿。',
        ].join('\n'),
      });
      const reportPath = resolveProjectRelativePath(
        activeProject,
        '.storyforge/analysis/book-breakdown.md',
      );
      if (reportPath) await openFile(reportPath, '打开拆书报告');
    } catch (error) {
      await dialogs.alert({
        title: '生成拆书报告失败',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBookBreakdownRunning(false);
      setBookBreakdownCancelling(false);
      setBookBreakdownCancelId(null);
    }
  }, [
    activeProject,
    bookBreakdownRunning,
    currentFile,
    dirtyFiles,
    dialogs,
    handleOpenProject,
    openFile,
  ]);

  const handleCancelBookBreakdown = useCallback(async () => {
    if (!bookBreakdownCancelId || bookBreakdownCancelling) return;
    setBookBreakdownCancelling(true);
    try {
      const result = await executeIdeCommand('book.breakdown.cancel', {
        analysis_id: bookBreakdownCancelId,
      });
      const payload = (result.payload ?? {}) as Record<string, unknown>;
      const breakdown = (payload.breakdown ?? {}) as Record<string, unknown>;
      if (breakdown.cancellation_requested !== true) {
        setBookBreakdownCancelling(false);
        await dialogs.alert({
          title: '拆书无法取消',
          message: '任务可能已经结束，请查看当前报告状态。',
        });
      }
    } catch (error) {
      setBookBreakdownCancelling(false);
      await dialogs.alert({
        title: '取消拆书失败',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [bookBreakdownCancelId, bookBreakdownCancelling, dialogs]);

  const handleOpenBookBreakdown = useCallback(
    async (format: 'json' | 'markdown' = 'markdown') => {
      if (!activeProject) return;
      const relativePath =
        format === 'json'
          ? '.storyforge/analysis/book-breakdown.json'
          : '.storyforge/analysis/book-breakdown.md';
      const path = resolveProjectRelativePath(activeProject, relativePath);
      if (path) await openFile(path, '打开拆书报告');
    },
    [activeProject, openFile],
  );

  return {
    projectRefreshVersion,
    welcomeDraft,
    setWelcomeDraft,
    pendingWelcomePrompt,
    handlePendingWelcomePromptConsumed,
    handleOpenProject,
    handleWelcomeSend,
    handleCreateSampleProject,
    handleNewFile,
    handleInitializeStoryProject,
    handleRefreshCanon,
    handleBookBreakdown,
    handleOpenBookBreakdown,
    bookBreakdown,
    bookBreakdownRunning,
    bookBreakdownCancelling,
    handleCancelBookBreakdown,
  };
}

export type BookBreakdownPreview = {
  status?: string;
  stale?: boolean;
  chapter_count?: number;
  selected_chapters?: Array<{ title?: string; reason?: string; global_index?: number }>;
  analysis?: Record<string, { status?: string; summary?: string }>;
  markdown_path?: string;
};

export type ProjectCommands = ReturnType<typeof useProjectCommands>;
