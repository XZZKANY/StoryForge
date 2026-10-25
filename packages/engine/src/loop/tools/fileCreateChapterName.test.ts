// E0 回放（10-25）：对话 AI 把第一章存成「第一章.md」，按路径排在「第002章.md」后面，第二章起草找不到上一章。
import { describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from './execution';
import type { ToolDeps } from './handlerDeps';
import { patchToolHandlers } from './patchHandlers';

const seen = vi.hoisted(() => ({ draft: [] as string[], prepared: [] as string[] }));

vi.mock('../../assistant/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../assistant/service')>()),
  draftFileContent: vi.fn(async (_deps: unknown, request: { file_path: string }) => {
    seen.draft.push(request.file_path);
    return {
      content: '林煊把茶盏放回桌上。',
      summary: '已起草',
      model: 'm',
      latency_ms: 1,
      completion_tokens: 2,
      assistant_session_id: 7,
    };
  }),
}));
vi.mock('./patchContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./patchContext')>()),
  prepareRuntimeWritingContext: vi.fn(
    async (_deps: unknown, _context: unknown, payload: { file_path: string }) => {
      seen.prepared.push(payload.file_path);
      return { contextBundle: {} };
    },
  ),
}));

function handler(existing: string[]) {
  const deps = {
    reader: {
      async inspectProjectPath(_root: string, path: string) {
        const kind = existing.includes(path) ? 'file' : 'missing';
        return { entryKind: kind, targetKind: kind, isReparsePoint: false, sizeBytes: 0 };
      },
    },
    platform: 'windows',
    secrets: { values: [] },
    newHex: () => 'abc',
  } as unknown as ToolDeps;
  return patchToolHandlers(deps)['file.create']!;
}

const context = {
  run: { permission_profile: 'auto' },
  services: { assistant: {} },
  args: {},
  userMessage: '直接开始写第一章正文',
  assistantSessionId: 7,
} as unknown as ToolExecutionContext;

describe('file.create 新建正文章节', () => {
  it('drafts and proposes the chapter under 第NNN章.md, keeping the requested name in the trace', async () => {
    seen.draft.length = 0;
    seen.prepared.length = 0;
    const result = await handler([])(context, {
      file_path: '正文/第一章 筑基前夜.md',
      instruction: '写第一章',
      project_root: 'D:\\书',
    });
    expect(seen.prepared).toEqual(['正文/第001章.md']);
    expect(seen.draft).toEqual(['正文/第001章.md']);
    const output = result.output as { file_path: string; proposed_patch: { file_path: string } };
    expect(output.file_path).toBe('正文/第001章.md');
    expect(output.proposed_patch.file_path).toBe('正文/第001章.md');
    expect(result.trace?.input_summary).toMatchObject({
      file_path: '正文/第001章.md',
      requested_file_path: '正文/第一章 筑基前夜.md',
    });
  });

  it('keeps the requested name when 第001章.md already exists', async () => {
    seen.draft.length = 0;
    await handler(['正文/第001章.md'])(context, {
      file_path: '正文/第一章.md',
      instruction: '写第一章',
      project_root: 'D:\\书',
    });
    expect(seen.draft).toEqual(['正文/第一章.md']);
  });
});
