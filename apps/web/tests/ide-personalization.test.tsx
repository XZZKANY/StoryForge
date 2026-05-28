import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  createEditorPopoutUrl,
  defaultIdePreferences,
  mergeIdePreferences,
  parseIdePreferences,
  serializeIdePreferences,
} from '../components/ide/personalization/preferences';
import { findCommandByShortcut, ideKeymap, resolveIdeKeymap } from '../components/ide/keymap/index';
import { PersonalizationPanel } from '../components/ide/personalization/PersonalizationPanel';
import { IdeShell } from '../components/ide/shell/IdeShell';

test('IDE 个性化偏好默认使用暗色主题并能从损坏存储回退', () => {
  assert.equal(defaultIdePreferences.theme, 'dark');
  assert.deepEqual(parseIdePreferences('{broken json'), defaultIdePreferences);
  assert.deepEqual(parseIdePreferences(null), defaultIdePreferences);
});

test('IDE 个性化偏好合并布局、主题与键位覆盖', () => {
  const preferences = parseIdePreferences(
    JSON.stringify({
      theme: 'light',
      layout: { leftPanelWidth: 320, bottomPanelHeight: 280, rightDockWidth: 360 },
      keybindings: { 'judge.run': 'Alt+J' },
    }),
  );

  assert.equal(preferences.theme, 'light');
  assert.equal(preferences.layout.leftPanelWidth, 320);
  assert.equal(preferences.layout.bottomPanelHeight, 280);
  assert.equal(preferences.layout.rightDockWidth, 360);
  assert.equal(preferences.keybindings['judge.run'], 'Alt+J');

  const merged = mergeIdePreferences(preferences, {
    theme: 'dark',
    layout: { bottomPanelHeight: 300 },
  });
  assert.equal(merged.theme, 'dark');
  assert.equal(merged.layout.leftPanelWidth, 320);
  assert.equal(merged.layout.bottomPanelHeight, 300);
  assert.equal(serializeIdePreferences(merged).includes('bottomPanelHeight'), true);
});

test('自定义键位覆盖默认键位且不修改默认 keymap', () => {
  const resolved = resolveIdeKeymap({ 'judge.run': 'Alt+J' });

  assert.equal(findCommandByShortcut('Alt+J', resolved)?.commandId, 'judge.run');
  assert.equal(findCommandByShortcut('Ctrl+Alt+J', resolved), undefined);
  assert.equal(findCommandByShortcut('Ctrl+Alt+J', ideKeymap)?.commandId, 'judge.run');
});

test('编辑器 pop-out URL 保留 tab 与 active 状态', () => {
  const url = createEditorPopoutUrl({
    workspace: 'default',
    bookId: 42,
    tabs: ['chapter:7'],
    activeTabId: 'chapter:7',
    leftPanel: 'explorer',
    bottomPanel: 'problems',
  });

  assert.equal(
    url,
    '/ide?workspace=default&book=42&tab=chapter%3A7&active=chapter%3A7&panel.left=explorer&panel.bottom=problems&window=editor',
  );
});

test('PersonalizationPanel 渲染主题、键位和布局持久化摘要', () => {
  const html = renderToStaticMarkup(
    React.createElement(PersonalizationPanel, {
      preferences: mergeIdePreferences(defaultIdePreferences, {
        theme: 'light',
        keybindings: { 'judge.run': 'Alt+J' },
      }),
    }),
  );

  assert.ok(html.includes('IDE 个性化'));
  assert.ok(html.includes('主题：light'));
  assert.ok(html.includes('judge.run → Alt+J'));
  assert.ok(html.includes('布局持久化'));
});

test('IdeShell 暴露个性化面板和编辑器新窗口入口', () => {
  const html = renderToStaticMarkup(
    React.createElement(IdeShell, {
      initialState: {
        workspace: 'default',
        bookId: 42,
        tabs: ['chapter:7'],
        activeTabId: 'chapter:7',
      },
    }),
  );

  assert.ok(html.includes('data-testid="ide-personalization"'));
  assert.ok(html.includes('IDE 个性化'));
  assert.ok(html.includes('拆到新窗口'));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('window=editor'));
});
