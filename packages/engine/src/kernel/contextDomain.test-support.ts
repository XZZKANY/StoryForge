import golden from '../../golden/p1-context.windows.json';
import {
  currentCanonOrderBytes,
  decodeFixtureBytes,
  type EncodedFile,
} from './contextFixture.test-support';
import { textFromCodePoints } from './pythonFacts.test-support';

/**
 * 迁移计划 §4.3.1：book.context 的 Python 用例不重录，逐条判定 TS 应得什么。
 * 判定只看输入，不调用被测实现；新行为的期望值取同一棵树上另一条 Python 用例的输出。
 */
export type ContextCase = (typeof golden.book_context)[number];
export type CommandCase = ContextCase['commands'][number];

/** 旧 oracle 不重录：仅升级测试缓存的版本戳，继续覆盖其余字节/结构有效性。 */
export function currentPresenceVersionFixture(fixture: {
  files: Record<string, EncodedFile | undefined>;
  missing_root: boolean;
}) {
  const path = '.storyforge/canon/derived/presence.json';
  const file = fixture.files[path];
  if (!file) return fixture;
  const bytes = currentCanonOrderBytes(path, decodeFixtureBytes(file));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return {
    ...fixture,
    files: {
      ...fixture.files,
      [path]: {
        chunks: [{ base64: btoa(binary), repeat: 1 }],
      },
    },
  };
}

/** 有意偏离 Python 旧阅读序；此用例只有第2/10章互换，其余字段与原oracle保持一致。 */
export function currentReadingOrderJson(id: string, json: string): string {
  return id === 'unicode-order'
    ? json.replace(/正文\/第(10|2)章\.md/g, (_, number: string) =>
        number === '10' ? '正文/第2章.md' : '正文/第10章.md',
      )
    : json;
}

/** 作者声明超出范围：TS 报错，消息须包含这段文字。 */
export const DECLARATION_ERRORS: Readonly<Record<string, string>> = {
  'deep-id-list-1000': '嵌套超过 64 层',
  'deep-id-list-2000': '嵌套超过 64 层',
  'deep-id-list-2500': '嵌套超过 64 层',
  'deep-id-dict-1000': '嵌套超过 64 层',
  'deep-id-dict-2000': '嵌套超过 64 层',
  'deep-id-dict-2500': '嵌套超过 64 层',
  'canon-invalid': 'canon.json 第 1 行第 2 列',
  'canon-bom': '文件以 BOM 开头',
  'canon-wrong-top': '顶层 应为对象，实际是数组',
  'canon-invalid-utf8': '不是合法的 UTF-8 文本',
  'canon-nul': 'JSON 之后还有多余内容',
  'canon-oversize': '文件超过 2 MiB',
  'canon-scalar-entities': 'entities 应为数组，实际是整数',
  'canon-empty-object-entities': 'entities 应为数组，实际是对象',
  'canon-string-aliases': 'entities[0].aliases 应为数组，实际是字符串',
  // 名字里有未转义的控制字符 U+001C：两边都整份拒收（Python 静默丢弃人物表）。
  'canon-map-aliases': '字符串里有未转义的控制字符',
  'canon-scalar-aliases': 'entities[0].aliases 应为数组，实际是整数',
  'roster-truncate-before-forms': 'entities[0] 应为对象，实际是null',
  'roster-python-value-semantics': 'entities[1].id 应为字符串，实际是布尔值',
  'unicode-version-container-id': 'entities[0].id 应为字符串，实际是数组',
};

/** 派生缓存超出范围视为失效：期望值取同一份 canon、缓存缺席或不匹配时 Python 的输出。 */
export const CACHE_INVALID_ORACLE: Readonly<Record<string, string>> = {
  'presence-utf-8-sig': 'canon-no-presence',
  'presence-utf-16': 'canon-no-presence',
  'presence-utf-16-le': 'canon-no-presence',
  'presence-utf-16-be': 'canon-no-presence',
  'presence-utf-32': 'canon-no-presence',
  'presence-utf-32-le': 'canon-no-presence',
  'presence-utf-32-be': 'canon-no-presence',
  'presence-browser-infinity': 'canon-no-presence',
  'presence-duplicate-and-nonstring-id': 'canon-no-presence',
  'presence-scalar-entities': 'canon-no-presence',
  'presence-pair-identity-utf-8-raw-last': 'presence-pair-identity-raw-escaped',
  'presence-pair-identity-utf-8-astral-last': 'presence-pair-identity-raw-escaped',
  'presence-pair-identity-utf-16-le-raw-last': 'presence-pair-identity-raw-escaped',
  'presence-pair-identity-utf-16-le-astral-last': 'presence-pair-identity-raw-escaped',
  'presence-pair-identity-utf-32-le-raw-last': 'presence-pair-identity-raw-escaped',
  'presence-pair-identity-utf-32-le-astral-last': 'presence-pair-identity-raw-escaped',
  'presence-pair-identity-raw-escaped': 'presence-pair-identity-raw-escaped',
  'presence-pair-identity-escaped-raw': 'presence-pair-identity-raw-escaped',
  // 回执时间戳是 u64 最大值，应用写不出来：回执作废，来源版本未知，缓存不被信任。
  'receipts-valid': 'receipts-unknown',
};

/** 来源版本因回执超出范围而未知（Python 给出了有效版本）。 */
export const REVISION_UNKNOWN: ReadonlySet<string> = new Set(['receipts-valid']);

/** 相对的 current_file 按项目根解析：期望值取同一棵树、绝对路径输入时 Python 的输出。 */
export const RELATIVE_ORACLE: Readonly<Record<string, string>> = {
  'relative-current-cwd-split': 'chapters',
};

/** 命令参数超出范围（孤立代理码点）：400。键为 `用例/命令`。 */
export const ARGUMENT_ERRORS: Readonly<Record<string, string>> = {
  'command-inputs/lone-surrogate-arg': '孤立的代理码点',
  'command-inputs/redacted-surrogate-arg': '孤立的代理码点',
  'command-inputs/lone-surrogate-key': '孤立的代理码点',
};

const byId = new Map(golden.book_context.map((fixture) => [fixture.id, fixture]));
function oracle(id: string): ContextCase {
  const fixture = byId.get(id);
  if (fixture === undefined) throw new Error(`Unknown oracle ${id}`);
  return fixture;
}

export type ContextExpectation =
  | { kind: 'parity'; source: ContextCase }
  | { kind: 'oracle'; source: ContextCase }
  | { kind: 'declaration-error'; message: string };

export function contextExpectation(fixture: ContextCase): ContextExpectation {
  const message = DECLARATION_ERRORS[fixture.id];
  if (message !== undefined) return { kind: 'declaration-error', message };
  const source = CACHE_INVALID_ORACLE[fixture.id] ?? RELATIVE_ORACLE[fixture.id];
  return source === undefined
    ? { kind: 'parity', source: fixture }
    : { kind: 'oracle', source: oracle(source) };
}

export type CommandExpectation =
  | { kind: 'error'; status: number; message: string; exact: boolean }
  | {
      kind: 'output';
      output: (root: string) => Record<string, unknown>;
      prompt: Uint8Array | null;
    };

export const hydrate = (text: string, root: string): unknown =>
  JSON.parse(text, (_key, value: unknown) =>
    typeof value === 'string' ? value.split('$ROOT').join(root) : value,
  );

export function commandSecrets(command: CommandCase) {
  return { values: command.context.map(textFromCodePoints) };
}

export function commandExpectation(fixture: ContextCase, command: CommandCase): CommandExpectation {
  const argumentError = ARGUMENT_ERRORS[`${fixture.id}/${command.id}`];
  if (argumentError !== undefined)
    return { kind: 'error', status: 400, message: argumentError, exact: false };
  const context = contextExpectation(fixture);
  if (context.kind === 'declaration-error')
    return { kind: 'error', status: 400, message: context.message, exact: false };
  const source = context.source.commands.find((candidate) => candidate.id === command.id);
  if (source === undefined) throw new Error(`No oracle command ${command.id}`);
  if ('error' in source && source.error)
    return {
      kind: 'error',
      status: source.http.status,
      message: source.http.display!,
      exact: true,
    };
  const outputJson = currentReadingOrderJson(fixture.id, source.output_json!);
  const promptBase64 = source.prompt_utf8_base64;
  // 参照用例的参数不同（只有相对路径那条）时，回显取本条命令自己的参数；两边都不含密钥。
  const ownArgs = source.args_json === command.args_json ? null : command.args_json;
  return {
    kind: 'output',
    output: (root) => {
      const expected = hydrate(outputJson, root) as { payload: Record<string, unknown> };
      if (ownArgs !== null) expected.payload.args = hydrate(ownArgs, root);
      return expected;
    },
    prompt:
      promptBase64 === null
        ? null
        : Uint8Array.from(atob(promptBase64!), (char) => char.charCodeAt(0)),
  };
}
