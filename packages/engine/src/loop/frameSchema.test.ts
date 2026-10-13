import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-contracts.json';
import rawSchema from '../../../shared/src/contracts/agent-ws.schema.json';

type Schema = {
  $defs: Record<string, { properties: Record<string, unknown>; required?: string[] }>;
};
const schema = rawSchema as unknown as Schema;

const FRAME_DEFS: Record<string, string> = {
  agent_run_started: 'AgentRunStartedFrame',
  agent_step: 'AgentStepFrame',
  tool_trace: 'ToolTraceFrame',
  permission_required: 'PermissionRequiredFrame',
  agent_run_completed: 'TerminalFrame',
  agent_run_failed: 'TerminalFrame',
  agent_run_interrupted: 'TerminalFrame',
  pause_run: 'ControlAckFrame',
  resume_run: 'ControlAckFrame',
  stop_run: 'ControlAckFrame',
  permission_approved: 'ControlAckFrame',
  agent_text_stream_started: 'AgentTextStreamStartedFrame',
  agent_text_delta: 'AgentTextDeltaFrame',
};

describe('帧契约快照（前端消费层只认 agent-ws.schema.json 的形状）', () => {
  it('引擎会发出的每种帧，字段集合与 schema 完全一致', () => {
    const frames = [
      ...(golden.records as { fn: string; output?: unknown }[])
        .filter((record) => record.fn === 'stream_frames' || record.fn === 'control_frame')
        .flatMap((record) => (Array.isArray(record.output) ? record.output : [record.output])),
      ...golden.text_stream.flatMap((item) => item.frames),
    ] as { type: string }[];
    const covered = new Set<string>();
    for (const frame of frames) {
      const name = FRAME_DEFS[frame.type];
      expect(name, frame.type).toBeDefined();
      covered.add(name);
      const def = schema.$defs[name];
      expect(Object.keys(frame).sort(), frame.type).toEqual(Object.keys(def.properties).sort());
      for (const key of def.required ?? [])
        expect(frame, `${frame.type}.${key}`).toHaveProperty(key);
    }
    expect([...covered].sort()).toEqual(
      Object.keys(schema.$defs)
        .filter((name) => name.endsWith('Frame') && name !== 'AgentRunWaitingFrame')
        .sort(),
    );
  });
});
