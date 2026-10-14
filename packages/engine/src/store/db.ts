import { JsonFloat } from '../kernel/json';

/** 绑定参数：整数、浮点、文本或 NULL（布尔存 0 / 1，JSON 列存文本）。 */
export type SqlValue = string | number | null;
export type SqlRow = { readonly [column: string]: SqlValue };
/** 一条语句；参数一律写成 `$1`、`$2` 这种带编号的形式（plugin-sql 按编号、node:sqlite 按名字绑定）。 */
export type SqlStep = { readonly sql: string; readonly params?: readonly SqlValue[] };

/**
 * 引擎库的端口。桌面端由 plugin-sql 实现，测试用 Node 自带的 node:sqlite。
 * 写操作一律经 `transaction`：同一组语句在一个事务里提交，失败整组回滚。
 */
export interface Db {
  select(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]>;
  /** 返回最后一条语句产生的行（INSERT … RETURNING 或 SELECT），其余语句的结果丢弃。 */
  transaction(steps: readonly SqlStep[]): Promise<SqlRow[]>;
}

const FLOAT_TAG = '\u0000JsonFloat';

/**
 * JSON 列的编码：与内存存储 `cloneJson` 的往返完全一致——普通数字仍是普通数字，
 * JsonFloat（Python 的整数值浮点）打标记保住身份，undefined 的键照 JSON 丢掉。
 */
export function encodeJsonColumn(value: unknown): string {
  return JSON.stringify(value, function (key, item) {
    const raw = (this as Record<string, unknown>)[key];
    return raw instanceof JsonFloat ? { [FLOAT_TAG]: raw.value } : item;
  });
}

function revive(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(revive);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 1 && entries[0][0] === FLOAT_TAG)
    return new JsonFloat(entries[0][1] as number);
  const output: Record<string, unknown> = Object.create(null);
  for (const [key, item] of entries) output[key] = revive(item);
  return output;
}

/** 解码出无原型对象（与 parseJson / cloneJson 一致：`constructor` 之类只是普通键）。 */
export function decodeJsonColumn(text: SqlValue): unknown {
  if (typeof text !== 'string') throw new TypeError('JSON 列不是文本');
  return revive(JSON.parse(text));
}

/** 写操作串行队列：引擎是这个库唯一的写入方，按调用顺序一条条提交。 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
