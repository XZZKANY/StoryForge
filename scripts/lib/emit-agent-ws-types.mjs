// 把 packages/engine/golden/agent-ws.schema.json（Agent 帧契约）投影成前端 TS 接口。
// 确定性纯函数：同一 schema 每次产出一字不差；前端 agent-contract-generation.test.ts 比对已入库的生成文件。
// 重新生成：node scripts/lib/emit-agent-ws-types.mjs --write
// 出线语义：帧的每个字段都在（to_wire 不 exclude_none），可空字段为 `X | null` 而非可选省略。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
    '// 该文件由 scripts/lib/emit-agent-ws-types.mjs 从',
    '// packages/engine/golden/agent-ws.schema.json 生成，请勿手改。',
    '// 改 Agent 帧字段要同改 schema 与引擎 loop/frames.ts，再跑 `node scripts/lib/emit-agent-ws-types.mjs --write`。',
    '// 出线语义：帧的每个字段都在（to_wire 不 exclude_none），可空字段为 `X | null`。',
  ].join('\n');

  const payloadNames = Object.keys(defs)
    .filter((name) => !frameNames.includes(name))
    .sort();
  const interfaces = [...frameNames, ...payloadNames].map((name) =>
    emitInterface(name, defs[name]),
  );

  const union = [
    'export type AgentWsFrame =',
    ...frameNames.map((name, index) => `  | ${name}${index === frameNames.length - 1 ? ';' : ''}`),
  ].join('\n');

  return `${header}\n\n${interfaces.join('\n\n')}\n\n${union}\n`;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url && process.argv.includes('--write')) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const schema = JSON.parse(
    readFileSync(resolve(root, 'packages/engine/golden/agent-ws.schema.json'), 'utf8'),
  );
  writeFileSync(
    resolve(root, 'apps/desktop/frontend/src/lib/api/generated/agent-ws.ts'),
    emitAgentWsTypes(schema),
    'utf8',
  );
}
