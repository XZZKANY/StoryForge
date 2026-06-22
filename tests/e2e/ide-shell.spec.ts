import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellSources = {
  app: readFileSync('apps/desktop/frontend/src/App.tsx', 'utf8'),
  layout: readFileSync('apps/desktop/frontend/src/components/DynamicIDELayout.tsx', 'utf8'),
  explorer: readFileSync('apps/desktop/frontend/src/components/ResourceExplorer.tsx', 'utf8'),
  editor: readFileSync('apps/desktop/frontend/src/components/Editor.tsx', 'utf8'),
  chat: readFileSync('apps/desktop/frontend/src/components/ChatWindow.tsx', 'utf8'),
};

function assertSourceEvidence(source, markers) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `缺少 IDE 壳层证据：${marker}`);
  }
}

test('Desktop IDE shell 暴露本地创作主入口和基础布局', () => {
  assertSourceEvidence(shellSources.app, [
    'data-testid="desktop-shell"',
    'WindowMenu',
    'CodexSidebar',
    'AgentWorkspace',
    'RightWorkspace',
  ]);
  assertSourceEvidence(shellSources.layout, [
    'data-testid="dynamic-ide-layout"',
    'conversation-full',
    'editor-floating',
    'split',
  ]);
});

test('Desktop IDE shell 支持文件树、编辑器和 Agent 交互入口', () => {
  assertSourceEvidence(shellSources.explorer, ['ResourceExplorer', 'projectPath', 'onFileSelect']);
  assertSourceEvidence(shellSources.editor, ['data-testid="editor-panel"', 'editor-save-btn', 'editor-export-btn']);
  assertSourceEvidence(shellSources.chat, ['sendAgentUserMessage', 'tool_trace', 'proposed_patch']);
});

test('Desktop IDE shell 不保留 Web legacy 路由入口', () => {
  const allDesktopSources = Object.values(shellSources).join('\n');
  for (const marker of ['/studio', '/retrieval', '/runs', '/artifacts', '/evaluations', 'legacy:']) {
    assert.ok(!allDesktopSources.includes(marker), `Desktop shell 不应继续暴露 Web legacy 入口：${marker}`);
  }
});
