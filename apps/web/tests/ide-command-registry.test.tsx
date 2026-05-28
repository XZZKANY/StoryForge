import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AgentSidebar } from '../components/ide/agent/AgentSidebar';
import { createCommandRegistry } from '../components/ide/commands/registry';
import { registerBuiltinCommands } from '../components/ide/commands/registerBuiltinCommands';
import { CommandPalette, filterCommands } from '../components/ide/commands/palette';
import { findCommandByShortcut, ideKeymap } from '../components/ide/keymap/index';
import { RightDock } from '../components/ide/shell/RightDock';

test('CommandRegistry 注册并执行内置写命令', async () => {
  const calls: Array<{ commandId: string; args: Record<string, unknown> }> = [];
  const registry = createCommandRegistry({
    executeRemote: async (commandId, args) => {
      calls.push({ commandId, args });
      return {
        command_id: commandId,
        status: 'accepted',
        audit_event_id: `audit:${commandId}`,
        payload: { args },
      };
    },
  });
  registerBuiltinCommands(registry);

  const result = await registry.execute('judge.repair', { issue_id: 7 });

  assert.equal(result.audit_event_id, 'audit:judge.repair');
  assert.deepEqual(calls, [{ commandId: 'judge.repair', args: { issue_id: 7 } }]);
  assert.ok(registry.list().some((command) => command.id === 'bookrun.start'));
});

test('CommandPalette 按标题、分类和命令 ID 过滤命令', () => {
  const registry = createCommandRegistry();
  registerBuiltinCommands(registry);

  const filtered = filterCommands(registry.list(), 'repair');
  const html = renderToStaticMarkup(
    React.createElement(CommandPalette, { commands: filtered, query: 'repair' }),
  );

  assert.ok(filtered.some((command) => command.id === 'judge.repair'));
  assert.ok(html.includes('Command Palette'));
  assert.ok(html.includes('生成定向修复'));
  assert.ok(html.includes('judge.repair'));
});

test('keymap 将快捷键解析到 CommandRegistry 命令 ID', () => {
  assert.equal(findCommandByShortcut('Ctrl+Alt+J')?.commandId, 'judge.run');
  assert.equal(findCommandByShortcut('Ctrl+.')?.commandId, 'judge.repair');
  assert.ok(ideKeymap.some((item) => item.commandId === 'bookrun.start'));
});

test('AgentSidebar 渲染 Agent 工具且声明写操作经 CommandRegistry', () => {
  const html = renderToStaticMarkup(React.createElement(AgentSidebar));

  assert.ok(html.includes('AI Agent Sidebar'));
  assert.ok(html.includes('commands.execute'));
  assert.ok(html.includes('judge.repair'));
  assert.ok(html.includes('memory.resolve_conflict'));
  assert.ok(html.includes('audit_event_id'));
});

test('RightDock 接入 AgentSidebar', () => {
  const html = renderToStaticMarkup(React.createElement(RightDock));

  assert.ok(html.includes('Right Dock'));
  assert.ok(html.includes('AI Agent Sidebar'));
});
