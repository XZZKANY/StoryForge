import { describe, expect, it } from 'vitest';

import {
  shouldShowAgentRunRecovery,
  type AgentRunRecoveryDisplay,
} from '../../src/components/chat-window/recovery';

// 修 #11：AI 修订接受后（run 转 completed）「状态：暂停 / 等待权限 / 最近边界」恢复卡片常驻。
const display: AgentRunRecoveryDisplay = {
  statusText: '状态：暂停',
  resumeText: '恢复：等待你确认',
  pendingText: '等待权限：file.revise；有待你确认的修订（#60）',
  latestControlText: null,
  boundaryText: '最近边界：file.revise · completed',
  checkpointText: null,
  tone: 'waiting',
  canRetryFromCheckpoint: false,
  manualRestartRequired: false,
};

describe('#11 恢复卡片可见性', () => {
  it('completed / stopped 后隐藏恢复卡片', () => {
    expect(shouldShowAgentRunRecovery('completed', display)).toBe(false);
    expect(shouldShowAgentRunRecovery('stopped', display)).toBe(false);
  });

  it('paused / waiting / failed / running 仍展示', () => {
    expect(shouldShowAgentRunRecovery('paused', display)).toBe(true);
    expect(shouldShowAgentRunRecovery('waiting', display)).toBe(true);
    expect(shouldShowAgentRunRecovery('failed', display)).toBe(true);
    expect(shouldShowAgentRunRecovery('running', display)).toBe(true);
  });

  it('无恢复数据时不展示', () => {
    expect(shouldShowAgentRunRecovery('paused', null)).toBe(false);
  });
});
