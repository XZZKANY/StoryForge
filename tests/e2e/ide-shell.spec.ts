import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellSources = {
  page: readFileSync('apps/web/app/ide/page.tsx', 'utf8'),
  shell: readFileSync('apps/web/components/ide/shell/IdeShell.tsx', 'utf8'),
  activityBar: readFileSync('apps/web/components/ide/shell/ActivityBar.tsx', 'utf8'),
  bottomPanel: readFileSync('apps/web/components/ide/shell/BottomPanel.tsx', 'utf8'),
  editorArea: readFileSync('apps/web/components/ide/shell/EditorArea.tsx', 'utf8'),
  sidePanel: readFileSync('apps/web/components/ide/shell/SidePanel.tsx', 'utf8'),
};

function assertSourceEvidence(source, markers) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `缺少 IDE 壳层证据：${marker}`);
  }
}

test('IDE shell 页面暴露 /ide 入口和 VS Code 式基础布局', () => {
  assertSourceEvidence(shellSources.page, ['IdeShell', 'parseIdeUrlState', 'searchParams']);
  assertSourceEvidence(shellSources.shell, [
    'data-testid="ide-shell"',
    'StoryForge IDE',
    'ActivityBar',
    'SidePanel',
    'EditorArea',
    'RightDock',
    'BottomPanel',
  ]);
});

test('IDE shell 支持运行和 diff 面板交互入口', () => {
  assertSourceEvidence(shellSources.activityBar, ['运行', "id: 'runs'"]);
  assertSourceEvidence(shellSources.bottomPanel, ["'diff'", '当前底部面板']);
});

test('IDE shell 暴露五个 legacy 页面入口', () => {
  for (const marker of [
    'legacy:studio',
    'legacy:retrieval',
    'legacy:runs',
    'legacy:artifacts',
    'legacy:evaluations',
  ]) {
    assert.ok(shellSources.sidePanel.includes(marker) || shellSources.editorArea.includes(marker), `缺少 ${marker}`);
  }
  for (const href of ['/studio', '/retrieval', '/runs', '/artifacts', '/evaluations']) {
    assert.ok(shellSources.editorArea.includes(href), `缺少旧路由链接 ${href}`);
  }
});
