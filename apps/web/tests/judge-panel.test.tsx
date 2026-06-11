import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { JudgeIssueList, type JudgeIssue } from '../components/judge-panel/JudgeIssueList';

const sampleIssues: JudgeIssue[] = [
  { id: 'iss-1', severity: '高', location: '[12-30]', message: '人物动机不一致' },
  {
    id: 'iss-2',
    severity: '中',
    location: '[40-60]',
    message: '场景描写过于冗长',
    detail: '建议精简至 3 句',
  },
];

test('JudgeIssueList 空列表渲染占位文案', () => {
  const html = renderToStaticMarkup(React.createElement(JudgeIssueList, { issues: [] }));
  assert.ok(html.includes('暂无评审问题'));
});

test('JudgeIssueList 渲染批量操作工具栏', () => {
  const html = renderToStaticMarkup(React.createElement(JudgeIssueList, { issues: sampleIssues }));
  assert.ok(html.includes('批量接受'));
  assert.ok(html.includes('批量拒绝'));
  assert.ok(html.includes('全选'));
});

test('JudgeIssueList 可显示仅本页标记的不持久化提示', () => {
  const html = renderToStaticMarkup(
    React.createElement(JudgeIssueList, {
      issues: sampleIssues,
      decisionNotice: '仅本页标记，不会写回后端。',
    }),
  );

  assert.ok(html.includes('仅本页标记，不会写回后端。'));
});

test('JudgeIssueList 渲染每个问题的可选与可展开控件', () => {
  const html = renderToStaticMarkup(React.createElement(JudgeIssueList, { issues: sampleIssues }));
  assert.ok(html.includes('严重级别：高'));
  assert.ok(html.includes('严重级别：中'));
  assert.ok(html.includes('展开详情'));
  assert.ok(html.includes('选择问题 iss-1'));
  assert.ok(html.includes('未决'));
});

test('JudgeIssueList 渲染严重级别样式标记', () => {
  const html = renderToStaticMarkup(React.createElement(JudgeIssueList, { issues: sampleIssues }));
  assert.ok(html.includes('data-testid="judge-issue-iss-1"'));
  assert.ok(html.includes('data-testid="judge-issue-iss-2"'));
});
