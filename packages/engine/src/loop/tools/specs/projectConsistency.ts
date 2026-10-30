import { toolSpec } from '../specModels';

/** 一致性观察与语义评审工具。声明顺序即注册顺序与模型看到的工具顺序。 */
export const PROJECT_CONSISTENCY_TOOL_SPECS = [
  toolSpec({
    name: 'project.consistency',
    description:
      '作品级一致性观察扫描：词条出现分布、时间标记、跨文件重复子句（path-scoped 只读，不下结论）。',
    domain: 'project',
    input_schema: {},
    output_schema: {},
    allowed_roles: ['root_agent', 'context_explorer'],
    risk_level: 'read',
    retry_safe: true,
    idempotent: true,
    execution_mode: 'sync',
    evidence_fields: ['scanned_files', 'term_count', 'time_marker_count', 'repeated_clause_count'],
    references: {
      workflow_nodes: ['agent_runtime.project_consistency'],
    },
    loop_schema: {
      description:
        '作品级一致性观察扫描：给定人物名 / 称谓 / 设定词条，返回各文件出现分布（含从未出现的缺席词条）、全书时间标记罗列和跨文件重复子句。' +
        '只报机械观察不下结论，用于称谓 / 时间线 / 重复表达检查。',
      parameters: {
        type: 'object',
        properties: {
          terms: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: '要追踪的人物名 / 称谓 / 设定词条，最多 30 个；可先读设定文件再决定。',
          },
          subpath: {
            type: 'string',
            description: '限定扫描的子目录，相对作品文件夹。',
          },
          glob: {
            type: 'string',
            description: '文件名过滤，默认 *.md。',
          },
        },
      },
    },
  }),
  toolSpec({
    name: 'project.deep_consistency',
    description:
      '深度一致性评审：语义 judge 对照本地人物 / 设定文件检查单篇正文，产出 advisory issue 信号（不写进文件、不落 DB）。',
    domain: 'project',
    input_schema: {},
    output_schema: {},
    allowed_roles: ['root_agent'],
    risk_level: 'analyze',
    retry_safe: false,
    idempotent: false,
    execution_mode: 'sync',
    required_capabilities: ['llm'],
    evidence_fields: ['path', 'issue_count', 'bible_file_count'],
    references: {
      workflow_nodes: ['agent_runtime.project_deep_consistency'],
    },
    loop_schema: {
      description:
        '深度一致性评审（语义）：把单篇正文对照作品内人物 / 设定文件交给语义评审模型，返回结构化 issue（类别 / 严重度 / 行号 / 摘要）。' +
        '比 project_consistency 更贵更慢，适合先用机械观察或检索定位疑点、再对目标章节深查；' +
        '结果是参考信号，须抽读原文核实。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '相对作品文件夹的文件路径（要评审的正文）。',
          },
          bible_paths: {
            type: 'array',
            items: {
              type: 'string',
            },
            description:
              '作为约束的人物 / 设定文件路径；省略则自动取 人物/ 与 设定/ 下的 md 文件。',
          },
          facts: {
            type: 'array',
            items: {
              type: 'string',
            },
            description:
              '已核实的必含事实（如「左臂受伤」「地点：灯塔港」），正文与之矛盾会被标出；最多 40 条。',
          },
        },
        required: ['path'],
      },
    },
  }),
  toolSpec({
    name: 'project.cross_chapter_check',
    description:
      '跨章一致性审校：把若干完整章节一起交给语义模型，找章与章之间的硬冲突（时间线、称谓漂移、设定不一、已退场角色再出场、伏笔未回收）；' +
      '不写进文件、不落 DB。',
    domain: 'project',
    input_schema: {},
    output_schema: {},
    allowed_roles: ['root_agent'],
    risk_level: 'analyze',
    retry_safe: false,
    idempotent: false,
    execution_mode: 'sync',
    required_capabilities: ['llm'],
    evidence_fields: ['chapter_count', 'finding_count', 'model'],
    references: {
      workflow_nodes: ['agent_runtime.project_cross_chapter_check'],
    },
    loop_schema: {
      description:
        '跨章一致性审校（语义，烧 token）：一次给 2-6 个章节路径，模型同时读这几章的完整正文，只找它们**之间**的硬冲突——时间线矛盾、人物称谓漂移、设定或世界规则前后不一致、已退场角色再次出场、前文埋的伏笔后文未回收。' +
        '这是 project_deep_consistency 结构上抓不到的那一类（那把只看单章）。' +
        '章会按阅读序自动排好，不必自己排；每章按预算截断，truncated=true 表示模型没读全那一章。' +
        'finding 是参考信号，回给作者前按 path 抽读核实。',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: '要比对的章节路径（相对作品文件夹），2-6 个。',
          },
          focus: {
            type: 'string',
            description: '可选：作者特别关注的点，如「玄铁令到底在谁手上」。',
          },
        },
        required: ['paths'],
      },
    },
  }),
] as const;
