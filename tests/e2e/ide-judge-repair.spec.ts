import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sources = {
  chat: readFileSync('apps/desktop/frontend/src/components/ChatWindow.tsx', 'utf8'),
  editor: readFileSync('apps/desktop/frontend/src/components/Editor.tsx', 'utf8'),
  suggestions: readFileSync('apps/desktop/frontend/src/lib/assistant-suggestions.ts', 'utf8'),
  apiClient: readFileSync('apps/desktop/frontend/src/lib/api-client.ts', 'utf8'),
  assistantEvents: readFileSync('apps/desktop/frontend/src/lib/assistant-events.ts', 'utf8'),
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

test('Desktop IDE Agent 保留工具轨迹、待确认补丁和错误状态', () => {
  assertSourceEvidence(sources.chat, [
    'tool_trace',
    'proposed_patch',
    'requires_user_confirmation',
    'isAgentErrorMessage',
    'isAgentResultMessage',
  ]);
});

test('Desktop IDE 编辑器和建议模型保留最小修订闭环', () => {
  assertSourceEvidence(sources.editor, [
    'requestRevision',
    'recordRevisionLoop',
    'emitAuthorLoopResult',
    'editor-save-btn',
  ]);
  assertSourceEvidence(sources.suggestions, [
    'createRemoteFileSuggestion',
    'createLocalFileSuggestion',
    'before',
    'after',
  ]);
});

test('IDE P2 Context Snapshot API 保留上下文回放契约', () => {
  assertSourceEvidence(sources.artifactPreviewSchema, ['context_href']);
  assertSourceEvidence(sources.artifactPreviewApi, [
    'compiled_context_id',
    '_context_href',
    '/ide?inspector=',
  ]);
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
  assertSourceEvidence(sources.apiClient, ['/api/ide/agent/sessions/', 'intent', 'tool_trace']);
  assertSourceEvidence(sources.assistantEvents, [
    'REVIEW_CURRENT_EVENT',
    'APPLY_FILE_SUGGESTION_EVENT',
    'ACCEPT_CURRENT_FILE_SUGGESTION_EVENT',
  ]);
});
