import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { RefreshCw, X } from '../src/components/icons/shell-icons';
import { SettingsSearchContext } from '../src/components/settings/search-context';
import { SettingDetails } from '../src/components/settings/SettingRows';
import {
  MenuItem,
  MenuItemAction,
  MenuSeparator,
  MenuSurface,
  ModalDialog,
  revealOnHover,
  Spinner,
} from '../src/components/ui';

// 加载圈只留 components/ui/Spinner 一种做法：要转圈就用 <Spinner />，刷新图标转圈用它的 icon 属性；
// 按钮自己的加载态由 Button 内部管。别处手写 animate-spin 或借用按钮的类，就又各写各的了。
function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

const relativePath = (path: string) => relative('.', path).replace(/\\/g, '/');
const filesContaining = (needle: string) =>
  sourceFiles('src')
    .map(relativePath)
    .filter((path) => readFileSync(path, 'utf8').includes(needle));

it('animate-spin 只出现在 components/ui 里', () => {
  const files = filesContaining('animate-spin');
  expect(files).toContain('src/components/ui/Spinner.tsx');
  expect(files.filter((path) => !path.startsWith('src/components/ui/'))).toEqual([]);
});

it('sf-button-spinner 只出现在 Button 与它的样式里', () => {
  expect(filesContaining('sf-button-spinner').sort()).toEqual([
    'src/components/ui/Button.tsx',
    'src/index.css',
  ]);
});

// 模态弹窗只留 components/ui 的 ModalDialog 一种做法：遮罩、dialog 语义、层级都由它出，
// 别处再手写一层 fixed 遮罩或 role="dialog"，就又绕开了层管理（Esc、焦点、叠放顺序）。
it('弹窗遮罩、aria-modal、DialogSurface 只出现在 components/ui 里', () => {
  for (const needle of ['bg-black/', 'data-modal-backdrop', 'aria-modal', '<DialogSurface']) {
    const files = filesContaining(needle);
    expect(files, needle).toContain('src/components/ui/Dialog.tsx');
    expect(
      files.filter((path) => !path.startsWith('src/components/ui/')),
      needle,
    ).toEqual([]);
  }
});

it('role="dialog" 只在 components/ui 里声明（选择器里查 [role="dialog"] 不算）', () => {
  const declaresDialog = /(?<!\[)\brole=\{?\s*['"]dialog['"]/;
  expect(declaresDialog.test('<div role="dialog">')).toBe(true);
  expect(declaresDialog.test("<div role={'dialog'}>")).toBe(true);
  expect(declaresDialog.test(`closest('[role="dialog"]')`)).toBe(false);
  const files = sourceFiles('src')
    .map(relativePath)
    .filter((path) => declaresDialog.test(readFileSync(path, 'utf8')));
  expect(files.filter((path) => !path.startsWith('src/components/ui/'))).toEqual([]);
});

it('ModalDialog 自带遮罩与 dialog 语义；顶层就地渲染，嵌在别的弹窗里时挂到 body', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <ModalDialog aria-label="外层" placement="top" onClose={() => {}} className="bg-panel">
          <ModalDialog aria-label="内层" onClose={() => {}} className="bg-panel">
            <button>好</button>
          </ModalDialog>
        </ModalDialog>,
      ),
    );
    const outer = host.querySelector<HTMLElement>('[aria-label="外层"]')!;
    const inner = document.querySelector<HTMLElement>('[aria-label="内层"]')!;
    for (const surface of [outer, inner]) {
      expect(surface.tagName).toBe('SECTION');
      expect(surface.getAttribute('role')).toBe('dialog');
      expect(surface.getAttribute('aria-modal')).toBe('true');
      expect(surface.className).toContain('rounded-xl border border-border shadow-dialog');
      const backdrop = surface.parentElement!;
      expect(backdrop.hasAttribute('data-modal-backdrop')).toBe(true);
      expect(backdrop.getAttribute('role')).toBe('presentation');
      expect(backdrop.className).toContain('fixed inset-0 z-50 flex justify-center bg-black/50');
    }
    expect(outer.parentElement!.parentElement).toBe(host);
    expect(outer.parentElement!.className).toContain('items-start sm:pt-24');
    expect(host.contains(inner)).toBe(false);
    expect(inner.parentElement!.parentElement).toBe(document.body);
    expect(inner.parentElement!.className).toContain('items-center');
    expect(Number(inner.parentElement!.style.zIndex)).toBeGreaterThan(
      Number(outer.parentElement!.style.zIndex),
    );
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it('Spinner 默认是装饰，给了 label 才是读屏可读的状态', () => {
  const decorative = renderToStaticMarkup(<Spinner />);
  expect(decorative).toBe(
    '<span class="sf-spinner" style="width:14px;height:14px" aria-hidden="true"></span>',
  );
  const labelled = renderToStaticMarkup(<Spinner size={12} label="正在读取" />);
  expect(labelled).toContain('role="status"');
  expect(labelled).toContain('<span class="sr-only">正在读取</span>');
  expect(labelled).toContain('style="width:12px;height:12px" aria-hidden="true"');
});

it('Spinner 转图标时只在 spinning 为真时转', () => {
  const idle = renderToStaticMarkup(
    <Spinner icon={RefreshCw} spinning={false} size={14} strokeWidth={1.6} />,
  );
  expect(idle).not.toContain('animate-spin');
  expect(idle).toContain('width="14"');
  expect(idle).toContain('stroke-width="1.6"');
  expect(idle).toContain('aria-hidden="true"');
  expect(renderToStaticMarkup(<Spinner icon={RefreshCw} />)).toContain('animate-spin');
});

// 图标只从 components/icons/shell-icons 一处来：别处直接引 lucide-react（类型也经它再导出）、
// 另画一套 svg 图标或手写 <svg>，尺寸与描边就又各定各的。
it('lucide-react 只在 shell-icons 里引入，类型也不例外', () => {
  const importsLucide = /['"]lucide-react(?:\/[^'"]*)?['"]/;
  expect(importsLucide.test("import type { LucideIcon } from 'lucide-react';")).toBe(true);
  expect(importsLucide.test("import { X } from './icons/shell-icons';")).toBe(false);
  const files = sourceFiles('src')
    .map(relativePath)
    .filter((path) => importsLucide.test(readFileSync(path, 'utf8')));
  expect(files).toEqual(['src/components/icons/shell-icons.tsx']);
});

it('手画的 StoryIcons 已删，界面里也不再手写 <svg>', () => {
  expect(existsSync('src/components/StoryIcons.tsx')).toBe(false);
  expect(filesContaining('StoryIcons')).toEqual([]);
  expect(filesContaining('<svg')).toEqual([]);
});

// 按钮只留三种写法：像按钮的用 Button，纯图标的用 IconButton，列表行 / 卡片 / 页签 / 树节点 / 文字链接用
// PlainButton（外观照旧由 className 定，只统一 type、焦点环与禁用光标）。别处再手写 <button>，就又各抄一遍。
// components/editor/inline-chat-dom.ts 在 Monaco 视图区里用 DOM API 造按钮，不是 JSX，不在此列。
const BUTTON_EXEMPT = new Set([
  // 等 #561 合了再收：这几个文件另一会话正在改，本刀没动（ChatSideRail / ContextSummaryPanel / ComposerDock 是它新加的）。
  'src/components/chat-window/ChatSideRail.tsx',
  'src/components/chat-window/ChatWindowView.tsx',
  'src/components/chat-window/Composer.tsx',
  'src/components/chat-window/ComposerDock.tsx',
  'src/components/chat-window/ContextPanel.tsx',
  'src/components/chat-window/ContextSummaryPanel.tsx',
  'src/components/chat-window/WriteBatchPanel.tsx',
  'src/components/chat-window/panels.tsx',
]);

it('JSX <button> 只写在 components/ui 里（#561 在改的文件暂时豁免）', () => {
  const jsxButton = /<button\b/;
  expect(jsxButton.test('<button type="button">')).toBe(true);
  expect(jsxButton.test('<PlainButton className="flex">')).toBe(false);
  const files = sourceFiles('src')
    .map(relativePath)
    .filter((path) => path.endsWith('.tsx') && jsxButton.test(readFileSync(path, 'utf8')));
  expect(files).toContain('src/components/ui/Button.tsx');
  expect(
    files.filter((path) => !path.startsWith('src/components/ui/') && !BUTTON_EXEMPT.has(path)),
  ).toEqual([]);
});

it('Button 的每个变体与尺寸在 index.css 里都有样式（sm 是默认，不另写）', () => {
  const css = readFileSync('src/index.css', 'utf8');
  for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'agent', 'agent-subtle'])
    expect(css, variant).toContain(`.sf-button[data-variant='${variant}'] {`);
  for (const size of ['mini', 'compact', 'xs', 'md', 'lg'])
    expect(css, size).toContain(`.sf-button[data-size='${size}'] {`);
});

// 菜单项只留 components/ui/Menu 一种做法（MenuItem，行尾图标小操作用 MenuItemAction）：别处再手写
// role="menuitem"，行高、悬停与键盘焦点底色、危险 / 禁用态就又各定各的。菜单容器仍是 FloatingSurface。
const MENUITEM_EXEMPT = new Set([
  // 等 #561 合了再收：这个文件另一会话正在改，本刀没动。
  'src/components/chat-window/ContextPanel.tsx',
]);

it('role="menuitem" 只在 components/ui 里声明（#561 在改的文件暂时豁免；选择器里查不算）', () => {
  const declaresMenuItem = /(?<!\[)\brole=\{?\s*['"]menuitem/;
  expect(declaresMenuItem.test('<PlainButton role="menuitem">')).toBe(true);
  expect(declaresMenuItem.test("<button role={'menuitemradio'}>")).toBe(true);
  expect(declaresMenuItem.test(`querySelectorAll('[role="menuitem"]')`)).toBe(false);
  const files = sourceFiles('src')
    .map(relativePath)
    .filter((path) => declaresMenuItem.test(readFileSync(path, 'utf8')));
  expect(files).toContain('src/components/ui/Menu.tsx');
  expect(
    files.filter((path) => !path.startsWith('src/components/ui/') && !MENUITEM_EXEMPT.has(path)),
  ).toEqual([]);
});

it('MenuItem：当前项打 ✓，快捷键与次要信息靠右；危险、禁用照样是 menuitem；给了 actions 就和小操作排成一行', () => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    <>
      <MenuItem current hint="10:30">
        第五章
      </MenuItem>
      <MenuItem shortcut="Ctrl S">保存</MenuItem>
      <MenuItem danger disabled>
        删除
      </MenuItem>
      <MenuItem actions={<MenuItemAction label="移除 雾港" title="移除" icon={<X size={12} />} />}>
        雾港
      </MenuItem>
    </>,
  );
  const items = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  expect(items.map((item) => item.textContent)).toEqual([
    '✓ 第五章10:30',
    '保存Ctrl S',
    '删除',
    '雾港',
    '',
  ]);
  expect(items[0].className).toContain('text-foreground');
  expect(items[1].querySelector('.font-mono')?.textContent).toBe('Ctrl S');
  expect(items[2].disabled).toBe(true);
  expect(items[2].className).toContain('text-error');
  const row = items[3].parentElement!;
  expect(row.className).toContain('group');
  expect(row.lastElementChild).toBe(items[4]);
  expect(items[4].getAttribute('aria-label')).toBe('移除 雾港');
  expect(items[4].getAttribute('title')).toBe('移除');
});

// 菜单分隔线只留 MenuSeparator：页签菜单、作品切换、会话菜单、右键菜单曾各写一份，只有右键菜单带 separator 语义。
it('菜单分隔线（h-px 配 bg-border）只写在 components/ui 里，MenuSeparator 是读屏可读的分隔线', () => {
  const divider = /\bh-px\b[^'"`\n]*\bbg-border\b|\bbg-border\b[^'"`\n]*\bh-px\b/;
  expect(divider.test('<div className="my-1 mx-1.5 h-px bg-border" />')).toBe(true);
  expect(divider.test("className='bg-border w-full h-px'")).toBe(true);
  expect(divider.test('<div className="h-px bg-accent" /><p className="bg-border" />')).toBe(false);
  const files = sourceFiles('src')
    .map(relativePath)
    .filter((path) => divider.test(readFileSync(path, 'utf8')));
  expect(files).toEqual(['src/components/ui/Menu.tsx']);
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<MenuSeparator />);
  expect(host.firstElementChild?.getAttribute('role')).toBe('separator');
});

// 字符串字面量里的类名（按空白拆开），用来认「同一串类名」，不管各类名的先后。
const classStrings = (source: string) =>
  [...source.matchAll(/['"`]([^'"`\n]*)['"`]/g)].map((match) => match[1].split(/\s+/));

// 菜单外框只留 MenuSurface：页签的两个菜单、作品切换、会话菜单、模型卡片菜单曾各写一份同一串外框类名，
// 右键菜单另抄一份磨砂变体。
const MENU_SURFACE_EXEMPT = new Set([
  // 等 #561 合了再收：这个文件另一会话正在改，本刀没动。
  'src/components/chat-window/ContextPanel.tsx',
]);

it('菜单外框（rounded-lg、p-1、shadow-dropdown 同在一串）只写在 ui/Menu.tsx，role="menu" 只由 MenuSurface 声明（#561 在改的文件暂时豁免）', () => {
  const isMenuFrame = (tokens: string[]) =>
    ['rounded-lg', 'p-1', 'shadow-dropdown'].every((token) => tokens.includes(token));
  expect(
    classStrings(
      'className="w-52 animate-fade-in rounded-lg border border-border bg-surface p-1 shadow-dropdown"',
    ).some(isMenuFrame),
  ).toBe(true);
  expect(classStrings("className='shadow-dropdown w-64 p-1 rounded-lg'").some(isMenuFrame)).toBe(
    true,
  );
  expect(classStrings('className="rounded-xl p-1.5 shadow-dropdown"').some(isMenuFrame)).toBe(
    false,
  );
  const frameFiles = sourceFiles('src')
    .map(relativePath)
    .filter((path) => classStrings(readFileSync(path, 'utf8')).some(isMenuFrame));
  expect(frameFiles.filter((path) => !MENU_SURFACE_EXEMPT.has(path))).toEqual([
    'src/components/ui/Menu.tsx',
  ]);
  const declaresMenu = /(?<!\[)\brole=\{?\s*['"]menu['"]/;
  expect(declaresMenu.test('<FloatingSurface role="menu">')).toBe(true);
  expect(declaresMenu.test('<PlainButton role="menuitem">')).toBe(false);
  expect(declaresMenu.test(`closest('[role="menu"]')`)).toBe(false);
  const menuFiles = sourceFiles('src')
    .map(relativePath)
    .filter((path) => declaresMenu.test(readFileSync(path, 'utf8')));
  expect(menuFiles.filter((path) => !MENU_SURFACE_EXEMPT.has(path))).toEqual([
    'src/components/ui/Menu.tsx',
  ]);
});

it('MenuSurface 是 role="menu" 的浮层，宽度由调用方给；frosted 换成半透明底、淡描边与背景模糊', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <>
          <MenuSurface aria-label="实底" onDismiss={() => {}} className="w-52">
            <MenuItem>保存</MenuItem>
          </MenuSurface>
          <MenuSurface frosted aria-label="磨砂" onDismiss={() => {}} className="min-w-[172px]">
            <MenuItem>打开</MenuItem>
          </MenuSurface>
        </>,
      ),
    );
    const solid = document.querySelector<HTMLElement>('[aria-label="实底"]')!;
    const frosted = document.querySelector<HTMLElement>('[aria-label="磨砂"]')!;
    for (const menu of [solid, frosted]) {
      expect(menu.getAttribute('role')).toBe('menu');
      for (const token of ['animate-fade-in', 'rounded-lg', 'border', 'p-1', 'shadow-dropdown'])
        expect(menu.classList.contains(token), token).toBe(true);
    }
    expect(solid.classList.contains('w-52')).toBe(true);
    expect(solid.classList.contains('border-border')).toBe(true);
    expect(solid.classList.contains('bg-surface')).toBe(true);
    expect(solid.getAttribute('style')).not.toContain('blur');
    expect(frosted.classList.contains('min-w-[172px]')).toBe(true);
    expect(frosted.classList.contains('border-border/60')).toBe(true);
    expect(frosted.classList.contains('bg-surface/[0.92]')).toBe(true);
    expect(frosted.classList.contains('bg-surface')).toBe(false);
    expect(frosted.getAttribute('style')).toContain('blur(40px) saturate(1.5)');
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

// 悬停才出现的小操作只留 revealOnHover 一种写法：速记的改 / 删、题材的 ×、观测项的勾曾各手写一串
// opacity-40 … group-hover，菜单行尾的小操作从 opacity-0 起步，作品库与文件树在按钮外面包一层 focus-within 的 span。
const REVEAL_EXEMPT = new Set([
  // 页签关闭钮里「未保存圆点 ↔ ×」互换：按钮一直在，不是悬停才出现的操作。
  'src/components/shell/EditorTabs.tsx',
  // 等 #561 合了再收：这个文件另一会话正在改，本刀没动。
  'src/components/chat-window/panels.tsx',
]);

it('悬停才出现（opacity-0 / opacity-40 配 group-hover:opacity-100）只经 revealOnHover（豁免见上）', () => {
  const isHoverReveal = (tokens: string[]) =>
    tokens.some((token) => token === 'opacity-0' || token === 'opacity-40') &&
    tokens.some((token) => /^group-hover(?:\/\w+)?:opacity-100$/.test(token));
  expect(
    classStrings('"text-subtle opacity-40 transition-opacity group-hover:opacity-100"').some(
      isHoverReveal,
    ),
  ).toBe(true);
  expect(
    classStrings("'opacity-0 focus-within:opacity-100 group-hover/row:opacity-100'").some(
      isHoverReveal,
    ),
  ).toBe(true);
  expect(classStrings("'text-muted opacity-70 group-hover:opacity-100'").some(isHoverReveal)).toBe(
    false,
  );
  const files = sourceFiles('src')
    .map(relativePath)
    .filter((path) => classStrings(readFileSync(path, 'utf8')).some(isHoverReveal));
  expect(files.filter((path) => !REVEAL_EXEMPT.has(path))).toEqual([]);
  const hidden = revealOnHover().split(' ');
  const faint = revealOnHover('faint').split(' ');
  expect(hidden[0]).toBe('opacity-0');
  expect(faint[0]).toBe('opacity-40');
  for (const token of [
    'transition-opacity',
    'focus-visible:opacity-100',
    'group-hover:opacity-100',
    'group-has-[:focus-visible]:opacity-100',
  ]) {
    expect(hidden, token).toContain(token);
    expect(faint, token).toContain(token);
  }
});
// 同一个组件名只在一处定义：MenuRow（页签菜单、模型卡片各一份）、Section（手稿 / 作品 / 观测镜各包一层
// PanelSection）都曾各写一份。要复用就从定义它的文件导出，别在新文件里再写一个同名的。
it('大写开头的函数（组件）不在多个文件里各自定义，MenuItem 只在 ui/Menu.tsx', () => {
  const declared = /^(?:export )?function ([A-Z]\w*)/gm;
  const sample = ['function MenuRow() {}', 'export function Section() {}', '  function Inner() {}'];
  expect([...sample.join('\n').matchAll(declared)].map((match) => match[1])).toEqual([
    'MenuRow',
    'Section',
  ]);
  const owners = new Map<string, Set<string>>();
  for (const path of sourceFiles('src').map(relativePath)) {
    if (path.endsWith('.css')) continue;
    for (const [, name] of readFileSync(path, 'utf8').matchAll(declared))
      owners.set(name, (owners.get(name) ?? new Set()).add(path));
  }
  expect(
    [...owners].filter(([, paths]) => paths.size > 1).map(([name, paths]) => [name, [...paths]]),
  ).toEqual([]);
  expect([...(owners.get('MenuItem') ?? [])]).toEqual(['src/components/ui/Menu.tsx']);
  expect(owners.has('MenuRow')).toBe(false);
});

// 设置行（标题 + 说明在左、控件在右）只有 settings/SettingRows 的 RowShell 一个外壳：行高、内边距、
// 字号与搜索过滤都在那里定。外观分区曾另写过 ChoiceRow / SelectFieldRow / ColorRow 三个外壳。
it('设置行的行高只写在 SettingRows 里', () => {
  expect(filesContaining('min-h-[76px]')).toEqual(['src/components/settings/SettingRows.tsx']);
});

// 设置搜索词只在 settings/search-context 里读和比：「关于」的更新说明、连接与存储详情、模型服务、插件曾各自
// trim().toLowerCase() 再 includes 一遍。
it('设置搜索词只在 search-context 里读', () => {
  expect(filesContaining('useContext(SettingsSearchContext)')).toEqual([
    'src/components/settings/search-context.ts',
  ]);
});

// 设置卡片里的折叠区只留 SettingDetails：连接与存储详情、模型服务的「高级」曾各写一份 <details open={Boolean(query)}>。
it('设置里的 <details> 只写在 SettingRows，SettingDetails 在搜索时展开', () => {
  const settingsFiles = [
    ...sourceFiles('src/components/settings'),
    'src/components/SettingsView.tsx',
  ]
    .map(relativePath)
    .filter((path) => readFileSync(path, 'utf8').includes('<details'));
  expect(settingsFiles).toEqual(['src/components/settings/SettingRows.tsx']);
  const render = (query: string) => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <SettingsSearchContext.Provider value={query}>
        <SettingDetails className="px-4 py-3" summary="高级" data-testid="details">
          <p>内容</p>
        </SettingDetails>
      </SettingsSearchContext.Provider>,
    );
    return host.querySelector<HTMLDetailsElement>('[data-testid="details"]')!;
  };
  expect(render('').open).toBe(false);
  expect(render('  ').open).toBe(false);
  expect(render('润色').open).toBe(true);
  expect(render('').querySelector('summary')?.textContent).toBe('高级');
});

// 确认弹窗的函数类型只从 AppDialog 取（AppDialogApi['confirm']）：模型服务与插件两个分组曾各抄一份 type Confirm。
it('确认函数的类型不在别处另抄一份', () => {
  expect(filesContaining('type Confirm =')).toEqual([]);
});
