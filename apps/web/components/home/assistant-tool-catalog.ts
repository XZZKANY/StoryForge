export type RuntimeToolLike = {
  readonly name: string;
  readonly domain: string;
  readonly input_schema?: Record<string, unknown>;
  readonly output_schema?: Record<string, unknown>;
  readonly required_capabilities?: readonly string[];
  readonly evidence_fields?: readonly string[];
  readonly references?: {
    readonly page_refs?: readonly string[];
    readonly api_paths?: readonly string[];
    readonly workflow_nodes?: readonly string[];
  };
};

export type AssistantToolDefinition = {
  readonly name: string;
  readonly domain: string;
  readonly label: string;
  readonly description: string;
  readonly requiredCapabilities: readonly string[];
  readonly evidenceFields: readonly string[];
  readonly pageRefs: readonly string[];
  readonly apiPaths: readonly string[];
  readonly workflowNodes: readonly string[];
  readonly needsApproval: boolean;
  readonly statusWeight: number;
};

const toolMetadata: Record<
  string,
  Pick<AssistantToolDefinition, 'label' | 'description' | 'needsApproval' | 'statusWeight'>
> = {
  'goal.analyze': {
    label: '分析创作目标',
    description: '提取题材、主角、冲突、章节规模、交付物和约束。',
    needsApproval: false,
    statusWeight: 10,
  },
  'blueprint.create': {
    label: '创建 Blueprint',
    description: '创建或更新作品蓝图、章节计划和生成边界。',
    needsApproval: false,
    statusWeight: 20,
  },
  'book_run.start': {
    label: '启动 BookRun',
    description: '基于锁定 Blueprint 启动整书或分批章节运行。',
    needsApproval: false,
    statusWeight: 30,
  },
  'retrieval.search': {
    label: '检索资料与证据',
    description: '检索资料库、世界观、章节快照和连续性证据。',
    needsApproval: false,
    statusWeight: 40,
  },
  'scene_packets.assemble': {
    label: '组装 Scene Packet',
    description: '汇总章节目标、证据、上下文预算和场景约束。',
    needsApproval: false,
    statusWeight: 50,
  },
  'chapter.generate': {
    label: '生成章节正文',
    description: '调用章节生成技能生成正文草稿并记录模型运行引用。',
    needsApproval: false,
    statusWeight: 60,
  },
  'judge.create_issues': {
    label: 'Judge 质量审阅',
    description: '检查节奏、设定、角色一致性和文本质量问题。',
    needsApproval: false,
    statusWeight: 70,
  },
  'repair.create_patch': {
    label: '生成修复建议',
    description: '根据 Judge 问题生成可批准的修复补丁。',
    needsApproval: true,
    statusWeight: 80,
  },
  'approval.apply': {
    label: '批准写回',
    description: '将用户批准的正文、修复或上下文变更写回事实源。',
    needsApproval: true,
    statusWeight: 90,
  },
  'artifact.export': {
    label: '导出交付物',
    description: '导出 Markdown、EPUB、审计报告和追溯摘要。',
    needsApproval: false,
    statusWeight: 100,
  },
  'artifacts.create': {
    label: '登记制品',
    description: '登记正文、审计报告、导出文件和版本追溯信息。',
    needsApproval: false,
    statusWeight: 110,
  },
  'evaluations.create_run': {
    label: '运行质量评测',
    description: '对生成结果执行质量评测并记录失败样例。',
    needsApproval: false,
    statusWeight: 120,
  },
  'provider_gateway.resolve': {
    label: '解析 Provider',
    description: '检查模型供应商能力、别名和凭据状态。',
    needsApproval: false,
    statusWeight: 5,
  },
};

const builtInTools: readonly AssistantToolDefinition[] = [
  createBuiltInTool('provider_gateway.resolve', 'provider_gateway'),
  createBuiltInTool('goal.analyze', 'planning'),
  createBuiltInTool('blueprint.create', 'generation'),
  createBuiltInTool('book_run.start', 'generation'),
  createBuiltInTool('chapter.generate', 'generation'),
  createBuiltInTool('approval.apply', 'approval'),
  createBuiltInTool('artifact.export', 'artifacts'),
];

export function buildAssistantToolCatalog(
  runtimeTools: readonly RuntimeToolLike[],
): readonly AssistantToolDefinition[] {
  const toolsByName = new Map<string, AssistantToolDefinition>();

  for (const runtimeTool of runtimeTools) {
    toolsByName.set(runtimeTool.name, normalizeRuntimeTool(runtimeTool));
  }
  for (const builtInTool of builtInTools) {
    if (!toolsByName.has(builtInTool.name)) {
      toolsByName.set(builtInTool.name, builtInTool);
    }
  }

  return [...toolsByName.values()].sort(
    (left, right) => left.statusWeight - right.statusWeight || left.name.localeCompare(right.name),
  );
}

export function findAssistantTool(
  catalog: readonly AssistantToolDefinition[],
  toolName: string,
): AssistantToolDefinition | undefined {
  return catalog.find((tool) => tool.name === toolName);
}

export function listAssistantToolsByDomain(
  catalog: readonly AssistantToolDefinition[],
  domain: string,
): readonly AssistantToolDefinition[] {
  return catalog.filter((tool) => tool.domain === domain);
}

function normalizeRuntimeTool(runtimeTool: RuntimeToolLike): AssistantToolDefinition {
  const metadata = metadataForTool(runtimeTool.name);
  return {
    name: runtimeTool.name,
    domain: runtimeTool.domain,
    label: metadata.label,
    description: metadata.description,
    requiredCapabilities: [...(runtimeTool.required_capabilities ?? [])],
    evidenceFields: [...(runtimeTool.evidence_fields ?? [])],
    pageRefs: [...(runtimeTool.references?.page_refs ?? [])],
    apiPaths: [...(runtimeTool.references?.api_paths ?? [])],
    workflowNodes: [...(runtimeTool.references?.workflow_nodes ?? [])],
    needsApproval: metadata.needsApproval,
    statusWeight: metadata.statusWeight,
  };
}

function createBuiltInTool(name: string, domain: string): AssistantToolDefinition {
  const metadata = metadataForTool(name);
  return {
    name,
    domain,
    label: metadata.label,
    description: metadata.description,
    requiredCapabilities: [],
    evidenceFields: [],
    pageRefs: [],
    apiPaths: [],
    workflowNodes: [],
    needsApproval: metadata.needsApproval,
    statusWeight: metadata.statusWeight,
  };
}

function metadataForTool(
  name: string,
): Pick<AssistantToolDefinition, 'label' | 'description' | 'needsApproval' | 'statusWeight'> {
  return (
    toolMetadata[name] ?? {
      label: name,
      description: '复用现有 StoryForge 能力执行该工具。',
      needsApproval: false,
      statusWeight: 500,
    }
  );
}
