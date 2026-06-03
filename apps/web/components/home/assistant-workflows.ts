import type { AssistantToolDefinition } from './assistant-tool-catalog';
import { findAssistantTool } from './assistant-tool-catalog';

export type AssistantWorkflowId = 'book_generation' | 'chapter_review' | 'artifact_export';

export type AssistantWorkflowStepTemplate = {
  readonly toolName: string;
  readonly approvalGate: boolean;
};

export type AssistantWorkflowTemplate = {
  readonly id: AssistantWorkflowId;
  readonly label: string;
  readonly description: string;
  readonly steps: readonly AssistantWorkflowStepTemplate[];
};

export type AssistantPlannedWorkflowStep = {
  readonly order: number;
  readonly tool: AssistantToolDefinition;
  readonly approvalGate: boolean;
};

export type AssistantWorkflowPlan =
  | {
      readonly status: 'ready';
      readonly workflow: AssistantWorkflowTemplate;
      readonly missingTools: readonly string[];
      readonly steps: readonly AssistantPlannedWorkflowStep[];
    }
  | {
      readonly status: 'blocked';
      readonly workflow: AssistantWorkflowTemplate;
      readonly missingTools: readonly string[];
      readonly steps: readonly AssistantPlannedWorkflowStep[];
    };

const workflowTemplates: readonly AssistantWorkflowTemplate[] = [
  {
    id: 'book_generation',
    label: '生成作品',
    description: '从创作目标出发，生成 Blueprint、章节正文、审阅修复和交付物。',
    steps: [
      { toolName: 'goal.analyze', approvalGate: false },
      { toolName: 'blueprint.create', approvalGate: false },
      { toolName: 'book_run.start', approvalGate: false },
      { toolName: 'retrieval.search', approvalGate: false },
      { toolName: 'scene_packets.assemble', approvalGate: false },
      { toolName: 'chapter.generate', approvalGate: false },
      { toolName: 'judge.create_issues', approvalGate: false },
      { toolName: 'repair.create_patch', approvalGate: true },
      { toolName: 'approval.apply', approvalGate: true },
      { toolName: 'artifact.export', approvalGate: false },
    ],
  },
  {
    id: 'chapter_review',
    label: '章节修订审阅',
    description: '对指定章节执行质量审阅、修复建议、批准写回和导出。',
    steps: [
      { toolName: 'goal.analyze', approvalGate: false },
      { toolName: 'judge.create_issues', approvalGate: false },
      { toolName: 'repair.create_patch', approvalGate: true },
      { toolName: 'approval.apply', approvalGate: true },
      { toolName: 'artifact.export', approvalGate: false },
    ],
  },
  {
    id: 'artifact_export',
    label: '导出审计',
    description: '读取运行结果并导出 Markdown、EPUB、审计报告和评测摘要。',
    steps: [
      { toolName: 'goal.analyze', approvalGate: false },
      { toolName: 'artifact.export', approvalGate: false },
      { toolName: 'evaluations.create_run', approvalGate: false },
    ],
  },
];

export function listAssistantWorkflowTemplates(): readonly AssistantWorkflowTemplate[] {
  return workflowTemplates;
}

export function getAssistantWorkflowTemplate(
  workflowId: AssistantWorkflowId,
): AssistantWorkflowTemplate {
  const template = workflowTemplates.find((workflow) => workflow.id === workflowId);
  if (!template) {
    throw new Error(`未知 Assistant 流程：${workflowId}`);
  }
  return template;
}

export function planAssistantWorkflow(
  workflow: AssistantWorkflowTemplate,
  catalog: readonly AssistantToolDefinition[],
): AssistantWorkflowPlan {
  const steps: AssistantPlannedWorkflowStep[] = [];
  const missingTools: string[] = [];

  workflow.steps.forEach((step, index) => {
    const tool = findAssistantTool(catalog, step.toolName);
    if (!tool) {
      missingTools.push(step.toolName);
      return;
    }
    steps.push({
      order: index + 1,
      tool,
      approvalGate: step.approvalGate || tool.needsApproval,
    });
  });

  return {
    status: missingTools.length > 0 ? 'blocked' : 'ready',
    workflow,
    missingTools,
    steps,
  };
}
