// Agent WS 帧「后端 → 前端」编译期契约（W6 契约化 slice 2b）。
//
// generated/agent-ws.ts 由后端 Pydantic 帧经 agent-ws.schema.json 派生（单一事实源）。
// 本文件把「前端各解码路径实际读取的字段」钉在生成帧上：后端改一个 WS 字段名并 `pnpm openapi`
// 重新生成后，被改的键从生成帧的 keyof 里消失，下面的约束即违约 → 前端 typecheck 红。
// 这是蓝图 W6 的 gate：「故意改一个 WS 字段名 → 前端 typecheck 红」。
//
// 只做键名 + 核心字段类型两级校验，不做整帧可赋值校验：出线帧字段恒在（可空为 X|null），
// 而前端消息类型把若干字段建模成可选省略（X|undefined），整帧对齐会被 null/undefined 差异噪音淹没。

import type {
  AgentControlAckMessage,
  AgentPermissionRequiredMessage,
  AgentRunStartedMessage,
  AgentStepEventMessage,
  AgentToolTraceEventMessage,
} from './types';
import type {
  AgentRunStartedFrame,
  AgentStepFrame,
  ControlAckFrame,
  PermissionRequiredFrame,
  TerminalFrame,
  ToolTraceFrame,
} from './generated/agent-ws';

// K 里每个键都必须是 Frame 的键，否则 `K extends keyof Frame` 约束违约 → 编译红。
type FrameHasKeys<Frame, K extends keyof Frame> = K;

// 核心字段：判别式 type + 两个 id。类型漂移（如 run_id 变 number）时约束违约 → 编译红。
type StableFrame = { type: string; run_id: string; session_id: string };
type FrameHasStableCore<Frame extends StableFrame> = Frame;

// ── 键名契约：前端各帧读取的键必须都在生成帧上 ──────────────────────────────
// 前端消息类型声明的键即「前端会读的键」；ControlAck 的 resumed_result / resume_diagnostic
// 是前端恢复流程自造字段、不在出线帧上，排除掉。

export type StartedFrameContract = FrameHasKeys<AgentRunStartedFrame, keyof AgentRunStartedMessage>;
export type StepFrameContract = FrameHasKeys<AgentStepFrame, keyof AgentStepEventMessage>;
export type ToolTraceFrameContract = FrameHasKeys<ToolTraceFrame, keyof AgentToolTraceEventMessage>;
export type PermissionFrameContract = FrameHasKeys<
  PermissionRequiredFrame,
  keyof AgentPermissionRequiredMessage
>;
export type ControlAckFrameContract = FrameHasKeys<
  ControlAckFrame,
  Exclude<keyof AgentControlAckMessage, 'resumed_result' | 'resume_diagnostic'>
>;
// 终态帧无对应前端消息类型（前端超时后从 REST 事件表重建，见 agent-run-events.ts）；
// 手列 F10 重建路径依赖的键，锁住它们不被后端悄悄改名。
export type TerminalFrameContract = FrameHasKeys<
  TerminalFrame,
  'type' | 'session_id' | 'run_id' | 'status' | 'message' | 'payload' | 'assistant_session_id'
>;

// ── 核心字段类型契约：type / run_id / session_id 的类型不许漂移 ──────────────
export type StartedStableContract = FrameHasStableCore<AgentRunStartedFrame>;
export type StepStableContract = FrameHasStableCore<AgentStepFrame>;
export type ToolTraceStableContract = FrameHasStableCore<ToolTraceFrame>;
export type PermissionStableContract = FrameHasStableCore<PermissionRequiredFrame>;
export type TerminalStableContract = FrameHasStableCore<TerminalFrame>;
export type ControlAckStableContract = FrameHasStableCore<ControlAckFrame>;
