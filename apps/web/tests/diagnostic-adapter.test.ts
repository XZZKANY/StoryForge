import assert from 'node:assert/strict';
import { test } from 'node:test';

import { judgeIssueToDiagnostic } from '../../../packages/shared/src/diagnostic';

test('judgeIssueToDiagnostic 将 high JudgeIssue 映射为 error 并提供修复命令', () => {
  const diagnostic = judgeIssueToDiagnostic({
    id: 42,
    scene_id: 7,
    category: 'setting_conflict',
    severity: 'high',
    span_start: 3,
    span_end: 9,
    summary: '设定冲突',
    evidence_links: [{ source_ref: 'asset:1', quote: '北岸灯塔' }],
  });

  assert.deepEqual(diagnostic, {
    id: 'judge:42',
    severity: 'error',
    code: 'setting_conflict',
    message: '设定冲突',
    range: { start: 3, end: 9 },
    source: 'judge',
    evidence: [{ source_ref: 'asset:1', quote: '北岸灯塔' }],
    quickFixes: [
      {
        command_id: 'judge.repair',
        title: '生成定向修复',
        args: { issue_id: 42, scene_id: 7 },
      },
    ],
  });
});
