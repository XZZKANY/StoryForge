import { COMMAND_TRIGGERS } from './conversationSkills';

/**
 * `/写 4-10` 批量写章指令（方案 docs/internal/write-batch-plan-2026-10.md）。只认消息开头的指令，
 * 触发符与技能点名相同；指令词是 `写` 或不分大小写的 `goal`，后面得是空白或消息结尾。
 */
export type WriteBatchCommand =
  /** 写第 from 到第 to 章（两端都含）；note 是范围后面跟的那句话，E 刀带进每一章。 */
  | { kind: 'range'; from: number; to: number; note: string | null }
  /** 不带范围：续写上一批。 */
  | { kind: 'resume' }
  /** 是指令，但范围写得不对；message 是给作者看的提示。 */
  | { kind: 'invalid'; message: string };

/** 用法示例，格式不对时卡片上列出来。 */
export const WRITE_BATCH_USAGE: ReadonlyArray<{ example: string; meaning: string }> = [
  { example: '/写 4-10', meaning: '写第 4 到第 10 章' },
  { example: '/写 5', meaning: '只写第 5 章' },
  { example: '/写 4-6 这几章节奏快一点', meaning: '范围后面空一格，可以跟一句要求' },
  { example: '/写', meaning: '续写上一批' },
];

/** 章序最多几位数。 */
export const WRITE_BATCH_ORDINAL_MAX_DIGITS = 5;

const HEAD = new RegExp(`^\\s*[${COMMAND_TRIGGERS}](?:写|goal)(?=\\s|$)`, 'i');
const DIGITS = '[0-9０-９]+';
// 半角、全角连字符，短横、长横（中文输入法常打成两个），波浪号，「至」「到」。
const SEPARATOR = '(?:-|－|–|—{1,2}|~|～|至|到)';
const RANGE = new RegExp(
  `^(?:第\\s*)?(${DIGITS})(?:\\s*章)?(?:\\s*${SEPARATOR}\\s*(?:第\\s*)?(${DIGITS}))?(?:\\s*章)?`,
);

const toNumber = (digits: string) =>
  Number(digits.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)));

const invalid = (message: string): WriteBatchCommand => ({ kind: 'invalid', message });

/** 消息是不是批量写章指令；不是就返回 null（照常发给 AI 或当技能点名）。 */
export function parseWriteBatchCommand(message: string): WriteBatchCommand | null {
  const head = HEAD.exec(message);
  if (!head) return null;
  const rest = message.slice(head[0].length).trim();
  if (!rest) return { kind: 'resume' };
  const range = RANGE.exec(rest);
  if (!range)
    return invalid('「/写」后面要跟章序：比如 /写 4-10；只写一章就写 /写 5。章序用数字写。');
  const after = rest.slice(range[0].length);
  if (after && !/^\s/.test(after))
    return invalid('章序范围没认出来：写成 4-10 或 5；要求写在范围后面，中间空一格。');
  const tokens = [range[1], range[2] ?? range[1]];
  if (tokens.some((token) => token.length > WRITE_BATCH_ORDINAL_MAX_DIGITS))
    return invalid(`章序最多 ${WRITE_BATCH_ORDINAL_MAX_DIGITS} 位数。`);
  const [from, to] = tokens.map(toNumber);
  if (from === 0 || to === 0) return invalid('章序从 1 开始，没有第 0 章。');
  if (from > to)
    return invalid(`起点比终点大：要写第 ${to} 到第 ${from} 章，就写 /写 ${to}-${from}。`);
  const note = after.trim();
  return { kind: 'range', from, to, note: note || null };
}
