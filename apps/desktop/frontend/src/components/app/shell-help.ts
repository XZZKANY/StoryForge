import type { ContextMenuItem } from '../shell/ContextMenu';
import type { AppDialogApi } from './AppDialog';
import type { ThemeMode } from '../../lib/user-settings';
import { formatShortcutSheet } from './shortcuts';

/** Help/menu composition is independent of workspace layout and file state. */
export function createShellHelp({
  dialogs,
  theme,
  toggleTheme,
  openSettings,
  openCommands,
}: {
  dialogs: Pick<AppDialogApi, 'alert'>;
  theme: ThemeMode;
  toggleTheme: () => void;
  openSettings: () => void | Promise<void>;
  openCommands: () => void;
}) {
  const showShortcuts = () => {
    void dialogs.alert({
      title: '快捷键速查',
      mono: true,
      message: formatShortcutSheet(),
    });
  };

  const showAbout = () =>
    void dialogs.alert({
      title: '了解 StoryForge',
      message: [
        'StoryForge — 面向小说作者的本地 AI 写作工作台。',
        '',
        '打开你的小说项目，专注写作，与 Agent 一起审稿、构思和修订。',
        '',
        '修改会先生成可查看的差异，默认由你确认后写回。',
        '项目权限可调整，但安全检查、写前快照与版本记录始终保留。',
      ].join('\n'),
    });

  // 齿轮小菜单（#15）：命令面板 / 设置 / 快捷键 / 主题 / 关于。
  const settingsMenu: ContextMenuItem[] = [
    { label: '命令面板', onSelect: openCommands },
    { label: '设置', onSelect: () => void openSettings() },
    { type: 'separator' },
    { label: '快捷键速查', onSelect: showShortcuts },
    {
      label: theme === 'dark' ? '切换到浅色' : '切换到深色',
      onSelect: toggleTheme,
    },
    { type: 'separator' },
    { label: '了解 StoryForge', onSelect: showAbout },
  ];

  return { showShortcuts, showAbout, settingsMenu };
}
