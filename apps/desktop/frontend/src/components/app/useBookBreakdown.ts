import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { executeIdeCommand } from '../../lib/api-client';
import { flushActiveEditorToDisk } from '../../lib/assistant-events';
import { resolveProjectRelativePath } from '../../lib/project-context';
import { invalidateFileSystemCache, TauriFileSystem } from '../../lib/tauri-fs';
import {
  adoptableSkills,
  adoptWritingSkills,
  BREAKDOWN_SKILLS_PATH,
} from '../../lib/writing-skill-adopt';
import type { AppDialogApi } from './AppDialog';

export type BookBreakdownPreview = {
  status?: string;
  stale?: boolean;
  chapter_count?: number;
  selected_chapters?: Array<{ title?: string; reason?: string; global_index?: number }>;
  analysis?: Record<string, { status?: string; summary?: string }>;
  markdown_path?: string;
  /** 拆书顺带拆出的写法 skill（作者点「放进 写法/」才落进作品）。 */
  writing_skills?: { status?: string; count?: number; names?: string[]; error?: string };
};

type ProjectLifetime = { projectPath: string | null };
type BreakdownRequest = {
  analysisId: string;
  lifetime: ProjectLifetime;
  cancelling: boolean;
};

type UseBookBreakdownOptions = {
  activeProject: string | null;
  currentFile: string | null;
  dirtyFiles: Set<string>;
  dialogs: AppDialogApi;
  openProject: () => Promise<void>;
  openFile: (path: string, actionLabel?: string) => Promise<void>;
  onReportGenerated: () => void;
};

export function useBookBreakdown({
  activeProject,
  currentFile,
  dirtyFiles,
  dialogs,
  openProject,
  openFile,
  onReportGenerated,
}: UseBookBreakdownOptions) {
  const [loadedReport, setLoadedReport] = useState<{
    projectPath: string;
    report: BookBreakdownPreview | null;
  } | null>(null);
  const [bookBreakdownRunning, setBookBreakdownRunning] = useState(false);
  const [bookBreakdownCancelling, setBookBreakdownCancelling] = useState(false);
  const projectLifetime = useRef<ProjectLifetime | null>(null);
  const activeRequest = useRef<BreakdownRequest | null>(null);
  const reportRevision = useRef(0);

  // 按已提交的项目生命周期隔离，A→B→A 也不是同一代；不在 render 中改 ref。
  useLayoutEffect(() => {
    projectLifetime.current = { projectPath: activeProject };
    return () => {
      projectLifetime.current = null;
    };
  }, [activeProject]);

  useEffect(() => {
    if (!activeProject) return;
    const lifetime = projectLifetime.current;
    const revision = reportRevision.current;
    const isCurrent = () =>
      projectLifetime.current === lifetime && reportRevision.current === revision;
    const loadReport = async () => {
      try {
        const raw = await TauriFileSystem.readProjectFile(
          activeProject,
          '.storyforge/analysis/book-breakdown.json',
        );
        if (!isCurrent()) return;
        const report = JSON.parse(raw) as BookBreakdownPreview;
        const statusResult = await executeIdeCommand('book.breakdown.status', {
          project_root: activeProject,
        });
        const statusPayload = (statusResult.payload ?? {}) as Record<string, unknown>;
        const status = (statusPayload.breakdown ?? {}) as Record<string, unknown>;
        if (!isCurrent()) return;
        setLoadedReport({
          projectPath: activeProject,
          report: {
            ...report,
            stale: status.stale === true,
            status: typeof status.status === 'string' ? status.status : report.status,
            markdown_path:
              typeof status.markdown_path === 'string'
                ? status.markdown_path
                : '.storyforge/analysis/book-breakdown.md',
          },
        });
      } catch {
        if (isCurrent()) setLoadedReport({ projectPath: activeProject, report: null });
      }
    };
    void loadReport();
  }, [activeProject]);

  const handleBookBreakdown = useCallback(async () => {
    if (!activeProject) {
      await openProject();
      return;
    }
    const lifetime = projectLifetime.current;
    if (!lifetime || lifetime.projectPath !== activeProject || activeRequest.current) return;
    const request: BreakdownRequest = {
      analysisId: crypto.randomUUID(),
      lifetime,
      cancelling: false,
    };
    activeRequest.current = request;
    const isCurrent = () =>
      activeRequest.current === request && projectLifetime.current === request.lifetime;
    setBookBreakdownCancelling(false);
    setBookBreakdownRunning(true);
    try {
      if (currentFile && dirtyFiles.has(currentFile)) await flushActiveEditorToDisk(currentFile);
      if (!isCurrent()) return;
      const result = await executeIdeCommand('book.breakdown', {
        project_root: activeProject,
        target_count: 8,
        analysis_id: request.analysisId,
        writing_skills: true,
      });
      if (!isCurrent()) return;
      const payload = (result.payload ?? {}) as Record<string, unknown>;
      const breakdown = (payload.breakdown ?? {}) as Record<string, unknown>;
      // 已接受生成结果后，先前开始的磁盘读取（包括失败）不得再覆盖它。
      reportRevision.current += 1;
      setLoadedReport({ projectPath: activeProject, report: breakdown as BookBreakdownPreview });
      invalidateFileSystemCache(activeProject);
      onReportGenerated();
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
          ...skillsSummary(breakdown.writing_skills),
        ].join('\n'),
      });
      if (!isCurrent()) return;
      const reportPath = resolveProjectRelativePath(
        activeProject,
        '.storyforge/analysis/book-breakdown.md',
      );
      if (reportPath) await openFile(reportPath, '打开拆书报告');
    } catch (error) {
      if (isCurrent()) {
        await dialogs.alert({
          title: '生成拆书报告失败',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      // 界面投递虽已过期，运行仍须释放自己的单 in-flight 占用。
      if (activeRequest.current === request) {
        activeRequest.current = null;
        if (projectLifetime.current) {
          setBookBreakdownRunning(false);
          setBookBreakdownCancelling(false);
        }
      }
    }
  }, [activeProject, currentFile, dialogs, dirtyFiles, onReportGenerated, openFile, openProject]);

  const handleCancelBookBreakdown = useCallback(async () => {
    const request = activeRequest.current;
    const lifetime = projectLifetime.current;
    if (!request || !lifetime || request.cancelling) return;
    request.cancelling = true;
    setBookBreakdownCancelling(true);
    const isCurrent = () =>
      activeRequest.current === request && projectLifetime.current === lifetime;
    const resetCancelling = () => {
      if (activeRequest.current !== request) return;
      request.cancelling = false;
      if (projectLifetime.current) setBookBreakdownCancelling(false);
    };
    try {
      const result = await executeIdeCommand('book.breakdown.cancel', {
        analysis_id: request.analysisId,
      });
      const payload = (result.payload ?? {}) as Record<string, unknown>;
      const breakdown = (payload.breakdown ?? {}) as Record<string, unknown>;
      if (breakdown.cancellation_requested !== true) {
        resetCancelling();
        if (isCurrent()) {
          await dialogs.alert({
            title: '拆书无法取消',
            message: '任务可能已经结束，请查看当前报告状态。',
          });
        }
      }
    } catch (error) {
      resetCancelling();
      if (isCurrent()) {
        await dialogs.alert({
          title: '取消拆书失败',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, [dialogs]);

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

  const handleAdoptBreakdownSkills = useCallback(async () => {
    if (!activeProject) return;
    const lifetime = projectLifetime.current;
    const isCurrent = () => projectLifetime.current === lifetime;
    try {
      const path = resolveProjectRelativePath(activeProject, BREAKDOWN_SKILLS_PATH);
      if (!path) throw new Error('找不到拆书产出的写法。');
      const skills = adoptableSkills(await TauriFileSystem.readFile(path));
      if (!skills.length) throw new Error('这次拆书没有可放进 写法/ 的 skill。');
      const { created, skipped } = await adoptWritingSkills(activeProject, skills);
      if (!isCurrent()) return;
      invalidateFileSystemCache(activeProject);
      onReportGenerated();
      await dialogs.alert({
        title: created.length ? '写法已放进 写法/' : '写法没有放进去',
        message: [
          created.length ? `新建：${created.map((skill) => skill.name).join('、')}` : '',
          skipped.length
            ? `同名已有、没有覆盖：${skipped.map((skill) => skill.name).join('、')}`
            : '',
          '之后写章时，章纲会按章挑用；可以直接改这些文件，或删掉不要的。',
        ]
          .filter(Boolean)
          .join('\n'),
      });
      const first =
        created[0] && resolveProjectRelativePath(activeProject, created[0].relativePath);
      if (isCurrent() && first) await openFile(first, '打开写法');
    } catch (error) {
      if (isCurrent())
        await dialogs.alert({
          title: '放进 写法/ 失败',
          message: error instanceof Error ? error.message : String(error),
        });
    }
  }, [activeProject, dialogs, onReportGenerated, openFile]);

  return {
    bookBreakdown: loadedReport?.projectPath === activeProject ? loadedReport.report : null,
    bookBreakdownRunning,
    bookBreakdownCancelling,
    handleBookBreakdown,
    handleCancelBookBreakdown,
    handleOpenBookBreakdown,
    handleAdoptBreakdownSkills,
  };
}

function skillsSummary(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const skills = value as { count?: unknown; error?: unknown };
  if (typeof skills.count === 'number' && skills.count > 0)
    return ['', `拆出 ${skills.count} 份写法 skill：在作品档案里点「放进 写法/」才会落进作品。`];
  const reason = typeof skills.error === 'string' ? skills.error : '原因不明';
  return ['', `这次没拆出写法 skill（${reason}）。`];
}
