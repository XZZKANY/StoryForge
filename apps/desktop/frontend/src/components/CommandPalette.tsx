/**
 * 命令面板（Ctrl+P 打开文件 / Ctrl+Shift+P 全部命令）
 * 文件列表来自真实项目目录；命令绑定到真实动作，不接假数据。
 * fuzzy 匹配：子序列匹配 + 匹配位置高亮，比纯子串包含更宽容。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { TauriFileSystem, FileEntry } from '../lib/tauri-fs';
import { projectBasename, relativePathInsideProject } from '../lib/project-context';
import { isOpenableProjectFileEntry } from '../lib/project/entry-visibility';
import { Command as CommandIcon, FileText } from './icons/shell-icons';

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
  onShowShortcuts?: () => void;
  onFocusAssistantOnly: () => void;
  onFocusWorkspaceOnly: () => void;
  onRestoreLayout: () => void;
  onToggleFontMode: () => void;
  onCycleProseMeasure: () => void;
  fontModeLabel: string;
  proseMeasureLabel: string;
};

function basename(path: string): string {
  return projectBasename(path);
}

function relativeToProject(projectPath: string | null, filePath: string): string {
  return projectPath
    ? (relativePathInsideProject(projectPath, filePath) ?? basename(filePath))
    : basename(filePath);
}

/** fuzzy 子序列匹配：query 的每个字符按顺序出现在 target 中即可，返回匹配位置用于高亮。 */
function fuzzyMatch(target: string, query: string): number[] | null {
  const t = target.toLowerCase();
  const q = query.toLowerCase();
  const positions: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return null;
    positions.push(found);
    ti = found + 1;
  }
  return positions;
}

/** fuzzy 评分：匹配越紧凑（首尾跨度小）、越靠前，分越高。 */
function fuzzyScore(target: string, positions: number[]): number {
  if (positions.length === 0) return 0;
  const span = positions[positions.length - 1] - positions[0] + 1;
  const density = positions.length / span;
  const startBonus = positions[0] === 0 ? 2 : positions[0] < 3 ? 1 : 0;
  const lengthPenalty = 1 / (1 + target.length * 0.01);
  return density * 10 + startBonus + lengthPenalty;
}

/** 将 label 按匹配位置拆分为高亮片段。 */
function HighlightedLabel({ label, positions }: { label: string; positions: number[] | null }) {
  if (!positions || positions.length === 0) return <span className="truncate">{label}</span>;
  const posSet = new Set(positions);
  const parts: { text: string; match: boolean }[] = [];
  let current = { text: '', match: posSet.has(0) };
  for (let i = 0; i < label.length; i++) {
    const isMatch = posSet.has(i);
    if (isMatch !== current.match) {
      parts.push(current);
      current = { text: '', match: isMatch };
    }
    current.text += label[i];
  }
  parts.push(current);
  return (
    <span className="truncate">
      {parts.map((part, i) =>
        part.match ? (
          <span key={i} className="font-semibold text-agent">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
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
  onShowShortcuts,
  onFocusAssistantOnly,
  onFocusWorkspaceOnly,
  onRestoreLayout,
  onToggleFontMode,
  onCycleProseMeasure,
  fontModeLabel,
  proseMeasureLabel,
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
      { id: 'open-project', title: '打开项目…', hint: 'Ctrl O', run: onOpenProject },
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
    if (onShowShortcuts) {
      list.push({ id: 'show-shortcuts', title: '帮助：快捷键速查', run: onShowShortcuts });
    }
    list.push(
      { id: 'focus-assistant-only', title: '只保留：对话栏', run: onFocusAssistantOnly },
      { id: 'focus-workspace-only', title: '只保留：资源管理器', run: onFocusWorkspaceOnly },
      { id: 'restore-layout', title: '恢复：完整布局', run: onRestoreLayout },
    );
    list.push(
      {
        id: 'toggle-font-mode',
        title: '正文：切换字体模式（格子 / 书稿）',
        hint: fontModeLabel,
        run: onToggleFontMode,
      },
      {
        id: 'cycle-prose-measure',
        title: '正文：切换行宽',
        hint: proseMeasureLabel,
        run: onCycleProseMeasure,
      },
    );
    return list;
  }, [
    currentFile,
    projectPath,
    fontModeLabel,
    proseMeasureLabel,
    onToggleFontMode,
    onCycleProseMeasure,
    onOpenProject,
    onReopenWelcome,
    onInitializeProject,
    onRefreshCanon,
    onExportCurrent,
    onToggleAssistant,
    onToggleWorkspace,
    onOpenSettings,
    onShowShortcuts,
    onFocusAssistantOnly,
    onFocusWorkspaceOnly,
    onRestoreLayout,
  ]);

  const fileItems = useMemo(() => {
    const q = query.trim();
    const mapped = files.map((f) => ({
      path: f.path,
      label: relativeToProject(projectPath, f.path),
    }));
    if (!q) return mapped.slice(0, 50).map((item) => ({ ...item, positions: null as number[] | null }));
    return mapped
      .map((item) => {
        const positions = fuzzyMatch(item.label, q);
        return { ...item, positions };
      })
      .filter((item) => item.positions !== null)
      .sort((a, b) => fuzzyScore(b.label, b.positions!) - fuzzyScore(a.label, a.positions!))
      .slice(0, 50);
  }, [files, query, projectPath]);

  const commandItems = useMemo(() => {
    const q = query.trim();
    if (!q) return commands.map((item) => ({ ...item, positions: null as number[] | null }));
    return commands
      .map((item) => {
        const positions = fuzzyMatch(item.title, q);
        return { ...item, positions };
      })
      .filter((item) => item.positions !== null)
      .sort((a, b) => fuzzyScore(b.title, b.positions!) - fuzzyScore(a.title, a.positions!));
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

  const modeIcon = mode === 'files' ? <FileText size={14} strokeWidth={1.6} /> : <CommandIcon size={14} strokeWidth={1.6} />;
  const modeLabel = mode === 'files' ? '打开文件' : '命令';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 sm:pt-24 animate-fade-in"
      data-testid="command-palette"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[calc(100vh-2rem)] w-[34rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-dialog animate-slide-up-fade"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'files' ? '打开文件' : '命令面板'}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* 输入区：模式图标 + 输入框 */}
        <div className="flex items-center gap-2.5 border-b border-border bg-background px-4">
          <span className="flex-shrink-0 text-subtle">{modeIcon}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'files' ? '按名称打开文件…' : '输入命令…'}
            className="h-11 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-subtle"
          />
          <kbd className="flex-shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-3xs text-subtle">
            {mode === 'files' ? 'Ctrl P' : 'Ctrl ⇧ P'}
          </kbd>
        </div>

        {/* 结果列表 */}
        <div className="min-h-0 max-h-80 flex-1 overflow-y-auto py-1">
          {filesLoading ? (
            <p className="px-4 py-3 text-sm text-muted">正在读取项目文件…</p>
          ) : filesError ? (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="text-sm text-error">无法读取项目文件，请检查目录权限后重试。</p>
              <button
                type="button"
                className="shrink-0 text-xs text-agent hover:underline"
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
                className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm ${
                  index === active
                    ? 'bg-agent/10 text-foreground'
                    : 'text-foreground hover:bg-elevated'
                }`}
              >
                <FileText size={14} strokeWidth={1.6} className="flex-shrink-0 text-subtle" />
                <HighlightedLabel label={item.label} positions={item.positions} />
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
                className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm ${
                  index === active
                    ? 'bg-agent/10 text-foreground'
                    : 'text-foreground hover:bg-elevated'
                }`}
              >
                <HighlightedLabel label={item.title} positions={item.positions} />
                {item.hint && (
                  <kbd
                    className={`flex-shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-3xs ${
                      index === active
                        ? 'border-agent/30 text-agent'
                        : 'border-border text-subtle'
                    }`}
                  >
                    {item.hint}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer：模式指示 + 结果计数 */}
        <div className="flex items-center justify-between border-t border-border px-4 py-1.5 text-3xs text-subtle">
          <span>{modeLabel}</span>
          <span>{itemCount > 0 ? `${itemCount} 项` : ''}</span>
        </div>
      </div>
    </div>
  );
}
