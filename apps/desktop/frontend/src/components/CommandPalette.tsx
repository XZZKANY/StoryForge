/**
 * 命令面板（Ctrl+P 打开文件 / Ctrl+Shift+P 全部命令）
 * 文件列表来自真实项目目录；命令绑定到真实动作，不接假数据。
 * fuzzy 匹配：子序列匹配 + 匹配位置高亮，比纯子串包含更宽容。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { TauriFileSystem, FileEntry } from '../lib/tauri-fs';
import { projectBasename, relativePathInsideProject } from '../lib/project-context';
import { isOpenableProjectFileEntry } from '../lib/project/entry-visibility';
import { emitEditorCommand } from '../lib/assistant-events';
import { entryName, parentDir } from '../lib/fs-path-ops';
import { isSameOrInsidePath } from './app/editor-tabs-state';
import type { FileTreeActions } from './app/useFileTreeActions';
import { Command as CommandIcon, FileText } from './icons/shell-icons';
import { VIEW_ENTRIES } from './shell/ActivityBar';
import type { SidePanelView } from './shell/useShellState';
import { Button } from './ui';

export type PaletteMode = 'files' | 'commands';

type Command = {
  id: string;
  title: string;
  /** 说明性小字（项目路径、当前状态等），纯文本渲染。 */
  hint?: string;
  /** 真实快捷键，才用 kbd 样式。 */
  shortcut?: string;
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
  /** 左栏各视图（作品 / 手稿 / 资源管理器 / 知识收件箱 / 搜索 / 观测镜）；未开作品时不传。 */
  onShowView?: (view: SidePanelView) => void;
  fileActions?: Pick<FileTreeActions, 'onNewFile' | 'onRename'>;
  onNewSession?: () => void;
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
          <span key={i} className="font-semibold text-foreground underline underline-offset-2">
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
  onShowView,
  fileActions,
  onNewSession,
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
      if (event.key === 'Escape' && !event.isComposing) {
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
        const entries = await TauriFileSystem.listProjectDir(projectPath, projectPath, true);
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
      { id: 'open-project', title: '打开本地作品…', shortcut: 'Ctrl O', run: onOpenProject },
    ];
    list.push({ id: 'project-library', title: '打开作品库', run: onReopenWelcome });
    if (projectPath && fileActions) {
      // 与左栏顶部「新建文件」同一落点：当前文件所在的文件夹，没开文件就是作品根目录。
      const dir =
        currentFile && isSameOrInsidePath(currentFile, projectPath)
          ? parentDir(currentFile)
          : projectPath;
      list.push({
        id: 'new-file',
        title: '新建文件',
        hint: dir === projectPath ? '在作品根目录' : `在「${entryName(dir)}」里`,
        run: () => void fileActions.onNewFile(dir),
      });
    }
    if (currentFile) {
      const relative = relativeToProject(projectPath, currentFile);
      if (fileActions) {
        list.push({
          id: 'rename-current',
          title: '重命名当前文件',
          hint: relative,
          run: () => void fileActions.onRename(currentFile, false),
        });
      }
      list.push(
        {
          id: 'toggle-history',
          title: '切换：版本历史',
          hint: relative,
          shortcut: 'Ctrl Shift H',
          run: () => emitEditorCommand('toggle-history'),
        },
        { id: 'export-current', title: '导出当前稿', hint: relative, run: onExportCurrent },
      );
    }
    if (projectPath && onNewSession) {
      list.push({ id: 'new-session', title: '新建会话', run: onNewSession });
    }
    if (onShowView) {
      for (const entry of VIEW_ENTRIES) {
        if (entry.projectOnly && !projectPath) continue;
        list.push({
          id: `show-view-${entry.view}`,
          title: `打开：${entry.label}`,
          shortcut: entry.title.match(/·\s*(.+)$/)?.[1],
          run: () => onShowView(entry.view),
        });
      }
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
    if (projectPath) {
      list.push(
        {
          id: 'initialize-story-project',
          title: '补齐作品目录',
          hint: '正文 / 大纲 / 人物 / 设定等，已有的不动',
          run: onInitializeProject,
        },
        {
          id: 'canon-refresh',
          title: '刷新设定事实卡',
          hint: '按设定重新整理一遍，不改正文',
          run: onRefreshCanon,
        },
      );
    }
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
    onShowView,
    fileActions,
    onNewSession,
  ]);

  const fileItems = useMemo(() => {
    const q = query.trim();
    const mapped = files.map((f) => ({
      path: f.path,
      label: relativeToProject(projectPath, f.path),
    }));
    if (!q)
      return mapped.slice(0, 50).map((item) => ({ ...item, positions: null as number[] | null }));
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
    // 输入法选字的回车不是「执行」：组字中的键一律交给输入法。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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

  const modeIcon =
    mode === 'files' ? (
      <FileText size={14} strokeWidth={1.6} />
    ) : (
      <CommandIcon size={14} strokeWidth={1.6} />
    );
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
        <div className="sf-input-shell flex items-center gap-2.5 border-b border-border bg-background px-4 focus-within:border-accent">
          <span className="flex-shrink-0 text-subtle">{modeIcon}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'files' ? '按名称打开文件…' : '输入命令…'}
            aria-label={mode === 'files' ? '按名称打开文件' : '输入命令'}
            className="sf-inner-input h-11 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-subtle"
            // P2-E：列表用 listbox 语义，输入框作为 combobox 指向它，方向键走 aria-activedescendant。
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="palette-listbox"
            aria-activedescendant={itemCount > 0 ? `palette-option-${active}` : undefined}
          />
          <kbd className="flex-shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-3xs text-subtle">
            {mode === 'files' ? 'Ctrl P' : 'Ctrl ⇧ P'}
          </kbd>
        </div>

        {/* 结果列表 */}
        <div
          id="palette-listbox"
          role="listbox"
          aria-label={mode === 'files' ? '文件结果' : '命令结果'}
          className="min-h-0 max-h-80 flex-1 overflow-y-auto py-1"
        >
          {filesLoading ? (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted">
              <span className="relative inline-block h-3.5 w-3.5 flex-shrink-0">
                <span className="sf-button-spinner" aria-hidden="true" />
              </span>
              正在读取作品文件…
            </p>
          ) : filesError ? (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="text-sm text-error">无法读取作品文件，请检查目录权限后重试。</p>
              <Button
                size="xs"
                variant="secondary"
                className="shrink-0"
                data-testid="palette-retry"
                onClick={retryFileLoad}
              >
                重试
              </Button>
            </div>
          ) : itemCount === 0 ? (
            <div
              className="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center"
              data-testid="palette-empty"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
                {mode === 'files' ? (
                  <FileText
                    size={20}
                    strokeWidth={1.4}
                    className="text-subtle"
                    aria-hidden="true"
                  />
                ) : (
                  <CommandIcon
                    size={20}
                    strokeWidth={1.4}
                    className="text-subtle"
                    aria-hidden="true"
                  />
                )}
              </div>
              <div>
                <p className="text-sm text-muted">
                  {mode === 'files' && !projectPath ? '还没有打开的作品' : '无匹配项'}
                </p>
                <p className="mt-1 text-xs text-subtle">
                  {mode === 'files' && !projectPath
                    ? '打开作品后即可按名称搜索并打开文件。'
                    : mode === 'files'
                      ? '换个关键词试试，或检查文件是否在作品内。'
                      : '换个关键词试试；全部命令在清空输入后列出。'}
                </p>
              </div>
              {mode === 'files' && !projectPath && (
                <Button size="xs" variant="secondary" onClick={onOpenProject}>
                  打开本地作品…
                </Button>
              )}
            </div>
          ) : mode === 'files' ? (
            fileItems.map((item, index) => (
              <button
                key={item.path}
                id={`palette-option-${index}`}
                role="option"
                aria-selected={index === active}
                ref={index === active ? activeItemRef : undefined}
                data-testid="palette-item"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors ${
                  index === active
                    ? 'bg-elevated text-foreground'
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
                id={`palette-option-${index}`}
                role="option"
                aria-selected={index === active}
                ref={index === active ? activeItemRef : undefined}
                data-testid="palette-item"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm transition-colors ${
                  index === active
                    ? 'bg-elevated text-foreground'
                    : 'text-foreground hover:bg-elevated'
                }`}
              >
                <HighlightedLabel label={item.title} positions={item.positions} />
                {item.shortcut ? (
                  <kbd
                    className={`flex-shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-3xs ${
                      index === active
                        ? 'border-border-strong text-foreground'
                        : 'border-border text-subtle'
                    }`}
                  >
                    {item.shortcut}
                  </kbd>
                ) : item.hint ? (
                  <span className="flex-shrink-0 text-3xs text-subtle">{item.hint}</span>
                ) : null}
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
