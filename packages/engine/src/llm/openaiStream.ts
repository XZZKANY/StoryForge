import { InputDomainError, isJsonObject, parseJson, type JsonObject } from '../kernel/json';

/** 工具调用流拼装出错（Python 的 ValueError 码）。 */
export class ToolStreamError extends RangeError {
  constructor(code: string) {
    super(code);
    this.name = 'ToolStreamError';
  }
}

type AssembledCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

const MAX_CHARACTERS = 1_048_576;
const has = (object: JsonObject, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/** OpenAI 流式工具调用的增量拼装，与 HTTP 与业务域无关。 */
export class OpenAIToolStream {
  readonly calls = new Map<number, AssembledCall>();
  responseId: string | null = null;
  private characters = 0;

  feed(chunk: JsonObject): void {
    if (typeof chunk.id === 'string') this.responseId = chunk.id;
    const choices = chunk.choices;
    if (!Array.isArray(choices) || !choices.length) return;
    const choice = choices[0];
    const delta = isJsonObject(choice) ? choice.delta : undefined;
    const fragments = isJsonObject(delta) ? delta.tool_calls : undefined;
    if (fragments === undefined || fragments === null) return;
    if (!Array.isArray(fragments)) throw new ToolStreamError('invalid_tool_stream');
    for (const fragment of fragments) {
      if (!isJsonObject(fragment)) throw new ToolStreamError('invalid_tool_stream');
      const index = fragment.index;
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= 128)
        throw new ToolStreamError('invalid_tool_stream_index');
      let call = this.calls.get(index);
      if (call === undefined) {
        call = { id: '', type: 'function', function: { name: '', arguments: '' } };
        this.calls.set(index, call);
      }
      const fn = has(fragment, 'function') ? fragment.function : {};
      const type = has(fragment, 'type') ? fragment.type : 'function';
      if (!isJsonObject(fn) || type !== 'function')
        throw new ToolStreamError('invalid_tool_stream_function');
      const target = call;
      const parts: [string | null | undefined | unknown, (part: string) => void][] = [
        [fragment.id, (part) => (target.id += part)],
        [fn.name, (part) => (target.function.name += part)],
        [fn.arguments, (part) => (target.function.arguments += part)],
      ];
      for (const [part, append] of parts) {
        if (part === undefined || part === null) continue;
        if (typeof part !== 'string') throw new ToolStreamError('invalid_tool_stream_fragment');
        this.characters += Array.from(part).length;
        if (this.characters > MAX_CHARACTERS) throw new ToolStreamError('tool_stream_too_large');
        append(part);
      }
    }
  }

  complete(finishReason: string | null): AssembledCall[] {
    // 截断 / 被过滤：保留结束原因与用量，丢弃所有未完成的调用。
    if (finishReason === 'length' || finishReason === 'content_filter') return [];
    if (this.calls.size && finishReason !== 'stop' && finishReason !== 'tool_calls')
      throw new ToolStreamError('incomplete_tool_stream');
    const result = [...this.calls.keys()]
      .sort((a, b) => a - b)
      .map((index) => this.calls.get(index)!);
    const ids = new Set<string>();
    for (const call of result) {
      if (!call.id || !call.function.name || ids.has(call.id))
        throw new ToolStreamError('invalid_completed_tool');
      ids.add(call.id);
      let parsed;
      try {
        parsed = parseJson(call.function.arguments, 'tool arguments');
      } catch (error) {
        if (!(error instanceof InputDomainError)) throw error;
        throw new ToolStreamError('invalid_completed_arguments');
      }
      if (!isJsonObject(parsed)) throw new ToolStreamError('invalid_completed_arguments');
    }
    return result;
  }
}
