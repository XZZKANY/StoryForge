import { cpLen } from '../kernel/pythonText';
import type { ToolCall, ToolSpec } from '../llm/contracts';
import {
  cloneJson,
  deepFreeze,
  dumpJson,
  InputDomainError,
  isJsonObject,
  JsonFloat,
  parseJson,
  pythonEquals,
  pythonFloatRepr,
  type JsonObject,
  type JsonValue,
} from '../kernel/json';

export type RuntimeArtifact = {
  readonly kind: string;
  readonly payload: JsonObject;
  readonly reference: string | null;
};

export const runtimeArtifact = (
  kind: string,
  payload: JsonObject,
  reference: string | null = null,
): RuntimeArtifact => Object.freeze({ kind, payload: deepFreeze(cloneJson(payload)), reference });

/**
 * 工具结果只有成功与失败两种。Python SDK 的 deferred（外部写回等待）没有生产调用方
 * （EXTERNAL_WRITEBACK_RELEASED=false），不搬。
 */
export class RuntimeToolResult {
  private constructor(
    readonly status: 'success' | 'failure',
    readonly output: JsonObject,
    readonly artifacts: readonly RuntimeArtifact[],
    readonly errorCode: string | null,
    readonly errorMessage: string | null,
    readonly retryable: boolean,
  ) {}

  static success(output: JsonObject, artifacts: readonly RuntimeArtifact[] = []) {
    return new RuntimeToolResult('success', cloneJson(output), [...artifacts], null, null, false);
  }

  static failure(code: string, message: string, retryable = false) {
    return new RuntimeToolResult('failure', {}, [], code, message, retryable);
  }

  toOutput(): JsonObject {
    return cloneJson(this.output);
  }
}

export type ToolHandler = (
  context: unknown,
  args: JsonObject,
) => RuntimeToolResult | Promise<RuntimeToolResult>;

export type RuntimeTool = {
  readonly spec: ToolSpec;
  readonly handler: ToolHandler;
  readonly outputSchema: JsonObject;
  readonly retrySafe: boolean;
  readonly idempotent: boolean;
  readonly metadata: JsonObject;
};

export const runtimeTool = (
  spec: ToolSpec,
  handler: ToolHandler,
  options: Partial<Omit<RuntimeTool, 'spec' | 'handler'>> = {},
): RuntimeTool => ({
  spec,
  handler,
  outputSchema: cloneJson(options.outputSchema ?? {}),
  retrySafe: options.retrySafe ?? false,
  idempotent: options.idempotent ?? false,
  metadata: cloneJson(options.metadata ?? {}),
});

export class ToolRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolRegistryError';
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, RuntimeTool>();

  constructor(tools: Iterable<RuntimeTool> = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: RuntimeTool): void {
    if (this.tools.has(tool.spec.name))
      throw new ToolRegistryError(`Runtime tool '${tool.spec.name}' is already registered.`);
    this.tools.set(tool.spec.name, tool);
  }

  get(name: string): RuntimeTool {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolRegistryError(`Unknown runtime tool: ${name}`);
    return tool;
  }

  all(): readonly RuntimeTool[] {
    return [...this.tools.values()];
  }
}

export type SchemaIssue = { path: (string | number)[]; code: string; message: string };

const numeric = (value: JsonValue | undefined): number | null =>
  typeof value === 'number' ? value : value instanceof JsonFloat ? value.value : null;
const numberText = (value: JsonValue): string =>
  value instanceof JsonFloat ? pythonFloatRepr(value.value) : String(value);

function matchesType(value: JsonValue, expected: string): boolean {
  switch (expected) {
    case 'object':
      return isJsonObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      // 非整数的 number 只可能来自 TS 代码里的浮点运算，按 Python float 处理。
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return numeric(value) !== null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

/** 工具契约用到的 JSON Schema 子集；与 Python validate_json_schema 同序、同文案。 */
export function validateJsonSchema(
  value: JsonValue,
  schema: JsonObject,
  path: (string | number)[] = [],
): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const allowed = schema.enum;
  if (Array.isArray(allowed) && !allowed.some((choice) => pythonEquals(value, choice))) {
    issues.push({ path, code: 'enum', message: 'Value is not one of the allowed choices.' });
    return issues;
  }
  const rawType = schema.type;
  const expected = Array.isArray(rawType)
    ? rawType.filter((item): item is string => typeof item === 'string')
    : typeof rawType === 'string'
      ? [rawType]
      : [];
  if (expected.length && !expected.some((item) => matchesType(value, item))) {
    issues.push({ path, code: 'type', message: `Expected ${expected.join(' or ')}.` });
    return issues;
  }
  if (isJsonObject(value)) {
    const properties = isJsonObject(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required)
        if (typeof key === 'string' && !Object.prototype.hasOwnProperty.call(value, key))
          issues.push({
            path: [...path, key],
            code: 'required',
            message: 'Required property is missing.',
          });
    }
    for (const [key, item] of Object.entries(value)) {
      const child = Object.prototype.hasOwnProperty.call(properties, key)
        ? properties[key]
        : undefined;
      if (isJsonObject(child)) issues.push(...validateJsonSchema(item, child, [...path, key]));
      else if (schema.additionalProperties === false)
        issues.push({
          path: [...path, key],
          code: 'additional_property',
          message: 'Additional property is not allowed.',
        });
    }
  }
  if (Array.isArray(value) && isJsonObject(schema.items)) {
    const items = schema.items;
    value.forEach((item, index) =>
      issues.push(...validateJsonSchema(item, items, [...path, index])),
    );
  }
  if (typeof value === 'string') {
    const { minLength, maxLength } = schema;
    if (typeof minLength === 'number' && cpLen(value) < minLength)
      issues.push({
        path,
        code: 'min_length',
        message: `String must contain at least ${minLength} characters.`,
      });
    if (typeof maxLength === 'number' && cpLen(value) > maxLength)
      issues.push({
        path,
        code: 'max_length',
        message: `String must contain at most ${maxLength} characters.`,
      });
  }
  const number = numeric(value);
  if (number !== null) {
    const minimum = numeric(schema.minimum);
    const maximum = numeric(schema.maximum);
    if (minimum !== null && number < minimum)
      issues.push({
        path,
        code: 'minimum',
        message: `Number must be at least ${numberText(schema.minimum!)}.`,
      });
    if (maximum !== null && number > maximum)
      issues.push({
        path,
        code: 'maximum',
        message: `Number must be at most ${numberText(schema.maximum!)}.`,
      });
  }
  return issues;
}

/**
 * 模型给的参数按标准 JSON 解析（§4.3.1）：NaN / Infinity、超出安全整数、孤立代理码点、
 * 嵌套超 64 层都按「不是合法 JSON」反馈给模型（Python json.loads 会接受其中一部分）。
 */
export function parseToolArguments(
  call: ToolCall,
  tool: RuntimeTool,
): { args: JsonObject; failure: null } | { args: null; failure: RuntimeToolResult } {
  let value: JsonValue;
  try {
    value = parseJson(call.argumentsJson || '{}', 'tool arguments');
  } catch (error) {
    if (!(error instanceof InputDomainError)) throw error;
    return {
      args: null,
      failure: RuntimeToolResult.failure('invalid_arguments', 'Tool arguments are not valid JSON.'),
    };
  }
  if (!isJsonObject(value))
    return {
      args: null,
      failure: RuntimeToolResult.failure(
        'invalid_arguments',
        'Tool arguments must be a JSON object.',
      ),
    };
  const issues = validateJsonSchema(value, tool.spec.inputSchema);
  if (issues.length) {
    const summary = issues
      .map((issue) => `${issue.code}@${issue.path.map(String).join('.') || '$'}`)
      .join(', ');
    return {
      args: null,
      failure: RuntimeToolResult.failure(
        'invalid_arguments',
        `Tool arguments do not match the declared schema: ${summary}`,
      ),
    };
  }
  return { args: value, failure: null };
}

export type FeedbackInput = { call: ToolCall; tool: RuntimeTool | null; context: unknown };

export interface ToolFeedbackFormatter {
  format(result: RuntimeToolResult, input: FeedbackInput): string;
}

export class JsonToolFeedbackFormatter implements ToolFeedbackFormatter {
  format(result: RuntimeToolResult): string {
    const payload =
      result.status === 'success'
        ? { ok: true, output: result.toOutput() }
        : {
            ok: false,
            error: {
              code: result.errorCode || 'tool_failure',
              message: result.errorMessage || 'Tool execution failed.',
              retryable: result.retryable,
            },
          };
    return dumpJson(payload, { ensureAscii: false, separators: [',', ':'] });
  }
}
