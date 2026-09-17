import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  overviewActivityActionLabel,
  overviewActivityLabel,
  projectOverviewActivity,
} from '../src/components/chat-window/overview-activity';
import type { AgentRun } from '../src/components/chat-window/types';

const run = (status: AgentRun['status'], steps = []): AgentRun => ({
  id: 'run-1',
  sessionId: 'session-1',
  goal: '完成这一章',
  status,
  steps,
});

test('overview activity preserves authoritative terminal status and separates waiting causes', () => {
  const base = {
    projectPath: 'D:/book',
    assistantSessionId: 7,
    chapterBrief: null,
    agentBusy: false,
    sessionLoadError: null,
  };
  assert.equal(projectOverviewActivity({ ...base, agentRun: run('running') })?.status, 'running');
  assert.equal(
    projectOverviewActivity({ ...base, agentRun: run('completed') })?.status,
    'completed',
  );
  assert.equal(
    projectOverviewActivity({ ...base, agentRun: run('stopped'), agentBusy: true })?.status,
    'stopped',
  );
  assert.equal(
    projectOverviewActivity({ ...base, agentRun: run('failed'), retryableFailure: true })?.status,
    'failed',
  );
  assert.equal(
    projectOverviewActivity({
      ...base,
      agentRun: run('waiting', [
        { id: 'permission-required', title: '', tool: '', status: 'waiting', detail: '' },
      ]),
    })?.status,
    'waiting_permission',
  );
  assert.equal(
    projectOverviewActivity({
      ...base,
      agentRun: run('waiting'),
      chapterBrief: {
        briefId: 'b',
        revision: 1,
        targetPath: '01.md',
        chapterOrdinal: 1,
        chapterTitle: '第一章',
        goal: 'x',
        pov: null,
        setting: null,
        requiredBeats: [],
        forbiddenItems: [],
        continuityConstraints: [],
        targetCharsMin: 1,
        targetCharsMax: 2,
      },
    })?.status,
    'waiting_brief',
  );
  assert.equal(
    projectOverviewActivity({ ...base, agentRun: run('waiting') })?.status,
    'waiting_patch',
  );
});

test('overview activity exposes busy and session recovery without inventing a run', () => {
  const base = {
    projectPath: 'D:/book',
    assistantSessionId: null,
    agentRun: null,
    chapterBrief: null,
    agentBusy: true,
    sessionLoadError: null,
  };
  assert.equal(projectOverviewActivity(base)?.status, 'busy');
  const failed = projectOverviewActivity({
    ...base,
    agentBusy: false,
    sessionLoadError: '加载失败',
  });
  assert.equal(failed?.status, 'session_error');
  assert.equal(failed?.retryable, true);
  assert.equal(overviewActivityLabel('waiting_permission'), '等待权限确认');
  assert.equal(overviewActivityLabel('waiting_brief'), '等待章节 Brief 确认');
  assert.equal(overviewActivityLabel('waiting_patch'), '等待修改确认');
  assert.equal(overviewActivityActionLabel(failed!), '查看会话错误并重试');
});
