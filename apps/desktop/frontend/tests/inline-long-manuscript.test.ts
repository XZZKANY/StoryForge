/** 代表性长稿的范围/重建回归；计时仅作观测，不用硬阈值制造跨机器波动。 */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import {
  planInlineReviseWindow,
  spliceInlineReviseWindow,
  planAnchoredInlineDiff,
} from '../src/lib/inline-chat';

import { longManuscript as manuscript } from './support/long-manuscript';

const samples: Record<string, unknown>[] = [];

it.each(
  [10000, 50000, 100000].flatMap((size) =>
    ['paragraphs', 'blank-dialogue', 'one-line'].map((shape) => ({
      size,
      shape: shape as 'paragraphs' | 'blank-dialogue' | 'one-line',
    })),
  ),
)('small scene in $size / $shape keeps all off-anchor LF manuscript text', ({ size, shape }) => {
  const before = manuscript(size, shape);
  const lines = before.split('\n');
  let index = Math.floor(lines.length / 2);
  while (index > 0 && lines[index] === '') index -= 1;
  const anchor = { startLine: index + 1, endLine: index + 1 };
  const timings: number[] = [];
  let payloadSize = 0;
  let hunkCount = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const started = performance.now();
    const window = planInlineReviseWindow(before, anchor);
    payloadSize = window.text.length;
    const candidate = window.text.split('\n');
    candidate[index - window.startLine + 1] = '她抬头看了一眼门口，终于把纸条收了起来。';
    const assembled = spliceInlineReviseWindow(before, window, candidate.join('\n'));
    const plan = planAnchoredInlineDiff(before, assembled, anchor);
    hunkCount = plan.hunks.length;
    timings.push(performance.now() - started);
    const expected = [...lines];
    expected[index] = candidate[index - window.startLine + 1];
    expect(plan.clampedAfter).toBe(expected.join('\n'));
    expect(plan.droppedOffAnchor).toBe(0);
    expect(window.text.split('\n')[index - window.startLine + 1]).toBe(lines[index]);
  }
  samples.push({
    kind: 'selected-scene',
    size,
    shape,
    lines: lines.length,
    payloadSize,
    hunkCount,
    timingsMs: timings,
  });
});

it.each(
  [10000, 50000, 100000].flatMap((size) =>
    ['paragraphs', 'blank-dialogue', 'one-line'].map((shape) => ({
      size,
      shape: shape as 'paragraphs' | 'blank-dialogue' | 'one-line',
    })),
  ),
)('supported whole-file $size / $shape reconstructs the complete candidate', ({ size, shape }) => {
  const before = manuscript(size, shape);
  const originalLines = before.split('\n');
  const after = originalLines.map((line) => (line ? '修订：' + line : line)).join('\n');
  const anchor = { startLine: 1, endLine: originalLines.length };
  const started = performance.now();
  const window = planInlineReviseWindow(before, anchor);
  expect(window.text).toBe(before);
  const plan = planAnchoredInlineDiff(before, after, anchor);
  const elapsed = performance.now() - started;
  expect(plan.clampedAfter).toBe(after);
  expect(plan.droppedOffAnchor).toBe(0);
  samples.push({
    kind: 'whole-file',
    size,
    shape,
    lines: originalLines.length,
    payloadSize: window.text.length,
    hunkCount: plan.hunks.length,
    elapsedMs: elapsed,
  });
});

it('100k repeated text with off-window drift cannot change protected leading/trailing lines', () => {
  const before = manuscript(100000, 'blank-dialogue');
  const lines = before.split('\n');
  const index = lines.findIndex((line, i) => i > lines.length / 2 && line !== '');
  const anchor = { startLine: index + 1, endLine: index + 1 };
  const window = planInlineReviseWindow(before, anchor);
  const candidate = window.text.split('\n');
  candidate[0] = '越界改写';
  candidate[index - window.startLine + 1] = '“这次不等了。”';
  candidate[candidate.length - 1] = '越界结尾';
  const plan = planAnchoredInlineDiff(
    before,
    spliceInlineReviseWindow(before, window, candidate.join('\n')),
    anchor,
  );
  const expected = [...lines];
  expected[index] = '“这次不等了。”';
  expect(plan.clampedAfter).toBe(expected.join('\n'));
  expect(plan.droppedOffAnchor).toBeGreaterThan(0);
});

afterAll(() => {
  const target = process.env.STORYFORGE_LONG_TRIAL_METRICS;
  if (target)
    writeFileSync(
      target,
      JSON.stringify(
        {
          runtime: 'Node/Vitest production pure functions; not browser rendering or native desktop',
          samples,
        },
        null,
        2,
      ),
    );
});

it('review: adversarial response above LCS budget preserves all off-anchor lines', () => {
  const lines = Array.from({ length: 3200 }, (_, i) => `原稿${i}：夜雨落在窗边，门外还没有人来。`);
  const before = lines.join('\n');
  const after = lines.map((line, i) => `越界候选${i}：${line}`).join('\n');
  const index = 1600;
  const result = planAnchoredInlineDiff(before, after, {
    startLine: index + 1,
    endLine: index + 1,
  });
  const expected = [...lines];
  expected[index] = after.split('\n')[index];
  expect(result.clampedAfter).toBe(expected.join('\n'));
  expect(result.droppedOffAnchor).toBeGreaterThan(0);
});
it('review: oversized ambiguous unequal response fails closed instead of touching unselected lines', () => {
  const before = Array.from({ length: 3200 }, (_, i) => `原稿${i}：正文`).join('\n');
  const after = Array.from({ length: 3201 }, (_, i) => `候选${i}：替换`).join('\n');
  const result = planAnchoredInlineDiff(before, after, { startLine: 1601, endLine: 1601 });
  expect(result.clampedAfter).toBe(before);
  expect(result.isNoop).toBe(true);
  expect(result.droppedOffAnchor).toBeGreaterThan(0);
});
it.each([1, 1500, 3000])(
  'review: repeated long paragraphs at anchor %s cannot redirect edits',
  (line) => {
    const lines = Array.from(
      { length: 3000 },
      () => '“再等一会儿。”夜雨落在窗边，门外还没有人来。',
    );
    const before = lines.join('\n');
    const anchor = { startLine: line, endLine: line };
    const window = planInlineReviseWindow(before, anchor);
    const candidate = window.text.split('\n');
    candidate[line - window.startLine] = '这次我不等了。';
    const result = planAnchoredInlineDiff(
      before,
      spliceInlineReviseWindow(before, window, candidate.join('\n')),
      anchor,
    );
    const expected = [...lines];
    expected[line - 1] = '这次我不等了。';
    expect(result.clampedAfter).toBe(expected.join('\n'));
  },
);
it('review: window request normalizes CRLF and keeps normalized off-anchor content', () => {
  const lines = Array.from({ length: 3000 }, (_, i) => `原稿${i}：正文`);
  const before = lines.join('\r\n');
  const anchor = { startLine: 1500, endLine: 1500 };
  const window = planInlineReviseWindow(before, anchor);
  const candidate = window.text.split('\n');
  candidate[1500 - window.startLine] = '改好正文';
  const result = planAnchoredInlineDiff(
    before,
    spliceInlineReviseWindow(before, window, candidate.join('\n')),
    anchor,
  );
  const expected = [...lines];
  expected[1499] = '改好正文';
  expect(result.clampedAfter).toBe(expected.join('\n'));
});
