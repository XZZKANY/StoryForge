// 作者 10-17 巡检：AI 交回的改稿与原文一字不差（+0 / -0），界面仍说「改好了」并要作者接受或拒绝。
import { describe, expect, it, vi } from 'vitest';

import { reviseFeedback } from '../toolFeedback';
import type { ToolExecutionContext } from './execution';
import type { ToolDeps } from './handlerDeps';
import { patchToolHandlers } from './patchHandlers';

const revised = vi.hoisted(() => ({ before: '', after: '' }));

vi.mock('../../assistant/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../assistant/service')>()),
  reviseFileContent: vi.fn(async () => ({
    before: revised.before,
    after: revised.after,
    summary: '改好了',
    model: 'm',
    latency_ms: 1,
    completion_tokens: 2,
    assistant_session_id: 7,
  })),
}));
vi.mock('./patchContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./patchContext')>()),
  prepareRevisionScope: vi.fn(
    async (
      _deps: unknown,
      _context: unknown,
      _payload: unknown,
      target: { instruction: string },
    ) => [
      null,
      {
        issues: [],
        issue_ids: [],
        categories: [],
        constraints: [],
        dropped_unknown_ids: [],
        narrow: false,
      },
      target.instruction,
    ],
  ),
  prepareRuntimeWritingContext: vi.fn(async () => ({ contextBundle: {} })),
}));

function handler() {
  const deps = {
    reader: {},
    platform: 'windows',
    secrets: { values: [] },
    newHex: () => 'abc',
  } as unknown as ToolDeps;
  return patchToolHandlers(deps)['file.revise']!;
}

const context = {
  run: { permission_profile: 'ask' },
  services: { assistant: {} },
  args: {},
  userMessage: '把结尾改一改',
  assistantSessionId: 7,
} as unknown as ToolExecutionContext;

describe('file.revise 改完一字没变', () => {
  it('不生成补丁，也不进入待确认；给模型的反馈说清楚没有改动', async () => {
    revised.before = '第一段。\n结尾。\n';
    revised.after = revised.before;
    const result = await handler()(context, {
      file_path: '正文/第005章.md',
      content: revised.before,
    });
    expect(result.status).toBe('completed');
    expect(result.artifacts ?? []).toEqual([]);
    expect(result.patch_proposal).toBeUndefined();
    expect((result.output as { proposed_patch?: unknown }).proposed_patch).toBeUndefined();
    const feedback = reviseFeedback(result.output as Record<string, unknown>);
    expect(feedback.status).toBe('unchanged');
    expect(String(feedback.note)).toContain('不要说「改好了」');
  });

  it('真有改动时照旧生成待确认补丁', async () => {
    revised.before = '第一段。\n结尾。\n';
    revised.after = '第一段。\n新的结尾。\n';
    const result = await handler()(context, {
      file_path: '正文/第005章.md',
      content: revised.before,
    });
    expect(result.patch_proposal).toBeDefined();
    expect(reviseFeedback(result.output as Record<string, unknown>).status).toBe(
      'proposed_patch_created',
    );
  });
});
