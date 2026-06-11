import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AgentSidebar } from '../components/ide/agent/AgentSidebar';
import { executeIdeCommand } from '../components/ide/commands/command-client';
import { createCommandRegistry } from '../components/ide/commands/registry';
import { registerBuiltinCommands } from '../components/ide/commands/registerBuiltinCommands';
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
      const delegatesToCommand =
        /commands\.execute|onExecuteCommand|executeCommand|registry\.execute/.test(blockText);
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

function collectOnClickBlocks(
  lines: readonly string[],
): Array<{ startLine: number; lines: string[] }> {
  const blocks: Array<{ startLine: number; lines: string[] }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('onClick')) continue;
    const blockLines = [lines[index]];
    let balance = bracketBalance(lines[index]);
    for (
      let cursor = index + 1;
      cursor < Math.min(lines.length, index + 20) && balance > 0;
      cursor += 1
    ) {
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

test('command-client 只调用同源 IDE 命令 BFF，不导入服务端 api-client', async () => {
  const source = readFileSync(
    join(process.cwd(), 'components', 'ide', 'commands', 'command-client.ts'),
    'utf8',
  );
  assert.ok(!source.includes('../../../lib/api-client'));
  assert.ok(source.includes('fetch(`/api/ide/commands/'));

  const originalFetch = globalThis.fetch;
  const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        command_id: 'judge.run',
        status: 'accepted',
        audit_event_id: 'audit:judge.run',
        payload: { ok: true },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const result = await executeIdeCommand('judge.run', { scene_packet_id: 42 });

    assert.equal(result.audit_event_id, 'audit:judge.run');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/ide/commands/judge.run');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, JSON.stringify({ args: { scene_packet_id: 42 } }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
