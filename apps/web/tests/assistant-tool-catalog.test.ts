import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildAssistantToolCatalog,
  findAssistantTool,
  listAssistantToolsByDomain,
} from '../components/home/assistant-tool-catalog';

const runtimeTools = [
  {
    name: 'retrieval.search',
    domain: 'retrieval',
    input_schema: { title: 'RetrievalSearchCreate' },
    output_schema: { title: 'RetrievalHitReadList' },
    required_capabilities: ['embedding', 'reranker'],
    evidence_fields: ['source_ref', 'score'],
    references: {
      page_refs: ['apps/web/app/retrieval/page.tsx'],
      api_paths: ['POST /api/retrieval/workbench/search'],
      workflow_nodes: ['scene_packets.retrieval_context'],
    },
  },
  {
    name: 'judge.create_issues',
    domain: 'judge',
    input_schema: { title: 'JudgeIssueCreate' },
    output_schema: { title: 'JudgeIssueReadList' },
    required_capabilities: ['llm'],
    evidence_fields: ['status'],
    references: {
      page_refs: ['apps/web/app/studio/api.ts'],
      api_paths: ['POST /api/judge/issues'],
      workflow_nodes: ['draft_writer'],
    },
  },
] as const;

test('buildAssistantToolCatalog 将运行时工具规范化为 Assistant 工具', () => {
  const catalog = buildAssistantToolCatalog(runtimeTools);
  const retrievalTool = findAssistantTool(catalog, 'retrieval.search');

  assert.ok(retrievalTool);
  assert.deepEqual(retrievalTool, {
    name: 'retrieval.search',
    domain: 'retrieval',
    label: '检索资料与证据',
    description: '检索资料库、世界观、章节快照和连续性证据。',
    requiredCapabilities: ['embedding', 'reranker'],
    evidenceFields: ['source_ref', 'score'],
    pageRefs: ['apps/web/app/retrieval/page.tsx'],
    apiPaths: ['POST /api/retrieval/workbench/search'],
    workflowNodes: ['scene_packets.retrieval_context'],
    needsApproval: false,
    statusWeight: 40,
  });
});

test('buildAssistantToolCatalog 自动补齐核心内置工具', () => {
  const catalog = buildAssistantToolCatalog(runtimeTools);

  assert.ok(findAssistantTool(catalog, 'goal.analyze'), '应包含目标分析工具');
  assert.ok(findAssistantTool(catalog, 'blueprint.create'), '应包含蓝图创建工具');
  assert.ok(findAssistantTool(catalog, 'book_run.start'), '应包含 BookRun 启动工具');
  assert.ok(findAssistantTool(catalog, 'artifact.export'), '应包含导出工具');
});

test('listAssistantToolsByDomain 按领域稳定排序', () => {
  const catalog = buildAssistantToolCatalog(runtimeTools);
  const generationTools = listAssistantToolsByDomain(catalog, 'generation');

  assert.deepEqual(
    generationTools.map((tool) => tool.name),
    ['blueprint.create', 'book_run.start', 'chapter.generate'],
  );
});
