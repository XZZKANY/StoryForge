import { describe, expect, it } from 'vitest';
import golden from '../../../golden/p3-tool-catalog.json';
import { dumpJson } from '../../kernel/json';
import { AgentOrchestrationError } from '../runPayloads';
import {
  AGENT_RUNTIME_TOOL_SPECS,
  buildLoopToolNameMap,
  buildLoopToolSchemas,
  confirmingToolNames,
  llmToolName,
  loopPatchToolSpecs,
  requiresConfirmation,
} from './catalog';
import * as ra from './runtimeArguments';
import { derivePermissionLevel, deriveRequiresConfirmation, toolSpec } from './specModels';

type Args = { [key: string]: never };
const secrets = { values: [golden.secret] };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

const CALLS: Record<string, (a: Args) => unknown> = {
  fs_int_arg: (a) => ra.fsIntArg(a.payload, 'offset', 9),
  chat_context_block: (a) => ra.chatContextBlock(a.args),
  required_string: (a) => ra.requiredString(a.args, 'k'),
  required_text: (a) => ra.requiredText(a.args, 'k'),
  required_int: (a) => ra.requiredInt(a.args, 'k'),
  optional_positive_int: (a) => ra.optionalPositiveInt(a.value),
  optional_int: (a) => ra.optionalInt(a.value),
  trim_prose_instruction: (a) => ra.trimProseInstruction(a.percent),
  safe_summary: (a) => ra.safeSummary(a.payload, secrets),
  sanitize_loop_tool_arguments: (a) => ra.sanitizeLoopToolArguments(a.args),
  string_list: (a) => ra.stringList(a.value),
  dict_list: (a) => ra.dictList(a.value),
  payload_list: (a) => ra.payloadList(a.value),
  style_rules: (a) => ra.styleRules(a.value),
  llm_context_input_summary: (a) => ra.llmContextInputSummary(a.snapshot),
  derive_requires_confirmation: (a) => deriveRequiresConfirmation(a.risk, a.mode),
  derive_permission_level: (a) => derivePermissionLevel(a.risk, a.mode),
  llm_tool_name: (a) => llmToolName(a.name),
};

describe('P3-3a 工具目录（Python 预言机）', () => {
  it('28 个工具声明逐字段一致（含派生的确认位与权限级）', () => {
    expect(
      plain(
        AGENT_RUNTIME_TOOL_SPECS.map((spec) => ({
          ...spec,
          requires_confirmation: requiresConfirmation(spec),
          permission_level: derivePermissionLevel(spec.risk_level, spec.execution_mode),
        })),
      ),
    ).toEqual(golden.specs);
  });

  it('模型看到的循环工具 schema 逐字节一致（含键序）', () => {
    expect(dumpJson(buildLoopToolSchemas(), { ensureAscii: false })).toBe(golden.loop_schemas_wire);
  });

  it('名映射、补丁工具、确认集合、受保护参数与两组循环策略一致', () => {
    expect(Object.fromEntries(buildLoopToolNameMap())).toEqual(golden.loop_name_map);
    expect(loopPatchToolSpecs().map((spec) => spec.name)).toEqual(golden.loop_patch_tools);
    expect([...confirmingToolNames()].sort()).toEqual(golden.confirming_tool_names);
    expect([...ra.PROTECTED_LOOP_TOOL_ARGUMENT_KEYS].sort()).toEqual(golden.protected_keys);
    expect([...ra.TRUSTED_WRITING_CONTEXT_TOOL_NAMES].sort()).toEqual(
      golden.trusted_writing_context_tools,
    );
    expect([...ra.HANDLER_OWNED_TRACE_TOOL_NAMES].sort()).toEqual(golden.handler_owned_trace_tools);
  });

  it('参数辅助函数逐条一致', () => {
    const seen = new Set<string>();
    for (const record of golden.records as unknown as {
      fn: string;
      args: Args;
      output?: unknown;
      error?: string;
    }[]) {
      seen.add(record.fn);
      const label = `${record.fn} ${JSON.stringify(record.args).slice(0, 200)}`;
      if (record.error !== undefined) {
        expect(() => CALLS[record.fn](record.args), label).toThrow(AgentOrchestrationError);
        expect(() => CALLS[record.fn](record.args), label).toThrow(record.error);
      } else expect(plain(CALLS[record.fn](record.args)), label).toEqual(record.output);
    }
    expect([...seen].sort()).toEqual(Object.keys(CALLS).sort());
  });

  it('声明的三项循环字段非法组合直接报错', () => {
    const base = {
      name: 'x',
      description: '',
      domain: 'd',
      input_schema: {},
      output_schema: {},
      allowed_roles: [],
      risk_level: 'read',
      retry_safe: true,
      idempotent: true,
      execution_mode: 'sync',
    };
    expect(() => toolSpec({ ...base, loop_trusted_context: true })).toThrow(
      'loop_trusted_context requires a file input mode',
    );
    expect(() => toolSpec({ ...base, loop_input_mode: 'disk' as never })).toThrow(
      'Invalid loop_input_mode',
    );
    expect(() => toolSpec({ ...base, loop_trace_owner: 'model' as never })).toThrow(
      'Invalid loop_trace_owner',
    );
  });
});
