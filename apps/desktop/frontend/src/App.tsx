/**
 * 桌面 IDE 主应用
 * 四栏布局：项目列表(左1) | 对话窗口(左2) | 资源管理器+未打开文件+历史(中) | 编辑器(右)
 * 完全重构，对齐期望的 UI 效果。
 */

import { useState, useEffect, useCallback } from 'react';
import { ProjectList } from './components/ProjectList';
import { ChatWindow } from './components/ChatWindow';
import { ResourceExplorer } from './components/ResourceExplorer';
import { HistoryPanel } from './components/HistoryPanel';
import { Editor } from './components/Editor';
import { ResizablePanel } from './components/ResizablePanel';
import { CommandPalette, PaletteMode } from './components/CommandPalette';
import { isTauriRuntime } from './lib/tauri-env';
import { registerSmokeProjectLoader } from './lib/smoke';
import { emitReviewCurrentFile } from './lib/assistant-events';

const DEFAULT_WIDTHS = {
  projectList: 200,
  chatWindow: 320,
  resourcePanel: 260,
};

const RECENT_PROJECTS_KEY = 'recent-projects';
const RECENT_FILES_KEY = 'recent-files';

export function App() {
  const [widths, setWidths] = useState(DEFAULT_WIDTHS);

  const [projects, setProjects] = useState<string[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [palette, setPalette] = useState<PaletteMode | null>(null);

  const [isDesktopRuntime, setIsDesktopRuntime] = useState(false);
  const [tauriMenuReady, setTauriMenuReady] = useState(false);
  const [tauriMenuError, setTauriMenuError] = useState('');
  const [smokeApiReady, setSmokeApiReady] = useState(false);

  // 恢复布局与最近项目
  useEffect(() => {
    const savedWidths = localStorage.getItem('panel-widths');
    const savedProjects = localStorage.getItem(RECENT_PROJECTS_KEY);
    const savedFiles = localStorage.getItem(RECENT_FILES_KEY);

    if (savedWidths) {
      setWidths((prev) => ({ ...prev, ...JSON.parse(savedWidths) }));
    }
    if (savedProjects) {
      try {
        const list = JSON.parse(savedProjects) as string[];
        if (Array.isArray(list)) {
          setProjects(list);
          if (list.length > 0) setActiveProject(list[0]);
        }
      } catch {
        // 忽略损坏的本地缓存
      }
    }
    if (savedFiles) {
      try {
        const list = JSON.parse(savedFiles) as string[];
        if (Array.isArray(list)) {
          setRecentFiles(list);
        }
      } catch {
        // 忽略
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('panel-widths', JSON.stringify(widths));
  }, [widths]);

  // 选择项目：切换右侧文件树上下文，清空当前文件
  const selectProject = useCallback((path: string) => {
    setActiveProject(path);
    setCurrentFile(null);
    setProjects((prev) => {
      const next = [path, ...prev.filter((item) => item !== path)].slice(0, 12);
      localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // 打开项目目录对话框
  const handleOpenProject = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title: '选择项目目录' });
      if (!selected || typeof selected !== 'string') return;
      selectProject(selected);
    } catch (error) {
      console.error('打开项目失败', error);
    }
  }, [selectProject]);

  // 冒烟入口：注入项目路径
  useEffect(() => {
    return registerSmokeProjectLoader((path: string) => {
      selectProject(path);
    });
  }, [selectProject]);

  const handleFileSelect = useCallback((filePath: string) => {
    setCurrentFile(filePath);
    setRecentFiles((prev) => {
      const next = [filePath, ...prev.filter((item) => item !== filePath)].slice(0, 20);
      localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleFileClose = useCallback(() => setCurrentFile(null), []);

  // 命令面板快捷键：Ctrl+P 打开文件，Ctrl+Shift+P 全部命令
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setPalette(e.shiftKey ? 'commands' : 'files');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 菜单与冒烟事件
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let isCancelled = false;
    const unlistenFns: Array<() => void> = [];

    const setSmokeReadyAttribute = (ready: boolean) => {
      const shell = document.querySelector('[data-testid="desktop-shell"]');
      shell?.setAttribute('data-smoke-api-ready', ready ? 'true' : 'false');
    };

    setSmokeApiReady(true);
    setSmokeReadyAttribute(true);

    const registerMenuListeners = async () => {
      let listen: typeof import('@tauri-apps/api/event').listen;
      try {
        ({ listen } = await import('@tauri-apps/api/event'));
      } catch (error) {
        setTauriMenuError(error instanceof Error ? error.message : 'Failed to import Tauri event API');
        return;
      }
      if (isCancelled) return;

      setIsDesktopRuntime(true);

      try {
        unlistenFns.push(
          await listen('menu:open-project', () => {
            void handleOpenProject();
          }),
        );
        unlistenFns.push(
          await listen('menu:save', () => {
            document.getElementById('editor-save-btn')?.click();
          }),
        );
        unlistenFns.push(
          await listen('smoke:reset-panels', () => {
            // 四栏布局无可折叠面板，无操作
          }),
        );

        setTauriMenuError('');
        setTauriMenuReady(true);
      } catch (error) {
        setTauriMenuError(error instanceof Error ? error.message : 'Failed to register Tauri menu listeners');
      }
    };

    void registerMenuListeners();

    return () => {
      isCancelled = true;
      setIsDesktopRuntime(false);
      setTauriMenuReady(false);
      setSmokeApiReady(false);
      setTauriMenuError('');
      setSmokeReadyAttribute(false);
      unlistenFns.forEach((fn) => fn());
    };
  }, [handleOpenProject]);

  return (
    <div
      className="flex h-screen bg-[#1E1E1E] text-[#CCCCCC] overflow-hidden"
      data-testid="desktop-shell"
      data-tauri-runtime={isDesktopRuntime ? 'true' : 'false'}
      data-tauri-menu-ready={tauriMenuReady ? 'true' : 'false'}
      data-smoke-api-ready={smokeApiReady ? 'true' : 'false'}
      data-tauri-menu-error={tauriMenuError}
    >
      {/* 左1：项目列表 */}
      <ResizablePanel
        defaultWidth={widths.projectList}
        minWidth={160}
        maxWidth={300}
        onWidthChange={(w) => setWidths((prev) => ({ ...prev, projectList: w }))}
        position="left"
      >
        <div className="h-full flex flex-col border-r border-[#2D2D30]" data-testid="project-list-panel">
          <ProjectList
            projects={projects}
            activeProject={activeProject}
            onSelectProject={selectProject}
            onOpenProject={handleOpenProject}
          />
        </div>
      </ResizablePanel>

      {/* 左2：对话窗口 */}
      <ResizablePanel
        defaultWidth={widths.chatWindow}
        minWidth={280}
        maxWidth={600}
        onWidthChange={(w) => setWidths((prev) => ({ ...prev, chatWindow: w }))}
        position="left"
      >
        <div className="h-full flex flex-col border-r border-[#2D2D30]" data-testid="chat-window-panel">
          <ChatWindow projectPath={activeProject} currentFile={currentFile} />
        </div>
      </ResizablePanel>

      {/* 中：资源管理器 + 未打开文件 + 历史 */}
      <ResizablePanel
        defaultWidth={widths.resourcePanel}
        minWidth={200}
        maxWidth={400}
        onWidthChange={(w) => setWidths((prev) => ({ ...prev, resourcePanel: w }))}
        position="left"
      >
        <div className="h-full flex flex-col border-r border-[#2D2D30]" data-testid="resource-panel">
          {/* 资源管理器 */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <ResourceExplorer
              projectPath={activeProject}
              currentFile={currentFile}
              onFileSelect={handleFileSelect}
            />
          </div>

          {/* 未打开文件（占位） */}
          <div className="h-[120px] border-t border-[#2D2D30] flex flex-col bg-[#252526]">
            <div className="h-[36px] px-3 border-b border-[#2D2D30] flex items-center">
              <span className="text-xs font-medium text-[#CCCCCC]">未打开文件</span>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-[#858585]">从右侧关闭文件后显示</p>
            </div>
          </div>

          {/* 历史 */}
          <div className="h-[160px] border-t border-[#2D2D30]">
            <HistoryPanel
              recentFiles={recentFiles}
              onFileSelect={handleFileSelect}
              currentFile={currentFile}
            />
          </div>
        </div>
      </ResizablePanel>

      {/* 右：编辑器 */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#1E1E1E]" data-testid="editor-panel">
        <Editor
          projectPath={activeProject}
          filePath={currentFile}
          onClose={handleFileClose}
          onToggleSidebar={() => {}}
          sidebarVisible={true}
        />
      </div>

      {palette && (
        <CommandPalette
          mode={palette}
          projectPath={activeProject}
          currentFile={currentFile}
          onClose={() => setPalette(null)}
          onOpenFile={handleFileSelect}
          onOpenProject={handleOpenProject}
          onReviewCurrent={() => {
            emitReviewCurrentFile();
          }}
          onToggleProject={() => {}}
          onToggleAssistant={() => {}}
          onToggleWorkspace={() => {}}
        />
      )}
    </div>
  );
}
