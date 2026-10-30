import { pythonStrip } from './pythonText';

/** 新项目默认「询问」档（Python permission.DEFAULT_PERMISSION_PROFILE）。 */
export const DEFAULT_PERMISSION_PROFILE = 'ask';

export type AgentSkill = {
  name: string;
  description: string;
  trigger_intents: string[];
  plan_template: { [key: string]: string }[];
  tool_sequence: string[];
  output_artifacts: string[];
  permission_profile: string;
};

export const AGENT_SKILL_DEFINITIONS: readonly AgentSkill[] = [
  {
    name: 'chapter_polish',
    description: '单章润色闭环：加载上下文、多视角审稿、生成修订，并等待作者确认写进文件。',
    trigger_intents: ['file.review', 'file.revise'],
    plan_template: [
      {
        step: 'context.load',
        detail: '读取当前章与作品上下文。',
        status: 'planned',
      },
      {
        step: 'subagents.review',
        detail: '剧情、人物、文风和连续性子代理并行审稿。',
        status: 'planned',
      },
      {
        step: 'repair.propose',
        detail: '将审稿结论综合为 proposed patch。',
        status: 'planned',
      },
      {
        step: 'permission.confirm',
        detail: '写进文件前等待作者确认。',
        status: 'planned',
      },
    ],
    tool_sequence: ['context.load', 'file.review', 'file.revise', 'judge.run', 'judge.repair'],
    output_artifacts: ['review_report', 'proposed_patch'],
    permission_profile: DEFAULT_PERMISSION_PROFILE,
  },
  {
    name: 'short_story_draft',
    description: '短篇创作流程：根据故事核、情绪钩子和目标读者生成可审稿初稿。',
    trigger_intents: ['chat.explain'],
    plan_template: [
      {
        step: 'brief.extract',
        detail: '提取题材、主角、冲突和结尾反转。',
        status: 'planned',
      },
      {
        step: 'draft.write',
        detail: '按短篇节奏生成完整初稿。',
        status: 'planned',
      },
      {
        step: 'judge.run',
        detail: '检查情绪推进、反转和可读性。',
        status: 'planned',
      },
    ],
    tool_sequence: ['context.load', 'judge.run'],
    output_artifacts: ['chapter_draft', 'review_report'],
    permission_profile: DEFAULT_PERMISSION_PROFILE,
  },
  {
    name: 'long_chapter_generate',
    description: '长篇章节生成流程：按蓝图、Scene Packet 和连续性约束产出新章节草稿。',
    trigger_intents: ['chat.explain', 'chapter.review'],
    plan_template: [
      {
        step: 'context.load',
        detail: '读取蓝图、章节目标和连续性资料。',
        status: 'planned',
      },
      {
        step: 'chapter.generate',
        detail: '生成章节草稿并保留证据链。',
        status: 'planned',
      },
      {
        step: 'judge.run',
        detail: '审查事实、节奏和设定一致性。',
        status: 'planned',
      },
    ],
    tool_sequence: ['context.load', 'scene_packets.assemble', 'judge.run'],
    output_artifacts: ['chapter_draft', 'review_report'],
    permission_profile: DEFAULT_PERMISSION_PROFILE,
  },
  {
    name: 'consistency_review',
    description: '一致性审查流程：聚焦设定、伏笔、人物关系、时间线和前后文事实冲突。',
    trigger_intents: ['file.review', 'chapter.review'],
    plan_template: [
      {
        step: 'context.load',
        detail: '读取当前稿和相关事实资料。',
        status: 'planned',
      },
      {
        step: 'continuity.review',
        detail: '检查设定、伏笔、人物关系和时间线。',
        status: 'planned',
      },
      {
        step: 'synthesizer.merge',
        detail: '合并冲突证据与修订建议。',
        status: 'planned',
      },
    ],
    tool_sequence: ['context.load', 'file.review', 'judge.run'],
    output_artifacts: ['review_report'],
    permission_profile: DEFAULT_PERMISSION_PROFILE,
  },
];

/** Root Agent 可选择的静态流程 skill 清单（只描述计划知识，不直接执行工具）。 */
export function listAgentSkills(): AgentSkill[] {
  return AGENT_SKILL_DEFINITIONS.map((skill) => structuredClone(skill));
}

export function skillByName(name: string): AgentSkill {
  const skill = AGENT_SKILL_DEFINITIONS.find((item) => item.name === name);
  if (!skill) throw new RangeError(`Agent skill 不存在：${name}`);
  return skill;
}

type Scope = { [key: string]: unknown } | null | undefined;

function scopeStringList(scope: Scope, key: string): string[] {
  const value = scope?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(pythonStrip(item)))
    : [];
}

const hasScopeKey = (scope: Scope, ...keys: string[]) =>
  scope != null && keys.some((key) => scope[key] !== undefined && scope[key] !== null);

function selectAgentSkill(intent: unknown, goal: string, scope: Scope): AgentSkill {
  const normalized = typeof intent === 'string' ? intent : '';
  if (normalized === 'file.revise') return skillByName('chapter_polish');
  if (normalized === 'file.review') {
    if (
      ['一致性', '设定', '伏笔', '时间线', '前后文', '连续性'].some((word) => goal.includes(word))
    )
      return skillByName('consistency_review');
    return skillByName('chapter_polish');
  }
  if (['短篇', '盐言', '故事核', '反转'].some((word) => goal.includes(word)))
    return skillByName('short_story_draft');
  if (
    ['生成章节', '写一章', '续写', 'long chapter'].some((word) => goal.includes(word)) ||
    hasScopeKey(scope, 'scene_packet_id', 'book_id', 'blueprint_id')
  )
    return skillByName('long_chapter_generate');
  if (goal.toLowerCase().includes('consistency')) return skillByName('consistency_review');
  return skillByName('chapter_polish');
}

export function agentPlanPayload(options: {
  intent: unknown;
  goal: string;
  scope: Scope;
  plan: unknown[];
}) {
  const selected = selectAgentSkill(options.intent, options.goal, options.scope);
  return {
    intent: options.intent,
    plan: options.plan,
    agent_role_hints: scopeStringList(options.scope, 'agent_role_hints'),
    agent_role_mentions: scopeStringList(options.scope, 'agent_role_mentions'),
    skill_version: 'skills_v1',
    selected_skill: {
      name: selected.name,
      description: selected.description,
      permission_profile: selected.permission_profile,
      tool_sequence: [...selected.tool_sequence],
      output_artifacts: [...selected.output_artifacts],
    },
    skill_plan_template: [...selected.plan_template],
  };
}
