import { expect, it } from 'vitest';
import {
  describeAuthorInstructions,
  MAX_INSTRUCTION_CHARS,
  readAuthorInstructions,
} from './authorVoice';
import { AUTHOR_INSTRUCTIONS_PATH } from './fsTools';
import { memoryProject } from './memoryProject.test-support';

const ROOT = 'D:/book';
const file = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});

async function delivered(text: string): Promise<string> {
  const { reader } = memoryProject(ROOT, { [AUTHOR_INSTRUCTIONS_PATH]: file(text) });
  const read = await readAuthorInstructions(reader, ROOT);
  if (read === null) throw new Error('expected instructions');
  return read;
}

it('describes short instructions as delivered in full', async () => {
  const described = describeAuthorInstructions(
    await delivered('  对话用简体中文。\r\n不改人名。\n'),
  );
  expect(described).toEqual({ body: '对话用简体中文。\n不改人名。', chars: 14, truncated: false });
});

it('describes over-long instructions as the kept tail, without the engine marker', async () => {
  const head = '旧'.repeat(500);
  const tail = '新'.repeat(MAX_INSTRUCTION_CHARS);
  const described = describeAuthorInstructions(await delivered(head + tail));
  expect(described.truncated).toBe(true);
  expect(described.body).toMatch(/^新+$/);
  expect(described.chars).toBeLessThan(MAX_INSTRUCTION_CHARS);
  expect(described.chars).toBeGreaterThan(MAX_INSTRUCTION_CHARS - 40);
});

it('does not mistake an author line that merely looks like the marker for truncation', () => {
  const text = '…[作者指令过长已截断，保留最近部分]\n只有一行';
  expect(describeAuthorInstructions(text)).toEqual({
    body: text,
    chars: Array.from(text).length,
    truncated: false,
  });
});
