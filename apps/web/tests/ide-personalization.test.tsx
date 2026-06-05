import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  createEditorPopoutUrl,
  defaultIdePreferences,
  idePreferencesStorageKey,
  loadIdePreferences,
  mergeIdePreferences,
  parseIdePreferences,
  saveIdePreferences,
  serializeIdePreferences,
} from '../components/ide/personalization/preferences';
import { PersonalizationControls } from '../components/ide/personalization/PersonalizationControls';
import { PersonalizationPanel } from '../components/ide/personalization/PersonalizationPanel';
import { IdeShell } from '../components/ide/shell/IdeShell';
import { IdeShellPreferencesHydrator } from '../components/ide/shell/IdeShellPreferencesHydrator';

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

test('IDE 个性化偏好可写入本地存储并从同一键恢复', () => {
  const storage = new Map<string, string>();
  const preferences = mergeIdePreferences(defaultIdePreferences, {
    theme: 'light',
    layout: { leftPanelWidth: 340, bottomPanelHeight: 260, rightDockWidth: 380 },
    keybindings: { 'judge.run': 'Alt+J' },
  });

  saveIdePreferences(
    {
      setItem: (key, value) => storage.set(key, value),
      getItem: (key) => storage.get(key) ?? null,
    },
    preferences,
  );

  assert.ok(storage.has(idePreferencesStorageKey));
  assert.deepEqual(loadIdePreferences({ getItem: (key) => storage.get(key) ?? null }), preferences);
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

test('PersonalizationControls 在 IDE 内写入主题、布局和任意键位偏好', () => {
  const source = readFileSync(
    join(process.cwd(), 'components/ide/personalization/PersonalizationControls.tsx'),
    'utf8',
  );
  const html = renderToStaticMarkup(
    React.createElement(PersonalizationControls, { preferences: defaultIdePreferences }),
  );

  assert.ok(source.includes("'use client'"), '偏好写入控件必须运行在浏览器端');
  assert.ok(source.includes('saveIdePreferences(window.localStorage'), '必须写入 localStorage');
  assert.ok(source.includes('mergeIdePreferences'), '必须复用偏好合并逻辑');
  assert.ok(source.includes('preferencesChangedEvent'), '必须派发统一偏好变更事件');
  assert.ok(source.includes('name="commandId"'), '必须允许用户输入命令 ID');
  assert.ok(source.includes('name="shortcut"'), '必须允许用户输入快捷键');
  assert.ok(source.includes('[commandId]: shortcut'), '必须按用户输入写入任意命令键位');
  assert.ok(!source.includes('??'), '偏好写入控件不应残留连续问号编码损坏');
  assert.ok(html.includes('保存自定义键位'));
  assert.ok(html.includes('命令 ID'));
  assert.ok(html.includes('快捷键'));
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

test('IdeShellPreferencesHydrator 从浏览器存储水合主题和布局', () => {
  const html = renderToStaticMarkup(
    React.createElement(IdeShellPreferencesHydrator, {
      initialState: {
        workspace: 'default',
        bookId: 42,
        tabs: ['chapter:7'],
        activeTabId: 'chapter:7',
      },
      storageSnapshot: JSON.stringify({
        theme: 'light',
        layout: { leftPanelWidth: 360, bottomPanelHeight: 320, rightDockWidth: 400 },
        keybindings: { 'judge.run': 'Alt+J' },
      }),
    }),
  );

  assert.ok(html.includes('data-ide-preferences-source="storage"'));
  assert.ok(html.includes('data-ide-theme="light"'));
  assert.ok(html.includes('--ide-left-panel-width:360px'));
  assert.ok(html.includes('--ide-bottom-panel-height:320px'));
  assert.ok(html.includes('--ide-right-dock-width:400px'));
  assert.ok(html.includes('judge.run → Alt+J'));
});

test('IdeShell 暴露个性化面板、布局变量和编辑器新窗口入口', () => {
  const html = renderToStaticMarkup(
    React.createElement(IdeShell, {
      initialState: {
        workspace: 'default',
        bookId: 42,
        tabs: ['chapter:7'],
        activeTabId: 'chapter:7',
      },
      initialPreferences: mergeIdePreferences(defaultIdePreferences, {
        theme: 'light',
        layout: { leftPanelWidth: 320, bottomPanelHeight: 300, rightDockWidth: 360 },
        keybindings: { 'judge.run': 'Alt+J' },
      }),
    }),
  );

  assert.ok(html.includes('data-testid="ide-personalization"'));
  assert.ok(html.includes('data-ide-theme="light"'));
  assert.ok(html.includes('--ide-left-panel-width:320px'));
  assert.ok(html.includes('--ide-bottom-panel-height:300px'));
  assert.ok(html.includes('--ide-right-dock-width:360px'));
  assert.ok(html.includes('judge.run → Alt+J'));
  assert.ok(html.includes('拆到新窗口'));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('window=editor'));
});
