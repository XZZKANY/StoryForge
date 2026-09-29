import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { AppDialogHost } from '../src/components/app/AppDialog';
import { ProjectLibrary } from '../src/components/app/ProjectLibrary';
import { ComposerSurface } from '../src/components/chat-window/Composer';
import { ConversationHeader } from '../src/components/chat-window/panels';
import { ActivityBar } from '../src/components/shell/ActivityBar';
import { AssistantPanelFrame } from '../src/components/shell/AssistantPanelFrame';
import { EditorTabs } from '../src/components/shell/EditorTabs';
import { SidePanel } from '../src/components/shell/SidePanel';
import { Titlebar } from '../src/components/shell/Titlebar';

// Static DOM/CSS guards only: real colors, geometry and focus appearance require browser evidence.
const noop = () => {};
function markup(node: ReactNode) {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(node);
  return host;
}
function element(host: HTMLElement, selector: string) {
  const found = host.querySelector<HTMLElement>(selector);
  assert.ok(found, `Missing rendered element: ${selector}`);
  return found;
}
function assertNoGridUtilities(node: HTMLElement) {
  const decorations = Array.from(node.classList).filter((token) =>
    /^(?:border(?:-|$)|divide-[xy])/.test(token),
  );
  assert.deepEqual(
    decorations,
    [],
    `Unexpected always-on grid utility on ${node.dataset.testid ?? node.tagName}`,
  );
}

const css = readFileSync('src/index.css', 'utf8');
const cssRules = Array.from(
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@tailwind\s+[^;]+;/g, '')
    .matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ([, selector, body]) => ({
    selectors: selector
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()
      .split(',')
      .map((part) => part.trim()),
    body,
  }),
);
function rule(selector: string) {
  const found = cssRules.find((entry) => entry.selectors.includes(selector));
  assert.ok(found, `Missing CSS rule: ${selector}`);
  return found.body;
}

test('主外壳统一 panel，横向细线只留顶栏底缘；二级面板以左缘圆角软影覆盖在 rail 底色上', () => {
  const host = markup(
    <>
      <Titlebar onOpenPalette={noop} projectOpen rightCollapsed={false} onToggleRight={noop} />
      <ActivityBar view="book" sidebarHidden={false} onSwitchView={noop} onOpenSettings={noop} />
      <SidePanel
        view="book"
        projects={[]}
        activeProject={null}
        currentFile={null}
        previewFile={null}
        projectRefreshVersion={0}
        onSelectProject={noop}
        onRemoveProject={noop}
        onOpenProject={noop}
        onNewFile={noop}
        onFileSelect={noop}
        onFilePreview={noop}
        width={300}
        onWidthChange={noop}
      />
      <AssistantPanelFrame visible>
        <ConversationHeader title="当前会话" />
      </AssistantPanelFrame>
      <EditorTabs
        openFiles={[]}
        activeFile={null}
        previewFile={null}
        dirtyFiles={new Set()}
        activeTab={null}
        onFocusFile={noop}
        onFocusPreview={noop}
        onPinPreview={noop}
        onCloseFile={noop}
      />
    </>,
  );
  const shellEdges: Record<string, string> = {
    'shell-titlebar': 'bottom',
  };
  for (const id of [
    'shell-titlebar',
    'shell-activity-bar',
    'shell-side-panel',
    'assistant-panel',
    'conversation-header',
  ]) {
    const panel = element(host, `[data-testid="${id}"]`);
    assertNoGridUtilities(panel);
    // 分区不靠网格线：rail 是画布色底层（无圆角、无凸出），二级面板左缘圆角内收 +
    // 横向软影 + overflow-hidden，覆盖在 rail 之上。
    if (id === 'shell-side-panel') {
      assert.equal(panel.classList.contains('rounded-l-xl'), true, '面板左缘必须是圆角');
      assert.equal(panel.classList.contains('shadow-panel-lift'), true, '面板左缘必须有横向软影');
      assert.equal(panel.classList.contains('overflow-hidden'), true, '圆角必须真实裁切内容');
    }
    if (id === 'shell-activity-bar') {
      assert.equal(
        Array.from(panel.classList).some((token) => token.startsWith('rounded-')),
        false,
        'rail 是贯穿全高的底层背景，不得带圆角',
      );
    }
    assert.deepEqual(
      Array.from(panel.classList).filter((token) => token.startsWith('sf-shell-edge-')),
      shellEdges[id] ? [`sf-shell-edge-${shellEdges[id]}`] : [],
      `${id} should only have its intended primary edge`,
    );
    // 一级导航 rail 用画布色（比二级面板暗一档），其余壳面仍共享 panel。
    const expectedSurface = id === 'shell-activity-bar' ? 'bg-background' : 'bg-panel';
    assert.equal(
      panel.classList.contains(expectedSurface),
      true,
      `${id} should use ${expectedSurface}`,
    );
  }
  const tabs = element(host, '[data-testid="editor-tabs"]');
  assertNoGridUtilities(tabs);
  assert.equal(
    Array.from(tabs.classList).some((token) => token.startsWith('sf-shell-edge-')),
    false,
  );
  assert.equal(tabs.classList.contains('bg-background'), true);
  const activeNavigation = element(host, '[data-testid="activity-book"]');
  assert.equal(activeNavigation.getAttribute('aria-current'), 'true');
  assert.equal(activeNavigation.classList.contains('rounded-lg'), true);
  assert.equal(activeNavigation.classList.contains('bg-elevated'), true);
});

test('选中页签以圆角填充区分，保留 tab 语义、焦点样式和未保存标记', () => {
  const host = markup(
    <EditorTabs
      openFiles={['D:/Book/a.md', 'D:/Book/b.md']}
      activeFile="D:/Book/a.md"
      previewFile={null}
      dirtyFiles={new Set(['D:/Book/a.md'])}
      activeTab="file"
      onFocusFile={noop}
      onFocusPreview={noop}
      onPinPreview={noop}
      onCloseFile={noop}
    />,
  );
  const selected = element(host, '[role="tab"][aria-selected="true"]');
  const inactive = element(host, '[role="tab"][aria-selected="false"]');
  const selectedSurface = selected.parentElement;
  const inactiveSurface = inactive.parentElement;
  assert.ok(selectedSurface && inactiveSurface);
  for (const surface of [selectedSurface, inactiveSurface]) {
    assertNoGridUtilities(surface);
    assert.equal(surface.classList.contains('rounded-md'), true);
  }
  assert.equal(selectedSurface.classList.contains('bg-elevated'), true);
  assert.equal(inactiveSurface.classList.contains('bg-elevated'), false);
  assert.equal(selected.tabIndex, 0);
  assert.equal(inactive.tabIndex, -1);
  // 死焦点类（outline-none + ring-agent）已移除，页签焦点交给全局 :focus-visible outline 兜底。
  assert.equal(selected.classList.contains('focus-visible:ring-2'), false);
  assert.ok(selectedSurface.querySelector('[data-testid="editor-tab-dirty"]'));
});

test('共用面板标题无底线，调宽静息透明且 hover、键盘焦点、拖动各有强调反馈', () => {
  assert.doesNotMatch(rule('.sf-panel-header'), /border(?:-[a-z]+)?\s*:/);
  assert.match(rule('.sf-panel-header'), /height:\s*var\(--sf-bar-height\)/);
  assert.match(rule('.sf-panel-resize'), /background:\s*transparent/);
  for (const selector of [
    '.sf-panel-resize:hover',
    '.sf-panel-resize:focus-visible',
    ".sf-panel-resize[data-resizing='true']",
  ]) {
    assert.match(rule(selector), /background:\s*rgb\(var\(--accent\)/);
  }
});

test('减少装饰线不抹掉输入、弹层和全局键盘焦点的必要边界', () => {
  const host = markup(
    <AppDialogHost
      dialog={{
        kind: 'prompt',
        title: '文件名称',
        message: '输入名称',
        defaultValue: '',
        value: '',
        confirmLabel: '确认',
        cancelLabel: '取消',
        resolve: noop,
      }}
      onClose={noop}
      onPromptValueChange={noop}
    />,
  );
  const dialog = element(host, '[role="dialog"]');
  const input = element(host, 'input');
  assert.equal(dialog.classList.contains('border'), true);
  assert.equal(dialog.classList.contains('border-border'), true);
  assert.equal(input.classList.contains('sf-form-control'), true);
  assert.match(rule('.sf-form-control'), /border:\s*1px solid/);
  assert.equal(input.classList.contains('border-border-strong'), true);
  assert.equal(input.classList.contains('sf-input'), true);
  assert.match(rule(':focus-visible'), /outline:\s*2px solid/);
  for (const entry of cssRules.filter(({ selectors }) =>
    selectors.some((selector) => ['*', ':root', 'html', 'body', '#root'].includes(selector)),
  )) {
    assert.doesNotMatch(
      entry.body,
      /border(?:-(?:width|color))?\s*:\s*(?:0(?:px)?\s*(?:;|$)|none\b|transparent\b)/,
      'No blanket border reset',
    );
  }
});

test('横向主边界只在深色出现，均为低对比 1px divider；三栏之间不画竖线', () => {
  const directions = ['bottom'];
  const selectors = directions.map(
    (direction) => `:root:not([data-theme='light']) .sf-shell-edge-${direction}`,
  );
  assert.deepEqual(
    cssRules
      .flatMap((entry) =>
        entry.selectors.filter((selector) => selector.includes('.sf-shell-edge-')),
      )
      .sort(),
    [...selectors].sort(),
    'No unscoped or light-theme shell edge rules',
  );
  for (const [index, selector] of selectors.entries()) {
    assert.equal(rule(selector).trim(), `border-${directions[index]}: 1px solid var(--divider);`);
  }
  assert.match(rule(':root'), /--divider:\s*rgb\(var\(--border\) \/ 0\.6\)/);
});

function tokens(selector: string) {
  return Object.fromEntries(
    Array.from(rule(selector).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g), ([, name, value]) => [
      name,
      value.trim(),
    ]),
  );
}

test('深色使用近黑画布与递进表面，保留控件描边；浅色 token 完整保持', () => {
  const dark = tokens(':root');
  assert.deepEqual(
    Object.fromEntries(
      ['background', 'panel', 'surface', 'elevated', 'border', 'border-strong'].map((name) => [
        name,
        dark[name],
      ]),
    ),
    {
      background: '16 16 18',
      panel: '26 26 30',
      surface: '33 33 37',
      elevated: '42 42 47',
      border: '52 52 57',
      'border-strong': '72 72 79',
    },
  );
  assert.deepEqual(tokens(":root[data-theme='light']"), {
    background: '243 243 245',
    panel: '255 255 255',
    surface: '255 255 255',
    elevated: '238 238 241',
    border: '226 226 230',
    'border-strong': '201 201 208',
    foreground: '26 26 29',
    muted: '94 94 102',
    subtle: '104 104 114',
    accent: '24 24 27',
    'accent-foreground': '250 250 250',
    error: '200 56 56',
    // P2-E 浅色语义色按最严底（surface #e8e8ea）达 AA 4.5:1 重选：
    // warning 旧 #b07a11 最差 3.04:1 → 新 #a14607 最差 5.06:1；
    // success 旧 #2a8c54 最差 3.45:1 → 新 #166534 最差 5.83:1。
    warning: '161 70 7',
    success: '22 101 52',
    agent: '79 86 196',
    'agent-foreground': '250 250 250',
    'issue-high': '200 56 56',
    'issue-medium': '161 70 7',
    'issue-low': '79 86 196',
    'shadow-sm': '0 1px 3px rgb(0 0 0 / 0.06), 0 1px 2px rgb(0 0 0 / 0.12)',
    'shadow-md': '0 4px 12px rgb(0 0 0 / 0.08), 0 2px 4px rgb(0 0 0 / 0.05)',
    'shadow-lg': '0 12px 40px rgb(0 0 0 / 0.12), 0 4px 12px rgb(0 0 0 / 0.08)',
    'shadow-panel': '0 2px 8px rgb(0 0 0 / 0.04)',
    'shadow-inset': 'inset 0 1px 2px rgb(0 0 0 / 0.05)',
    'shadow-dropdown': '0 8px 28px rgb(0 0 0 / 0.14)',
    'shadow-dialog': '0 24px 80px rgb(0 0 0 / 0.22)',
    'shadow-composer': '0 4px 16px rgb(0 0 0 / 0.08)',
    'shadow-composer-focus': '0 4px 20px rgb(0 0 0 / 0.1)',
    // 反向投影 token：底栏/贴底操作条共用，浅色按惯例降 alpha（深色 0.1 → 浅色 0.05）。
    'shadow-bar-top': '0 -4px 16px rgb(0 0 0 / 0.05)',
    'shadow-panel-lift': '-4px 0 12px -6px rgb(0 0 0 / 0.12)',
    divider: 'rgb(var(--border) / 0.5)',
  });
});

test('复合输入框焦点反馈只由外层负责，内层控件豁免全局焦点轮廓', () => {
  // base 焦点环保留；sf-inner-input 明确让外壳负责反馈。
  // 文本输入框被鼠标点击后同样匹配 :focus-visible，不能只靠注释里的键盘假设。
  assert.match(rule(':focus-visible'), /outline:\s*2px solid rgb\(var\(--agent\)\)/); // 三处复合输入框：文件搜索（命令面板）、询问框（Composer）、作品搜索（项目库）。
  // 外层容器用 focus-within 提亮边框；内层控件一律带 sf-inner-input 豁免第二套轮廓。
  const composer = markup(
    <ComposerSurface
      value=""
      onChange={noop}
      disabled={false}
      busy={false}
      currentFileLabel={null}
      explicitContextPaths={[]}
      onAddContext={noop}
      permissionProfile="ask"
      onPermissionProfileChange={noop}
    />,
  );
  assert.equal(
    element(composer, '[data-testid="composer-surface"] textarea').classList.contains(
      'sf-inner-input',
    ),
    true,
  );

  const library = markup(
    <ProjectLibrary
      projects={['C:/demo/a']}
      activeProject={null}
      onNewProject={noop}
      onOpenProject={noop}
      onSelectProject={noop}
      onResumeProject={noop}
      onOpenSettings={noop}
    />,
  );
  assert.equal(element(library, 'input[type="search"]').classList.contains('sf-inner-input'), true);
  for (const host of [composer, library]) {
    const shell = element(host, '.sf-input-shell');
    assert.ok(
      shell.classList.contains('sf-form-shell') ||
        Array.from(shell.classList).some((token) => token.startsWith('focus-within:border-accent')),
    );
    assert.ok(shell.querySelector('.sf-inner-input'));
  }

  // CommandPalette 状态下放且挂载即 focus，走源文本断言（同 app.test.tsx）。
  const paletteSource = readFileSync('src/components/CommandPalette.tsx', 'utf8');
  assert.match(paletteSource, /className="sf-inner-input [^"]*outline-none/);
});

test('reduced-motion 归零保留状态载体：animate-ping/pulse 降级为常亮而非消失', () => {
  // 「Agent 运行中」靠这两个无限动画表达；全局归零会把运行信号整个抹掉。
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(reduced, 'Missing prefers-reduced-motion block');
  assert.match(reduced[1], /\.animate-ping,\s*\.animate-pulse\s*\{[^}]*animation:\s*none/s);
  // 贴底操作条的反向投影走 token，不再允许任意值/内联阴影漂移。
  assert.match(css, /--shadow-bar-top:\s*0 -4px 16px/);
  const panels = readFileSync('src/components/chat-window/panels.tsx', 'utf8');
  assert.doesNotMatch(panels, /shadow-\[0_-4px/);
});
