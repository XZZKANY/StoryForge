/** 作品启用了哪些插件（插件本身装在本机插件库里）：`{ "version": 1, "enabled": ["名字", ...] }`。 */
export const PLUGINS_FILE = '.storyforge/plugins.json';

/** StoryForge 自带的插件（宿主每次打开插件库时放进去、不能移除）；新建作品默认启用它。宿主 Rust 侧有同名字面量。 */
export const STARTER_PLUGIN_NAME = '起书基础包';

/** 插件名（= 插件库里的文件夹名）最多几个字，按码点数。 */
export const PLUGIN_NAME_MAX_CHARS = 40;

const PLUGINS_FILE_VERSION = 1;
const FORBIDDEN_CHARS = '<>:"/\\|?*';
// 不加 u 标志：大小写只按 ASCII 比，非 ASCII 字母不会被折成保留名。
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// 与 Rust `char::is_whitespace` 同一个集合（Unicode White_Space），宿主那份规则要一致。
const EDGE_WHITESPACE = /^\p{White_Space}|\p{White_Space}$/u;

/** 插件名合规时返回 null，否则返回一句说明。宿主 Rust 侧有一份同样的规则，两边必须一致。 */
export function pluginNameProblem(name: string): string | null {
  const points = Array.from(name);
  if (!points.length) return '插件名不能为空。';
  if (points.length > PLUGIN_NAME_MAX_CHARS)
    return `插件名最多 ${PLUGIN_NAME_MAX_CHARS} 个字，现在是 ${points.length} 个。`;
  if (EDGE_WHITESPACE.test(name)) return '插件名开头和结尾不能有空白。';
  if (
    points.some((point) => {
      const code = point.codePointAt(0)!;
      return code <= 0x1f || code === 0x7f;
    })
  )
    return '插件名不能含控制字符。';
  if (points.some((point) => FORBIDDEN_CHARS.includes(point)))
    return '插件名不能含这些字符：< > : " / \\ | ? *';
  if (name.startsWith('.')) return '插件名不能以「.」开头。';
  if (name.endsWith('.') || name.endsWith(' ')) return '插件名不能以「.」或空格结尾。';
  const stem = name.split('.')[0];
  if (RESERVED_NAME.test(stem)) return `「${stem}」是 Windows 保留名，不能当插件名。`;
  return null;
}

/**
 * 读作品的插件启用文件：坏了就当一个都没启用并说明；不合规的名字丢掉，去重保序。
 * 去重不分大小写（Windows 上 `Foo` 与 `foo` 是同一个文件夹），留先出现的写法。
 */
export function parsePluginsFile(text: string): { enabled: string[]; problem: string | null } {
  const fail = (problem: string) => ({ enabled: [], problem });
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return fail('插件启用文件不是合法的 JSON，当作一个插件都没启用。');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return fail('插件启用文件应是一个 JSON 对象，当作一个插件都没启用。');
  const record = data as { [key: string]: unknown };
  if (record.version !== PLUGINS_FILE_VERSION)
    return fail(`插件启用文件的 version 应是 ${PLUGINS_FILE_VERSION}，当作一个插件都没启用。`);
  if (!Array.isArray(record.enabled))
    return fail('插件启用文件的 enabled 应是插件名列表，当作一个插件都没启用。');
  const enabled: string[] = [];
  const seen = new Set<string>();
  const dropped: string[] = [];
  record.enabled.forEach((item: unknown, index) => {
    if (typeof item !== 'string') {
      dropped.push(`第 ${index + 1} 项不是文字`);
      return;
    }
    const problem = pluginNameProblem(item);
    if (problem) dropped.push(`「${item}」（${problem.replace(/。$/, '')}）`);
    else if (!seen.has(item.toLowerCase())) {
      seen.add(item.toLowerCase());
      enabled.push(item);
    }
  });
  return {
    enabled,
    problem: dropped.length
      ? `插件启用文件里有不合规的名字，已忽略：${dropped.join('；')}。`
      : null,
  };
}

/** 插件启用文件的写法：两空格缩进、末尾换行。 */
export function serializePluginsFile(enabled: readonly string[]): string {
  return `${JSON.stringify({ version: PLUGINS_FILE_VERSION, enabled: [...enabled] }, null, 2)}\n`;
}
