import { useCallback, useEffect, useState } from 'react';
import {
  loadProjectAssistantSessions,
  RECENT_FILES_KEY,
  RECENT_PROJECTS_KEY,
  saveProjectAssistantSessions,
} from './helpers';

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
    const savedProjects = localStorage.getItem(RECENT_PROJECTS_KEY);
    const savedFiles = localStorage.getItem(RECENT_FILES_KEY);

    if (savedProjects) {
      try {
        const list = JSON.parse(savedProjects) as string[];
        if (Array.isArray(list)) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- 启动时从 localStorage 恢复项目列表，React18 合法模式
          setProjects(list);
          if (list.length > 0) setActiveProject(list[0]);
        }
      } catch {
        // Ignore corrupted cache.
      }
    }
    if (savedFiles) {
      try {
        const list = JSON.parse(savedFiles) as string[];
        if (Array.isArray(list)) setRecentFiles(list);
      } catch {
        // Ignore corrupted cache.
      }
    }
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

  const setActiveProjectAssistantSession = useCallback(
    (assistantSessionId: number | null) => {
      const project = activeProject;
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
    setActiveProjectAssistantSession,
  };
}
