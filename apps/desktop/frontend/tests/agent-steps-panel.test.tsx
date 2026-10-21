import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { AgentStepsPanel, hasProcess } from '../src/components/AgentStepsPanel';
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
  assert.match(
    html,
    /✗<\/span><span class="min-w-0 truncate text-foreground" title="file\.revise">file\.revise/,
  );
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

test('running：保留活动态动画与当前工具名，过程是限高的滚动小窗', () => {
  const run = makeRun('running');
  run.steps[1].status = 'running';
  const html = renderToStaticMarkup(<AgentStepsPanel run={run} />);
  assert.match(html, /sf-thinking-dots/);
  assert.match(html, /data-testid="thinking-active-step"[^>]*>.*file\.revise.*· 1 工具/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /data-testid="thinking-log" data-live="true"/);
  assert.match(html, /max-h-\[7\.5rem\] overflow-y-auto/);
});

test('跑完不再限高：展开就是全部步骤', () => {
  const html = renderToStaticMarkup(<AgentStepsPanel run={makeRun('completed')} />);
  assert.match(html, /data-testid="thinking-log" data-live="false"/);
  assert.doesNotMatch(html, /max-h-\[7\.5rem\]/);
});

test('纯聊天（只有「整理回答」、没调工具）跑完不留「已思考 · 1 步」；跑着时照样报「思考中」', () => {
  const loopOnly = (status: AgentRunStatus): AgentRun => ({
    id: 'run-chat',
    sessionId: 's-1',
    goal: '聊聊设定',
    status,
    steps: [
      {
        id: 'plan-0-agent.loop',
        title: '整理回答',
        tool: 'agent.loop',
        status: status === 'running' ? 'running' : 'completed',
        detail: '完成：1 轮、0 次工具调用。',
      },
    ],
  });
  for (const status of ['completed', 'failed', 'paused', 'stopped'] as const) {
    assert.equal(hasProcess(loopOnly(status)), false, status);
    assert.equal(renderToStaticMarkup(<AgentStepsPanel run={loopOnly(status)} />), '', status);
  }
  const live = renderToStaticMarkup(<AgentStepsPanel run={loopOnly('running')} />);
  assert.match(live, /思考中/);
  assert.doesNotMatch(live, /整理回答 ·/);
});

test('waiting：等作者决定时头部静止写「等你决定」，确认步骤不在思考过程里重复', () => {
  const run = makeRun('waiting');
  run.steps.push({
    id: 'approval',
    title: '等待作者确认',
    tool: 'author.approval',
    status: 'waiting',
    detail: '等待作者在编辑器里确认 diff',
  });
  const html = renderToStaticMarkup(<AgentStepsPanel run={run} />);
  assert.doesNotMatch(html, /sf-thinking-dots/);
  assert.match(html, /等你决定 · 2 步 · 1 工具/);
  assert.doesNotMatch(html, /等待作者确认/);
  assert.match(html, /aria-expanded="true"/);
});

test('作者拒绝了修改：头部写「已拒绝」，不用错误色、不打 ✗，默认收起', () => {
  const html = renderToStaticMarkup(
    <AgentStepsPanel run={{ ...makeRun('failed'), rejectedByAuthor: true }} />,
  );
  assert.match(html, /已拒绝 · 2 步 · 1 工具/);
  assert.doesNotMatch(html, /已失败/);
  assert.doesNotMatch(html, /text-error"[^>]*data-testid="thinking-settled-header"/);
  assert.doesNotMatch(html, /1 工具 ✗/);
  assert.match(html, /aria-expanded="false"/);
});
