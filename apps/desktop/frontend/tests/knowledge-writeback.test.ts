import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { ApiKnowledgeProposalPatch } from '../src/lib/api/contracts';
import {
  performKnowledgeWriteback,
  type KnowledgeWritebackEffects,
} from '../src/lib/project/knowledge-writeback';

const patch: ApiKnowledgeProposalPatch = {
  id: 'knowledge-patch-1',
  artifact_id: 12,
  kind: 'project_knowledge',
  patch_class: 'project_knowledge',
  proposal_id: 'kpp_1',
  proposal_revision: 1,
  knowledge_id: 'pk_550e8400-e29b-41d4-a716-446655440000',
  author_confirmation_event_id: 'ake_1',
  file_path: 'D:/Book/设定/天枢.md',
  relative_path: '设定/天枢.md',
  before: '旧内容',
  after: '新内容',
  baseline_hash: 'sha256:baseline',
  requires_confirmation: true,
  created_by_tool: 'knowledge.propose',
};

function effects(current: string | null, order: string[]): KnowledgeWritebackEffects {
  return {
    readCurrent: async () => {
      order.push('read');
      return current;
    },
    snapshot: async () => {
      order.push('snapshot');
      return { timestamp: 42 };
    },
    advanceBranchHead: async () => {
      order.push('advance');
    },
    write: async () => {
      order.push('write');
    },
    record: async () => {
      order.push('record');
    },
    resolveAccepted: async () => {
      order.push('resolve');
    },
  };
}

test('知识 patch 依次经过快照、写盘、记录和 accepted resolve', async () => {
  const order: string[] = [];

  const result = await performKnowledgeWriteback(patch, effects('旧内容', order));

  assert.equal(result, 'written');
  assert.deepEqual(order, ['read', 'snapshot', 'advance', 'write', 'record', 'resolve']);
});

test('知识文件基线漂移时不执行任何写入副作用', async () => {
  const order: string[] = [];

  await assert.rejects(
    performKnowledgeWriteback(patch, effects('作者刚刚改过的内容', order)),
    /知识文件已变化/,
  );

  assert.deepEqual(order, ['read']);
});

test('磁盘已是 patch after 时只重试 accepted resolution', async () => {
  const order: string[] = [];

  const result = await performKnowledgeWriteback(patch, effects('新内容', order));

  assert.equal(result, 'reconciled');
  assert.deepEqual(order, ['read', 'resolve']);
});
