/**
 * D5 状态变化反馈：Agent 运行相位（运行 → 等待确认 → 暂停 → 终态）对读屏作者不可见，
 * 此前既没有 live region 也没有 alert。本测试钉死两件事：
 *  1. runLivePhaseText 把相位映射成稳定措辞（同一相位内步骤详情再怎么变都不换文案，
 *     保证 live region 不被长程 run 吵到，只在相位切换时念一次）；
 *  2. ChatWindowView 里真的挂了那个常驻 sr-only live region（静态护栏，防接线被删掉）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { runLivePhaseText } from '../src/components/chat-window/display-utils';
import type { AgentRun, AgentStep } from '../src/components/chat-window/types';

const abs = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function step(overrides: Partial<AgentStep> = {}): AgentStep {
  return {
    id: 'step-1',
    title: '读取文件',
    tool: 'fs.read',
    status: 'running',
    detail: '读取 正文/01.md',
    ...overrides,
  };
}

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    sessionId: 'session-1',
    goal: '润色第一章',
    status: 'running',
    steps: [step()],
    ...overrides,
  };
}

test('runLivePhaseText：无 run 时不播报', () => {
  assert.equal(runLivePhaseText(null), '');
});

test('runLivePhaseText：运行中带恒定一句，不随步骤详情变化', () => {
  const a = run({ steps: [step({ detail: '读取 正文/01.md' })] });
  const b = run({ steps: [step({ detail: '正在分析第三章人物' })] });
  const c = run({ steps: [] }); // 无活动步骤仍是运行相位
  // 相位不变 → 文案恒定 → live region 不重复念诵。
  assert.equal(runLivePhaseText(a), 'Agent 正在处理本轮…');
  assert.equal(runLivePhaseText(b), runLivePhaseText(a));
  assert.equal(runLivePhaseText(c), runLivePhaseText(a));
});

test('runLivePhaseText：等待权限与等待修订确认分开措辞', () => {
  const withPerm = run({
    status: 'waiting',
    steps: [step({ id: 'permission-required', status: 'waiting' })],
  });
  const withPatch = run({ status: 'waiting', steps: [step({ status: 'completed' })] });
  assert.match(runLivePhaseText(withPerm), /确认/);
  // 两种「等待」措辞必须有别：作者在屏幕阅读器下要能区分「批权限」和「收补丁」。
  assert.notEqual(runLivePhaseText(withPerm), runLivePhaseText(withPatch));
});

test('runLivePhaseText：暂停 / 停止 / 失败 / 完成各有明确相位句', () => {
  assert.match(runLivePhaseText(run({ status: 'paused' })), /暂停/);
  // 作者主动停止是中性收尾，不念「遇到问题」。
  const stopped = runLivePhaseText(run({ status: 'stopped' }));
  assert.match(stopped, /停止/);
  assert.doesNotMatch(stopped, /遇到问题/);
  assert.match(runLivePhaseText(run({ status: 'failed' })), /遇到问题/);
  assert.match(runLivePhaseText(run({ status: 'completed' })), /完成/);
});

test('ChatWindowView 挂载了常驻 sr-only 运行相位 live region（接线护栏）', () => {
  const source = readFileSync(abs('../src/components/chat-window/ChatWindowView.tsx'), 'utf8');
  // 只取 agent-run-live 那个元素的标签本体，不依赖属性书写顺序。
  const tag = source.match(/<p\b[^>]*data-testid="agent-run-live"[^>]*>/s)?.[0];
  assert.ok(tag, '找不到 agent-run-live 元素');
  assert.match(tag, /aria-live="polite"/, 'agent-run-live 缺 aria-live="polite"');
  assert.match(tag, /role="status"/, 'agent-run-live 缺 role="status"');
  assert.match(tag, /className="sr-only"/, 'live region 必须视觉隐藏（sr-only）');
  assert.match(source, /runLivePhaseText\(state\.agentRun\)/, 'live 文案必须来自 runLivePhaseText');
});
