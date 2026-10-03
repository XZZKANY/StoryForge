// 该文件由 scripts/generate-openapi.mjs 从
// packages/shared/src/contracts/agent-ws.schema.json 生成，请勿手改。
// 改 Agent 帧字段要改后端 app/domains/agent_runs/ws_messages.py 再跑 `pnpm openapi`。
// 出线语义：帧的每个字段都在（to_wire 不 exclude_none），可空字段为 `X | null`。

export interface AgentRunStartedFrame {
  agent_role_hints: string[];
  agent_role_mentions: string[];
  event_id: number;
  permission_profile: string;
  run_id: string;
  session_id: string;
  type: "agent_run_started";
  user_message: string;
}

export interface AgentStepFrame {
  assistant_session_id: number | null;
  detail: string | null;
  event_id: number;
  index: number;
  run_id: string;
  sequence: number;
  session_id: string;
  status: string | null;
  step: string | null;
  type: "agent_step";
}

export interface ToolTraceFrame {
  assistant_session_id: number | null;
  event_id: number;
  index: number;
  run_id: string;
  sequence: number;
  session_id: string;
  trace: Record<string, unknown>;
  type: "tool_trace";
}

export interface PermissionRequiredFrame {
  assistant_session_id: number | null;
  blocked_tool: string | null;
  confirmation_action: string | Record<string, unknown> | null;
  event_id: number;
  permission_profile: string;
  proposed_patch: Record<string, unknown> | null;
  reason: string;
  run_id: string;
  sequence: number;
  session_id: string;
  type: "permission_required";
}

export interface TerminalFrame {
  assistant_session_id: number | null;
  event_id: number;
  message: string | null;
  payload: Record<string, unknown>;
  run_id: string;
  sequence: number;
  session_id: string;
  status: string;
  type: "agent_run_completed" | "agent_run_failed" | "agent_run_interrupted";
}

export interface ControlAckFrame {
  control_effect: "requested" | "applied" | "ignored" | null;
  event_id: number;
  run_id: string;
  run_status: string | null;
  runtime_state: "in_flight" | "settled" | null;
  session_id: string;
  status: "recorded";
  type: "permission_approved" | "permission_denied" | "pause_run" | "resume_run" | "stop_run" | "retry_from_checkpoint";
}

export interface AgentRunWaitingFrame {
  assistant_session_id: number;
  event_id: number;
  execution_epoch: string | null;
  protocol: "external_writeback_v1";
  revision: number;
  run_id: string;
  sequence: number;
  session_id: string;
  stage: "await_authorization" | "awaiting_receipt" | "reconciliation" | "receipt_ready" | "claimed";
  type: "agent_run_waiting";
  wait_id: string;
}

export interface AgentTextStreamStartedFrame {
  chunk_sequence: 0;
  round_index: number;
  run_id: string;
  stream_id: string;
  type: "agent_text_stream_started";
}

export interface AgentTextDeltaFrame {
  chunk_sequence: number;
  round_index: number;
  run_id: string;
  stream_id: string;
  text_delta: string;
  type: "agent_text_delta";
}

export interface AgentExecutionOutcome {
  code: string;
  message: string;
  status: "failed" | "partial";
}

export interface AgentRuntimeInterruption {
  boundary: string;
  status: "paused" | "stopped";
}

export type AgentWsFrame =
  | AgentRunStartedFrame
  | AgentStepFrame
  | ToolTraceFrame
  | PermissionRequiredFrame
  | TerminalFrame
  | ControlAckFrame
  | AgentRunWaitingFrame
  | AgentTextStreamStartedFrame
  | AgentTextDeltaFrame;
