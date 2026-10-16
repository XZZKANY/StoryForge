import { isTauri } from '@tauri-apps/api/core';
import { reviseFileContent, streamContinueProse } from '../../src/lib/api/assistant';
import { nativeLlmSource } from '../../src/lib/engine/llm';
import {
  buildInlineReviseInstruction,
  planInlineReviseWindow,
  spliceInlineReviseWindow,
} from '../../src/lib/inline-chat';
import { resolveContinueAnchorLine } from '../../src/lib/inline-continue';
import { loadInlineContinueContext } from '../../src/lib/inline-continue-context';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const describe = (error: unknown) => ({
  name: error instanceof Error ? error.name : typeof error,
  message: error instanceof Error ? error.message : String(error),
});

// The author's real provider through Rust; a synthetic project and a synthetic session store.
// Mirrors useInlineChat: Ctrl+K sends the anchored window with the built instruction and the
// polish gate; Ctrl+Shift+K continues from the last line with the inline context bundle.
async function runAssistantRealRun(input: { projectRoot: string; chapter: string }) {
  assert(isTauri(), 'Real run requires the real Native host');
  const { source, secrets } = await nativeLlmSource('main');
  const filePath = `${input.projectRoot}\\正文\\第002章.md`;
  const before = input.chapter.replace(/\r\n?/g, '\n');
  const lines = before.split('\n');
  const anchorLine = lines.findIndex((line) => line.startsWith('街上没有人')) + 1;
  assert(anchorLine > 0, 'Anchor paragraph missing');
  const anchor = {
    startLine: anchorLine,
    endLine: anchorLine,
    text: lines[anchorLine - 1],
    isSelection: true,
  };
  const window = planInlineReviseWindow(before, anchor);
  const userInstruction = '把这段改得更紧张一些，用动作和声音代替形容词';
  const instruction = buildInlineReviseInstruction({
    anchorText: anchor.text,
    anchorRange: anchor,
    windowStartLine: window.startLine,
    isSelection: true,
    userInstruction,
    isExcerpt: !window.isWholeDocument,
  });

  const reviseStartedAt = Date.now();
  const revise = await reviseFileContent({
    filePath,
    content: window.text,
    instruction,
    projectName: '合成验证书',
    projectRoot: input.projectRoot,
    qualityGate: 'polish',
  }).then(
    (result) => ({
      ok: true as const,
      result,
      merged: spliceInlineReviseWindow(before, window, result.after),
    }),
    (error: unknown) => ({ ok: false as const, error: describe(error) }),
  );
  const reviseMs = Date.now() - reviseStartedAt;

  const cursorLine = resolveContinueAnchorLine(before, lines.length);
  const contextBundle = await loadInlineContinueContext(input.projectRoot, filePath);
  const deltas: { text: string; at: number }[] = [];
  const continueStartedAt = Date.now();
  const continued = await streamContinueProse({
    filePath,
    content: before,
    cursorLine,
    instruction: null,
    projectRoot: input.projectRoot,
    contextBundle: contextBundle ?? undefined,
    onDelta: (text) => deltas.push({ text, at: Date.now() - continueStartedAt }),
  }).then(
    (result) => ({ ok: true as const, result }),
    (error: unknown) => ({ ok: false as const, error: describe(error) }),
  );
  const continueMs = Date.now() - continueStartedAt;

  return {
    native: isTauri(),
    provider: {
      provider: source.STORYFORGE_LLM_PROVIDER,
      baseUrl: source.STORYFORGE_LLM_BASE_URL,
      model: source.STORYFORGE_LLM_MODEL,
      timeout: source.STORYFORGE_LLM_TIMEOUT_SECONDS,
      keyIsPlaceholder:
        secrets.values.length === 1 && source.STORYFORGE_LLM_API_KEY === secrets.values[0],
      keyLength: (source.STORYFORGE_LLM_API_KEY ?? '').length,
    },
    ctrlK: { userInstruction, anchor: anchor.text, window, instruction, revise, reviseMs },
    continuation: {
      cursorLine,
      contextFiles: contextBundle?.files.map((file) => file.relativePath) ?? [],
      continued,
      deltaCount: deltas.length,
      firstDeltaMs: deltas[0]?.at ?? null,
      continueMs,
    },
  };
}

declare global {
  interface Window {
    __ENGINE_P2_ASSISTANT_REAL__: { runAssistantRealRun: typeof runAssistantRealRun };
  }
}
window.__ENGINE_P2_ASSISTANT_REAL__ = { runAssistantRealRun };
document.documentElement.dataset.engineP2AssistantRealReady = 'true';
