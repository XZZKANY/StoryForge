import { isTauri } from '@tauri-apps/api/core';
import {
  probeProviderHealth,
  reviseFileContent,
  streamContinueProse,
} from '../../src/lib/api/assistant';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const describe = (error: unknown) => ({
  name: error instanceof Error ? error.name : typeof error,
  message: error instanceof Error ? error.message : String(error),
});

// Synthetic project, synthetic provider and synthetic session store only; the key is generated
// by the harness and must never reach this page.
async function runAssistantProbe(input: { projectRoot: string }) {
  assert(isTauri(), 'Assistant probe requires the real Native host');
  localStorage.setItem('engine.assistant', 'ts');
  const chapter = `${input.projectRoot}\\正文\\第002章.md`;
  const startedAt = Date.now();
  const revise = await reviseFileContent({
    filePath: chapter,
    content: '第二章上文。',
    instruction: '改得紧凑些',
    projectRoot: input.projectRoot,
  });
  const deltas: { text: string; receivedAt: number }[] = [];
  const continued = await streamContinueProse({
    filePath: chapter,
    content: '第二章上文。\n',
    cursorLine: 1,
    projectRoot: input.projectRoot,
    assistantSessionId: revise.assistantSessionId,
    onDelta: (text) => deltas.push({ text, receivedAt: Date.now() }),
  });
  const controller = new AbortController();
  const cancelled = await streamContinueProse({
    filePath: chapter,
    content: '第二章上文。\n',
    cursorLine: 1,
    projectRoot: input.projectRoot,
    signal: controller.signal,
    onDelta: () => controller.abort(),
  }).then(() => null, describe);
  const missing = await streamContinueProse({
    filePath: chapter,
    content: '第二章上文。\n',
    cursorLine: 1,
    projectRoot: input.projectRoot,
    assistantSessionId: 999,
  }).then(() => null, describe);
  const health = await probeProviderHealth();
  return { native: isTauri(), startedAt, revise, continued, deltas, cancelled, missing, health };
}

declare global {
  interface Window {
    __ENGINE_P2_ASSISTANT__: { runAssistantProbe: typeof runAssistantProbe };
  }
}
window.__ENGINE_P2_ASSISTANT__ = { runAssistantProbe };
document.documentElement.dataset.engineP2AssistantReady = 'true';
