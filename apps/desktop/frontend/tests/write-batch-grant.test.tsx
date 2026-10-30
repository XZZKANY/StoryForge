/**
 * `/写` 批量写章的一次性授权（作者第 1 问选 B）：只有调度器、只对写章、只对这一批计划里的目标文件，
 * 才把这一轮按「自动」送给引擎；其余任何路径都送作者存的档位。断言落在真实发送边界（sendAgentUserMessage）上。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { useRunAuthorAgent } from '../src/components/chat-window/useRunAuthorAgent';
import type {
  RunAuthorAgentOptions,
  RunAuthorAgentOutcome,
} from '../src/components/chat-window/types';
import type { AgentPermissionProfile } from '../src/lib/agent-permission';
import { sendAgentUserMessage, type AgentUserMessageRequest } from '../src/lib/api-client';
import { buildContextBundle, type ContextBundle } from '../src/lib/project-context';
import {
  issueWriteBatchGrant,
  permissionForRun,
  revokeWriteBatchGrant,
  type WriteBatchGrant,
} from '../src/lib/write-batch-grant';

vi.mock('../src/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api-client')>()),
  sendAgentUserMessage: vi.fn(),
}));
vi.mock('../src/lib/project-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/project-context')>()),
  buildContextBundle: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const PROJECT = 'D:/books/wu-gang';
const TARGET = '正文/第004章.md';

const grantFor = (targets = [TARGET], projectPath = PROJECT) =>
  issueWriteBatchGrant({ projectPath, batchId: 'write-batch-1', targets });

describe('permissionForRun', () => {
  const base = {
    stored: 'ask' as AgentPermissionProfile,
    projectPath: PROJECT,
    intent: 'chapter.write',
    targetFilePath: TARGET,
  };

  it('调度器发的授权、写章、目标在计划里：这一轮按自动送', () => {
    expect(permissionForRun({ ...base, grant: grantFor() })).toBe('auto');
    // 路径写法不同（反斜杠）也认同一个目标。
    expect(
      permissionForRun({ ...base, targetFilePath: '正文\\第004章.md', grant: grantFor() }),
    ).toBe('auto');
  });

  it('照着形状拼出来的授权、撤销过的授权，都升不了', () => {
    const forged = { projectPath: PROJECT, batchId: 'write-batch-1' } as WriteBatchGrant;
    expect(permissionForRun({ ...base, grant: forged })).toBe('ask');
    const grant = grantFor();
    revokeWriteBatchGrant(grant);
    expect(permissionForRun({ ...base, grant })).toBe('ask');
  });

  it('不是写章、目标不在计划里、换了作品：都按作者存的档位', () => {
    const grant = grantFor();
    for (const intent of ['file.revise', 'chapter.polish', undefined])
      expect(permissionForRun({ ...base, intent, grant })).toBe('ask');
    expect(permissionForRun({ ...base, targetFilePath: '正文/第005章.md', grant })).toBe('ask');
    expect(permissionForRun({ ...base, targetFilePath: undefined, grant })).toBe('ask');
    expect(permissionForRun({ ...base, projectPath: 'D:/books/other', grant })).toBe('ask');
    expect(permissionForRun({ ...base, grant: undefined })).toBe('ask');
  });

  it('只读不升；自动 / 完全放行本来就免点，原样送', () => {
    const grant = grantFor();
    expect(permissionForRun({ ...base, stored: 'read', grant })).toBe('read');
    expect(permissionForRun({ ...base, stored: 'auto', grant })).toBe('auto');
    expect(permissionForRun({ ...base, stored: 'full', grant })).toBe('full');
  });
});

describe('唯一入口', () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(name) ? [relative('.', path).replace(/\\/g, '/')] : [];
    });

  it('只有批量写章调度器发授权、把授权带进运行', () => {
    const files = sourceFiles('src');
    const issuing = files.filter((path) =>
      /issueWriteBatchGrant\(/.test(readFileSync(path, 'utf8')),
    );
    expect(issuing.sort()).toEqual([
      'src/components/chat-window/write-batch-run.ts',
      'src/lib/write-batch-grant.ts',
    ]);
    // 把授权放进运行选项的只有调度器（useRunAuthorAgent 只拿它问 permissionForRun，重试时清掉）。
    const carrying = files.filter((path) =>
      /writeBatchGrant\s*:(?!\s*undefined)/.test(readFileSync(path, 'utf8')),
    );
    expect(carrying).toEqual(['src/components/chat-window/write-batch-run.ts']);
    const deciding = files.filter((path) => /permissionForRun\(/.test(readFileSync(path, 'utf8')));
    expect(deciding.sort()).toEqual([
      'src/components/chat-window/useRunAuthorAgent.ts',
      'src/lib/write-batch-grant.ts',
    ]);
  });
});

describe('useRunAuthorAgent 送出去的档位', () => {
  let root: Root;
  let host: HTMLDivElement;
  let run: ReturnType<typeof useRunAuthorAgent>;
  let state: ReturnType<typeof useChatWindowState>;

  function Body({ stored }: { stored: AgentPermissionProfile }) {
    state = useChatWindowState({ projectPath: PROJECT, currentFile: null, assistantSessionId: 7 });
    run = useRunAuthorAgent(
      state,
      () => undefined,
      () => undefined,
      async () => undefined,
      undefined,
      stored,
    );
    return null;
  }

  const sent = (): AgentUserMessageRequest[] =>
    vi.mocked(sendAgentUserMessage).mock.calls.map(([request]) => request);

  async function dispatch(
    intent: Parameters<typeof run>[2],
    options: RunAuthorAgentOptions,
  ): Promise<RunAuthorAgentOutcome> {
    let outcome!: RunAuthorAgentOutcome;
    await act(async () => {
      outcome = await run('写第 4 章（批量第 1 / 3 章）', 'agent', intent, [], options);
    });
    return outcome;
  }

  beforeEach(async () => {
    vi.mocked(buildContextBundle).mockResolvedValue({
      projectRoot: PROJECT,
      currentFile: null,
      files: [],
      summary: { hasStoryStructure: true, counts: {} },
      budget: {
        fileCount: 0,
        charCount: 0,
        maxFiles: 8,
        maxExcerptChars: 1200,
        truncated: false,
        pinnedFileCount: 0,
        missingPinnedFiles: [],
      },
    } as unknown as ContextBundle);
    vi.mocked(sendAgentUserMessage).mockReset();
    vi.mocked(sendAgentUserMessage).mockImplementation(async (request) => ({
      type: 'agent_result',
      session_id: request.sessionId,
      run_id: request.runId,
      assistant_session_id: 7,
      intent: 'chapter.write',
      user_message: request.userMessage,
      plan: [],
      agent_result: { summary: '第 4 章写好了。', requires_user_confirmation: false },
      tool_trace: [],
      proposed_patch: {
        id: 'patch-4',
        file_path: TARGET,
        before: '',
        after: '第四章\n',
        requires_confirmation: request.permissionProfile === 'ask',
      },
    }));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<Body stored="ask" />));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('调度器那一轮按自动送，交回的修订不用作者点', async () => {
    const outcome = await dispatch('chapter.write', {
      targetFilePath: TARGET,
      writeBatchGrant: grantFor(),
    });
    expect(sent()[0]?.permissionProfile).toBe('auto');
    expect(state.agentRun?.permissionProfile).toBe('auto');
    expect(outcome).toEqual({
      kind: 'settled',
      runId: sent()[0]?.runId,
      proposal: {
        patchId: 'patch-4',
        filePath: `${PROJECT}/${TARGET}`,
        requiresConfirmation: false,
      },
    });
  });

  it('这一轮失败了：交回 settled 让引擎判；作者点的「重试」不带这一批的授权', async () => {
    vi.mocked(sendAgentUserMessage).mockImplementation(async (request) => ({
      type: 'error',
      session_id: request.sessionId,
      run_id: request.runId,
      detail: '服务商超时',
    }));
    const outcome = await dispatch('chapter.write', {
      targetFilePath: TARGET,
      writeBatchGrant: grantFor(),
    });
    expect(outcome).toEqual({ kind: 'settled', runId: sent()[0]?.runId, proposal: null });
    expect(state.retryRequest?.options.targetFilePath).toBe(TARGET);
    expect(state.retryRequest?.options.writeBatchGrant).toBeUndefined();
  });

  it('别的路径一律送作者存的档位：没带授权、目标不在计划里、不是写章、授权已撤销', async () => {
    const grant = grantFor();
    await dispatch('chapter.write', { targetFilePath: TARGET });
    await dispatch('chapter.write', { targetFilePath: '正文/第009章.md', writeBatchGrant: grant });
    await dispatch(undefined, { targetFilePath: TARGET, writeBatchGrant: grant });
    revokeWriteBatchGrant(grant);
    await dispatch('chapter.write', { targetFilePath: TARGET, writeBatchGrant: grant });
    expect(sent().map((request) => request.permissionProfile)).toEqual([
      'ask',
      'ask',
      'ask',
      'ask',
    ]);
  });

  it('作者存的是只读：带着授权也送只读', async () => {
    await act(async () => root.render(<Body stored="read" />));
    await dispatch('chapter.write', { targetFilePath: TARGET, writeBatchGrant: grantFor() });
    expect(sent()[0]?.permissionProfile).toBe('read');
  });
});
