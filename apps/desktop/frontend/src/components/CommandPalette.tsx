/**
 * 命令面板（Ctrl+P 打开文件 / Ctrl+Shift+P 全部命令）
 * 文件列表来自真实项目目录；命令绑定到真实动作，不接假数据。
 * fuzzy 匹配：子序列匹配 + 匹配位置高亮，比纯子串包含更宽容。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAsyncEffect } from '../lib/async-guards';
import { TauriFileSystem, FileEntry } from '../lib/tauri-fs';
import { isOpenableProjectFileEntry } from '../lib/project/entry-visibility';
import { Command as CommandIcon, FileText } from './icons/shell-icons';
import { Button, ModalDialog, PlainButton, Spinner } from './ui';
import {
  fuzzyMatch,
  fuzzyScore,
  HighlightedLabel,
  relativeToProject,
} from './command-palette/palette-items';
import {
  usePaletteCommands,
  type PaletteCommandSources,
} from './command-palette/usePaletteCommands';

export type PaletteMode = 'files' | 'commands';

type FileLoadState =
  | { projectPath: null; status: 'idle'; files: FileEntry[] }
  | { projectPath: string; status: 'loading' | 'loaded' | 'error'; files: FileEntry[] };

type CommandPaletteProps = PaletteCommandSources & {
  mode: PaletteMode;
  onClose: () => void;
  /** 面板里再按 Ctrl+P / Ctrl+Shift+P 切到文件 / 命令。 */
  onModeChange?: (mode: PaletteMode) => void;
  onOpenFile: (path: string) => void;
};

export function CommandPalette({
  mode,
  projectPath,
  currentFile,
  onClose,
  onModeChange,
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

  // 方向键选中项滚入视口，长列表往下选不出屏。
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useAsyncEffect(
    (isCurrent) => {
      if (mode !== 'files' || !projectPath) return;
      void (async () => {
        try {
          const entries = await TauriFileSystem.listProjectDir(projectPath, projectPath, true);
          const md = entries
            .filter(isOpenableProjectFileEntry)
            .sort((a, b) => a.path.localeCompare(b.path));
          if (isCurrent()) {
            setFileLoadState({ projectPath, status: 'loaded', files: md });
          }
        } catch {
          if (isCurrent()) {
            setFileLoadState({ projectPath, status: 'error', files: [] });
          }
        }
      })();
    },
    [fileLoadRequest, mode, projectPath],
  );

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

  const commands = usePaletteCommands({
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
  });

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
    // 弹窗挡住了全局快捷键，面板自己的那两个键在这里接住。
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' && onModeChange) {
      e.preventDefault();
      onModeChange(e.shiftKey ? 'commands' : 'files');
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
    <ModalDialog
      placement="top"
      dismissOutside
      onClose={onClose}
      initialFocusRef={inputRef}
      aria-label={mode === 'files' ? '打开文件' : '命令面板'}
      className="flex max-h-[calc(100vh-2rem)] w-[34rem] max-w-[90vw] flex-col overflow-hidden bg-panel"
      data-testid="command-palette"
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
            <Spinner />
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
                <FileText size={20} strokeWidth={1.4} className="text-subtle" aria-hidden="true" />
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
            <PlainButton
              key={item.path}
              id={`palette-option-${index}`}
              role="option"
              aria-selected={index === active}
              // 选项靠 ↑↓ 与 aria-activedescendant 选，不进 Tab 序：Tab 由弹窗的焦点陷阱留在输入框。
              tabIndex={-1}
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
            </PlainButton>
          ))
        ) : (
          commandItems.map((item, index) => (
            <PlainButton
              key={item.id}
              id={`palette-option-${index}`}
              role="option"
              aria-selected={index === active}
              tabIndex={-1}
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
            </PlainButton>
          ))
        )}
      </div>

      {/* Footer：模式指示 + 结果计数 */}
      <div className="flex items-center justify-between border-t border-border px-4 py-1.5 text-3xs text-subtle">
        <span>{modeLabel}</span>
        <span>{itemCount > 0 ? `${itemCount} 项` : ''}</span>
      </div>
    </ModalDialog>
  );
}
