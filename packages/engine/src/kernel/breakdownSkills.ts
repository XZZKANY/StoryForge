import { InputDomainError, isJsonObject, parseJson, type JsonValue } from './json';
import { pythonStrip } from './pythonText';

/** 拆书产出的写法 skill（作者在作品档案里点「放进 写法/」才落进作品）；每次拆书整份覆盖。 */
export const BREAKDOWN_SKILLS_PATH = '.storyforge/analysis/writing-skills.json';
export const BREAKDOWN_SKILLS_MAX = 5;
const NAME_MAX = 16;
const WHEN_MAX = 80;
const BODY_MAX = 800;

/** 程序从代表章节实测的写法数字：给模型用实测值，不让它估。 */
export type CraftMetrics = {
  readonly chapter_count: number;
  readonly avg_chapter_chars: number;
  readonly avg_paragraph_chars: number;
  readonly dialogue_percent: number;
  /** 每章第一句对白之前的字数（有对白的章取中位数）。 */
  readonly first_dialogue_offset: number | null;
  /** 最后一段是对白或问句的章数。 */
  readonly hook_endings: number;
};

export type BreakdownSkill = {
  readonly name: string;
  readonly when: string;
  readonly body: string;
  readonly file_name: string;
  /** 落进 `写法/` 的整份文件内容（与写法 skill 读取同一格式）。 */
  readonly content: string;
};

export class BreakdownSkillsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BreakdownSkillsError';
  }
}

const DIALOGUE = /“[^”]*”|「[^」]*」|"[^"\n]*"/gu;
const QUESTION_OR_QUOTE = /[？?”」"]/u;
const chars = (text: string) => Array.from(text.replace(/\s/gu, '')).length;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

export function craftMetrics(texts: readonly string[]): CraftMetrics | null {
  const chapters = texts.map((text) => text.replace(/\r\n?/g, '\n')).filter((text) => chars(text));
  if (!chapters.length) return null;
  let total = 0;
  let dialogue = 0;
  let paragraphs = 0;
  let hookEndings = 0;
  const offsets: number[] = [];
  for (const text of chapters) {
    const lines = text.split('\n').filter((line) => pythonStrip(line));
    total += chars(text);
    paragraphs += lines.length;
    dialogue += (text.match(DIALOGUE) ?? []).reduce((sum, quote) => sum + chars(quote), 0);
    const first = text.search(DIALOGUE);
    if (first >= 0) offsets.push(chars(text.slice(0, first)));
    if (QUESTION_OR_QUOTE.test(lines[lines.length - 1] ?? '')) hookEndings += 1;
  }
  return {
    chapter_count: chapters.length,
    avg_chapter_chars: Math.round(total / chapters.length),
    avg_paragraph_chars: Math.round(total / Math.max(paragraphs, 1)),
    dialogue_percent: Math.round((dialogue * 100) / Math.max(total, 1)),
    first_dialogue_offset: offsets.length ? median(offsets) : null,
    hook_endings: hookEndings,
  };
}

export function craftMetricsText(metrics: CraftMetrics): string {
  const lines = [
    `程序从代表章节实测（${metrics.chapter_count} 章）：`,
    `- 每章平均 ${metrics.avg_chapter_chars} 字`,
    `- 段落平均 ${metrics.avg_paragraph_chars} 字`,
    `- 对白约占 ${metrics.dialogue_percent}%`,
  ];
  if (metrics.first_dialogue_offset !== null)
    lines.push(`- 每章第一句对白出现在第 ${metrics.first_dialogue_offset} 字前后（中位数）`);
  lines.push(`- ${metrics.hook_endings} / ${metrics.chapter_count} 章最后一段是对白或问句`);
  return lines.join('\n');
}

export const BREAKDOWN_SKILLS_SYSTEM_PROMPT =
  '你是网络小说写法教练。根据给你的代表章节和程序实测的数字，把这本书最值得学、能直接照着写的写法整理成 3 到 5 份写法 skill。' +
  '每份只写做法：什么时候用、具体怎么做；能量化的用给你的实测数字，不要自己估。' +
  '最多举两句不超过 30 字的短例；例子和说明里不许出现原书的人名、地名、势力名、功法名或情节，换成泛称（主角、对手、某城）。' +
  '不要复述剧情，不要评价好坏。' +
  '只输出 JSON 对象：{"skills":[{"name":"不超过 12 字的名字","when":"一句话说什么时候用","body":"做法，Markdown 列表，不超过 600 字"}]}，' +
  '不要代码块或额外解释。';

export function breakdownSkillsPrompt(metrics: CraftMetrics | null, context: string): string {
  return (metrics ? `${craftMetricsText(metrics)}\n\n` : '') + `代表章节：\n\n${context}`;
}

const clip = (value: JsonValue | undefined, limit: number) =>
  typeof value === 'string' && pythonStrip(value)
    ? Array.from(pythonStrip(value)).slice(0, limit).join('')
    : null;

/** Windows 文件名不能带的字符换成短横线；编号在前，保证同一批里不重名。 */
function fileNameOf(index: number, name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\s]+/gu, '-').replace(/^-+|-+$/g, '') || '写法';
  return `${String(index + 1).padStart(2, '0')}-${safe}.md`;
}

export function skillFileContent(
  skill: { name: string; when: string; body: string },
  source: string,
) {
  return `---\n名字：${skill.name}\n什么时候用：${skill.when}\n来源：${source}\n---\n${skill.body}\n`;
}

/** 模型回的 skill：名字、用途、做法都要有，名字去重，最多 {@link BREAKDOWN_SKILLS_MAX} 份。 */
export function parseBreakdownSkills(raw: unknown, source: string): BreakdownSkill[] {
  if (typeof raw !== 'string' || !pythonStrip(raw))
    throw new BreakdownSkillsError('写法 skill 返回为空。');
  const text = pythonStrip(raw);
  let parsed: JsonValue;
  try {
    parsed = parseJson(text, 'writing skills');
  } catch (error) {
    if (!(error instanceof InputDomainError)) throw error;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new BreakdownSkillsError('写法 skill 不是有效 JSON。');
    parsed = parseJson(text.slice(start, end + 1), 'writing skills');
  }
  const list = isJsonObject(parsed) ? parsed.skills : undefined;
  if (!Array.isArray(list)) throw new BreakdownSkillsError('写法 skill 缺少 skills 列表。');
  const skills: BreakdownSkill[] = [];
  for (const item of list) {
    if (skills.length >= BREAKDOWN_SKILLS_MAX) break;
    if (!isJsonObject(item)) continue;
    const name = clip(item.name, NAME_MAX);
    const when = clip(item.when, WHEN_MAX);
    const body = clip(item.body, BODY_MAX);
    if (!name || !when || !body || skills.some((skill) => skill.name === name)) continue;
    skills.push({
      name,
      when,
      body,
      file_name: fileNameOf(skills.length, name),
      content: skillFileContent({ name, when, body }, source),
    });
  }
  if (!skills.length) throw new BreakdownSkillsError('写法 skill 一份可用的都没有。');
  return skills;
}
