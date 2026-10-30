import { pythonStrip } from '../kernel/pythonText';
import {
  AgentRuntimeUserMessageError,
  runAgentUserMessage,
  type AgentRuntimeDeps,
} from './agentRuntime';
import { controlAckFrame, framesForEvent, type ControlAckFrame } from './frames';
import { normalizePermissionProfile, PermissionProfileError } from './permission';
import { handleAgentControlMessage } from './runControlChannel';
import { CONTROL_MESSAGE_TYPES } from './runPayloads';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 宿主在执行之前就拒掉的请求（Python 路由的 HTTP 4xx）。detail 为 null 时前端照 Python 422 的处理
 * 显示「API 返回 <status>」（Python 的 422 detail 是校验错误列表，不是字符串）。
 */
export class AgentHostRejection extends Error {
  constructor(
    readonly status: number,
    readonly detail: string | null,
  ) {
    super(detail ?? `API 返回 ${status}`);
    this.name = 'AgentHostRejection';
  }
}

// ---- 文本增量合并（ide/router 的 _TextDeltaCoalescer）----

/** 合并窗口（秒）：每轮第一段立即发，之后的增量在固定窗口内合成一帧。 */
export const TEXT_COALESCE_WINDOW_SECONDS = 0.04;
const TEXT_COALESCE_MAX_CHARS = 4096;

const isTextDelta = (payload: Obj) => payload.type === 'agent_text_delta';
const roundKey = (payload: Obj) =>
  JSON.stringify([payload.run_id ?? null, payload.stream_id ?? null, payload.round_index ?? null]);
const codePoints = (text: unknown) => Array.from(String(text)).length;

/**
 * 同一流同一轮的连续增量合成一帧：首段立即发，之后的攒到窗口到期、字数满或遇到非增量帧再发；
 * 发出时 chunk_sequence 按轮重新连续编号。生产速度与背压不受影响。
 */
export class TextDeltaCoalescer {
  private pending: Obj | null = null;
  private readonly emittedRounds = new Set<string>();
  private readonly nextSequence = new Map<string, number>();

  private take(): Obj | null {
    const pending = this.pending;
    this.pending = null;
    return pending;
  }

  private renumber(frame: Obj | null): Obj | null {
    if (frame === null) return null;
    const key = roundKey(frame);
    const sequence = this.nextSequence.get(key) ?? 1;
    frame.chunk_sequence = sequence;
    this.nextSequence.set(key, sequence + 1);
    return frame;
  }

  /** 返回现在要发的帧，以及是否该挂上合并窗口。 */
  feed(payload: Obj): [Obj[], boolean] {
    if (!isTextDelta(payload)) {
      const flushed = this.renumber(this.take());
      return [flushed !== null ? [flushed, payload] : [payload], false];
    }
    const pending = this.pending;
    if (pending !== null && roundKey(pending) !== roundKey(payload)) {
      // 新的流 / 轮不能吞掉上一轮：先发掉旧的，再从这一段开始攒。
      const flushed = this.renumber(this.take());
      this.pending = { ...payload };
      return [[flushed!], true];
    }
    const key = roundKey(payload);
    if (pending === null) {
      this.pending = { ...payload };
      if (!this.emittedRounds.has(key)) {
        this.emittedRounds.add(key);
        return [[this.renumber(this.take())!], false];
      }
      return [[], true];
    }
    if (codePoints(pending.text_delta) + codePoints(payload.text_delta) > TEXT_COALESCE_MAX_CHARS) {
      const flushed = this.renumber(this.take());
      this.pending = { ...payload };
      return [[flushed!], true];
    }
    pending.text_delta = String(pending.text_delta) + String(payload.text_delta);
    return [[], true];
  }

  flush(): Obj | null {
    return this.renumber(this.take());
  }
}

/** 合并窗口用的计时器（生产是 setTimeout；测试可以注入不触发的版本）。 */
export type FrameScheduler = {
  setTimer(callback: () => void, seconds: number): unknown;
  clearTimer(timer: unknown): void;
};

const timerScheduler: FrameScheduler = {
  setTimer: (callback, seconds) => setTimeout(callback, seconds * 1000),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/**
 * 进程内的帧泵：事件帧与文本帧按产生顺序进来，经合并后交给 onFrame。窗口是固定窗口，
 * 不因新增量到来而顺延；终态帧先冲掉缓存的文本再原样发出。
 */
export class FramePump {
  private readonly coalescer = new TextDeltaCoalescer();
  private timer: unknown = null;

  constructor(
    private readonly emit: (frame: Obj) => void,
    private readonly scheduler: FrameScheduler,
  ) {}

  private cancel() {
    if (this.timer !== null) this.scheduler.clearTimer(this.timer);
    this.timer = null;
  }

  push(payload: Obj) {
    const [frames, armed] = this.coalescer.feed(payload);
    if (!armed) this.cancel();
    else if (this.timer === null || frames.length) {
      // 因字数或换轮发出一帧就是开了新的缓存，也就开了新的窗口。
      this.cancel();
      this.timer = this.scheduler.setTimer(() => {
        this.timer = null;
        const flushed = this.coalescer.flush();
        if (flushed !== null) this.emit(flushed);
      }, TEXT_COALESCE_WINDOW_SECONDS);
    }
    for (const frame of frames) this.emit(frame);
  }

  finish(terminal: Obj) {
    this.cancel();
    const flushed = this.coalescer.flush();
    if (flushed !== null) this.emit(flushed);
    this.emit(terminal);
  }
}

// ---- 作者消息（POST /api/ide/agent/sessions/{id}/stream）----

const optional = (value: unknown, check: (item: unknown) => boolean) =>
  value === undefined || value === null || check(value);

/** 请求体校验（AgentUserMessageStreamRequest）：类型不对按 422 拒绝，不做 Python 的宽松转换。 */
function streamMessage(body: unknown): Obj {
  if (!isObj(body)) throw new AgentHostRejection(422, null);
  const isString = (item: unknown) => typeof item === 'string';
  const isSessionId = (item: unknown) => typeof item === 'number' && Number.isSafeInteger(item);
  if (
    !optional(body.user_message, isString) ||
    !optional(body.run_id, isString) ||
    !optional(body.assistant_session_id, isSessionId) ||
    !optional(body.intent, isString) ||
    !optional(body.permission_profile, isString) ||
    !(body.args === undefined || isObj(body.args)) ||
    !(
      body.execution_protocol === undefined ||
      body.execution_protocol === 'legacy' ||
      body.execution_protocol === 'external_writeback_v1'
    )
  )
    throw new AgentHostRejection(422, null);
  try {
    normalizePermissionProfile(body.permission_profile ?? null);
  } catch (error) {
    if (error instanceof PermissionProfileError) throw new AgentHostRejection(422, null);
    throw error;
  }
  // 连续写回协议从未在发行版开放，也不搬（迁移计划 P3 拆刀）。
  if (body.execution_protocol === 'external_writeback_v1')
    throw new AgentHostRejection(409, '当前宿主未开放连续写入协议');
  return {
    type: 'user_message',
    stream: true,
    run_id: body.run_id ?? null,
    user_message: body.user_message ?? null,
    assistant_session_id: body.assistant_session_id ?? null,
    intent: body.intent ?? null,
    permission_profile: body.permission_profile ?? null,
    args: isObj(body.args) ? body.args : {},
  };
}

export type AgentHostDeps = AgentRuntimeDeps & {
  /** 请求没带 run_id 时新建的 run id（Python 的 uuid4）。 */
  readonly newRunId: () => string;
  readonly scheduler?: FrameScheduler;
};

/**
 * 本地 SSE 流的进程内版本：校验请求体（拒绝时抛 `AgentHostRejection`，一帧都不发），
 * 然后按事件顺序把帧交给 onFrame，最后一帧是结果或错误帧。
 */
export async function streamAgentUserMessage(
  deps: AgentHostDeps,
  sessionId: string,
  body: unknown,
  onFrame: (frame: Obj) => void,
): Promise<void> {
  const message = streamMessage(body);
  const pump = new FramePump(onFrame, deps.scheduler ?? timerScheduler);
  let terminal: Obj;
  try {
    const { result } = await runAgentUserMessage(deps, {
      agentSessionId: sessionId,
      message,
      newRunId: deps.newRunId,
      onEvent: (event, run) => {
        for (const frame of framesForEvent(run, event, deps.secrets)) pump.push(frame as Obj);
      },
      onText: (frame) => pump.push({ ...frame }),
    });
    terminal = result;
  } catch (error) {
    terminal = {
      type: 'error',
      session_id: sessionId,
      detail: error instanceof Error ? error.message : String(error),
    };
    // 编排失败（run 已建好）带上 run_id；其余错误（含建 run 之前的）只有文案，与 Python 同。
    if (error instanceof AgentRuntimeUserMessageError) terminal.run_id = error.run.public_id;
  }
  pump.finish(terminal);
}

// ---- 控制消息（POST /api/ide/agent/sessions/{id}/control）----

export type AgentControlAck = ControlAckFrame & {
  resumed_result?: Obj;
  resume_diagnostic?: Obj;
};

/** 领域错误以错误帧返回（Python 是 200 + {type:"error"}），前端按消息处理、不抛出。 */
export async function postAgentControl(
  deps: AgentRuntimeDeps,
  sessionId: string,
  body: unknown,
): Promise<AgentControlAck | Obj> {
  if (
    !isObj(body) ||
    typeof body.type !== 'string' ||
    typeof body.run_id !== 'string' ||
    !(body.payload === undefined || isObj(body.payload))
  )
    throw new AgentHostRejection(422, null);
  const controlType = body.type;
  if (!CONTROL_MESSAGE_TYPES.has(controlType))
    return { type: 'error', session_id: sessionId, detail: `不支持的控制消息：${controlType}。` };
  const runId = pythonStrip(body.run_id);
  if (!runId)
    return { type: 'error', session_id: sessionId, detail: `${controlType} 消息缺少 run_id。` };
  let result;
  try {
    result = await handleAgentControlMessage(deps, {
      publicId: runId,
      sessionId,
      controlType,
      payload: isObj(body.payload) ? body.payload : {},
    });
  } catch (error) {
    return {
      type: 'error',
      session_id: sessionId,
      run_id: runId,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const ack: AgentControlAck = controlAckFrame(
    result.event as Parameters<typeof controlAckFrame>[0],
  );
  if (result.resumedResult !== null) ack.resumed_result = result.resumedResult;
  if (result.resumeDiagnostic !== null) ack.resume_diagnostic = result.resumeDiagnostic;
  return ack;
}
