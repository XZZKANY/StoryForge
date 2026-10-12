import { pythonStrip } from './pythonText';
import { DEFAULT_PERMISSION_PROFILE } from './skillCatalog';

export type AgentRole = {
  name: string;
  display_name: string;
  kind: string;
  description: string;
  aliases: string[];
  read_only: boolean;
  default_permission_profile: string;
  allowed_tools: string[];
  output_artifacts: string[];
  can_be_mentioned: boolean;
};

export const READ_ONLY_ROLE_FORBIDDEN_TOOLS = new Set([
  'file.revise',
  'chapter.polish',
  'judge.repair',
]);

const AGENT_ROLE_DEFINITIONS: readonly AgentRole[] = [
  {
    name: 'root_agent',
    display_name: 'Root Agent',
    kind: 'primary',
    description:
      '用户直接交互的主代理，负责理解目标、制定计划、调度子代理、执行权限检查和汇总结果。',
    aliases: [],
    read_only: false,
    default_permission_profile: DEFAULT_PERMISSION_PROFILE,
    allowed_tools: [
      'context.load',
      'fs.list',
      'fs.read',
      'fs.search',
      'project.knowledge',
      'knowledge.propose',
      'project.consistency',
      'project.prose_check',
      'project.collapse_check',
      'project.entity_budget_check',
      'project.cross_chapter_check',
      'project.deep_consistency',
      'project.canon',
      'project.canon_delta',
      'project.promise_check',
      'project.hooks_delta',
      'project.plan_update',
      'chapter.brief',
      'chapter.draft',
      'chapter.check',
      'chapter.repair',
      'project.trim_prose',
      'prose.continue',
      'file.review',
      'file.revise',
      'chapter.polish',
      'file.create',
      'judge.run',
      'judge.repair',
    ],
    output_artifacts: ['review_report', 'proposed_patch', 'knowledge_proposal', 'chapter_draft'],
    can_be_mentioned: false,
  },
  {
    name: 'plot_reviewer',
    display_name: '剧情 reviewer',
    kind: 'subagent',
    description: '检查剧情结构、冲突、钩子、节奏和主线推进。',
    aliases: ['@剧情'],
    read_only: true,
    default_permission_profile: 'read',
    allowed_tools: ['context.load', 'file.review', 'judge.run'],
    output_artifacts: ['review_report'],
    can_be_mentioned: true,
  },
  {
    name: 'character_reviewer',
    display_name: '人物 reviewer',
    kind: 'subagent',
    description: '检查人物动机、称谓、关系、人设一致性和行为可信度。',
    aliases: ['@人物'],
    read_only: true,
    default_permission_profile: 'read',
    allowed_tools: ['context.load', 'file.review', 'judge.run'],
    output_artifacts: ['review_report'],
    can_be_mentioned: true,
  },
  {
    name: 'prose_reviewer',
    display_name: '文风 reviewer',
    kind: 'subagent',
    description: '检查文风、表达、信息密度、爽感和移动端阅读节奏。',
    aliases: ['@文风'],
    read_only: true,
    default_permission_profile: 'read',
    allowed_tools: ['context.load', 'file.review', 'judge.run'],
    output_artifacts: ['review_report'],
    can_be_mentioned: true,
  },
  {
    name: 'continuity_reviewer',
    display_name: '连续性 reviewer',
    kind: 'subagent',
    description: '检查设定、伏笔、人物关系、时间线和前后文事实冲突。',
    aliases: ['@伏笔', '@设定'],
    read_only: true,
    default_permission_profile: 'read',
    allowed_tools: ['context.load', 'file.review', 'judge.run'],
    output_artifacts: ['review_report'],
    can_be_mentioned: true,
  },
  {
    name: 'repair_agent',
    display_name: '修复 agent',
    kind: 'subagent',
    description: '根据审稿结论生成 proposed patch，并在写回前等待作者确认。',
    aliases: ['@修复'],
    read_only: false,
    default_permission_profile: DEFAULT_PERMISSION_PROFILE,
    allowed_tools: [
      'context.load',
      'file.review',
      'file.revise',
      'chapter.polish',
      'project.trim_prose',
      'prose.continue',
      'judge.run',
      'judge.repair',
    ],
    output_artifacts: ['proposed_patch', 'review_report'],
    can_be_mentioned: true,
  },
  {
    name: 'synthesizer',
    display_name: 'Synthesizer',
    kind: 'subagent',
    description: '合并多个 reviewer 的发现，形成统一审稿报告和修订策略。',
    aliases: [],
    read_only: false,
    default_permission_profile: DEFAULT_PERMISSION_PROFILE,
    allowed_tools: ['context.load', 'file.review', 'judge.run'],
    output_artifacts: ['review_report'],
    can_be_mentioned: false,
  },
  {
    name: 'context_explorer',
    display_name: '上下文探索 agent',
    kind: 'subagent',
    description: '只读探索项目上下文、当前稿、相关设定和检索结果。',
    aliases: ['@探索'],
    read_only: true,
    default_permission_profile: 'read',
    allowed_tools: [
      'context.load',
      'fs.list',
      'fs.read',
      'fs.search',
      'project.knowledge',
      'project.consistency',
      'project.prose_check',
      'project.collapse_check',
      'project.entity_budget_check',
      'project.canon',
      'project.canon_delta',
      'project.promise_check',
      'project.hooks_delta',
      'mcp.project.search',
      'mcp.context.inspect',
    ],
    output_artifacts: ['review_report'],
    can_be_mentioned: true,
  },
  {
    name: 'external_scout',
    display_name: '资料 scout',
    kind: 'subagent',
    description: '只读检索外部资料或 MCP 结果，为 Root Agent 提供证据摘要。',
    aliases: ['@资料'],
    read_only: true,
    default_permission_profile: 'read',
    allowed_tools: ['mcp.project.search', 'mcp.context.inspect'],
    output_artifacts: ['review_report'],
    can_be_mentioned: true,
  },
];

/** Agent role 目录配置错误。 */
export class AgentRoleCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRoleCatalogError';
  }
}

function validateAgentRoleCatalog() {
  if (AGENT_ROLE_DEFINITIONS.filter((role) => role.kind === 'primary').length !== 1)
    throw new AgentRoleCatalogError('Agent role catalog 必须且只能包含一个 primary role。');
  const names = AGENT_ROLE_DEFINITIONS.map((role) => role.name);
  if (new Set(names).size !== names.length)
    throw new AgentRoleCatalogError('Agent role catalog 存在重复 role name。');
  for (const role of AGENT_ROLE_DEFINITIONS) {
    if (role.kind !== 'primary' && role.kind !== 'subagent')
      throw new AgentRoleCatalogError(`Agent role kind 不合法：${role.kind}`);
    if (
      role.read_only &&
      role.allowed_tools.some((tool) => READ_ONLY_ROLE_FORBIDDEN_TOOLS.has(tool))
    )
      throw new AgentRoleCatalogError(`只读 Agent role 不能绑定写入工具：${role.name}`);
  }
}

const copy = (role: AgentRole): AgentRole => ({
  ...role,
  aliases: [...role.aliases],
  allowed_tools: [...role.allowed_tools],
  output_artifacts: [...role.output_artifacts],
});

/** Agent Runtime 只读角色目录。 */
export function listAgentRoles(): AgentRole[] {
  validateAgentRoleCatalog();
  return AGENT_ROLE_DEFINITIONS.map(copy);
}

/** 可被 Runtime 调度的子代理角色。 */
export function listSubagentRoles(): AgentRole[] {
  return listAgentRoles().filter((role) => role.kind === 'subagent');
}

export function getAgentRole(name: string): AgentRole | null {
  validateAgentRoleCatalog();
  const normalized = pythonStrip(name);
  if (!normalized) return null;
  const role = AGENT_ROLE_DEFINITIONS.find((item) => item.name === normalized);
  return role ? copy(role) : null;
}

/** 用户输入的 @角色 别名 → 目录中的角色。 */
export function resolveAgentRoleAlias(alias: string): AgentRole | null {
  validateAgentRoleCatalog();
  const normalized = pythonStrip(alias);
  if (!normalized) return null;
  const role = AGENT_ROLE_DEFINITIONS.find(
    (item) => item.name === normalized || item.aliases.includes(normalized),
  );
  return role ? copy(role) : null;
}

export function isRoleAllowedTool(roleName: string, toolName: string): boolean {
  const role = getAgentRole(roleName);
  return Boolean(role && role.allowed_tools.includes(toolName));
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && Boolean(pythonStrip(item)))
        .map(pythonStrip)
    : [];
const orderedUnique = (values: readonly string[]) => [...new Set(values)];

/** 把桌面端传来的 role 名 / @提及 归一化为可执行的 role hints。 */
export function normalizeAgentRoleInputs(args: { [key: string]: unknown }) {
  const hints: string[] = [];
  const unknownHints: string[] = [];
  for (const raw of stringList(args.agent_role_hints)) {
    const role = getAgentRole(raw) ?? resolveAgentRoleAlias(raw);
    if (role && role.can_be_mentioned) hints.push(role.name);
    else unknownHints.push(raw);
  }
  const mentions: string[] = [];
  const unknownMentions: string[] = [];
  for (const mention of stringList(args.agent_role_mentions)) {
    mentions.push(mention);
    const role = resolveAgentRoleAlias(mention);
    if (role && role.can_be_mentioned) hints.push(role.name);
    else unknownMentions.push(mention);
  }
  return {
    hints: orderedUnique(hints),
    mentions: orderedUnique(mentions),
    unknown_hints: orderedUnique(unknownHints),
    unknown_mentions: orderedUnique(unknownMentions),
  };
}
