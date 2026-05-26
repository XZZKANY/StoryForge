import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeJobStatus,
  isTerminalJobStatus,
  normalizeJobStatus,
  parseJobRunSnapshot,
} from '../components/job-status/job-status-core';

test('normalizeJobStatus 对未知值返回 unknown', () => {
  assert.equal(normalizeJobStatus('weird'), 'unknown');
  assert.equal(normalizeJobStatus(null), 'unknown');
  assert.equal(normalizeJobStatus(undefined), 'unknown');
  assert.equal(normalizeJobStatus('queued'), 'queued');
  assert.equal(normalizeJobStatus('running'), 'running');
  assert.equal(normalizeJobStatus('completed'), 'completed');
  assert.equal(normalizeJobStatus('failed'), 'failed');
});

test('isTerminalJobStatus 正确识别终态', () => {
  assert.equal(isTerminalJobStatus('completed'), true);
  assert.equal(isTerminalJobStatus('failed'), true);
  assert.equal(isTerminalJobStatus('queued'), false);
  assert.equal(isTerminalJobStatus('running'), false);
});

test('parseJobRunSnapshot 解析合法负载并应用回退 ID', () => {
  const snapshot = parseJobRunSnapshot(
    {
      job_run_id: 42,
      status: 'running',
      progress: 0.5,
      current_node: 'judge',
      error_summary: null,
      updated_at: '2026-05-26T10:00:00Z',
    },
    100,
  );
  assert.ok(snapshot);
  assert.equal(snapshot.job_run_id, 42);
  assert.equal(snapshot.status, 'running');
  assert.equal(snapshot.progress, 0.5);
  assert.equal(snapshot.current_node, 'judge');
  assert.equal(snapshot.updated_at, '2026-05-26T10:00:00Z');
});

test('parseJobRunSnapshot 未提供 ID 时回退到默认值', () => {
  const snapshot = parseJobRunSnapshot({ status: 'queued' }, 7);
  assert.ok(snapshot);
  assert.equal(snapshot.job_run_id, 7);
  assert.equal(snapshot.status, 'queued');
});

test('parseJobRunSnapshot 拒绝非对象输入', () => {
  assert.equal(parseJobRunSnapshot(null, 1), null);
  assert.equal(parseJobRunSnapshot('bad', 1), null);
});

test('describeJobStatus 返回中文描述', () => {
  assert.equal(describeJobStatus('queued'), '排队中');
  assert.equal(describeJobStatus('running'), '运行中');
  assert.equal(describeJobStatus('completed'), '已完成');
  assert.equal(describeJobStatus('failed'), '已失败');
  assert.equal(describeJobStatus('unknown'), '状态未知');
});
