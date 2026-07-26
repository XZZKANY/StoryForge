import { describe, expect, it } from 'vitest';

import { planCursorInsertion } from '../src/lib/inline-chat';
import { parseContinueSseFrame, resolveContinueAnchorLine } from '../src/lib/inline-continue';

describe('planCursorInsertion', () => {
  it('在非空行之后插入时补一个空行，另起段落', () => {
    const plan = planCursorInsertion('他推开门。', 1, '雪扑在脸上。');
    expect(plan.isNoop).toBe(false);
    expect(plan.clampedAfter).toBe('他推开门。\n\n雪扑在脸上。');
    expect(plan.hunks).toHaveLength(1);
    expect(plan.hunks[0].newLines).toEqual(['', '雪扑在脸上。']);
  });

  it('落点已是空行时不再补空行', () => {
    const plan = planCursorInsertion('他推开门。\n', 2, '雪扑在脸上。');
    expect(plan.clampedAfter).toBe('他推开门。\n\n雪扑在脸上。');
    expect(plan.hunks[0].newLines).toEqual(['雪扑在脸上。']);
  });

  it('产出纯新增 hunk：不红标任何旧行', () => {
    const plan = planCursorInsertion('第一段。\n\n第二段。', 3, '第三段。');
    const hunk = plan.hunks[0];
    expect(hunk.removedStartLine).toBeNull();
    expect(hunk.removedEndLine).toBeNull();
    expect(hunk.removedLineCount).toBe(0);
    expect(plan.removedLines).toBe(0);
    expect(plan.droppedOffAnchor).toBe(0);
  });

  it('段间空行不会让新增被当成 drift 丢弃', () => {
    // 这是 planAnchoredInlineDiff 走 LCS 时会踩的坑：空行被吃进公共前缀，
    // 纯新增的 afterLineNumber 落到锚定容忍窗口之外 → 整段续写静默消失。
    const plan = planCursorInsertion('第一段。\n\n第二段。\n', 1, '插进来的新段。');
    expect(plan.isNoop).toBe(false);
    expect(plan.droppedOffAnchor).toBe(0);
    expect(plan.clampedAfter).toBe('第一段。\n\n插进来的新段。\n\n第二段。\n');
  });

  it('落点越界自动夹取，不抛错', () => {
    expect(planCursorInsertion('只有一行。', 999, '新段。').clampedAfter).toBe('只有一行。\n\n新段。');
    expect(planCursorInsertion('只有一行。', -5, '新段。').clampedAfter).toBe('新段。\n只有一行。');
  });

  it('空续写文本 = noop，不产生 hunk 也不改内容', () => {
    const plan = planCursorInsertion('原文。', 1, '   \n  ');
    expect(plan.isNoop).toBe(true);
    expect(plan.hunks).toHaveLength(0);
    expect(plan.clampedAfter).toBe('原文。');
  });

  it('CRLF 输入归一为 LF，不把换行差异算成改动', () => {
    const plan = planCursorInsertion('第一段。\r\n\r\n第二段。', 3, '第三段。');
    expect(plan.clampedAfter).toBe('第一段。\n\n第二段。\n\n第三段。');
  });
});

describe('resolveContinueAnchorLine', () => {
  it('往上跳过连续空行，让新段紧贴上一段', () => {
    // 作者写完一段习惯连敲两下回车再停手，光标落在第 4 行空行上。
    expect(resolveContinueAnchorLine('第一段。\n\n\n', 4)).toBe(1);
  });

  it('光标已在正文行上时原样返回', () => {
    expect(resolveContinueAnchorLine('第一段。\n第二段。', 2)).toBe(2);
  });

  it('全空文件回到文件顶部', () => {
    expect(resolveContinueAnchorLine('\n\n\n', 3)).toBe(0);
  });

  it('越界夹取', () => {
    expect(resolveContinueAnchorLine('第一段。', 999)).toBe(1);
    expect(resolveContinueAnchorLine('第一段。', -3)).toBe(0);
  });
});

describe('parseContinueSseFrame', () => {
  it('解析 start 帧', () => {
    const frame = parseContinueSseFrame(
      'event: start\ndata: {"assistant_session_id": 7, "model": "m1"}',
    );
    expect(frame).toEqual({ kind: 'start', assistantSessionId: 7, model: 'm1' });
  });

  it('解析 delta 帧', () => {
    expect(parseContinueSseFrame('event: delta\ndata: {"text": "雪落"}')).toEqual({
      kind: 'delta',
      text: '雪落',
    });
  });

  it('解析 done 帧', () => {
    const frame = parseContinueSseFrame(
      'event: done\ndata: {"text": "定稿。", "model": "m1", "assistant_session_id": 7}',
    );
    expect(frame).toEqual({ kind: 'done', text: '定稿。', model: 'm1', assistantSessionId: 7 });
  });

  it('解析 error 帧', () => {
    expect(parseContinueSseFrame('event: error\ndata: {"message": "上游 502"}')).toEqual({
      kind: 'error',
      message: '上游 502',
    });
  });

  it('坏 JSON / 未知事件 / 缺字段一律返回 null 而不是抛错', () => {
    expect(parseContinueSseFrame('event: delta\ndata: {不是JSON')).toBeNull();
    expect(parseContinueSseFrame('event: heartbeat\ndata: {}')).toBeNull();
    expect(parseContinueSseFrame('data: {"text":"x"}')).toBeNull();
    expect(parseContinueSseFrame('')).toBeNull();
  });

  it('容忍 CRLF 行尾', () => {
    expect(parseContinueSseFrame('event: delta\r\ndata: {"text": "x"}')).toEqual({
      kind: 'delta',
      text: 'x',
    });
  });
});
