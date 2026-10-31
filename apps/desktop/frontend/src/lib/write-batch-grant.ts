/**
 * `/写` 批量写章的一次性授权（作者 10-30 第 1 问选 B）：作者点了「开始写」，这一批里调度器发起的写章运行
 * 按「自动」档送给引擎，修订不用逐章点接受。作者存的档位不改，也不写进本机存储。
 *
 * 唯一入口：授权只能由批量写章调度器发出（`tests/write-batch-grant.test.ts` 钉住只有它调用 issueWriteBatchGrant），
 * 而且只对意图是写章、目标在这一批计划里的运行生效；批量停下或写完就撤销。只读档整批不升。
 * 引擎只认每次运行送来的档位，判定仍只有 `permission.ts` 那一处；写进文件的保护一条不放宽。
 */
import type { AgentPermissionProfile } from './agent-permission';
import { normalizePathForMatch } from './project/path';

export type WriteBatchGrant = {
  readonly projectPath: string;
  readonly batchId: string;
};

type GrantState = { targets: ReadonlySet<string>; live: boolean; runs: Set<string> };

// 只认这里发出去的对象：别处照着形状拼一个出来，不在表里，升不了档。
const issued = new WeakMap<WriteBatchGrant, GrantState>();
// 这一批发起的运行 → 它的授权：自动写进文件时据此不逐章弹撤销提示（撤销改由清单提供）。
const runOwners = new Map<string, WriteBatchGrant>();

const targetKey = (path: string) => normalizePathForMatch(path.trim());

/** 只给批量写章调度器用：这一段要写的章（计划里的目标文件，项目相对路径）。 */
export function issueWriteBatchGrant(input: {
  projectPath: string;
  batchId: string;
  targets: readonly string[];
}): WriteBatchGrant {
  const grant: WriteBatchGrant = Object.freeze({
    projectPath: input.projectPath,
    batchId: input.batchId,
  });
  issued.set(grant, {
    targets: new Set(input.targets.map(targetKey)),
    live: true,
    runs: new Set(),
  });
  return grant;
}

/** 批量停下、写完或调度器卸载时撤销；撤销后同一个对象再也升不了档，登记过的运行也不再算批量的。 */
export function revokeWriteBatchGrant(grant: WriteBatchGrant | null | undefined): void {
  const state = grant ? issued.get(grant) : undefined;
  if (!state) return;
  state.live = false;
  for (const runId of state.runs) runOwners.delete(runId);
  state.runs.clear();
}

/** 只给批量写章调度器用：把刚发起的这一章的运行 id 登记到这一批的授权下。 */
export function bindWriteBatchRun(grant: WriteBatchGrant, runId: string): void {
  const state = issued.get(grant);
  if (!state?.live || !runId) return;
  state.runs.add(runId);
  runOwners.set(runId, grant);
}

/**
 * 这次运行是不是批量写章发起的、这一批的授权还没撤。是的话它自动写进文件时不逐章弹撤销提示
 * （写 10 章会冒出约 20 条、10 秒就消失），撤销改由清单提供；批量停下或写完以后作者再手动接受，照旧弹。
 */
export function isWriteBatchRun(runId: string | null | undefined): boolean {
  const grant = runId ? runOwners.get(runId) : undefined;
  return grant !== undefined && issued.get(grant)?.live === true;
}

/**
 * 这次运行送给引擎的档位：作者存的是「询问」、带着有效授权、意图是写章、目标在这一批计划里、作品对得上，
 * 才送「自动」；其余一律原样送作者存的档位（只读不升，自动 / 完全放行本来就免点）。
 */
export function permissionForRun(input: {
  stored: AgentPermissionProfile;
  projectPath: string | null;
  intent: string | undefined;
  targetFilePath: string | undefined;
  grant: WriteBatchGrant | undefined;
}): AgentPermissionProfile {
  const { stored, grant } = input;
  if (!grant || stored !== 'ask' || input.intent !== 'chapter.write') return stored;
  const state = issued.get(grant);
  if (!state?.live || grant.projectPath !== input.projectPath) return stored;
  if (!input.targetFilePath || !state.targets.has(targetKey(input.targetFilePath))) return stored;
  return 'auto';
}
