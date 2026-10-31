import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { RefreshCw } from '../src/components/icons/shell-icons';
import { ModalDialog, Spinner } from '../src/components/ui';

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
