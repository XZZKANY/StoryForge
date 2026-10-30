import { CONTEXT_ALLOWED_ROLES, toolSpec } from '../specModels';

/** 上下文与项目文件工具。声明顺序即注册顺序与模型看到的工具顺序。 */
export const CONTEXT_FS_TOOL_SPECS = [
  toolSpec({
    name: 'context.load',
    description: '读取当前文件与上下文摘要。',
    domain: 'context',
    input_schema: {},
    output_schema: {},
    allowed_roles: CONTEXT_ALLOWED_ROLES,
    risk_level: 'read',
    retry_safe: true,
    idempotent: true,
    execution_mode: 'sync',
    evidence_fields: ['file_path', 'context_file_count', 'context_kinds'],
    references: {
      workflow_nodes: ['agent_runtime.context_load'],
    },
  }),
  toolSpec({
    name: 'fs.list',
    description: '列出作品文件夹内的文件（path-scoped 只读）。',
    domain: 'fs',
    input_schema: {},
    output_schema: {},
    allowed_roles: ['root_agent', 'context_explorer'],
    risk_level: 'read',
    retry_safe: true,
    idempotent: true,
    execution_mode: 'sync',
    evidence_fields: ['entry_count', 'truncated'],
    references: {
      workflow_nodes: ['agent_runtime.fs_list'],
    },
    loop_schema: {
      description: '列出作品内文件（递归、相对路径）。可选 subpath 限定子目录。',
      parameters: {
        type: 'object',
        properties: {
          subpath: {
            type: 'string',
            description: '限定列出的子目录，相对作品文件夹。',
          },
        },
      },
    },
  }),
  toolSpec({
    name: 'fs.read',
    description: '读取作品内单个文本文件切片（path-scoped 只读）。',
    domain: 'fs',
    input_schema: {},
    output_schema: {},
    allowed_roles: ['root_agent', 'context_explorer'],
    risk_level: 'read',
    retry_safe: true,
    idempotent: true,
    execution_mode: 'sync',
    evidence_fields: ['path', 'returned_chars', 'truncated'],
    references: {
      workflow_nodes: ['agent_runtime.fs_read'],
    },
    loop_schema: {
      description: '读取作品内单个文本文件的内容切片。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '相对作品文件夹的文件路径。',
          },
          offset: {
            type: 'integer',
            description: '起始字符偏移，默认 0。',
          },
          limit: {
            type: 'integer',
            description: '最多返回字符数，默认 20000。',
          },
        },
        required: ['path'],
      },
    },
  }),
  toolSpec({
    name: 'fs.search',
    description: '在作品文本文件里跨文件检索（path-scoped 只读）。',
    domain: 'fs',
    input_schema: {},
    output_schema: {},
    allowed_roles: ['root_agent', 'context_explorer'],
    risk_level: 'read',
    retry_safe: true,
    idempotent: true,
    execution_mode: 'sync',
    evidence_fields: ['match_count', 'truncated'],
    references: {
      workflow_nodes: ['agent_runtime.fs_search'],
    },
    loop_schema: {
      description: '在作品文本文件里跨文件检索，返回文件、行号和摘录。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '要检索的文本或正则。',
          },
          glob: {
            type: 'string',
            description: '文件名过滤，默认 *.md。',
          },
          use_regex: {
            type: 'boolean',
            description: 'query 是否按正则解释，默认 false。',
          },
        },
        required: ['query'],
      },
    },
  }),
  toolSpec({
    name: 'project.knowledge',
    description: '受控发现、读取或检索作品创作资料。',
    domain: 'fs',
    input_schema: {},
    output_schema: {},
    allowed_roles: ['root_agent', 'context_explorer'],
    risk_level: 'read',
    retry_safe: true,
    idempotent: true,
    execution_mode: 'sync',
    evidence_fields: ['action', 'candidate_count', 'match_count', 'path', 'warning_count'],
    references: {
      workflow_nodes: ['agent_runtime.project_knowledge'],
    },
    loop_schema: {
      description: '列出、读取或检索受控 Project Knowledge。未知隐藏目录与内部状态不可访问。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'read', 'search'],
            description: 'list 列候选，read 读单文件，search 检索候选。',
          },
          path: {
            type: 'string',
            description: 'read 使用的作品内相对路径。',
          },
          query: {
            type: 'string',
            description: 'search 使用的文本或正则。',
          },
          offset: {
            type: 'integer',
            description: 'read 起始字符偏移，默认 0。',
          },
          limit: {
            type: 'integer',
            description: 'read 最多返回字符数，默认 20000。',
          },
          use_regex: {
            type: 'boolean',
            description: 'search 是否按正则解释 query。',
          },
        },
        required: ['action'],
      },
    },
  }),
  toolSpec({
    name: 'knowledge.propose',
    description: '提议将耐久创作事实沉淀到知识收件箱，不写作品文件。',
    domain: 'fs',
    input_schema: {},
    output_schema: {},
    allowed_roles: ['root_agent'],
    risk_level: 'analyze',
    retry_safe: false,
    idempotent: false,
    execution_mode: 'sync',
    artifact_kinds: ['knowledge_proposal'],
    evidence_fields: ['proposal_count', 'target_paths'],
    references: {
      workflow_nodes: ['agent_runtime.knowledge_propose'],
    },
    loop_schema: {
      description: '把 1–5 条跨章节耐久知识放入作者的 Knowledge Inbox。只提议，不创建或更新文件。',
      parameters: {
        type: 'object',
        properties: {
          proposals: {
            type: 'array',
            minItems: 1,
            maxItems: 5,
            items: {
              type: 'object',
              properties: {
                target_path: {
                  type: 'string',
                },
                operation: {
                  type: 'string',
                  enum: [
                    'create',
                    'extend',
                    'conflict',
                    'dispute',
                    'retire',
                    'supersede',
                    'migrate',
                  ],
                },
                title: {
                  type: 'string',
                },
                claim: {
                  type: 'string',
                },
                kind: {
                  type: 'string',
                  enum: [
                    'character_fact',
                    'world_rule',
                    'timeline_fact',
                    'promise',
                    'plan',
                    'writing_rule',
                    'reference',
                  ],
                },
                confidence: {
                  type: 'string',
                  enum: ['author_declared', 'project_observed', 'inferred', 'external_reference'],
                },
                sources: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                  },
                },
                related_knowledge_ids: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                },
                reason: {
                  type: 'string',
                },
              },
              required: [
                'target_path',
                'operation',
                'title',
                'claim',
                'kind',
                'confidence',
                'sources',
                'reason',
              ],
            },
          },
        },
        required: ['proposals'],
      },
    },
    loop_trace_owner: 'handler',
  }),
] as const;
