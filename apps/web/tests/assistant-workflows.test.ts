import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildAssistantToolCatalog } from '../components/home/assistant-tool-catalog';
import {
  getAssistantWorkflowTemplate,
  listAssistantWorkflowTemplates,
  planAssistantWorkflow,
} from '../components/home/assistant-workflows';

const catalog = buildAssistantToolCatalog([
  {
    name: 'retrieval.search',
    domain: 'retrieval',
    input_schema: {},
    output_schema: {},
    required_capabilities: ['embedding'],
    evidence_fields: ['source_ref'],
    references: { page_refs: [], api_paths: ['POST /api/retrieval/search'], workflow_nodes: [] },
  },
  {
    name: 'judge.create_issues',
    domain: 'judge',
    input_schema: {},
    output_schema: {},
    required_capabilities: ['llm'],
    evidence_fields: ['status'],
    references: { page_refs: [], api_paths: ['POST /api/judge/issues'], workflow_nodes: [] },
  },
  {
    name: 'repair.create_patch',
    domain: 'repair',
    input_schema: {},
    output_schema: {},
    required_capabilities: [],
    evidence_fields: ['replacement_text'],
    references: { page_refs: [], api_paths: ['POST /api/repair/patches'], workflow_nodes: [] },
  },
]);

test('listAssistantWorkflowTemplates 返回生成、修订、导出流程', () => {
  assert.deepEqual(
    listAssistantWorkflowTemplates().map((workflow) => workflow.id),
    ['book_generation', 'chapter_review', 'artifact_export'],
  );
});

test('book_generation 流程复用工具目录中的核心工具顺序', () => {
  const template = getAssistantWorkflowTemplate('book_generation');

  assert.deepEqual(
    template.steps.map((step) => step.toolName),
    [
      'goal.analyze',
      'blueprint.create',
      'book_run.start',
      'retrieval.search',
      'scene_packets.assemble',
      'chapter.generate',
      'judge.create_issues',
      'repair.create_patch',
      'approval.apply',
      'artifact.export',
    ],
  );
});

test('planAssistantWorkflow 为缺失工具输出失败前置检查', () => {
  const plan = planAssistantWorkflow(getAssistantWorkflowTemplate('book_generation'), []);

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.missingTools, [
    'goal.analyze',
    'blueprint.create',
    'book_run.start',
    'retrieval.search',
    'scene_packets.assemble',
    'chapter.generate',
    'judge.create_issues',
    'repair.create_patch',
    'approval.apply',
    'artifact.export',
  ]);
});

test('planAssistantWorkflow 为可用工具生成待执行步骤', () => {
  const plan = planAssistantWorkflow(getAssistantWorkflowTemplate('chapter_review'), catalog);

  assert.equal(plan.status, 'ready');
  assert.deepEqual(
    plan.steps.map((step) => `${step.order}:${step.tool.name}:${step.approvalGate}`),
    [
      '1:goal.analyze:false',
      '2:judge.create_issues:false',
      '3:repair.create_patch:true',
      '4:approval.apply:true',
      '5:artifact.export:false',
    ],
  );
});
