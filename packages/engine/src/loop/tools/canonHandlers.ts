import { canonDelta, type CanonDeltaInput } from '../../kernel/canonDelta';
import { hooksDelta } from '../../kernel/canonHooksDelta';
import { buildCanonProjection } from '../../kernel/canonService';
import { FsToolError } from '../../kernel/fsTools';
import { isObj, type Obj } from '../../kernel/json';
import { cpLen, pythonStrip } from '../../kernel/pythonText';
import { optionalString } from '../runPayloads';
import type { ToolHandler, ToolResult } from './execution';
import type { ToolDeps } from './handlerDeps';
import { requiredString } from './runtimeArguments';

const has = (payload: Obj, key: string) => Object.prototype.hasOwnProperty.call(payload, key);

const completed = (output: Obj, trace: ToolResult['trace']): ToolResult => ({
  status: 'completed',
  output,
  trace,
  artifacts: [],
});

const DELTA_KEYS: [string, keyof CanonDeltaInput][] = [
  ['entities', 'entities'],
  ['holder_claims', 'holderClaims'],
  ['exit_claims', 'exitClaims'],
  ['timeline_claims', 'timelineClaims'],
  ['promise_claims', 'promiseClaims'],
];

/** project.canon / canon_delta / hooks_delta；压缩修订（trim_prose）产补丁，随 P3-6。 */
export function canonToolHandlers(deps: ToolDeps): Record<string, ToolHandler> {
  const { reader, writer, platform } = deps;

  const canon: ToolHandler = async (_context, payload) => {
    const root = requiredString(payload, 'project_root');
    const glob = optionalString(payload.glob) ?? '*.md';
    const refresh = payload.refresh !== false;
    // 确定性投影核心（写派生缓存 + dossier）与 IDE 命令 canon.refresh 共用。
    const { output } = await buildCanonProjection(reader, writer, root, {
      glob,
      refresh,
      platform,
    });
    return completed(output, {
      tool_name: 'project.canon',
      status: 'completed',
      input_summary: { refresh, glob },
      output_summary: {
        entity_count: output.entity_count,
        checked_invariants: output.checked_invariants,
        conflict_count: output.conflict_count,
        advisory_count: output.advisory_count,
      },
    });
  };

  const delta: ToolHandler = async (_context, payload) => {
    const root = requiredString(payload, 'project_root');
    const input: CanonDeltaInput = {};
    const counts: Record<string, number> = {};
    for (const [key, field] of DELTA_KEYS) {
      if (!has(payload, key)) continue;
      const value = payload[key];
      if (!Array.isArray(value) || value.some((item) => !isObj(item)))
        throw new FsToolError(`${key} 必须是对象数组。`);
      Object.assign(input, { [field]: value });
      counts[key] = value.length;
    }
    const output = (await canonDelta(reader, writer, root, input, platform)) as Obj;
    const proposals = output.proposals as Obj;
    return completed(output, {
      tool_name: 'project.canon_delta',
      status: 'completed',
      input_summary: {
        entity_count: counts.entities ?? 0,
        claim_count: ['holder_claims', 'exit_claims', 'timeline_claims', 'promise_claims'].reduce(
          (sum, key) => sum + (counts[key] ?? 0),
          0,
        ),
      },
      output_summary: {
        new_entity_count: (proposals.new_entities as unknown[]).length,
        known_entity_count: (proposals.known_entities as unknown[]).length,
        alias_conflict_count: (output.alias_conflicts as unknown[]).length,
        new_conflict_count: (output.new_conflicts as unknown[]).length,
        new_advisory_count: (output.new_advisories as unknown[]).length,
      },
    });
  };

  const hooks: ToolHandler = async (_context, payload) => {
    const root = requiredString(payload, 'project_root');
    const observed = payload.observed_hooks;
    let observedHooks: Obj[] | null = null;
    if (observed !== undefined && observed !== null) {
      if (!Array.isArray(observed) || observed.some((item) => !isObj(item)))
        throw new FsToolError('observed_hooks 必须是对象数组。');
      observedHooks = observed as Obj[];
    }
    const evidence = payload.evidence_text;
    const evidenceText = typeof evidence === 'string' && pythonStrip(evidence) ? evidence : null;
    const output = (await hooksDelta(reader, root, {
      observedHooks: observedHooks as never,
      evidenceText,
    })) as Obj;
    return completed(output, {
      tool_name: 'project.hooks_delta',
      status: 'completed',
      input_summary: {
        observed_hook_count: observedHooks?.length ?? 0,
        evidence_text_chars: cpLen(evidenceText ?? ''),
      },
      output_summary: {
        new_hook_count: (output.new_hooks as unknown[]).length,
        duplicate_count: (output.duplicates as unknown[]).length,
        pattern_hit_count: (output.pattern_hits as unknown[]).length,
      },
    });
  };

  return { 'project.canon': canon, 'project.canon_delta': delta, 'project.hooks_delta': hooks };
}
