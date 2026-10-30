import { toolSpec } from '../specModels';

/** 按名字读技能全文。只在这一轮的可用技能里有插件技能时才交给模型（见 chatLoopAdapters）。 */
export const SKILL_TOOL_SPECS = [
  toolSpec({
    name: 'skill.read',
    description: '按名字读取一份技能全文（作品「技能/」里的或作者启用的插件里的，只读）。',
    domain: 'fs',
    input_schema: {},
    output_schema: {},
    allowed_roles: ['root_agent', 'context_explorer'],
    risk_level: 'read',
    retry_safe: true,
    idempotent: true,
    execution_mode: 'sync',
    evidence_fields: ['skill_name', 'plugin', 'path', 'returned_chars', 'truncated'],
    references: {
      workflow_nodes: ['agent_runtime.skill_read'],
    },
    loop_schema: {
      description:
        '按名字读取一份技能的全文（技能目录里列出的，作品里的和插件里的都能读）。插件里的技能只能用它读。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '技能名字，照技能目录里写的。',
          },
        },
        required: ['name'],
      },
    },
  }),
] as const;
