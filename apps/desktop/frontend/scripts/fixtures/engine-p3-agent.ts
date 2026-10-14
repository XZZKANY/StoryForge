import { isTauri } from '@tauri-apps/api/core';
import { getAgentRunEvents, getAgentRunSavePoints } from '../../src/lib/api/agent-runs';
import { sendAgentControlMessage, sendAgentUserMessage } from '../../src/lib/api/agent-socket';
import type { AgentSocketMessage } from '../../src/lib/api/types';
import { workerRegexCompiler } from '../../src/lib/engine/regex';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Frame = {
  type: string;
  text?: string;
  tool?: string;
  summary?: unknown;
  receivedAt: number;
};

function frameOf(message: AgentSocketMessage): Frame {
  const value = message as unknown as Record<string, unknown>;
  const trace = value.trace as Record<string, unknown> | undefined;
  return {
    type: String(value.type),
    ...(typeof value.text_delta === 'string' ? { text: value.text_delta } : {}),
    ...(trace && typeof trace.tool_name === 'string'
      ? { tool: trace.tool_name, summary: trace.output_summary }
      : {}),
    receivedAt: Date.now(),
  };
}

// Synthetic project, synthetic provider and synthetic session store only; the key is generated
// by the harness and must never reach this page.
async function runAgentProbe(input: { projectRoot: string }) {
  assert(isTauri(), 'Agent probe requires the real Native host');
  localStorage.setItem('engine.agentLoop', 'ts');

  // 1. Regex runs in a real Worker: a catastrophic pattern is cut off by the watchdog while the
  //    page keeps ticking.
  const compile = workerRegexCompiler();
  const ticks: number[] = [];
  const interval = setInterval(() => ticks.push(performance.now()), 50);
  const runawayStarted = performance.now();
  const runaway = await compile('^(a+)+$').scan(['a'.repeat(36) + 'b'], 5, 0.2);
  const runawayMs = performance.now() - runawayStarted;
  clearInterval(interval);
  const quick = await compile('钟.|雨夜').scan(['雨夜里他推开门', '钟声响了三下', '无关'], 5, 2);

  // 2. One author message on the TS engine: a tool round (regex search + serial plan written
  //    under .storyforge/ through the Rust writer), then a streamed answer.
  const frames: Frame[] = [];
  const runA = 'p3-agent-run-a';
  const result = await sendAgentUserMessage({
    sessionId: runA,
    runId: runA,
    userMessage: '找找雨夜和钟声，再把第三章记进连载计划',
    permissionProfile: 'ask',
    args: { project_path: input.projectRoot },
    onEvent: (message) => frames.push(frameOf(message)),
  });
  const events = await getAgentRunEvents(runA);
  const savePoints = await getAgentRunSavePoints(runA);

  // 3. A stop sent while the answer is still streaming closes the Native stream.
  const stopFrames: Frame[] = [];
  const runB = 'p3-agent-run-b';
  let stopAck: Promise<unknown> | null = null;
  const stopped = await sendAgentUserMessage({
    sessionId: runB,
    runId: runB,
    userMessage: '慢慢说',
    permissionProfile: 'ask',
    args: { project_path: input.projectRoot },
    onEvent: (message) => {
      stopFrames.push(frameOf(message));
      if (message.type === 'agent_text_delta' && stopAck === null)
        stopAck = sendAgentControlMessage({
          sessionId: runB,
          runId: runB,
          type: 'stop_run',
          payload: { source: 'desktop.timeline' },
        });
    },
  });
  const stoppedSavePoints = await getAgentRunSavePoints(runB);
  return {
    native: isTauri(),
    runaway,
    runawayMs,
    ticks: ticks.length,
    quick,
    result,
    frames,
    events: events.map((event) => event.event_type),
    savePoints: { status: savePoints.status, runtimeState: savePoints.interruption_model },
    stopped,
    stopAck: await stopAck,
    stopFrames,
    stoppedStatus: stoppedSavePoints.status,
  };
}

declare global {
  interface Window {
    __ENGINE_P3_AGENT__: { runAgentProbe: typeof runAgentProbe };
  }
}
window.__ENGINE_P3_AGENT__ = { runAgentProbe };
document.documentElement.dataset.engineP3AgentReady = 'true';
