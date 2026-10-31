import { stripBom } from '../readPort';
import { pythonStrip } from './pythonText';
import { redactSensitiveText, type SecretContext } from './redaction';

export const STORYFORGE_MANIFEST_PATH = 'storyforge-plugin.json';
export const CODEX_MANIFEST_PATH = '.codex-plugin/plugin.json';
export const CODEX_DEFAULT_SKILLS_DIR = 'skills';
export const CODEX_CONNECTORS_IGNORED = '这个 Codex 插件里的连接器 / MCP 不会被使用。';

export type PluginManifest = {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string | null;
  readonly homepage: string | null;
  readonly displayName: string | null;
  readonly format: 'storyforge' | 'codex';
};

export type ParsedManifest = {
  readonly manifest: PluginManifest | null;
  readonly problems: string[];
};

export type ParsedCodexManifest = ParsedManifest & {
  /** 技能目录（插件内 posix 相对路径，'' 是插件根）；null 表示声明的目录不可用、不读技能。 */
  readonly skillsDir: string | null;
  /** 清单里写明了 skills（而不是用缺省的 `skills/`）。 */
  readonly skillsDeclared: boolean;
};

type JsonObject = { [key: string]: unknown };

function jsonObject(path: string, text: string, problems: string[]): JsonObject | null {
  let data: unknown;
  try {
    data = JSON.parse(stripBom(text));
  } catch {
    problems.push(`${path} 不是合法的 JSON。`);
    return null;
  }
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) return data as JsonObject;
  problems.push(`${path} 应是一个 JSON 对象。`);
  return null;
}

const optionalText = (value: unknown, secrets: SecretContext): string | null =>
  typeof value === 'string' && pythonStrip(value)
    ? pythonStrip(redactSensitiveText(value, secrets))
    : null;

function requiredFields(
  path: string,
  data: JsonObject,
  secrets: SecretContext,
  problems: string[],
): { name: string; version: string; description: string } | null {
  const missing = ['name', 'version', 'description'].filter(
    (key) => typeof data[key] !== 'string' || !pythonStrip(data[key] as string),
  );
  if (missing.length) {
    problems.push(`${path} 缺少 ${missing.join('、')}（必须是非空文字）。`);
    return null;
  }
  return {
    // 名字不去首尾空白：它要和文件夹名逐字一致，带空白就该被名字规则拦下来。
    name: redactSensitiveText(data.name as string, secrets),
    version: optionalText(data.version, secrets)!,
    description: optionalText(data.description, secrets)!,
  };
}

export function parseStoryforgeManifest(text: string, secrets: SecretContext): ParsedManifest {
  const problems: string[] = [];
  const data = jsonObject(STORYFORGE_MANIFEST_PATH, text, problems);
  const fields = data && requiredFields(STORYFORGE_MANIFEST_PATH, data, secrets, problems);
  if (!data || !fields) return { manifest: null, problems };
  return {
    manifest: {
      ...fields,
      author: optionalText(data.author, secrets),
      homepage: optionalText(data.homepage, secrets),
      displayName: null,
      format: 'storyforge',
    },
    problems,
  };
}

/** Codex 清单的 `skills`：只认插件内相对路径（`./skills/` 这类），绝对路径和 `..` 都不认。 */
export function codexSkillsDir(value: string): string | null {
  const path = value.replace(/\\/g, '/');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null;
  const parts = path.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.some((part) => part === '..')) return null;
  return parts.join('/');
}

export function parseCodexManifest(text: string, secrets: SecretContext): ParsedCodexManifest {
  const problems: string[] = [];
  const data = jsonObject(CODEX_MANIFEST_PATH, text, problems);
  if (!data)
    return { manifest: null, problems, skillsDir: CODEX_DEFAULT_SKILLS_DIR, skillsDeclared: false };
  let skillsDir: string | null = CODEX_DEFAULT_SKILLS_DIR;
  const skillsDeclared = data.skills !== undefined && data.skills !== null;
  if (skillsDeclared) {
    skillsDir = typeof data.skills === 'string' ? codexSkillsDir(data.skills) : null;
    if (skillsDir === null)
      problems.push(
        `${CODEX_MANIFEST_PATH} 的 skills 应是插件内的相对路径（不能用 ..），技能不读。`,
      );
  }
  const fields = requiredFields(CODEX_MANIFEST_PATH, data, secrets, problems);
  if (
    (data.apps !== undefined && data.apps !== null) ||
    (data.mcpServers !== undefined && data.mcpServers !== null)
  )
    problems.push(CODEX_CONNECTORS_IGNORED);
  if (!fields) return { manifest: null, problems, skillsDir, skillsDeclared };
  const author = data.author;
  const iface = data.interface;
  return {
    manifest: {
      ...fields,
      author:
        typeof author === 'object' && author !== null
          ? optionalText((author as JsonObject).name, secrets)
          : optionalText(author, secrets),
      homepage: optionalText(data.homepage, secrets),
      displayName:
        typeof iface === 'object' && iface !== null
          ? optionalText((iface as JsonObject).displayName, secrets)
          : null,
      format: 'codex',
    },
    problems,
    skillsDir,
    skillsDeclared,
  };
}
