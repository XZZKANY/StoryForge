import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamContinueProse } from '../src/lib/api/assistant';
import { loadInlineContinueContext } from '../src/lib/inline-continue-context';
import { buildContextBundle, readProjectKnowledgeSelection } from '../src/lib/project-context';

vi.mock('../src/lib/project-context', () => ({
  buildContextBundle: vi.fn(),
  readProjectKnowledgeSelection: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('shortcut continuation context', () => {
  it('loads pins for this project and the actual target, then serializes the bundle', async () => {
    vi.mocked(readProjectKnowledgeSelection).mockReturnValue(['knowledge/钥匙.md']);
    vi.mocked(buildContextBundle).mockResolvedValue({
      projectRoot: 'D:/Books/current',
      currentFile: 'D:/Books/current/正文/第03章.md',
      files: [
        {
          path: 'D:/Books/current/knowledge/钥匙.md',
          relativePath: 'knowledge/钥匙.md',
          kind: 'knowledge',
          title: '钥匙',
          excerpt: 'SHORTCUT_PIN_SENTINEL',
        },
      ],
      summary: { counts: {}, hasStoryStructure: false },
    });
    const bundle = await loadInlineContinueContext(
      'D:/Books/current',
      'D:/Books/current/正文/第03章.md',
    );
    expect(buildContextBundle).toHaveBeenCalledWith({
      projectPath: 'D:/Books/current',
      currentFile: 'D:/Books/current/正文/第03章.md',
      pinnedFiles: ['knowledge/钥匙.md'],
    });
    const requests: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init: RequestInit) => {
        requests.push(init);
        return new Response(
          'event: done\ndata: {"text":"新段。","model":"fake","assistant_session_id":1}\n\n',
          {
            headers: { 'Content-Type': 'text/event-stream' },
          },
        );
      }),
    );
    const result = await streamContinueProse({
      filePath: '正文/第03章.md',
      content: '前文。',
      cursorLine: 1,
      projectRoot: 'D:/Books/current',
      contextBundle: bundle ?? undefined,
    });
    expect(result.text).toBe('新段。');
    const body = JSON.parse(String(requests[0].body));
    expect(body.context_bundle.project_root).toBe('D:/Books/current');
    expect(body.context_bundle.files[0].relative_path).toBe('knowledge/钥匙.md');
    expect(body.context_bundle.files[0].excerpt).toBe('SHORTCUT_PIN_SENTINEL');
  });

  it('without a project does not load unrelated preferences', async () => {
    expect(await loadInlineContinueContext(null, 'chapter.md')).toBeNull();
    expect(readProjectKnowledgeSelection).not.toHaveBeenCalled();
    expect(buildContextBundle).not.toHaveBeenCalled();
  });

  it('does not fabricate an empty bundle when context loading fails', async () => {
    vi.mocked(buildContextBundle).mockRejectedValueOnce(new Error('context read failed'));
    await expect(loadInlineContinueContext('D:/Books/current', 'chapter.md')).rejects.toThrow(
      'context read failed',
    );
  });
});
