import assert from 'node:assert/strict';
import { test } from 'vitest';

import { repairPatchApproval } from '../src/components/chat-window/agent-result';
import type { AgentResultMessage } from '../src/lib/api-client';

/**
 * P1-2 修复的行为测试：agent_result 无真实批准路径时不应进入 waiting 死路。
 *
 * 背景：useRunAuthorAgent 此前对纯文本总结和「缺少 approval_command 的 repair patch」
 * 一律按 agent_result.requires_user_confirmation 置 waiting，但前端 RunActionBar
 * 的「接受/拒绝」依赖 approvalStep.patchId，缺失时按钮静默无效，composer 被锁，
 * 作者唯一出路是切会话。
 */

function makeMessage(overrides: Partial<AgentResultMessage> = {}): AgentResultMessage {
  return {
    type: 'result',
    run_id: 'run-1',
    session_id: 'session-1',
    agent_result: { summary: 'ok', requires_user_confirmation: false },
    ...overrides,
  } as AgentResultMessage;
}

function makeRepairMessage(
  command: AgentResultMessage['proposed_patch'] extends infer P
    ? P extends { approval_command?: infer C }
      ? C
      : never
    : never,
): AgentResultMessage {
  return makeMessage({
    proposed_patch: {
      kind: 'repair_patch',
      repair_patch: {
        id: 7,
        target_span: '旧文',
        replacement_text: '新文',
        reason: '一致性',
      },
      approval_command: command,
    },
    agent_result: { summary: '修复建议', requires_user_confirmation: true },
  } as unknown as AgentResultMessage);
}

test('repair patch 缺少 approval_command 时，repairProposal.command 为 null', () => {
  const msg = makeRepairMessage(null);
  const proposal = repairPatchApproval(msg);
  assert.ok(proposal);
  assert.strictEqual(proposal.command, null);
  // 前端应据此判断 hasRealApprovalPath = false，不置 waiting
});

test('repair patch 带 approval_command 时，repairProposal.command 正常解析', () => {
  const msg = makeRepairMessage({ command_id: 'judge.approve', args: { repair_patch_id: 7 } });
  const proposal = repairPatchApproval(msg);
  assert.ok(proposal);
  assert.ok(proposal.command);
  assert.strictEqual(proposal.command.command_id, 'judge.approve');
  // 有真实命令时，requires_user_confirmation=true 应置 waiting（真批准路径）
});

test('纯文本总结无 proposed_patch 时，repairPatchApproval 返回 null', () => {
  const msg = makeMessage({ proposed_patch: null });
  assert.strictEqual(repairPatchApproval(msg), null);
  // 这种消息此前会进 waiting，修复后应强制 completed
});

/**
 * 集成层面的语义（对应 useRunAuthorAgent.ts 内的决策点）：
 *
 * | 场景 | proposed | repair | chapterBrief | 旧 waiting | 新 waiting |
 * |------|----------|--------|--------------|------------|------------|
 * | 正常 patch | ✓ | — | — | 需要时 true | 需要时 true |
 * | repair 有 cmd | — | ✓ | — | 需要时 true | 需要时 true |
 * | repair 无 cmd | — | ✓(无cmd) | — | true ← 死路 | false ✓ |
 * | 纯文本 | — | — | — | 需要时 true ← 死路 | false ✓ |
 * | chapterBrief | — | — | ✓ | 需要时 true | true ✓ |
 */
