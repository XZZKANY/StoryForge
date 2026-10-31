import { useMemo } from 'react';

import { emitEditorCommand } from '../../lib/assistant-events';
import { entryName, parentDir } from '../../lib/fs-path-ops';
import { isSameOrInsidePath } from '../app/editor-tabs-state';
import type { FileTreeActions } from '../app/useFileTreeActions';
import { VIEW_ENTRIES } from '../shell/ActivityBar';
import type { SidePanelView } from '../shell/useShellState';
import { relativeToProject } from './palette-items';

type Command = {
  id: string;
  title: string;
  /** 说明性小字（项目路径、当前状态等），纯文本渲染。 */
  hint?: string;
  /** 真实快捷键，才用 kbd 样式。 */
  shortcut?: string;
  run: () => void;
};

export type PaletteCommandSources = {
  projectPath: string | null;
  currentFile: string | null;
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

// 命令面板的命令清单：每条绑到真实动作，按有没有打开作品、有没有当前文件决定列哪些。
export function usePaletteCommands({
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
}: PaletteCommandSources) {
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
  return commands;
}
