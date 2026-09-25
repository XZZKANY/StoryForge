import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';

import { MessageList } from '../src/components/chat-window/panels';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * P1-1 回归测试：消息列表稳定 key + memo。
 * 背景：此前 key={index}，任何 setAgentRun step 事件触发父组件 re-render 时，
 * 整个消息列表都会 reconcile，每条 assistant 消息的 react-markdown 全量重解析。
 * 修复后：相同消息的组件实例被保留，markdown 不重渲染。
 */
test('消息列表在追加消息后，已有消息的 DOM 节点被保留（稳定 key + memo）', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  const baseMessages = [
    { role: 'user' as const, content: '你好，请看看第 3 章' },
    { role: 'assistant' as const, content: '# 评审结果\n\n第 3 章节奏偏慢，建议压缩对话。' },
    { role: 'user' as const, content: '帮我润色一下' },
  ];

  await act(async () => {
    root.render(
      <MessageList
        messages={baseMessages}
        conversationScope={0}
        agentRun={null}
        agentRunRecovery={null}
        writingRunProjection={null}
      />,
    );
  });

  const initialAssistantNodes = host.querySelectorAll('[data-testid="assistant-message"]');
  const initialUserNodes = host.querySelectorAll('[data-testid="user-message"]');
  assert.equal(initialAssistantNodes.length, 1);
  assert.equal(initialUserNodes.length, 2);

  // 记录初始 DOM 节点引用，用于后续 identity 比对
  const firstUserNode = initialUserNodes[0];
  const assistantNode = initialAssistantNodes[0];
  const secondUserNode = initialUserNodes[1];

  // 模拟 Agent step 事件后的追加：新增一条 assistant 回复
  const withNewMessage = [
    ...baseMessages,
    { role: 'assistant' as const, content: '已生成修订建议，请查看 diff。' },
  ];

  await act(async () => {
    root.render(
      <MessageList
        messages={withNewMessage}
        conversationScope={0}
        agentRun={null}
        agentRunRecovery={null}
        writingRunProjection={null}
      />,
    );
  });

  const afterAssistantNodes = host.querySelectorAll('[data-testid="assistant-message"]');
  const afterUserNodes = host.querySelectorAll('[data-testid="user-message"]');
  assert.equal(afterAssistantNodes.length, 2);
  assert.equal(afterUserNodes.length, 2);

  // 关键断言：已有消息的 DOM 节点 identity 不变（未被 React 重挂载）
  assert.strictEqual(
    afterUserNodes[0],
    firstUserNode,
    '第一条用户消息的 DOM 节点应被保留（key 稳定）',
  );
  assert.strictEqual(
    afterAssistantNodes[0],
    assistantNode,
    'assistant 消息的 DOM 节点应被保留（memo 生效）',
  );
  assert.strictEqual(
    afterUserNodes[1],
    secondUserNode,
    '第二条用户消息的 DOM 节点应被保留（key 稳定）',
  );

  // 再次渲染相同消息列表（模拟 step 事件但消息不变），所有节点应保持
  await act(async () => {
    root.render(
      <MessageList
        messages={withNewMessage}
        conversationScope={0}
        agentRun={null}
        agentRunRecovery={null}
        writingRunProjection={null}
      />,
    );
  });

  const finalAssistantNodes = host.querySelectorAll('[data-testid="assistant-message"]');
  assert.equal(finalAssistantNodes.length, 2);
  assert.strictEqual(finalAssistantNodes[0], assistantNode, '消息不变时节点应完全保持');
  assert.strictEqual(
    finalAssistantNodes[1],
    afterAssistantNodes[1],
    '新追加消息的节点在后续渲染中也应稳定',
  );

  await act(async () => {
    root.unmount();
  });
  host.remove();
});

test('消息 key 对内容相同但 role 不同的消息产生不同 key', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  const messages = [
    { role: 'user' as const, content: '同一个内容' },
    { role: 'assistant' as const, content: '同一个内容' },
  ];

  await act(async () => {
    root.render(
      <MessageList
        messages={messages}
        conversationScope={0}
        agentRun={null}
        agentRunRecovery={null}
        writingRunProjection={null}
      />,
    );
  });

  // 两条消息内容相同但 role 不同，应渲染为两个独立节点且都稳定
  const userNodes = host.querySelectorAll('[data-testid="user-message"]');
  const assistantNodes = host.querySelectorAll('[data-testid="assistant-message"]');
  assert.equal(userNodes.length, 1);
  assert.equal(assistantNodes.length, 1);

  await act(async () => {
    root.render(
      <MessageList
        messages={[...messages]}
        conversationScope={0}
        agentRun={null}
        agentRunRecovery={null}
        writingRunProjection={null}
      />,
    );
  });

  assert.strictEqual(
    host.querySelectorAll('[data-testid="user-message"]')[0],
    userNodes[0],
    'user 节点应保留',
  );
  assert.strictEqual(
    host.querySelectorAll('[data-testid="assistant-message"]')[0],
    assistantNodes[0],
    'assistant 节点应保留',
  );

  await act(async () => {
    root.unmount();
  });
  host.remove();
});
