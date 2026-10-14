import type { Db, SqlRow, SqlValue } from './db';
import { migrateEngineDb } from './schema';

// 引擎测试不带 Node 类型：只声明用到的那点 node:sqlite 接口。
type Statement = { all(named?: Record<string, SqlValue>): SqlRow[] };
type DatabaseSync = { exec(sql: string): void; prepare(sql: string): Statement; close(): void };
type SqliteModule = { DatabaseSync: new (path: string) => DatabaseSync };

const sqlite = (await import(/* @vite-ignore */ 'node:sqlite' as string)) as SqliteModule;

/** `$1`、`$2` 在 node:sqlite 里是具名参数：按名字绑定。 */
const named = (params: readonly SqlValue[] = []) =>
  Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value]));

/**
 * 测试用的 Db 端口：Node 自带的 SQLite（与桌面端 plugin-sql 同一个引擎，版本不同）。
 * 事务照桌面端的做法整组提交、失败整组回滚；外键约束打开。
 */
export function nodeSqliteDb(path = ':memory:'): Db & { close(): void } {
  const db = new sqlite.DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  return {
    async select(sql, params = []) {
      return db.prepare(sql).all(named(params));
    },
    async transaction(steps) {
      db.exec('BEGIN IMMEDIATE');
      try {
        let rows: SqlRow[] = [];
        for (const step of steps) rows = db.prepare(step.sql).all(named(step.params));
        db.exec('COMMIT');
        return rows;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close(),
  };
}

/** 建好表的内存库。 */
export async function migratedMemoryDb() {
  const db = nodeSqliteDb();
  await migrateEngineDb(db);
  return db;
}
