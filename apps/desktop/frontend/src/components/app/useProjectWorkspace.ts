import { useCallback, useEffect, useState } from 'react';
import {
  loadProjectAssistantSessions,
  RECENT_FILES_KEY,
  RECENT_PROJECTS_KEY,
  saveProjectAssistantSessions,
} from './helpers';
import { isTauriRuntime } from '../../lib/tauri-env';
import { TauriFileSystem } from '../../lib/tauri-fs';

/** 过滤掉磁盘上已不存在的路径；校验出错时保守保留，避免误删有效项。 */
async function filterExistingPaths(paths: string[]): Promise<string[]> {
  const checked = await Promise.all(
    paths.map(async (path) => {
      try {
        return (await TauriFileSystem.pathExists(path)) ? path : null;
      } catch {
        return path;
      }
    }),
  );
  return checked.filter((path): path is string => path !== null);
}

function parseStringList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as string[]) : [];
  } catch {
    return [];
  }
}

export function useProjectWorkspace({
  onProjectSelected,
  onFileSelected,
}: {
  onProjectSelected: () => void;
  onFileSelected: () => void;
}) {
  const [projects, setProjects] = useState<string[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [projectAssistantSessions, setProjectAssistantSessions] = useState<Record<string, number>>(
    () => loadProjectAssistantSessions(),
  );

  useEffect(() => {
    const projectList = parseStringList(localStorage.getItem(RECENT_PROJECTS_KEY));
    const fileList = parseStringList(localStorage.getItem(RECENT_FILES_KEY));

    // 非 Tauri 运行时（浏览器/测试）无真实文件系统可校验，按旧行为直接恢复。
    if (!isTauriRuntime()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 启动时从 localStorage 恢复，React18 合法模式
      setProjects(projectList);
      // 不自动打开最近项目：启动落到 pane-start 空起始态，最近项目留侧栏供一键重开。
      setRecentFiles(fileList);
      return;
    }

    // Tauri 桌面端：剔除磁盘上已不存在的最近项目/文件（如被清理的 smoke 临时项目），
    // 避免死链堆在项目库里，并防止启动时自动打开一个不存在的项目。
    let cancelled = false;
    void (async () => {
      const [existingProjects, existingFiles] = await Promise.all([
        filterExistingPaths(projectList),
        filterExistingPaths(fileList),
      ]);
      if (cancelled) return;
      setProjects(existingProjects);
      // 不自动打开最近项目：启动落到 pane-start 空起始态，最近项目留侧栏供一键重开。
      setRecentFiles(existingFiles);
      if (existingProjects.length !== projectList.length) {
        localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(existingProjects));
      }
      if (existingFiles.length !== fileList.length) {
        localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(existingFiles));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectProject = useCallback(
    (path: string) => {
      setActiveProject(path);
      setCurrentFile(null);
      onProjectSelected();
      setProjects((prev) => {
        const next = [path, ...prev.filter((item) => item !== path)].slice(0, 12);
        localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
        return next;
      });
    },
    [onProjectSelected],
  );

  const selectFile = useCallback(
    (filePath: string) => {
      setCurrentFile(filePath);
      onFileSelected();
      setRecentFiles((prev) => {
        const next = [filePath, ...prev.filter((item) => item !== filePath)].slice(0, 20);
        localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next));
        return next;
      });
    },
    [onFileSelected],
  );

  const closeFile = useCallback(() => {
    setCurrentFile(null);
  }, []);

  /** 从「最近项目」里移除一条（如误入的临时/测试项目）；若它正是当前项目则退回起始态。 */
  const removeProject = useCallback((path: string) => {
    setProjects((prev) => {
      const next = prev.filter((item) => item !== path);
      localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
      return next;
    });
    setActiveProject((prev) => (prev === path ? null : prev));
  }, []);

  const setActiveProjectAssistantSession = useCallback(
    (assistantSessionId: number | null, projectOverride?: string) => {
      // projectOverride 供侧栏「切换/新建会话」在 selectProject 同一事件里使用，
      // 此时 activeProject state 尚未更新到目标项目。
      const project = projectOverride ?? activeProject;
      if (!project) return;
      setProjectAssistantSessions((prev) => {
        const next = { ...prev };
        if (assistantSessionId) {
          next[project] = assistantSessionId;
        } else {
          delete next[project];
        }
        saveProjectAssistantSessions(next);
        return next;
      });
    },
    [activeProject],
  );

  return {
    projects,
    activeProject,
    currentFile,
    recentFiles,
    projectAssistantSessions,
    selectProject,
    selectFile,
    closeFile,
    removeProject,
    setActiveProjectAssistantSession,
  };
}
