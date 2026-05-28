import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AgentSidebar } from '../components/ide/agent/AgentSidebar';
import { createCommandRegistry } from '../components/ide/commands/registry';
import { registerBuiltinCommands } from '../components/ide/commands/registerBuiltinCommands';
import { CommandPalette, filterCommands } from '../components/ide/commands/palette';
import {
  executeShortcutCommand,
  findCommandByShortcut,
  ideKeymap,
} from '../components/ide/keymap/index';
import { RightDock } from '../components/ide/shell/RightDock';


type CommandBypassFinding = {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
};

const ideComponentsRoot = join(process.cwd(), 'components', 'ide');

function assertIdeWriteButtonsUseCommandsExecute(): readonly CommandBypassFinding[] {
  return scanIdeWriteButtonBypasses(ideComponentsRoot);
}

function scanIdeWriteButtonBypasses(root: string): readonly CommandBypassFinding[] {
  if (!existsSync(root)) return [];
  const findings: CommandBypassFinding[] = [];
  for (const file of listSourceFiles(root)) {
    const source = readFileSync(file, 'utf8');
    const lines = source.split(/\r?\n/);
    for (const block of collectOnClickBlocks(lines)) {
      const blockText = block.lines.join('\n');
      const mentionsDirectApi = /\b(fetch|apiFetch)\s*\(|\/api\//.test(blockText);
      const delegatesToCommand = /commands\.execute|onExecuteCommand|executeCommand|registry\.execute/.test(blockText);
      if (mentionsDirectApi && !delegatesToCommand) {
        findings.push({
          file: file.replace(`${process.cwd()}\\`, '').replace(`${process.cwd()}/`, ''),
          line: block.startLine,
          reason: 'IDE 写操作 onClick 直接调用 API，未委托 commands.execute。',
        });
      }
    }
  }
  return findings;
}

function listSourceFiles(root: string): readonly string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...listSourceFiles(fullPath));
    } else if (/\.tsx?$/.test(entry.name)) {
      result.push(fullPath);
    }
  }
  return result;
}

function collectOnClickBlocks(lines: readonly string[]): Array<{ startLine: number; lines: string[] }> {
  const blocks: Array<{ startLine: number; lines: string[] }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('onClick')) continue;
    const blockLines = [lines[index]];
    let balance = bracketBalance(lines[index]);
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 20) && balance > 0; cursor += 1) {
      blockLines.push(lines[cursor]);
      balance += bracketBalance(lines[cursor]);
    }
    blocks.push({ startLine: index + 1, lines: blockLines });
  }
  return blocks;
}

function bracketBalance(line: string): number {
  let balance = 0;
  for (const char of line) {
    if (char === '{' || char === '(') balance += 1;
    if (char === '}' || char === ')') balance -= 1;
  }
  return balance;
}

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
  const approveResult = await registry.execute('judge.approve', { repair_patch_id: 32 });

  assert.equal(result.audit_event_id, 'audit:judge.repair');
  assert.equal(approveResult.audit_event_id, 'audit:judge.approve');
  assert.deepEqual(calls, [
    { commandId: 'judge.repair', args: { issue_id: 7 } },
    { commandId: 'judge.approve', args: { repair_patch_id: 32 } },
  ]);
  assert.ok(registry.list().some((command) => command.id === 'bookrun.start'));
  assert.ok(registry.list().some((command) => command.id === 'judge.approve'));
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
  assert.ok(html.includes('data-command-id="judge.repair"'));
  assert.ok(html.includes('执行命令'));
});

test('keymap 将快捷键解析到 CommandRegistry 命令 ID', () => {
  assert.equal(findCommandByShortcut('Ctrl+Alt+J')?.commandId, 'judge.run');
  assert.equal(findCommandByShortcut('Ctrl+.')?.commandId, 'judge.repair');
  assert.ok(ideKeymap.some((item) => item.commandId === 'bookrun.start'));
});

test('executeShortcutCommand 通过同一 CommandRegistry 执行快捷键命令', async () => {
  const calls: Array<{ commandId: string; args: Record<string, unknown> }> = [];
  const registry = createCommandRegistry({
    executeRemote: async (commandId, args) => {
      calls.push({ commandId, args });
      return { command_id: commandId, status: 'accepted', audit_event_id: null, payload: {} };
    },
  });
  registerBuiltinCommands(registry);

  const result = await executeShortcutCommand('Ctrl+Alt+J', registry, { book_id: 1 });

  assert.equal(result?.command_id, 'judge.run');
  assert.deepEqual(calls, [{ commandId: 'judge.run', args: { book_id: 1 } }]);
  assert.equal(await executeShortcutCommand('Ctrl+Alt+Unknown', registry), undefined);
});

test('AgentSidebar 渲染 Agent 工具且声明写操作经 CommandRegistry', () => {
  const html = renderToStaticMarkup(React.createElement(AgentSidebar));

  assert.ok(html.includes('AI Agent Sidebar'));
  assert.ok(html.includes('commands.execute'));
  assert.ok(html.includes('judge.repair'));
  assert.ok(html.includes('memory.resolve_conflict'));
  assert.ok(html.includes('audit_event_id'));
  assert.ok(html.includes('data-agent-message-type="command"'));
  assert.ok(html.includes('data-command-id="judge.repair"'));
  assert.ok(html.includes('&quot;type&quot;:&quot;command&quot;'));
});

test('RightDock 接入 AgentSidebar', () => {
  const html = renderToStaticMarkup(React.createElement(RightDock));

  assert.ok(html.includes('Right Dock'));
  assert.ok(html.includes('AI Agent Sidebar'));
});



test('IDE 写操作按钮不得绕过 CommandRegistry 直接调用 API', () => {
  assert.deepEqual(assertIdeWriteButtonsUseCommandsExecute(), []);
});
