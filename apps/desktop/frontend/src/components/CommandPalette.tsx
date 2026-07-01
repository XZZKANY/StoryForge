/**
 * 命令面板（Ctrl+P 打开文件 / Ctrl+Shift+P 全部命令）
 * 文件列表来自真实项目目录；命令绑定到真实动作，不接假数据。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { TauriFileSystem, FileEntry } from '../lib/tauri-fs';

export type PaletteMode = 'files' | 'commands';

type Command = {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
};

type CommandPaletteProps = {
  mode: PaletteMode;
  projectPath: string | null;
  currentFile: string | null;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onOpenProject: () => void;
  onInitializeProject: () => void;
  onExportCurrent: () => void;
  onToggleAssistant: () => void;
  onToggleWorkspace: () => void;
  onOpenSettings: () => void;
  onFocusAssistantOnly: () => void;
  onFocusWorkspaceOnly: () => void;
  onRestoreLayout: () => void;
};

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function relativeToProject(projectPath: string | null, filePath: string): string {
  if (!projectPath) return basename(filePath);
  const root = projectPath.replace(/[/\\]+$/, '');
  return filePath.startsWith(root)
    ? filePath.slice(root.length).replace(/^[/\\]+/, '')
    : basename(filePath);
}

export function CommandPalette({
  mode,
  projectPath,
  currentFile,
  onClose,
  onOpenFile,
  onOpenProject,
  onInitializeProject,
  onExportCurrent,
  onToggleAssistant,
  onToggleWorkspace,
  onOpenSettings,
  onFocusAssistantOnly,
  onFocusWorkspaceOnly,
  onRestoreLayout,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (mode !== 'files' || !projectPath) return;
    let cancelled = false;
    void (async () => {
      try {
        const entries = await TauriFileSystem.listDir(projectPath, true);
        const md = entries
          .filter((e) => !e.isDir && (e.extension === 'md' || e.extension === 'markdown'))
          .filter((e) => !/[/\\]\.storyforge[/\\]/.test(e.path))
          .sort((a, b) => a.path.localeCompare(b.path));
        if (!cancelled) setFiles(md);
      } catch {
        if (!cancelled) setFiles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, projectPath]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'open-project', title: '打开项目…', hint: 'Ctrl+O', run: onOpenProject },
    ];
    if (projectPath) {
      list.push({
        id: 'initialize-story-project',
        title: '初始化小说项目结构',
        hint: basename(projectPath),
        run: onInitializeProject,
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
      { id: 'toggle-assistant', title: '切换：AI 交互区', run: onToggleAssistant },
      { id: 'toggle-workspace', title: '切换：文件工作区', run: onToggleWorkspace },
      { id: 'open-settings', title: '打开：设置', run: onOpenSettings },
      { id: 'focus-assistant-only', title: '只保留：AI 交互区', run: onFocusAssistantOnly },
      { id: 'focus-workspace-only', title: '只保留：文件工作区', run: onFocusWorkspaceOnly },
      { id: 'restore-layout', title: '恢复：完整布局', run: onRestoreLayout },
    );
    return list;
  }, [
    currentFile,
    projectPath,
    onOpenProject,
    onInitializeProject,
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
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
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
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/50 animate-fade-in"
      data-testid="command-palette"
      onMouseDown={onClose}
    >
      <div
        className="w-[34rem] max-w-[90vw] rounded-xl border border-border bg-panel shadow-2xl overflow-hidden animate-slide-up-fade"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={mode === 'files' ? '按名称打开文件…' : '输入命令…'}
          className="w-full px-4 py-3 bg-background text-sm text-foreground outline-none border-b border-border placeholder:text-muted"
        />
        <div className="max-h-80 overflow-y-auto py-1">
          {itemCount === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">
              {mode === 'files' && !projectPath ? '先打开一个项目' : '无匹配项'}
            </p>
          ) : mode === 'files' ? (
            fileItems.map((item, index) => (
              <button
                key={item.path}
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
