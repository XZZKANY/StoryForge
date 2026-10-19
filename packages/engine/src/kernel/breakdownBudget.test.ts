import { describe, expect, it } from 'vitest';
import { ANALYSIS_KEYS, BreakdownCancellations, runBookBreakdown } from './bookBreakdown';
import { memoryProject } from './memoryProject.test-support';

const ROOT = 'D:/book';
function encoded(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return { chunks: [{ base64: btoa(binary), repeat: 1 }] };
}
const reply = JSON.stringify(Object.fromEntries(ANALYSIS_KEYS.map((key) => [key, '分析'])));
const HUGE = '长'.repeat(120_001);

function breakdown(text: string, callLlm: (request: { userPrompt: string }) => Promise<string>) {
  const project = memoryProject(ROOT, { '参考/长篇.txt': encoded(text) });
  const prompts: string[] = [];
  let cancelled = false;
  const run = runBookBreakdown(project.reader, project.writer, ROOT, {
    platform: 'windows',
    analysisId: 'feedfacefeedfacefeedfacefeedface',
    model: {
      provider: 'openai',
      model: 'fake-model',
      callLlm: async (request) => {
        prompts.push(request.userPrompt);
        return { content: await callLlm(request) };
      },
    },
    cancellation: { isCancelled: () => cancelled },
    cancellations: new BreakdownCancellations(),
    newAnalysisId: () => 'feedfacefeedfacefeedfacefeedface',
  });
  return { run, prompts, cancel: () => (cancelled = true) };
}

describe('book breakdown context budget', () => {
  it('does not ask the model about chapters it never got to read', async () => {
    const { run, prompts } = breakdown(HUGE, async () => reply);
    const output = (await run) as unknown as { status: string; model_error?: string };
    expect(prompts).toEqual([]);
    expect(output.status).toBe('completed_deterministic');
    expect(output.model_error).toBe('selected_context_empty');
  });

  it('skips a chapter too long for the budget but still reads the shorter ones after it', async () => {
    const text = `第1章 开头\n${HUGE}\n第2章 后面\n短正文。\n`;
    const { run, prompts } = breakdown(text, async () => reply);
    const output = (await run) as unknown as { status: string };
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('短正文。');
    expect(prompts[0]).not.toContain('长长长长');
    expect(output.status).toBe('completed');
  });
});

describe('book breakdown cancellation', () => {
  it('does not send the retry after the author cancelled during a failed first request', async () => {
    const { run, prompts, cancel } = breakdown('第1章 开头\n正文。\n', async () => {
      cancel();
      return '这不是 JSON';
    });
    const output = (await run) as unknown as { status: string };
    expect(prompts).toHaveLength(1);
    expect(output.status).toBe('cancelled');
  });
});
