import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sources = {
  problems: readFileSync('apps/web/components/ide/panels/ProblemsPanel.tsx', 'utf8'),
  editor: readFileSync('apps/web/components/ide/editors/ChapterEditor.tsx', 'utf8'),
  diff: readFileSync('apps/web/components/ide/views/DiffViewer.tsx', 'utf8'),
  contextInspector: readFileSync('apps/web/components/ide/views/ContextInspector.tsx', 'utf8'),
  editorArea: readFileSync('apps/web/components/ide/shell/EditorArea.tsx', 'utf8'),
  idePage: readFileSync('apps/web/app/ide/page.tsx', 'utf8'),
  artifactViewer: readFileSync('apps/web/components/ide/views/ArtifactViewer.tsx', 'utf8'),
  ideUrlState: readFileSync('apps/web/components/ide/url/ide-url-state.ts', 'utf8'),
  artifactPreviewApi: readFileSync('apps/api/app/domains/ide/service.py', 'utf8'),
  artifactPreviewSchema: readFileSync('apps/api/app/domains/ide/schemas.py', 'utf8'),
  diagnosticsApi: readFileSync('apps/api/app/domains/ide/router.py', 'utf8'),
  diagnosticsService: readFileSync('apps/api/app/domains/ide/service.py', 'utf8'),
  diagnosticsTest: readFileSync('apps/api/tests/test_ide_diagnostics.py', 'utf8'),
  contextSnapshotTest: readFileSync('apps/api/tests/test_ide_context_snapshot.py', 'utf8'),
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
  assertSourceEvidence(sources.editor, [
    '@codemirror',
    'data-editor-engine="codemirror6"',
    '诊断装饰数量',
  ]);
  assertSourceEvidence(sources.diff, ['修复前', '修复后', 'before', 'after']);
});

test('IDE P1 Workbench 串联 Judge 到 Approve 的命令闭环', () => {
  const workbench = readFileSync(
    'apps/web/components/ide/workflows/JudgeRepairWorkbench.tsx',
    'utf8',
  );
  assertSourceEvidence(workbench, [
    'judge.run',
    'judge.repair',
    'judge.approve',
    'commands.execute',
    'audit_event_id',
  ]);
});

test('IDE P2 Context Inspector 支持 inspector URL 回放和 evicted 降级', () => {
  assertSourceEvidence(sources.ideUrlState, [
    'inspectorId',
    "params.get('inspector')",
    "params.set('inspector'",
  ]);
  assertSourceEvidence(sources.contextInspector, [
    'data-context-entry-kind',
    'data-compiled-context-id',
    'data-context-entry-href',
    'snapshot evicted at',
  ]);
  assertSourceEvidence(sources.idePage, [
    'readJson<ContextSnapshot>',
    '`/api/ide/context-snapshot/${inspectorId}`',
    'readContextSnapshot(state.inspectorId)',
  ]);
  assertSourceEvidence(sources.editorArea, [
    'data-active-inspector-id',
    '<ContextInspector',
    'contextSnapshotEvictedAt',
  ]);
  assertSourceEvidence(sources.artifactPreviewSchema, ['context_href']);
  assertSourceEvidence(sources.artifactPreviewApi, [
    'compiled_context_id',
    '_context_href',
    '/ide?inspector=',
  ]);
  assertSourceEvidence(sources.artifactViewer, ['data-context-href', 'context_href', '上下文']);
  assertSourceEvidence(sources.contextSnapshotTest, [
    '/api/ide/context-snapshot/',
    'injected_blocks',
    'dropped_blocks',
    'debug_summary',
    'snapshot evicted at unknown',
  ]);
});

test('IDE P1 diagnostics API 从 JudgeIssue 映射 Problems 契约', () => {
  assertSourceEvidence(sources.diagnosticsApi, [
    '/diagnostics',
    '/commands/{command_id}',
    'IdeCommandNotFoundError',
  ]);
  assertSourceEvidence(sources.diagnosticsService, [
    'JudgeIssue',
    'blocking',
    'high',
    'medium',
    'low',
    'judge.repair',
    '未知 IDE 命令',
  ]);
  assertSourceEvidence(sources.diagnosticsTest, [
    'setting_conflict',
    '生成定向修复',
    'response.json() == []',
  ]);
});
