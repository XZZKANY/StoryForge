import { findAvailableSkill, loadAvailableSkills } from '../../kernel/conversationSkills';
import { FsToolError } from '../../kernel/fsTools';
import type { ToolHandler } from './execution';
import type { ToolDeps } from './handlerDeps';
import { requiredString } from './runtimeArguments';

/** skill.read 一次最多返回的码点数。 */
export const SKILL_READ_MAX_CHARS = 20_000;
/** 找不到时列出的可用名字上限。 */
const SKILL_NAMES_LISTED = 20;

export function skillToolHandlers(deps: ToolDeps): Record<string, ToolHandler> {
  const skillReadHandler: ToolHandler = async (_context, payload) => {
    const root = requiredString(payload, 'project_root');
    const name = requiredString(payload, 'name');
    const skills = await loadAvailableSkills(
      deps.reader,
      root,
      deps.pluginLibraryRoot ?? null,
      deps.secrets,
    );
    const skill = findAvailableSkill(skills, name);
    if (skill === null) {
      const names = skills.slice(0, SKILL_NAMES_LISTED).map((item) => `「${item.name}」`);
      throw new FsToolError(
        `没有叫「${name}」的技能。` +
          (names.length ? `可用的技能：${names.join('、')}。` : '这本书现在没有可用的技能。'),
      );
    }
    const points = Array.from(skill.body);
    const truncated = points.length > SKILL_READ_MAX_CHARS;
    const content = truncated ? points.slice(0, SKILL_READ_MAX_CHARS).join('') : skill.body;
    const plugin = skill.plugin === null ? null : skill.plugin.id;
    return {
      status: 'completed',
      output: { name: skill.name, plugin, path: skill.path, content, truncated },
      trace: {
        tool_name: 'skill.read',
        status: 'completed',
        input_summary: { name },
        output_summary: {
          skill_name: skill.name,
          plugin,
          path: skill.path,
          returned_chars: truncated ? SKILL_READ_MAX_CHARS : points.length,
          truncated,
        },
      },
      artifacts: [],
    };
  };
  return { 'skill.read': skillReadHandler };
}
