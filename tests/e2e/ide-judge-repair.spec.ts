import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sources = {
  problems: readFileSync('apps/web/components/ide/panels/ProblemsPanel.tsx', 'utf8'),
  editor: readFileSync('apps/web/components/ide/editors/ChapterEditor.tsx', 'utf8'),
  diff: readFileSync('apps/web/components/ide/views/DiffViewer.tsx', 'utf8'),
  diagnosticsApi: readFileSync('apps/api/app/domains/ide/router.py', 'utf8'),
  diagnosticsService: readFileSync('apps/api/app/domains/ide/service.py', 'utf8'),
  diagnosticsTest: readFileSync('apps/api/tests/test_ide_diagnostics.py', 'utf8'),
};

function assertSourceEvidence(source, markers) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `缺少 IDE Judge/Repair 证据：${marker}`);
  }
}

test('IDE P1 Problems 面板覆盖空状态和列表状态', () => {
  assertSourceEvidence(sources.problems, [
    '当前没有诊断问题',
    'diagnostic.severity',
    'diagnostic.code',
    'diagnostic.message',
    'onSelectDiagnostic',
    'onQuickFix',
  ]);
});

test('IDE P1 章节编辑器和 Diff 视图保留最小闭环展示', () => {
  assertSourceEvidence(sources.editor, ['@codemirror', 'data-editor-engine="codemirror6"', '诊断装饰数量']);
  assertSourceEvidence(sources.diff, ['修复前', '修复后', 'before', 'after']);
});

test('IDE P1 diagnostics API 从 JudgeIssue 映射 Problems 契约', () => {
  assertSourceEvidence(sources.diagnosticsApi, ['/diagnostics', '/commands/{command_id}', '未知 IDE 命令']);
  assertSourceEvidence(sources.diagnosticsService, [
    'JudgeIssue',
    'blocking',
    'high',
    'medium',
    'low',
    'judge.repair',
  ]);
  assertSourceEvidence(sources.diagnosticsTest, ['setting_conflict', '生成定向修复', 'response.json() == []']);
});
