/**
 * 光标处续写的纯逻辑：SSE 帧解析与落点推导。与 Monaco 无关，便于单测。
 *
 * 帧契约见后端 `POST /api/assistant/continue`：`delta` 是原始增量、只供即时观感；
 * `done.text` 才是经确定性后处理（掐掉重抄的上文、裁到完整句末）的权威结果，
 * 渲染层必须以它覆盖累积缓冲，不能把 delta 拼起来当最终结果。
 */

export type ContinueSseFrame =
  | { kind: 'start'; assistantSessionId: number; model: string }
  | { kind: 'delta'; text: string }
  | { kind: 'done'; text: string; model: string; assistantSessionId: number }
  | { kind: 'error'; message: string };

export function parseContinueSseFrame(raw: string): ContinueSseFrame | null {
  let event = '';
  let data = '';
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!event || !data) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }

  switch (event) {
    case 'start':
      return {
        kind: 'start',
        assistantSessionId: Number(payload.assistant_session_id ?? 0),
        model: String(payload.model ?? ''),
      };
    case 'delta':
      return { kind: 'delta', text: String(payload.text ?? '') };
    case 'done':
      return {
        kind: 'done',
        text: String(payload.text ?? ''),
        model: String(payload.model ?? ''),
        assistantSessionId: Number(payload.assistant_session_id ?? 0),
      };
    case 'error':
      return { kind: 'error', message: String(payload.message ?? '续写失败。') };
    default:
      return null;
  }
}

/**
 * 从光标行推导续写落点：往上跳过连续空行，让新段紧贴上一段而不是掉进一片空白里。
 *
 * 作者写完一段习惯连敲两下回车再停手，此时光标在第二个空行上。若原样把落点定在光标行，
 * 续写会与上文之间隔出多余空行；跳到最后一行非空正文之后，落点才与作者的直觉一致。
 *
 * @param cursorLine 1-based 光标行。
 * @returns 1-based：在此行之后插入；0 = 文件顶部。
 */
export function resolveContinueAnchorLine(content: string, cursorLine: number): number {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let anchor = Math.max(0, Math.min(Math.trunc(cursorLine), lines.length));
  while (anchor > 0 && (lines[anchor - 1] ?? '').trim() === '') anchor -= 1;
  return anchor;
}
