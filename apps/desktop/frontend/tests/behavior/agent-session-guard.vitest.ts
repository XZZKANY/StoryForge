import { describe, expect, it } from 'vitest';

import { isRunResultForActiveSession } from '../../src/components/chat-window/session-guard';

// 红线③：会话切换中途 run 完成不污染当前会话（修 F26）。
// isRunResultForActiveSession 是 runAuthorAgent 终态写回与 applyResumedAgentResult 的共用守卫：
// 只有当 run 起跑会话仍是当前活动会话时才允许写回（强切会话 / 追加消息 / 发补丁建议）。
describe('F26 会话切换红线③：run 完成不污染当前会话', () => {
  it('run 起跑会话仍是当前会话 → 应用结果', () => {
    expect(isRunResultForActiveSession(7, 7)).toBe(true);
  });

  it('作者已切到别的会话 → 拒绝写回（不污染新会话）', () => {
    expect(isRunResultForActiveSession(9, 7)).toBe(false);
  });

  it('新会话起跑（尚无 id）且未切走 → 应用结果并落库新会话', () => {
    expect(isRunResultForActiveSession(null, null)).toBe(true);
  });

  it('新会话起跑后切到已有会话 → 拒绝写回', () => {
    expect(isRunResultForActiveSession(5, null)).toBe(false);
  });
});
