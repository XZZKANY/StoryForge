export type IdeKeybinding = {
  readonly shortcut: string;
  readonly commandId: string;
  readonly title: string;
};

export const ideKeymap: readonly IdeKeybinding[] = [
  { shortcut: 'Ctrl+Shift+P', commandId: 'palette.open', title: '打开命令面板' },
  { shortcut: 'Ctrl+Alt+J', commandId: 'judge.run', title: '运行 Judge' },
  { shortcut: 'Ctrl+.', commandId: 'judge.repair', title: '生成定向修复' },
  { shortcut: 'Ctrl+Alt+B', commandId: 'bookrun.start', title: '启动 BookRun' },
];

export function resolveIdeKeymap(
  customKeybindings: Readonly<Record<string, string>> = {},
): readonly IdeKeybinding[] {
  const overrides = new Map(Object.entries(customKeybindings));
  const overriddenCommandIds = new Set(overrides.keys());
  const defaults = ideKeymap.filter((item) => !overriddenCommandIds.has(item.commandId));
  const custom = Array.from(overrides.entries()).map(([commandId, shortcut]) => {
    const existing = ideKeymap.find((item) => item.commandId === commandId);
    return {
      commandId,
      shortcut,
      title: existing?.title ?? commandId,
    };
  });
  return [...custom, ...defaults];
}

export function findCommandByShortcut(
  shortcut: string,
  keymap: readonly IdeKeybinding[] = ideKeymap,
): IdeKeybinding | undefined {
  return keymap.find((item) => item.shortcut.toLowerCase() === shortcut.toLowerCase());
}
