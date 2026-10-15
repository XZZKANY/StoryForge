import { invoke } from '@tauri-apps/api/core';
import type { Db, LegacySnapshotSource, SqlRow } from '@storyforge/engine';

async function native<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * 引擎库的原生端口（`src-tauri/src/engine_db.rs`）：库文件 `storyforge-engine.sqlite3`
 * 在应用本地数据目录，与 Python 的库并排；单连接，一组语句一个真事务，失败整组回滚。
 */
export const nativeEngineDb: Db = {
  select: (sql, params = []) => native<SqlRow[]>('engine_db_select', { sql, params }),
  transaction: (steps) =>
    native<SqlRow[]>('engine_db_transaction', {
      steps: steps.map((step) => ({ sql: step.sql, params: step.params ?? [] })),
    }),
};

/**
 * Python sidecar 的库（同一目录的 `storyforge.sqlite3`），旧库导入时读一次：驱动层只读打开、
 * 不存在时为 null、所有查询在一个读事务里（`engine_python_db_snapshot`）。
 */
export const nativePythonDb: LegacySnapshotSource = {
  snapshot: (queries) =>
    native<SqlRow[][] | null>('engine_python_db_snapshot', { queries: [...queries] }),
};

/**
 * 影子档（P5-1）的临时库：Rust 里的内存库，一条连接、关掉即消失（`engine_scratch_db_*`）。
 * 用完必须 `close`：Rust 端最多同时留几个。
 */
export async function nativeScratchDb(): Promise<Db & { close(): Promise<void> }> {
  const id = await native<number>('engine_scratch_db_open', {});
  return {
    select: (sql, params = []) => native<SqlRow[]>('engine_scratch_db_select', { id, sql, params }),
    transaction: (steps) =>
      native<SqlRow[]>('engine_scratch_db_transaction', {
        id,
        steps: steps.map((step) => ({ sql: step.sql, params: step.params ?? [] })),
      }),
    close: () => native<void>('engine_scratch_db_close', { id }),
  };
}
