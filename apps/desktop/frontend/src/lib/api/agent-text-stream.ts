import type { AgentTextDeltaFrame, AgentTextStreamStartedFrame } from './generated/agent-ws';

export type AgentTextFrame = AgentTextDeltaFrame | AgentTextStreamStartedFrame;

export function isAgentTextFrame(value: unknown): value is AgentTextFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Record<string, unknown>;
  if (
    typeof frame.run_id !== 'string' ||
    !frame.run_id ||
    typeof frame.stream_id !== 'string' ||
    !frame.stream_id ||
    !Number.isSafeInteger(frame.round_index) ||
    Number(frame.round_index) < 1
  )
    return false;
  if (frame.type === 'agent_text_stream_started') return frame.chunk_sequence === 0;
  return (
    frame.type === 'agent_text_delta' &&
    Number.isSafeInteger(frame.chunk_sequence) &&
    Number(frame.chunk_sequence) >= 1 &&
    typeof frame.text_delta === 'string' &&
    frame.text_delta.length > 0 &&
    [...frame.text_delta].length <= 4096
  );
}
