import { describe, expect, it } from 'vitest';

import {
  conversationKey,
  isRunResultForActiveSession,
} from '../../src/components/chat-window/session-guard';

// 红线③：会话切换中途 run 完成不污染当前会话（修 F26）。
// isRunResultForActiveSession 是 runAuthorAgent 终态写回与 applyResumedAgentResult 的共用守卫：
// 只有当 run 起跑会话仍是当前活动会话时才允许写回（强切会话 / 追加消息 / 发补丁建议）。
describe('F26 会话切换红线③：run 完成不污染当前会话', () => {
  it('为已保存会话和草稿会话生成不同命名空间的 key', () => {
    expect(conversationKey(7, 'draft-1')).toBe('saved:7');
    expect(conversationKey(null, 'draft-1')).toBe('draft:draft-1');
  });

  it.each([
    ['saved 同号', conversationKey(7, 'unused'), conversationKey(7, 'unused'), true],
    ['saved 异号', conversationKey(9, 'unused'), conversationKey(7, 'unused'), false],
    ['同 draft nonce', conversationKey(null, 'draft-1'), conversationKey(null, 'draft-1'), true],
    [
      'draft A 起跑后切到 draft B',
      conversationKey(null, 'draft-2'),
      conversationKey(null, 'draft-1'),
      false,
    ],
    [
      'draft 起跑后切到 saved',
      conversationKey(5, 'unused'),
      conversationKey(null, 'draft-1'),
      false,
    ],
    [
      'saved 起跑后切到 draft',
      conversationKey(null, 'draft-1'),
      conversationKey(5, 'unused'),
      false,
    ],
  ])('%s → %s', (_label, activeKey, runKey, expected) => {
    expect(isRunResultForActiveSession(activeKey, runKey)).toBe(expected);
  });
});
