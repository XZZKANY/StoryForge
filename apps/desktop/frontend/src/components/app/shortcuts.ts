/**
 * 快捷键速查表的单一事实源。
 *
 * 这张表是印在界面上的承诺。此前它是 AppShell 里一段写死的字符串数组，和 App.tsx 的 keydown
 * 处理器各写各的，于是「Ctrl O 打开项目」在速查表和欢迎页上挂了很久，键却从来没绑上
 * （原本指望原生菜单兜底，而原生菜单从未安装）。
 *
 * 现在每一行都必须交代自己在哪儿被接管：
 *   - 不填 `scope` / `needs` = 全局无条件生效，由 `tests/shortcuts.test.tsx` 逐个真按一遍验证；
 *   - `needs` = 只在开了项目 / 有活动文件时生效（护栏跳过，happy-dom 起不了这些前置态）；
 *   - `scope` = 由别的组件接管（Monaco 内部命令 / 页签行 keydown），不走 App 的全局处理器。
 * 加行不填这两个字段，护栏就会真按下去，按不动即红。
 */
export type ShortcutRow = {
  /** 速查表里显示的键名 */
  keys: string;
  label: string;
  /** 实际按下的键（event.key 小写），供护栏逐个验证 */
  chords: Array<{ ctrl?: true; shift?: true; key: string }>;
  /** 需要前置态才生效：护栏不按这些 */
  needs?: 'project' | 'file';
  /** 不由 App 全局处理器接管，而在这些组件内部 */
  scope?: 'editor' | 'tabs';
};

export const SHORTCUT_ROWS: ShortcutRow[] = [
  { keys: 'Ctrl P', label: '打开文件（命令面板 · 文件）', chords: [{ ctrl: true, key: 'p' }] },
  {
    keys: 'Ctrl Shift P',
    label: '命令面板（全部命令）',
    chords: [{ ctrl: true, shift: true, key: 'p' }],
  },
  { keys: 'Ctrl Shift E', label: '资源管理器', chords: [{ ctrl: true, shift: true, key: 'e' }] },
  {
    keys: 'Ctrl Shift F',
    label: '在正文中搜索',
    chords: [{ ctrl: true, shift: true, key: 'f' }],
  },
  {
    keys: 'Ctrl Shift O',
    label: '世界线观测镜',
    chords: [{ ctrl: true, shift: true, key: 'o' }],
  },
  { keys: 'Ctrl O', label: '打开项目', chords: [{ ctrl: true, key: 'o' }] },
  { keys: 'Ctrl S', label: '保存当前文件', chords: [{ ctrl: true, key: 's' }], needs: 'file' },
  { keys: 'Ctrl B', label: '显示 / 隐藏资源管理器', chords: [{ ctrl: true, key: 'b' }] },
  { keys: 'Ctrl ,', label: '打开设置', chords: [{ ctrl: true, key: ',' }] },
  {
    keys: 'Ctrl 1 / 2 / 3',
    label: '编辑 / 平衡 / 对话 布局',
    chords: [
      { ctrl: true, key: '1' },
      { ctrl: true, key: '2' },
      { ctrl: true, key: '3' },
    ],
    needs: 'project',
  },
  { keys: 'Ctrl 4', label: '观测镜', chords: [{ ctrl: true, key: '4' }], needs: 'project' },
  {
    keys: 'Ctrl K',
    label: '行间对话（编辑器内选中后）',
    chords: [{ ctrl: true, key: 'k' }],
    scope: 'editor',
  },
  {
    keys: 'Ctrl W',
    label: '关闭当前页签（焦点在页签行时）',
    chords: [{ ctrl: true, key: 'w' }],
    scope: 'tabs',
  },
];

/** 速查表正文：键名列等宽对齐（比例字体下空格填充会参差，故对话框用 mono:true 渲染）。 */
export function formatShortcutSheet(rows: ShortcutRow[] = SHORTCUT_ROWS): string {
  return [
    ...rows.map((row) => `${row.keys.padEnd(16)}${row.label}`),
    '',
    '编辑 · 全选 · 复制 · 粘贴（Ctrl C / A / V）全部沿袭系统，不拦截。',
  ].join('\n');
}
