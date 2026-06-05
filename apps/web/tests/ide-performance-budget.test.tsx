import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { Diagnostic } from '../../../packages/shared/src/diagnostic';
import { ChapterEditor } from '../components/ide/editors/ChapterEditor';
import { ProblemsPanel } from '../components/ide/panels/ProblemsPanel';
import {
  createIdePerformanceBaseline,
  evaluateIdePerformanceBaseline,
  idePerformanceBudgets,
  measureIdePerformance,
} from '../components/ide/performance/budgets';

function createDiagnostics(count: number): Diagnostic[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `judge:${index + 1}`,
    severity: index % 2 === 0 ? 'error' : 'warning',
    code: 'setting_conflict',
    message: `第 ${index + 1} 个设定冲突`,
    range: { start: index * 2, end: index * 2 + 1 },
    source: 'judge',
    quickFixes: [
      { command_id: 'judge.repair', title: '生成定向修复', args: { issue_id: index + 1 } },
    ],
  }));
}

test('IDE 性能预算基线记录 1000 Problems 和 1 万字章节', () => {
  assert.equal(idePerformanceBudgets['1000 Problems SSR render'], 100);
  const diagnostics = createDiagnostics(1000);
  const longChapter = `${'雾港航线。'.repeat(1000)}\n\n${'角色沿着潮湿街道前进。'.repeat(500)}`;
  assert.ok(longChapter.length >= 10000, '测试章节必须达到 1 万字级别');

  const problemsMetric = measureIdePerformance('1000 Problems SSR render', () => {
    const html = renderToStaticMarkup(React.createElement(ProblemsPanel, { diagnostics }));
    assert.ok(html.includes('data-total-diagnostics="1000"'));
    assert.ok(html.includes('data-rendered-diagnostics="80"'));
    assert.ok(html.includes('data-diagnostic-id="judge:80"'));
    assert.ok(!html.includes('data-diagnostic-id="judge:1000"'));
    assert.ok(html.includes('仅渲染 80 / 1000 条诊断'));
    assert.ok(!html.includes('???'));
  });
  const chapterMetric = measureIdePerformance('10k ChapterEditor SSR render', () => {
    const html = renderToStaticMarkup(
      React.createElement(ChapterEditor, {
        content: longChapter,
        diagnostics: diagnostics.slice(0, 8),
        onChange: () => undefined,
      }),
    );
    assert.ok(html.includes('data-editor-engine="codemirror6"'));
  });
  const baseline = createIdePerformanceBaseline([problemsMetric, chapterMetric]);
  const evaluation = evaluateIdePerformanceBaseline(baseline, idePerformanceBudgets);

  assert.equal(evaluation.status, 'pass');
  assert.equal(evaluation.violations.length, 0);
  assert.ok(baseline.metrics.some((metric) => metric.name === '1000 Problems SSR render'));

  const reportPath = resolve(process.cwd(), '../../.codex/ide-performance-baseline.json');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ baseline, evaluation }, null, 2), 'utf8');
});
