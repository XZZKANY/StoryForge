import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadProjectAssistantSessions,
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
    return Array.isArray(list)
      ? [
          ...new Set(
            list.filter(
              (path): path is string => typeof path === 'string' && path.trim().length > 0,
            ),
          ),
        ]
      : [];
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
  const [projects, setProjects] = useState(() =>
    parseStringList(localStorage.getItem(RECENT_PROJECTS_KEY)),
  );
  const initialProjectsRef = useRef(projects);
  const selectedSinceStartupRef = useRef(new Set<string>());
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [projectAssistantSessions, setProjectAssistantSessions] = useState<Record<string, number>>(
    () => loadProjectAssistantSessions(),
  );

  useEffect(() => {
    // 最近列表先由同一 owner 展示；异步校验只能删除仍属于启动基线的失效路径。
    if (!isTauriRuntime()) return;
    const projectList = initialProjectsRef.current;
    const baseline = new Set(projectList);
    let cancelled = false;
    void (async () => {
      const existing = new Set(await filterExistingPaths(projectList));
      if (cancelled) return;
      setProjects((current) => {
        const next = current.filter(
          (path) =>
            !baseline.has(path) || existing.has(path) || selectedSinceStartupRef.current.has(path),
        );
        // 保留当下的顺序和新选中/新建的路径；只筛 current，绝不从旧快照复活已移除项。
        localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectProject = useCallback(
    (path: string) => {
      selectedSinceStartupRef.current.add(path);
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
    projectAssistantSessions,
    selectProject,
    selectFile,
    closeFile,
    removeProject,
    setActiveProjectAssistantSession,
  };
}
