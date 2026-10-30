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
  assert.match(html, /已思考 · 2 步</);
  assert.doesNotMatch(html, /工具/);
  assert.doesNotMatch(html, /sf-thinking-dots/);
  assert.doesNotMatch(html, /text-error/);
  assert.match(html, /aria-expanded="false"/);
});

test('failed：头部 error 色显示「已失败 · N 步」并带 ✗ 标记，默认展开列出失败步', () => {
  const html = renderToStaticMarkup(<AgentStepsPanel run={makeRun('failed')} />);
  assert.match(html, /data-testid="thinking-settled-header"/);
  assert.match(html, /text-error/);
  assert.match(html, /已失败 · 2 步 ✗/);
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
  assert.match(html, /已停止 · 2 步</);
  assert.doesNotMatch(html, /思考中/);
  assert.doesNotMatch(html, /sf-thinking-dots/);
  assert.doesNotMatch(html, /text-error/);
  assert.match(html, /aria-expanded="false"/);
});

test('paused：显示「已暂停 · N 步」，动画停止，保持展开等待恢复', () => {
  const html = renderToStaticMarkup(<AgentStepsPanel run={makeRun('paused')} />);
  assert.match(html, /已暂停 · 2 步</);
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
  assert.match(html, /等你决定 · 2 步</);
  assert.doesNotMatch(html, /工具/);
  assert.doesNotMatch(html, /等待作者确认/);
  assert.match(html, /aria-expanded="true"/);
});

test('作者拒绝了修改：头部写「已拒绝」，不用错误色、不打 ✗，默认收起', () => {
  const html = renderToStaticMarkup(
    <AgentStepsPanel run={{ ...makeRun('failed'), rejectedByAuthor: true }} />,
  );
  assert.match(html, /已拒绝 · 2 步</);
  assert.doesNotMatch(html, /已失败/);
  assert.doesNotMatch(html, /text-error"[^>]*data-testid="thinking-settled-header"/);
  assert.doesNotMatch(html, /2 步 ✗/);
  assert.match(html, /aria-expanded="false"/);
});

const loopSummary = (status: 'completed' | 'failed', detail: string): AgentStep => ({
  id: 'plan-0-agent.loop',
  title: '整理回答',
  tool: 'agent.loop',
  status,
  detail,
});

const readStep: AgentStep = {
  id: 'tool-0-fs.read',
  title: '读取 大纲/总纲.md',
  tool: 'fs.read',
  status: 'completed',
  detail: '',
};

test('完成的 run 不渲染「整理回答」收尾步，头部步数只数日志里看得到的行', () => {
  const run: AgentRun = {
    id: 'run-loop',
    sessionId: 's-1',
    goal: '改总纲',
    status: 'completed',
    steps: [
      loopSummary('completed', '完成：3 轮、2 次工具调用。'),
      readStep,
      { ...readStep, id: 'tool-1-file.revise', title: '改写 大纲/总纲.md', tool: 'file.revise' },
    ],
  };
  const html = renderToStaticMarkup(<AgentStepsPanel run={run} />);
  assert.doesNotMatch(html, /整理回答/);
  assert.doesNotMatch(html, /完成：3 轮/);
  assert.match(html, /data-testid="thinking-settled-header">已思考 · 2 步</);
  assert.doesNotMatch(html, /工具/);
});

test('收尾步失败时仍在日志里，失败原因可见', () => {
  const run: AgentRun = {
    id: 'run-loop-failed',
    sessionId: 's-1',
    goal: '改总纲',
    status: 'failed',
    steps: [loopSummary('failed', '模型连续三次超时'), readStep],
  };
  const html = renderToStaticMarkup(<AgentStepsPanel run={run} />);
  assert.match(html, /整理回答/);
  assert.match(html, /模型连续三次超时/);
  assert.match(html, /已失败 · 2 步 ✗/);
});

test('只有模型说的话、没有步骤时头部只写「已思考」，不写「· 0 步」', () => {
  const run: AgentRun = {
    id: 'run-notes',
    sessionId: 's-1',
    goal: '聊聊',
    status: 'completed',
    steps: [loopSummary('completed', '完成：2 轮、0 次工具调用。')],
    notes: [{ round: 0, toolIndex: 0, text: '先想想这一章的节奏。' }],
  };
  const html = renderToStaticMarkup(<AgentStepsPanel run={run} />);
  assert.match(html, /data-testid="thinking-settled-header">已思考</);
  assert.doesNotMatch(html, /0 步/);
});

test('工具指标是同一行右侧的淡字：用时说人话，模型名只在悬停提示里，不出灰底 chip', () => {
  const run: AgentRun = {
    id: 'run-meta',
    sessionId: 's-1',
    goal: '改总纲',
    status: 'completed',
    steps: [
      {
        id: 'tool-0-file.revise',
        title: '改写 大纲/总纲.md',
        tool: 'file.revise',
        status: 'completed',
        detail: '模型 gpt-6.1-terra；3 分 41 秒；问题 2 个',
        metrics: ['问题 2 个', '3 分 41 秒'],
        model: 'gpt-6.1-terra',
      },
    ],
  };
  const html = renderToStaticMarkup(<AgentStepsPanel run={run} />);
  assert.match(html, /data-testid="step-meta">问题 2 个 · 3 分 41 秒</);
  assert.doesNotMatch(html, /step-metric/);
  assert.doesNotMatch(html, /延迟/);
  assert.doesNotMatch(html, /ms</);
  assert.match(html, /title="改写 大纲\/总纲\.md · 模型 gpt-6\.1-terra"/);
  assert.equal(html.match(/gpt-6\.1-terra/g)?.length, 1);
  // 有右侧淡字时行内不再挂纯文本 detail，行也不是可点的 button。
  assert.doesNotMatch(html, /<button[^>]*class="flex w-full items-baseline/);
});
