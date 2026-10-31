import {
  compareChapterPaths,
  CONVERSATION_SKILL_DIR,
  normalizeRoot,
  parsePluginsFile,
  pluginNameProblem,
  PLUGINS_FILE,
  projectBasename,
} from '@storyforge/project-core';
import { normalizeNewlines, ProjectReadError, type ProjectReader } from '../readPort';
import { FsToolError, readBoundedText, resolveProjectRoot } from './fsTools';
import {
  CODEX_DEFAULT_SKILLS_DIR,
  CODEX_MANIFEST_PATH,
  parseCodexManifest,
  parseStoryforgeManifest,
  STORYFORGE_MANIFEST_PATH,
  type PluginManifest,
} from './pluginManifest';
import { MAX_DIRECTORY_ENTRIES, ProjectTreeError, scanProjectFiles } from './projectTree';
import { clipWithEllipsis, pythonStrip } from './pythonText';
import { redactSensitiveText, type SecretContext } from './redaction';
import { sha256Hex } from './sha256';
import { parseWritingSkill, WRITING_SKILL_DIR, type WritingSkill } from './writingSkills';

export type { PluginManifest } from './pluginManifest';

/** 插件里的一份技能或写法；path 是插件内 posix 相对路径。形状与作品里的写法 skill 相同。 */
export type PluginEntry = WritingSkill;

export type PluginInstructions = {
  readonly path: string;
  readonly text: string;
  readonly sha256: string;
  readonly truncated: boolean;
};

export type PluginDescription = {
  /** 插件文件夹名。 */
  readonly id: string;
  /** 插件文件夹的绝对路径。 */
  readonly root: string;
  readonly manifest: PluginManifest | null;
  /** StoryForge 自带的插件（插件根下有宿主写的标记文件）：不能移除，每本书照样能不选。 */
  readonly bundled: boolean;
  readonly skills: PluginEntry[];
  readonly styles: PluginEntry[];
  readonly instructions: PluginInstructions | null;
  readonly problems: string[];
};

/** 每个插件技能、写法各最多几份（按路径序取前面的）。 */
export const PLUGIN_ENTRY_MAX = 20;
/** 插件指令片段的上限（码点数），超出保留开头。 */
export const PLUGIN_INSTRUCTIONS_MAX_CHARS = 4_000;
export const PLUGIN_INSTRUCTIONS_PATH = '指令.md';
// 宿主放进插件库的自带插件带这个标记文件；与 Rust plugin_library.rs 的 BUNDLED_MARKER 相同。
const BUNDLED_MARKER = '.storyforge-bundled';
const SKILL_ENTRY = 'SKILL.md';

const optional = (error: unknown) =>
  error instanceof ProjectReadError ||
  error instanceof ProjectTreeError ||
  error instanceof FsToolError;

const unreadable = (path: string, error: unknown) =>
  `读不到 ${path}${error instanceof FsToolError || error instanceof ProjectTreeError ? `：${error.message}` : '。'}`;

async function hasBundledMarker(reader: ProjectReader, root: string): Promise<boolean> {
  try {
    return (await reader.inspectProjectPath(root, BUNDLED_MARKER)).entryKind === 'file';
  } catch (error) {
    if (optional(error)) return false;
    throw error;
  }
}

/** present=false 是没有这个文件；present=true 而 text=null 是有但读不出（已记 problem）。 */
async function readPluginText(
  reader: ProjectReader,
  root: string,
  path: string,
  problems: string[],
): Promise<{ present: boolean; text: string | null }> {
  try {
    if ((await reader.inspectProjectPath(root, path)).targetKind === 'missing')
      return { present: false, text: null };
    return { present: true, text: (await readBoundedText(reader, root, path)).content };
  } catch (error) {
    if (!optional(error)) throw error;
    problems.push(unreadable(path, error));
    return { present: true, text: null };
  }
}

/**
 * `base` 目录（插件内 posix 相对路径，'' 是插件根）下的入口文件：`flat` 收 `<名>.md` / `<名>.markdown`，
 * `nested` 收 `<名>/SKILL.md`。
 * 目录不存在返回 null。
 */
async function listEntryFiles(
  reader: ProjectReader,
  root: string,
  base: string,
  layout: { flat: boolean; nested: boolean },
): Promise<string[] | null> {
  const resolved = (await reader.resolveProjectPath(root, base || '.')).resolvedRelativePath;
  const scope = resolved === '.' ? '' : resolved;
  if ((await reader.inspectProjectPath(root, scope || '.')).targetKind !== 'directory') return null;
  const prefix = scope ? scope.split('/') : [];
  const rest = (path: string) => path.split('/').slice(prefix.length);
  const visible = (path: string) => {
    const parts = path.split('/');
    if (parts.length <= prefix.length) return parts.every((part, index) => part === prefix[index]);
    if (!prefix.every((part, index) => parts[index] === part)) return false;
    const tail = rest(path);
    if (tail.some((part) => part.startsWith('.'))) return false;
    return tail.length === 1 || (layout.nested && tail.length === 2 && tail[1] === SKILL_ENTRY);
  };
  const files = await scanProjectFiles(reader, root, { scope: scope || '.', visible });
  return files.filter((path) => {
    const tail = rest(path);
    return tail.length === 1
      ? layout.flat && /\.(md|markdown)$/i.test(tail[0])
      : tail[1] === SKILL_ENTRY;
  });
}

const ENTRY_NAME_MAX_CHARS = 40;
const ENTRY_WHEN_MAX_CHARS = 80;
const BLOCK_SCALAR = new Set(['>', '>-', '>+', '|', '|-', '|+']);

const indentOf = (line: string) => /^\s*/.exec(line)![0].length;

/** YAML 标量的最小归一：去成对引号；块标量把后面缩进更深的连续行去缩进后用空格连起来。 */
function yamlScalar(
  value: string,
  lines: readonly string[],
  index: number,
): { value: string; consumed: number } {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
    return { value: value.slice(1, -1).replace(/\\"/g, '"'), consumed: 0 };
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'"))
    return { value: value.slice(1, -1).replace(/''/g, "'"), consumed: 0 };
  if (!BLOCK_SCALAR.has(value)) return { value, consumed: 0 };
  const indent = indentOf(lines[index]);
  const block: string[] = [];
  for (let next = index + 1; next < lines.length; next += 1) {
    const line = lines[next];
    if (!pythonStrip(line) || indentOf(line) <= indent) break;
    block.push(pythonStrip(line));
  }
  return { value: block.join(' '), consumed: block.length };
}

/**
 * 插件技能 / 写法的名字与什么时候用：头部行的认法、优先级、缺省与截断都同 {@link parseWritingSkill}，
 * 多认 Codex / Claude 风格 SKILL.md 里带引号和块标量的 YAML 值。正文仍取 parseWritingSkill 的。
 */
function pluginEntryFields(
  namePath: string,
  content: string,
): Pick<PluginEntry, 'name' | 'when' | 'body'> {
  const { body } = parseWritingSkill(namePath, content);
  const header = /^---\n([\s\S]*?)\n---\n?/.exec(normalizeNewlines(content));
  const lines = header ? header[1].split('\n') : [];
  const fields: { [key: string]: string } = {};
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*([^:：]+)[:：]\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const scalar = yamlScalar(pythonStrip(match[2]), lines, index);
    fields[pythonStrip(match[1]).toLowerCase()] = scalar.value;
    index += scalar.consumed;
  }
  const fallbackName = namePath
    .split('/')
    .slice(-1)[0]
    .replace(/\.(md|markdown)$/i, '');
  const firstLine = body.split('\n').find((line) => pythonStrip(line)) ?? '';
  const name = fields['名字'] || fields.name || fallbackName;
  const when =
    fields['什么时候用'] ||
    fields.when ||
    fields.description ||
    pythonStrip(firstLine.replace(/^#+\s*/, ''));
  return {
    name: clipWithEllipsis(name, ENTRY_NAME_MAX_CHARS),
    when: clipWithEllipsis(when, ENTRY_WHEN_MAX_CHARS),
    body,
  };
}

async function loadEntries(
  reader: ProjectReader,
  root: string,
  paths: readonly string[],
  secrets: SecretContext,
  label: string,
  problems: string[],
): Promise<PluginEntry[]> {
  const entries: PluginEntry[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    if (entries.length >= PLUGIN_ENTRY_MAX) {
      problems.push(
        `${label}超过 ${PLUGIN_ENTRY_MAX} 份，只取按路径序的前 ${PLUGIN_ENTRY_MAX} 份，后面 ${paths.length - index} 个文件没有读。`,
      );
      break;
    }
    const path = paths[index];
    let content: string;
    try {
      content = (await readBoundedText(reader, root, path)).content;
    } catch (error) {
      if (!optional(error)) throw error;
      problems.push(unreadable(path, error));
      continue;
    }
    const redacted = redactSensitiveText(content, secrets);
    // SKILL.md 没写名字时用它所在的文件夹名，不是「SKILL」。
    const namePath = path.endsWith(`/${SKILL_ENTRY}`)
      ? path.slice(0, -SKILL_ENTRY.length - 1)
      : path;
    const entry = pluginEntryFields(namePath, redacted);
    if (!entry.body) continue;
    entries.push({ ...entry, path, sha256: sha256Hex(redacted) });
  }
  return entries;
}

async function loadEntryDir(
  reader: ProjectReader,
  root: string,
  base: string,
  layout: { flat: boolean; nested: boolean },
  secrets: SecretContext,
  label: string,
  problems: string[],
): Promise<{ entries: PluginEntry[]; found: boolean }> {
  let paths: string[] | null;
  try {
    paths = await listEntryFiles(reader, root, base, layout);
  } catch (error) {
    if (!optional(error)) throw error;
    problems.push(unreadable(base ? `${base}/` : '插件根目录', error));
    return { entries: [], found: true };
  }
  if (paths === null) return { entries: [], found: false };
  return { entries: await loadEntries(reader, root, paths, secrets, label, problems), found: true };
}

async function loadInstructions(
  reader: ProjectReader,
  root: string,
  secrets: SecretContext,
  problems: string[],
): Promise<PluginInstructions | null> {
  const { text: raw } = await readPluginText(reader, root, PLUGIN_INSTRUCTIONS_PATH, problems);
  if (raw === null) return null;
  const redacted = redactSensitiveText(raw, secrets);
  const text = pythonStrip(redacted);
  if (!text) return null;
  const points = Array.from(text);
  const truncated = points.length > PLUGIN_INSTRUCTIONS_MAX_CHARS;
  return {
    path: PLUGIN_INSTRUCTIONS_PATH,
    text: truncated ? points.slice(0, PLUGIN_INSTRUCTIONS_MAX_CHARS).join('') : text,
    sha256: sha256Hex(redacted),
    truncated,
  };
}

/**
 * 读一个插件文件夹：清单、技能、写法、指令片段。纯读、不抛读取类错误——读不到的部分当没有并记进 problems。
 * 清单缺失或不合法时 manifest 为 null，其余能读的照读；没有 StoryForge 清单而只有 Codex 清单时按 Codex 布局读技能。
 * 给了 `expectedId` 才比对清单里的名字和它是否一致（暂存目录预览时文件夹名不是插件名）。
 */
export async function describePlugin(
  reader: ProjectReader,
  pluginRoot: string,
  secrets: SecretContext,
  options: { expectedId?: string } = {},
): Promise<PluginDescription> {
  const problems: string[] = [];
  const description = {
    id: projectBasename(pluginRoot),
    root: pluginRoot,
    manifest: null as PluginManifest | null,
    bundled: false,
    skills: [] as PluginEntry[],
    styles: [] as PluginEntry[],
    instructions: null as PluginInstructions | null,
    problems,
  };
  try {
    await resolveProjectRoot(reader, pluginRoot);
  } catch (error) {
    if (!optional(error)) throw error;
    problems.push(`插件文件夹不存在或读不到：${pluginRoot}`);
    return description;
  }
  description.bundled = await hasBundledMarker(reader, pluginRoot);

  let skillsDir: string | null = CONVERSATION_SKILL_DIR;
  let codex = false;
  let skillsDeclared = false;
  const storyforge = await readPluginText(reader, pluginRoot, STORYFORGE_MANIFEST_PATH, problems);
  if (storyforge.present) {
    if (storyforge.text !== null) {
      const parsed = parseStoryforgeManifest(storyforge.text, secrets);
      description.manifest = parsed.manifest;
      problems.push(...parsed.problems);
    }
  } else {
    const codexText = await readPluginText(reader, pluginRoot, CODEX_MANIFEST_PATH, problems);
    if (codexText.present) {
      codex = true;
      if (codexText.text !== null) {
        const parsed = parseCodexManifest(codexText.text, secrets);
        description.manifest = parsed.manifest;
        problems.push(...parsed.problems);
        skillsDir = parsed.skillsDir;
        skillsDeclared = parsed.skillsDeclared;
      } else skillsDir = CODEX_DEFAULT_SKILLS_DIR;
    } else
      problems.push(
        `没有找到插件清单（${STORYFORGE_MANIFEST_PATH} 或 ${CODEX_MANIFEST_PATH}），按 StoryForge 插件的布局读。`,
      );
  }
  const manifest = description.manifest;
  if (manifest) {
    const nameProblem = pluginNameProblem(manifest.name);
    if (nameProblem) problems.push(`清单里的插件名「${manifest.name}」不合规：${nameProblem}`);
    if (options.expectedId !== undefined && manifest.name !== options.expectedId)
      problems.push(
        `清单里的插件名「${manifest.name}」和插件文件夹名「${options.expectedId}」不一致。`,
      );
  }

  if (skillsDir !== null) {
    const loaded = await loadEntryDir(
      reader,
      pluginRoot,
      skillsDir,
      { flat: !codex, nested: true },
      secrets,
      '技能',
      problems,
    );
    description.skills = loaded.entries;
    if (!loaded.found && skillsDeclared)
      problems.push(`清单里写的技能目录不存在：${skillsDir || '插件根目录'}`);
  }
  description.styles = (
    await loadEntryDir(
      reader,
      pluginRoot,
      WRITING_SKILL_DIR,
      { flat: true, nested: false },
      secrets,
      '写法',
      problems,
    )
  ).entries;
  description.instructions = await loadInstructions(reader, pluginRoot, secrets, problems);
  return description;
}

function libraryChildPath(libraryRoot: string, id: string): string {
  return `${normalizeRoot(libraryRoot)}${libraryRoot.includes('\\') ? '\\' : '/'}${id}`;
}

async function isPluginFolder(reader: ProjectReader, libraryRoot: string, id: string) {
  try {
    const info = await reader.inspectProjectPath(libraryRoot, id);
    return info.entryKind === 'directory' && !info.isReparsePoint;
  } catch (error) {
    if (optional(error)) return false;
    throw error;
  }
}

/** 本机插件库里已装的插件（库根下不以 `.` 开头的文件夹），按文件夹名码点序；库根不存在或读不到时为空。 */
export async function listInstalledPlugins(
  reader: ProjectReader,
  libraryRoot: string,
  secrets: SecretContext,
): Promise<PluginDescription[]> {
  let ids: string[];
  try {
    await resolveProjectRoot(reader, libraryRoot);
    const listing = await reader.readProjectDirectory(libraryRoot, '.', MAX_DIRECTORY_ENTRIES);
    if (listing.terminalError !== null) throw new ProjectReadError(listing.terminalError);
    ids = [];
    for (const name of listing.names.slice(0, MAX_DIRECTORY_ENTRIES))
      if (!name.startsWith('.') && (await isPluginFolder(reader, libraryRoot, name)))
        ids.push(name);
  } catch (error) {
    if (optional(error)) return [];
    throw error;
  }
  const plugins: PluginDescription[] = [];
  for (const id of ids.sort(compareChapterPaths))
    plugins.push(
      await describePlugin(reader, libraryChildPath(libraryRoot, id), secrets, {
        expectedId: id,
      }),
    );
  return plugins;
}

/** 作品启用了哪些插件（`.storyforge/plugins.json`）；没有这个文件就是一个都没启用。 */
export async function readEnabledPluginNames(
  reader: ProjectReader,
  projectRoot: string,
): Promise<{ enabled: string[]; problem: string | null }> {
  try {
    if ((await reader.inspectProjectPath(projectRoot, PLUGINS_FILE)).targetKind === 'missing')
      return { enabled: [], problem: null };
    return parsePluginsFile((await readBoundedText(reader, projectRoot, PLUGINS_FILE)).content);
  } catch (error) {
    if (!optional(error)) throw error;
    return { enabled: [], problem: unreadable(PLUGINS_FILE, error) };
  }
}

/** 作品启用的插件按启用顺序读出来；本机插件库里没有的（或没给插件库）进 missing。 */
export async function resolveEnabledPlugins(
  reader: ProjectReader,
  projectRoot: string,
  libraryRoot: string | null,
  secrets: SecretContext,
): Promise<{ plugins: PluginDescription[]; missing: string[]; problems: string[] }> {
  const { enabled, problem } = await readEnabledPluginNames(reader, projectRoot);
  const plugins: PluginDescription[] = [];
  const missing: string[] = [];
  for (const id of enabled) {
    if (!libraryRoot || !(await isPluginFolder(reader, libraryRoot, id))) missing.push(id);
    else
      plugins.push(
        await describePlugin(reader, libraryChildPath(libraryRoot, id), secrets, {
          expectedId: id,
        }),
      );
  }
  return { plugins, missing, problems: problem ? [problem] : [] };
}
