import { describe, expect, it } from 'vitest';
import { ChatMessage, chatResponse, ToolCall, ToolSpec } from '../llm/contracts';
import { ToolCallingRuntime } from './sdkLoop';
import { DefaultRuntimePolicy, InMemoryCheckpointStore } from './sdkPorts';
import { runtimeLimits, RuntimeState, type RuntimeCheckpoint } from './sdkState';
import { runtimeArtifact, RuntimeToolResult, runtimeTool, ToolRegistry } from './sdkTools';

type Seen = { policyPath: unknown; executedPath: unknown; handlerArgs: unknown };

/** 模型先要 inspect({path: safe.md})，再收尾；工具产出一个带嵌套 payload 的 artifact。 */
function scripted(
  seen: Seen,
  interruption: (boundary: string, checkpoint: RuntimeCheckpoint) => void,
  checkpoints = new InMemoryCheckpointStore(),
) {
  let count = 0;
  const tool = runtimeTool(
    new ToolSpec('inspect', 'synthetic', {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    }),
    (_context, args) => {
      seen.executedPath = args.path;
      // 处理器拿到的是可写副本：改它不影响 pending，也不抛错。
      args.path = 'handler-local.md';
      seen.handlerArgs = args;
      return RuntimeToolResult.success({ ok: true }, [
        runtimeArtifact('note', { nested: { list: [1, 2] } }),
      ]);
    },
  );
  const policy = new DefaultRuntimePolicy();
  policy.decideTool = (_tool, call) => {
    seen.policyPath = call.arguments.path;
    return { kind: 'allow', reason: null };
  };
  return new ToolCallingRuntime(
    {
      complete: async () =>
        ++count === 1
          ? chatResponse({
              content: '',
              toolCalls: [new ToolCall('c1', 'inspect', '{"path":"safe.md"}')],
              continuation: { provider: 'anthropic', state: { thinking_blocks: [{ text: 't' }] } },
            })
          : chatResponse({ content: 'ok' }),
    },
    new ToolRegistry([tool]),
    {
      policy,
      checkpoints,
      interruption: (_run, boundary, checkpoint) => {
        interruption(boundary, checkpoint);
        return null;
      },
    },
  );
}

const run = (runtime: ToolCallingRuntime) =>
  runtime.run([new ChatMessage('user', 'synthetic', [], null, null, { trace: { id: 'm1' } })], {
    model: 'scripted',
    runId: 'owned',
    limits: runtimeLimits(),
  });

// 只认冻结造成的 TypeError；写到不存在的路径上（undefined.x）不算拒绝。
const rejects = (mutate: () => void) => {
  try {
    mutate();
  } catch (error) {
    return error instanceof TypeError && /read only|not extensible/.test(error.message);
  }
  return false;
};

describe('检查点与活动状态隔离（验收 F3）', () => {
  it('钩子改不动 pending 参数：策略与处理器看到同一个 path', async () => {
    const seen: Seen = { policyPath: null, executedPath: null, handlerArgs: null };
    const attempts: [string, boolean[]][] = [];
    const runtime = scripted(seen, (boundary, checkpoint) => {
      if (boundary !== 'before_tool_attempt' && boundary !== 'before_tool_dispatch') return;
      if (checkpoint.pending === null) return;
      const shell = checkpoint.pending as unknown as Record<string, unknown>;
      attempts.push([
        boundary,
        [
          rejects(() => {
            checkpoint.pending!.arguments.path = 'changed-after-policy.md';
          }),
          rejects(() => (shell.arguments = { path: 'swapped.md' })),
          rejects(() => (shell.attempt = 99)),
        ],
      ]);
    });
    const result = await run(runtime);
    expect(result.status).toBe('completed');
    // dispatch 前的 pending 是重试计数加一后的新外壳，同样冻结。
    expect(attempts.map(([boundary]) => boundary)).toContain('before_tool_dispatch');
    for (const [, outcomes] of attempts) expect(outcomes).toEqual([true, true, true]);
    expect([seen.policyPath, seen.executedPath]).toEqual(['safe.md', 'safe.md']);
    expect(seen.handlerArgs).toEqual({ path: 'handler-local.md' });
  });

  it('快照里的每一层都改不动：字段、消息、metadata、续接状态、产出物、id 列表', async () => {
    const seen: Seen = { policyPath: null, executedPath: null, handlerArgs: null };
    const results: Record<string, boolean> = {};
    const runtime = scripted(seen, (boundary, checkpoint) => {
      if (boundary !== 'after_tool') return;
      const assistant = checkpoint.messages.find((message) => message.toolCalls.length)!;
      const writable = checkpoint as unknown as Record<string, unknown>;
      const attempts: Record<string, () => void> = {
        phase: () => (writable.phase = 'completed'),
        messages: () => (checkpoint.messages as ChatMessage[]).push(new ChatMessage('user', 'x')),
        content: () => ((assistant as unknown as Record<string, unknown>).content = 'x'),
        toolCall: () => ((assistant.toolCalls[0] as unknown as Record<string, unknown>).name = 'x'),
        toolCalls: () => (assistant.toolCalls as ToolCall[]).push(new ToolCall('x', 'x', '{}')),
        metadata: () =>
          ((checkpoint.messages[0].metadata.trace as Record<string, unknown>).id = 'x'),
        continuation: () =>
          ((assistant.continuation!.state.thinking_blocks as Record<string, unknown>[])[0].text =
            'x'),
        artifact: () =>
          ((checkpoint.artifacts[0].payload.nested as Record<string, unknown[]>).list[0] = 9),
        artifactKind: () =>
          ((checkpoint.artifacts[0] as unknown as Record<string, unknown>).kind = 'x'),
        artifacts: () => (checkpoint.artifacts as unknown[]).push(checkpoint.artifacts[0]),
        ids: () => (checkpoint.completedToolCallIds as string[]).push('x'),
      };
      for (const [name, attempt] of Object.entries(attempts)) results[name] = rejects(attempt);
    });
    expect((await run(runtime)).status).toBe('completed');
    expect(results).toEqual({
      phase: true,
      messages: true,
      content: true,
      toolCall: true,
      toolCalls: true,
      metadata: true,
      continuation: true,
      artifact: true,
      artifactKind: true,
      artifacts: true,
      ids: true,
    });
  });

  it('存储里留的快照不随运行继续而变，恢复出的状态可继续追加', async () => {
    const seen: Seen = { policyPath: null, executedPath: null, handlerArgs: null };
    const kept: RuntimeCheckpoint[] = [];
    const runtime = scripted(seen, (boundary, checkpoint) => {
      if (boundary === 'before_tool_attempt') kept.push(checkpoint);
    });
    await run(runtime);
    const [snapshot] = kept;
    expect(snapshot.pending!.arguments).toEqual({ path: 'safe.md' });
    expect(snapshot.completedToolCallIds).toEqual([]);
    const state = RuntimeState.fromCheckpoint(snapshot);
    state.messages.push(new ChatMessage('user', '继续'));
    state.completedToolCallIds.push('c1');
    expect(snapshot.messages.length).toBe(state.messages.length - 1);
    expect(snapshot.completedToolCallIds).toEqual([]);
    expect(
      rejects(() => {
        state.pending!.arguments.path = 'x';
      }),
    ).toBe(true);
  });
});
