import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { AgentStepsPanel } from '../src/components/AgentStepsPanel';
import type { AgentRun, AgentRunStatus, AgentStep } from '../src/components/chat-window/types';

function makeSteps(finalStatus: 'completed' | 'failed'): AgentStep[] {
  return [
    { id: 'plan-0', title: '规划修订', tool: 'plan', status: 'completed', detail: '' },
    {
      id: 'tool-1-file.revise',
      title: 'file.revise',
      tool: 'file.revise',
      status: finalStatus,
      detail: '',
    },
  ];
}

function makeRun(status: AgentRunStatus): AgentRun {
  return {
    id: 'run-1',
    sessionId: 's-1',
    goal: '改稿',
    status,
    steps: makeSteps(status === 'failed' ? 'failed' : 'completed'),
  };
}

test('completed：折叠头部显示「已思考 · N 步」，无动画圆点，默认收起', () => {
  const html = renderToStaticMarkup(<AgentStepsPanel run={makeRun('completed')} />);
  assert.match(html, /已思考 · 2 步 · 1 工具/);
  assert.doesNotMatch(html, /sf-thinking-dots/);
  assert.doesNotMatch(html, /text-error/);
  assert.match(html, /aria-expanded="false"/);
});

test('failed：头部 error 色显示「已失败 · N 步」并带 ✗ 标记，默认展开列出失败步', () => {
  const html = renderToStaticMarkup(<AgentStepsPanel run={makeRun('failed')} />);
  assert.match(html, /data-testid="thinking-settled-header"/);
  assert.match(html, /text-error/);
  assert.match(html, /已失败 · 2 步 · 1 工具 ✗/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /grid-rows-\[1fr\]/);
  // 失败步的 ✗ 字形必须随默认展开一起可见（折叠态下 CSS 仍渲染 DOM，此断言锁展开标记）。
  assert.match(html, /✗<\/span><span class="flex-shrink-0 text-foreground">file\.revise/);
});

test('stopped：计入终态显示「已停止 · N 步」，动画停止，默认收起', () => {
  const html = renderToStaticMarkup(<AgentStepsPanel run={makeRun('stopped')} />);
  assert.match(html, /已停止 · 2 步 · 1 工具/);
  assert.doesNotMatch(html, /思考中/);
  assert.doesNotMatch(html, /sf-thinking-dots/);
  assert.doesNotMatch(html, /text-error/);
  assert.match(html, /aria-expanded="false"/);
});

test('paused：显示「已暂停 · N 步」，动画停止，保持展开等待恢复', () => {
  const html = renderToStaticMarkup(<AgentStepsPanel run={makeRun('paused')} />);
  assert.match(html, /已暂停 · 2 步 · 1 工具/);
  assert.doesNotMatch(html, /sf-thinking-dots/);
  assert.doesNotMatch(html, /text-error/);
  assert.match(html, /aria-expanded="true"/);
});

test('running：保留活动态动画与当前步骤标题', () => {
  const run = makeRun('running');
  run.steps[1].status = 'running';
  const html = renderToStaticMarkup(<AgentStepsPanel run={run} />);
  assert.match(html, /sf-thinking-dots/);
  assert.match(html, /file\.revise · 2 步/);
  assert.match(html, /aria-expanded="true"/);
});

test('waiting：补丁待确认仍是活动态，动画与步骤标题照常显示', () => {
  const run = makeRun('waiting');
  run.steps[1].status = 'waiting';
  run.steps[1].title = '等待作者确认';
  const html = renderToStaticMarkup(<AgentStepsPanel run={run} />);
  assert.match(html, /sf-thinking-dots/);
  assert.match(html, /等待作者确认 · 2 步/);
  assert.match(html, /aria-expanded="true"/);
});
