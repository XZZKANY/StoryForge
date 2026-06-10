import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

test('Assistant action 统一通过工具适配器写入 tool call', () => {
  const adapterPath = join(root, 'components', 'home', 'assistant-tools', 'tool-call-writer.ts');
  assert.ok(existsSync(adapterPath), 'Assistant tool call 写入必须集中在共享适配器中');

  const adapterSource = read('components/home/assistant-tools/tool-call-writer.ts');
  assert.ok(
    adapterSource.includes('createAssistantToolCall'),
    '共享适配器负责调用 AssistantToolCall API',
  );

  for (const actionPath of [
    'components/home/assistant-book-run-actions.ts',
    'components/home/assistant-chapter-review-actions.ts',
    'components/home/assistant-artifact-export-actions.ts',
  ] as const) {
    const source = read(actionPath);
    assert.ok(
      source.includes('assistant-tools/tool-call-writer'),
      `${actionPath} 必须复用共享 tool call 写入适配器`,
    );
    assert.ok(
      !source.includes('createAssistantToolCall'),
      `${actionPath} 不应直接调用 createAssistantToolCall`,
    );
  }
});
