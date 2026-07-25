import { describe, expect, it } from 'vitest';

import {
  conversationKey,
  isRunResultForActiveSession,
} from '../../src/components/chat-window/session-guard';

// 红线③：会话切换中途 run 完成不污染当前会话（修 F26）。
// isRunResultForActiveSession 是 runAuthorAgent 终态写回与 applyResumedAgentResult 的共用守卫：
// 只有当 run 起跑会话仍是当前活动会话时才允许写回（强切会话 / 追加消息 / 发补丁建议）。
// 守卫身份含 project 维度：跨项目草稿切换不得因共用 draft nonce 而碰撞（UF-04）。
describe('F26 会话切换红线③：run 完成不污染当前会话', () => {
  it('为已保存会话和草稿会话生成含 project 维度的不同命名空间 key', () => {
    expect(conversationKey('/proj', 7, 'draft-1')).toBe('project:/proj|saved:7');
    expect(conversationKey('/proj', null, 'draft-1')).toBe('project:/proj|draft:draft-1');
  });

  it.each([
    ['saved 同号同项目', conversationKey('/proj', 7, 'x'), conversationKey('/proj', 7, 'x'), true],
    ['saved 异号', conversationKey('/proj', 9, 'x'), conversationKey('/proj', 7, 'x'), false],
    [
      '同项目同 draft nonce',
      conversationKey('/proj', null, 'draft-1'),
      conversationKey('/proj', null, 'draft-1'),
      true,
    ],
    [
      '跨项目同 draft nonce（UF-04：不得碰撞）',
      conversationKey('/projB', null, 'draft-1'),
      conversationKey('/projA', null, 'draft-1'),
      false,
    ],
    [
      'draft A 起跑后切到 draft B',
      conversationKey('/proj', null, 'draft-2'),
      conversationKey('/proj', null, 'draft-1'),
      false,
    ],
    [
      'draft 起跑后切到 saved',
      conversationKey('/proj', 5, 'x'),
      conversationKey('/proj', null, 'draft-1'),
      false,
    ],
    [
      'saved 起跑后切到 draft',
      conversationKey('/proj', null, 'draft-1'),
      conversationKey('/proj', 5, 'x'),
      false,
    ],
  ])('%s → %s', (_label, activeKey, runKey, expected) => {
    expect(isRunResultForActiveSession(activeKey, runKey)).toBe(expected);
  });
});
