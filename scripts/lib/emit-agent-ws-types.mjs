// 把 agent-ws.schema.json（Agent 实时帧契约的历史兼容路径）投影成前端 TS 接口。
// 确定性纯函数：同一 schema 每次产出一字不差，供 drift 门禁校验。
// 出线语义：帧的每个字段都在（to_wire 不 exclude_none），可空字段为 `X | null` 而非可选省略。

function tsTypeOf(propSchema) {
  if (propSchema.const !== undefined) {
    return JSON.stringify(propSchema.const);
  }
  if (Array.isArray(propSchema.enum)) {
    return propSchema.enum.map((value) => JSON.stringify(value)).join(' | ');
  }
  if (Array.isArray(propSchema.anyOf)) {
    return propSchema.anyOf.map(tsTypeOf).join(' | ');
  }
  switch (propSchema.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return `${tsTypeOf(propSchema.items ?? {})}[]`;
    case 'object':
      return 'Record<string, unknown>';
    default:
      return 'unknown';
  }
}

function emitInterface(name, frameSchema) {
  const properties = frameSchema.properties ?? {};
  const lines = [`export interface ${name} {`];
  for (const [key, propSchema] of Object.entries(properties)) {
    lines.push(`  ${key}: ${tsTypeOf(propSchema)};`);
  }
  lines.push('}');
  return lines.join('\n');
}

export function emitAgentWsTypes(schema) {
  const defs = schema.$defs ?? {};
  // oneOf 顺序即后端 _FRAMES 顺序，判别式解码按此；union 与接口输出都跟它走，保稳定。
  const frameNames = (schema.oneOf ?? []).map((entry) => entry.$ref.replace('#/$defs/', ''));

  const header = [
    '// 该文件由 scripts/generate-openapi.mjs 从',
    '// packages/shared/src/contracts/agent-ws.schema.json 生成，请勿手改。',
    '// 改 Agent 帧字段要改后端 app/domains/agent_runs/ws_messages.py 再跑 `pnpm openapi`。',
    '// 出线语义：帧的每个字段都在（to_wire 不 exclude_none），可空字段为 `X | null`。',
  ].join('\n');

  const interfaces = frameNames.map((name) => emitInterface(name, defs[name]));

  const union = [
    'export type AgentWsFrame =',
    ...frameNames.map((name, index) => `  | ${name}${index === frameNames.length - 1 ? ';' : ''}`),
  ].join('\n');

  return `${header}\n\n${interfaces.join('\n\n')}\n\n${union}\n`;
}
