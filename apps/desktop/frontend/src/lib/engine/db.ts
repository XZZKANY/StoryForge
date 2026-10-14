import { invoke } from '@tauri-apps/api/core';
import type { Db, SqlRow } from '@storyforge/engine';

async function native(command: string, args: Record<string, unknown>): Promise<SqlRow[]> {
  try {
    return await invoke<SqlRow[]>(command, args);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * 引擎库的原生端口（`src-tauri/src/engine_db.rs`）：库文件 `storyforge-engine.sqlite3`
 * 在应用本地数据目录，与 Python 的库并排；单连接，一组语句一个真事务，失败整组回滚。
 */
export const nativeEngineDb: Db = {
  select: (sql, params = []) => native('engine_db_select', { sql, params }),
  transaction: (steps) =>
    native('engine_db_transaction', {
      steps: steps.map((step) => ({ sql: step.sql, params: step.params ?? [] })),
    }),
};
