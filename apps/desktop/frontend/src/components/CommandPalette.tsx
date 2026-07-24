/**
 * 命令面板（Ctrl+P 打开文件 / Ctrl+Shift+P 全部命令）
 * 文件列表来自真实项目目录；命令绑定到真实动作，不接假数据。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { TauriFileSystem, FileEntry } from '../lib/tauri-fs';
import { projectBasename, relativePathInsideProject } from '../lib/project-context';
import { isOpenableProjectFileEntry } from '../lib/project/entry-visibility';

export type PaletteMode = 'files' | 'commands';

type Command = {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
};

type FileLoadState =
  | { projectPath: null; status: 'idle'; files: FileEntry[] }
  | { projectPath: string; status: 'loading' | 'loaded' | 'error'; files: FileEntry[] };

type CommandPaletteProps = {
  mode: PaletteMode;
  projectPath: string | null;
  currentFile: string | null;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onOpenProject: () => void;
  onReopenWelcome: () => void;
  onInitializeProject: () => void;
  onRefreshCanon: () => void;
  onExportCurrent: () => void;
  onToggleAssistant: () => void;
  onToggleWorkspace: () => void;
  onOpenSettings: () => void;
  onFocusAssistantOnly: () => void;
  onFocusWorkspaceOnly: () => void;
  onRestoreLayout: () => void;
};

function basename(path: string): string {
  return projectBasename(path);
}

function relativeToProject(projectPath: string | null, filePath: string): string {
  return projectPath
    ? (relativePathInsideProject(projectPath, filePath) ?? basename(filePath))
    : basename(filePath);
}

export function CommandPalette({
  mode,
  projectPath,
  currentFile,
  onClose,
  onOpenFile,
  onOpenProject,
  onReopenWelcome,
  onInitializeProject,
  onRefreshCanon,
  onExportCurrent,
  onToggleAssistant,
  onToggleWorkspace,
  onOpenSettings,
  onFocusAssistantOnly,
  onFocusWorkspaceOnly,
  onRestoreLayout,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [fileLoadState, setFileLoadState] = useState<FileLoadState>({
    projectPath: null,
    status: 'idle',
    files: [],
  });
  const [fileLoadRequest, setFileLoadRequest] = useState(0);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 方向键选中项滚入视口，长列表往下选不出屏。
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Esc 挂 window：焦点落在列表项上时也能关，不只在输入框内生效。
  useEffect(() => {
    const onWindowKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  }, [onClose]);

  useEffect(() => {
    if (mode !== 'files' || !projectPath) return;
    let cancelled = false;
    void (async () => {
      try {
        const entries = await TauriFileSystem.listDir(projectPath, true);
        const md = entries
          .filter(isOpenableProjectFileEntry)
          .sort((a, b) => a.path.localeCompare(b.path));
        if (!cancelled) {
          setFileLoadState({ projectPath, status: 'loaded', files: md });
        }
      } catch {
        if (!cancelled) {
          setFileLoadState({ projectPath, status: 'error', files: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileLoadRequest, mode, projectPath]);

  const files = useMemo(
    () => (fileLoadState.projectPath === projectPath ? fileLoadState.files : []),
    [fileLoadState.files, fileLoadState.projectPath, projectPath],
  );
  const filesLoading =
    mode === 'files' &&
    projectPath !== null &&
    (fileLoadState.projectPath !== projectPath || fileLoadState.status === 'loading');
  const filesError =
    mode === 'files' &&
    projectPath !== null &&
    fileLoadState.projectPath === projectPath &&
    fileLoadState.status === 'error';

  const retryFileLoad = () => {
    if (!projectPath) return;
    setFileLoadState({ projectPath, status: 'loading', files: [] });
    setFileLoadRequest((request) => request + 1);
  };

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'open-project', title: '打开项目…', hint: 'Ctrl+O', run: onOpenProject },
    ];
    if (!projectPath) {
      list.push({ id: 'show-welcome', title: '显示欢迎页', run: onReopenWelcome });
    }
    if (projectPath) {
      list.push({
        id: 'initialize-story-project',
        title: '初始化小说项目结构',
        hint: basename(projectPath),
        run: onInitializeProject,
      });
      list.push({
        id: 'canon-refresh',
        title: '刷新 Canon 事实卡（dossier）',
        hint: '派生参考信号',
        run: onRefreshCanon,
      });
    }
    if (currentFile) {
      list.push({
        id: 'export-current',
        title: '导出当前稿',
        hint: relativeToProject(projectPath, currentFile),
        run: onExportCurrent,
      });
    }
    list.push(
      { id: 'toggle-assistant', title: '切换：对话栏', run: onToggleAssistant },
      { id: 'toggle-workspace', title: '切换：资源管理器', run: onToggleWorkspace },
      { id: 'open-settings', title: '打开：设置', run: onOpenSettings },
    );
    list.push(
      { id: 'focus-assistant-only', title: '只保留：对话栏', run: onFocusAssistantOnly },
      { id: 'focus-workspace-only', title: '只保留：资源管理器', run: onFocusWorkspaceOnly },
      { id: 'restore-layout', title: '恢复：完整布局', run: onRestoreLayout },
    );
    return list;
  }, [
    currentFile,
    projectPath,
    onOpenProject,
    onReopenWelcome,
    onInitializeProject,
    onRefreshCanon,
    onExportCurrent,
    onToggleAssistant,
    onToggleWorkspace,
    onOpenSettings,
    onFocusAssistantOnly,
    onFocusWorkspaceOnly,
    onRestoreLayout,
  ]);

  const fileItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const mapped = files.map((f) => ({
      path: f.path,
      label: relativeToProject(projectPath, f.path),
    }));
    if (!q) return mapped.slice(0, 50);
    return mapped.filter((f) => f.label.toLowerCase().includes(q)).slice(0, 50);
  }, [files, query, projectPath]);

  const commandItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.title.toLowerCase().includes(q));
  }, [commands, query]);

  const itemCount = mode === 'files' ? fileItems.length : commandItems.length;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- query/mode 变化时重置高亮项，React18 合法模式
    setActive(0);
  }, [query, mode]);

  const choose = (index: number) => {
    if (mode === 'files') {
      const item = fileItems[index];
      if (item) {
        onOpenFile(item.path);
        onClose();
      }
    } else {
      const item = commandItems[index];
      if (item) {
        item.run();
        onClose();
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      // 焦点陷阱：面板靠 ↑↓ 导航，Tab 不外逃到背景，收回输入框。
      e.preventDefault();
      inputRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (itemCount === 0 ? 0 : (i + 1) % itemCount));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (itemCount === 0 ? 0 : (i - 1 + itemCount) % itemCount));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 sm:pt-24 animate-fade-in"
      data-testid="command-palette"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[calc(100vh-2rem)] w-[34rem] max-w-[90vw] flex-col overflow-hidden rounded-md border border-border bg-panel shadow-2xl animate-slide-up-fade"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'files' ? '打开文件' : '命令面板'}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === 'files' ? '按名称打开文件…' : '输入命令…'}
          className="w-full px-4 py-3 bg-background text-sm text-foreground outline-none border-b border-border placeholder:text-muted"
        />
        <div className="min-h-0 max-h-80 flex-1 overflow-y-auto py-1">
          {filesLoading ? (
            <p className="px-4 py-3 text-sm text-muted">正在读取项目文件…</p>
          ) : filesError ? (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="text-sm text-error">无法读取项目文件，请检查目录权限后重试。</p>
              <button
                type="button"
                className="shrink-0 text-xs text-accent hover:underline"
                data-testid="palette-retry"
                onClick={retryFileLoad}
              >
                重试
              </button>
            </div>
          ) : itemCount === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">
              {mode === 'files' && !projectPath ? '先打开一个项目' : '无匹配项'}
            </p>
          ) : mode === 'files' ? (
            fileItems.map((item, index) => (
              <button
                key={item.path}
                ref={index === active ? activeItemRef : undefined}
                data-testid="palette-item"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${
                  index === active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground hover:bg-foreground/10'
                }`}
              >
                <span className="truncate">{item.label}</span>
              </button>
            ))
          ) : (
            commandItems.map((item, index) => (
              <button
                key={item.id}
                ref={index === active ? activeItemRef : undefined}
                data-testid="palette-item"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between gap-2 ${
                  index === active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground hover:bg-foreground/10'
                }`}
              >
                <span className="truncate">{item.title}</span>
                {item.hint && (
                  <span
                    className={`text-xs flex-shrink-0 ${index === active ? 'text-accent-foreground/70' : 'text-muted'}`}
                  >
                    {item.hint}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
