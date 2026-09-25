import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { AppDialogHost } from '../src/components/app/AppDialog';
import { ConversationHeader } from '../src/components/chat-window/panels';
import { ActivityBar } from '../src/components/shell/ActivityBar';
import { AssistantPanelFrame } from '../src/components/shell/AssistantPanelFrame';
import { EditorTabs } from '../src/components/shell/EditorTabs';
import { SidePanel } from '../src/components/shell/SidePanel';
import { StatusBar } from '../src/components/shell/StatusBar';
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

test('主外壳统一 panel，仅四处主区域边界保留主题细线；正文页签仍使用 background', () => {
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
        widths={{}}
        onWidthChange={noop}
      />
      <AssistantPanelFrame visible>
        <ConversationHeader title="当前会话" />
      </AssistantPanelFrame>
      <StatusBar
        modelLabel=""
        projectOpen
        obs={{ error: 0, warning: 0, advisory: 0, total: 0 }}
        onToggleObs={noop}
      />
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
    'shell-side-panel': 'right',
    'assistant-panel': 'left',
    'shell-status-bar': 'top',
  };
  for (const id of [
    'shell-titlebar',
    'shell-activity-bar',
    'shell-side-panel',
    'assistant-panel',
    'conversation-header',
    'shell-status-bar',
  ]) {
    const panel = element(host, `[data-testid="${id}"]`);
    assertNoGridUtilities(panel);
    assert.deepEqual(
      Array.from(panel.classList).filter((token) => token.startsWith('sf-shell-edge-')),
      shellEdges[id] ? [`sf-shell-edge-${shellEdges[id]}`] : [],
      `${id} should only have its intended primary edge`,
    );
    assert.equal(
      panel.classList.contains('bg-panel'),
      true,
      `${id} should share the panel surface`,
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
  assert.equal(selected.classList.contains('focus-visible:ring-2'), true);
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
  assert.equal(input.classList.contains('border'), true);
  assert.equal(input.classList.contains('border-border-strong'), true);
  assert.equal(input.classList.contains('focus:border-accent'), true);
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

test('四处主边界只在深色出现，均为低对比 1px divider，不恢复其他网格', () => {
  const directions = ['bottom', 'top', 'right', 'left'];
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
      panel: '22 22 24',
      surface: '29 29 32',
      elevated: '41 41 45',
      border: '52 52 57',
      'border-strong': '72 72 79',
    },
  );
  assert.deepEqual(tokens(":root[data-theme='light']"), {
    background: '247 247 248',
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
    warning: '176 122 17',
    success: '42 140 84',
    agent: '79 86 196',
    'agent-foreground': '250 250 250',
    'issue-high': '200 56 56',
    'issue-medium': '176 122 17',
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
    divider: 'rgb(var(--border) / 0.5)',
  });
});
