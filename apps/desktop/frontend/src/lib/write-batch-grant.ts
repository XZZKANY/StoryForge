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

type GrantState = { targets: ReadonlySet<string>; live: boolean };

// 只认这里发出去的对象：别处照着形状拼一个出来，不在表里，升不了档。
const issued = new WeakMap<WriteBatchGrant, GrantState>();

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
  issued.set(grant, { targets: new Set(input.targets.map(targetKey)), live: true });
  return grant;
}

/** 批量停下、写完或调度器卸载时撤销；撤销后同一个对象再也升不了档。 */
export function revokeWriteBatchGrant(grant: WriteBatchGrant | null | undefined): void {
  const state = grant ? issued.get(grant) : undefined;
  if (state) state.live = false;
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
