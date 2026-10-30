/** 对话技能放在作品根的这个文件夹：一个技能一份 Markdown，对话每轮只带目录，AI 用得上时自己读全文。 */
export const CONVERSATION_SKILL_DIR = '技能';

/** 一条消息最多点名几份技能：多了提示词太长、规矩互相打架。 */
export const INVOKED_SKILL_MAX = 3;

// 中文输入法下按 / 键打出来的是「、」，全角是「／」，三个都认。
const TRIGGERS = '/／、';
const LEADING_TRIGGER = new RegExp(`^\\s*[${TRIGGERS}]`);
const PENDING_COMMAND = new RegExp(`^\\s*(?:[${TRIGGERS}]\\S+\\s+){0,2}[${TRIGGERS}](\\S*)$`);

/** 消息是不是以技能点名开头（只看触发符，不核对名字）。 */
export function startsWithSkillCommand(message: string): boolean {
  return LEADING_TRIGGER.test(message);
}

/**
 * 输入框里正在打的技能点名：整条消息只有开头的几个点名、最后一个还没打空格时，返回最后一个触发符后面的字
 * （刚打出触发符时是空串）；否则 null。
 */
export function skillCommandQuery(value: string): string | null {
  return PENDING_COMMAND.exec(value)?.[1] ?? null;
}

/** 把正在打的那个点名换成 `/名字 `（触发符统一成半角）。 */
export function completeSkillCommand(value: string, name: string): string {
  return value.replace(new RegExp(`[${TRIGGERS}]\\S*$`), `/${name} `);
}

/**
 * 消息开头连着点名的技能（`/立项流程 /审稿口径 ……`）：每个触发符后面按最长匹配认 `names` 里的名字，
 * 名字后面要么是空白、要么是消息结尾；碰到认不出的就停。去重，最多 {@link INVOKED_SKILL_MAX} 个。
 */
export function invokedSkillNames(message: string, names: readonly string[]): string[] {
  const known = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  const picked: string[] = [];
  let rest = message.trimStart();
  while (picked.length < INVOKED_SKILL_MAX && rest && TRIGGERS.includes(rest[0])) {
    const after = rest.slice(1);
    const name = known.find(
      (item) =>
        after.startsWith(item) && (after.length === item.length || /\s/.test(after[item.length])),
    );
    if (name === undefined) break;
    if (!picked.includes(name)) picked.push(name);
    rest = after.slice(name.length).trimStart();
  }
  return picked;
}
