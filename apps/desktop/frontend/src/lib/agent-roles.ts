export type AgentRoleRead = {
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

export const BUILTIN_AGENT_ROLE_ALIASES: Record<string, string> = {
  '@剧情': 'plot_reviewer',
  '@人物': 'character_reviewer',
  '@文风': 'prose_reviewer',
  '@伏笔': 'continuity_reviewer',
  '@设定': 'continuity_reviewer',
  '@写作任务': 'bookrun_agent',
  '@探索': 'context_explorer',
  '@资料': 'external_scout',
};

export const AGENT_ROLE_SUGGESTIONS = Object.entries(BUILTIN_AGENT_ROLE_ALIASES).map(
  ([mention, roleName]) => ({
    mention,
    roleName,
  }),
);

export function extractAgentRoleMentions(input: string): string[] {
  const aliases = new Set(Object.keys(BUILTIN_AGENT_ROLE_ALIASES));
  const mentions = Array.from(input.matchAll(/@([^\s，。！？!?；;：:,、]+)/g))
    .map((match) => `@${match[1]?.trim() ?? ''}`)
    .filter((mention) => aliases.has(mention));
  return orderedUnique(mentions);
}

export function mapAgentRoleMentionsToHints(
  mentions: string[],
  roles: AgentRoleRead[] = [],
): string[] {
  const roleByAlias = new Map<string, string>();
  for (const role of roles) {
    if (!role.can_be_mentioned) continue;
    for (const alias of role.aliases) {
      roleByAlias.set(alias, role.name);
    }
  }
  const hints = mentions
    .map((mention) => roleByAlias.get(mention) ?? BUILTIN_AGENT_ROLE_ALIASES[mention])
    .filter((roleName): roleName is string => Boolean(roleName));
  return orderedUnique(hints);
}

export function isKnownAgentRoleMention(mention: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_AGENT_ROLE_ALIASES, mention);
}

function orderedUnique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
