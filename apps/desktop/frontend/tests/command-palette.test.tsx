import assert from 'node:assert/strict';
import { test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CommandPalette } from '../src/components/CommandPalette';

function renderCommands(projectPath: string | null) {
  return renderToStaticMarkup(
    React.createElement(CommandPalette, {
      mode: 'commands',
      projectPath,
      currentFile: null,
      onClose: () => {},
      onOpenFile: () => {},
      onOpenProject: () => {},
      onInitializeProject: () => {},
      onExportCurrent: () => {},
      onToggleAssistant: () => {},
      onToggleWorkspace: () => {},
      onOpenSettings: () => {},
      onFocusAssistantOnly: () => {},
      onFocusWorkspaceOnly: () => {},
      onRestoreLayout: () => {},
    }),
  );
}

test('command palette exposes story project initialization for active projects', () => {
  const html = renderCommands('D:\\StoryForge\\Books\\雾港回声');

  assert.ok(html.includes('初始化小说项目结构'));
  assert.ok(html.includes('雾港回声'));
});

test('command palette hides story project initialization before a project is open', () => {
  const html = renderCommands(null);

  assert.equal(html.includes('初始化小说项目结构'), false);
});
