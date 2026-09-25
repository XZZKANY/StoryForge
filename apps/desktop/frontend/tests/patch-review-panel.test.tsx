import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, test } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { buildPatchReviewTraceTitle, PatchReviewPanel } from '../src/components/PatchReviewPanel';
import type { AssistantFileSuggestion } from '../src/lib/assistant-suggestions';

function sampleSuggestion(
  overrides: Partial<AssistantFileSuggestion> = {},
): AssistantFileSuggestion {
  return {
    id: 'patch-42',
    filePath: '正文/第01章.md',
    title: 'AI 修订',
    summary: '收紧开篇节奏',
    before: '第一行\n第二行\n',
    after: '第一行改\n第二行\n第三行\n',
    note: '旁注',
    createdAt: 1,
    model: 'deepseek-v4',
    assistantSessionId: 7,
    issueIds: ['iss-1', 'iss-2'],
    scopeWarning: '修订范围偏大',
    ...overrides,
  };
}

test('buildPatchReviewTraceTitle packs engineering fields', () => {
  const title = buildPatchReviewTraceTitle(sampleSuggestion());
  assert.match(title, /补丁 patch-42/);
  assert.match(title, /会话 7/);
  assert.match(title, /deepseek-v4/);
  assert.match(title, /iss-1/);
  assert.match(title, /iss-2/);
});

test('patch panel main text is author-facing without Patch/Session labels', () => {
  const suggestion = sampleSuggestion();
  const html = renderToStaticMarkup(
    <PatchReviewPanel
      suggestion={suggestion}
      editorFontSize={14}
      editorFontFamily="test-font"
      onAccept={() => undefined}
      onAcceptHunk={() => undefined}
      onReject={() => undefined}
      onSaveNote={() => undefined}
      onRetryWithoutKnowledge={() => undefined}
    />,
  );

  assert.match(html, /data-testid="patch-review"/);
  assert.match(html, /AI 修订/);
  assert.match(html, /收紧开篇节奏/);
  assert.match(html, /正文\/第01章\.md/);
  assert.match(html, /data-testid="patch-stats"/);
  assert.match(html, /\+\d+ \/ -\d+/);
  assert.match(html, /修订范围偏大/);

  assert.doesNotMatch(html, />Patch patch-42</);
  assert.doesNotMatch(html, />Session 7</);
  assert.doesNotMatch(html, /Patch patch-42/);
  assert.doesNotMatch(html, /Session 7/);

  // model / issueIds 不作为主行可见元数据
  assert.doesNotMatch(html, /data-testid="patch-meta"[^>]*>[\s\S]*deepseek-v4/);
  assert.doesNotMatch(html, /data-testid="patch-meta"[^>]*>[\s\S]*iss-1/);

  assert.match(html, /data-testid="patch-trace"/);
  assert.match(html, /title="补丁 patch-42 · 会话 7 · deepseek-v4 · iss-1, iss-2"/);

  assert.match(html, /data-testid="suggestion-accept"/);
  assert.match(html, /保存旁注/);
  assert.match(html, /拒绝/);
});

test('multi-hunk accept buttons carry a line-number label, not opaque 块 N', () => {
  const suggestion = sampleSuggestion({
    before: '甲\n乙\n丙\n丁\n戊\n',
    after: '甲改\n乙\n丙\n丁改\n戊\n',
  });
  const html = renderToStaticMarkup(
    <PatchReviewPanel
      suggestion={suggestion}
      editorFontSize={14}
      editorFontFamily="test-font"
      onAccept={() => undefined}
      onAcceptHunk={() => undefined}
      onReject={() => undefined}
      onSaveNote={() => undefined}
      onRetryWithoutKnowledge={() => undefined}
    />,
  );
  assert.match(html, /data-testid="suggestion-accept-hunk"/);
  assert.match(html, /第 \d+ 处 · 第 \d+ 行/);
  assert.doesNotMatch(html, /接受块/);
});

test('trace title omits missing optional fields', () => {
  const title = buildPatchReviewTraceTitle(
    sampleSuggestion({
      model: undefined,
      assistantSessionId: null,
      issueIds: [],
    }),
  );
  assert.equal(title, '补丁 patch-42');
});

/**
 * 拒绝的交互形状：点一下不再是「这版就没了」，而是先问一句「该怎么改」。
 *
 * 静态渲染断言不到这一层——上面那条 `assert.match(html, /拒绝/)` 在改动前后都绿。
 */
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const rejected: string[] = [];

function mountPanel(overrides: Partial<AssistantFileSuggestion> = {}) {
  act(() => {
    root.render(
      <PatchReviewPanel
        suggestion={sampleSuggestion(overrides)}
        editorFontSize={14}
        editorFontFamily="test-font"
        onAccept={() => undefined}
        onAcceptHunk={() => undefined}
        onReject={(direction) => rejected.push(direction)}
        onSaveNote={() => undefined}
        onRetryWithoutKnowledge={() => undefined}
      />,
    );
  });
}

function byTestId(id: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${id}"]`);
}

function click(id: string): void {
  const element = byTestId(id);
  assert.ok(element, `找不到 ${id}`);
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function type(id: string, value: string): void {
  const input = byTestId(id) as HTMLInputElement | null;
  assert.ok(input, `找不到 ${id}`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function press(id: string, key: string): void {
  const element = byTestId(id);
  assert.ok(element, `找不到 ${id}`);
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

beforeEach(() => {
  rejected.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

test('点「拒绝」不立即否掉，先问该怎么改', () => {
  mountPanel();
  assert.equal(byTestId('patch-reject-form'), null, '还没点就冒出输入框');

  click('suggestion-reject');

  assert.ok(byTestId('patch-reject-input'), '点了拒绝却没有「该怎么改」的入口');
  assert.deepEqual(rejected, [], '点一下就把补丁否掉了——作者还没说话');
});

test('补丁操作有分组，展开和拒绝状态可读，拒绝输入具有独立名称', () => {
  mountPanel();
  const group = container.querySelector('[role="group"][aria-label="补丁操作"]');
  assert.ok(group);
  assert.equal(group.querySelectorAll('button').length, 4);
  assert.equal(byTestId('patch-expand')?.getAttribute('aria-expanded'), 'false');
  click('patch-expand');
  assert.equal(byTestId('patch-expand')?.getAttribute('aria-expanded'), 'true');
  assert.equal(byTestId('patch-review')?.getAttribute('data-review-expanded'), 'true');
  assert.equal(byTestId('patch-expand')?.textContent, '退出审阅');
  press('patch-expand', 'Escape');
  assert.equal(byTestId('patch-review')?.getAttribute('data-review-expanded'), 'false');
  assert.equal(byTestId('suggestion-reject')?.getAttribute('aria-expanded'), 'false');
  click('suggestion-reject');
  assert.equal(byTestId('suggestion-reject')?.getAttribute('aria-expanded'), 'true');
  assert.equal(byTestId('patch-reject-input')?.getAttribute('aria-label'), '修改方向（可选）');
  press('patch-reject-input', 'Escape');
  assert.equal(byTestId('suggestion-reject')?.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(rejected, []);
});

test('写下方向后确认，原话原样交出去', () => {
  mountPanel();
  click('suggestion-reject');
  type('patch-reject-input', '这段独白太满，删到两句');
  click('patch-reject-confirm');

  assert.deepEqual(rejected, ['这段独白太满，删到两句']);
});

test('回车即发出，并把输入框收起', () => {
  mountPanel();
  click('suggestion-reject');
  type('patch-reject-input', '换个开头');
  press('patch-reject-input', 'Enter');

  assert.deepEqual(rejected, ['换个开头']);
  assert.equal(byTestId('patch-reject-form'), null, '发出后草稿还留在面板上');
});

test('Esc 收起输入框且不否掉', () => {
  mountPanel();
  click('suggestion-reject');
  press('patch-reject-input', 'Escape');

  assert.equal(byTestId('patch-reject-form'), null, 'Esc 没收起输入框');
  assert.deepEqual(rejected, [], 'Esc 不该否掉补丁');
});

test('补丁快捷键只在当前可见操作区生效，文本目标与 IME 不触发', () => {
  let accepts = 0;
  act(() => {
    root.render(
      <PatchReviewPanel
        suggestion={sampleSuggestion()}
        editorFontSize={14}
        editorFontFamily="test-font"
        onAccept={() => {
          accepts += 1;
        }}
        onAcceptHunk={() => undefined}
        onReject={() => undefined}
        onSaveNote={() => undefined}
        onRetryWithoutKnowledge={() => undefined}
      />,
    );
  });

  const operation = byTestId('suggestion-accept');
  assert.ok(operation);
  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);
  try {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }));
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }),
      );
      operation.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }),
      );
    });
    assert.equal(accepts, 1, '只有操作区焦点应触发 Ctrl+Y');

    act(() => {
      operation.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'y',
          ctrlKey: true,
          isComposing: true,
          bubbles: true,
        }),
      );
    });
    assert.equal(accepts, 1, 'IME 组合态不应触发 Ctrl+Y');
  } finally {
    textarea.remove();
  }
});

test('接受动作 in-flight 时双击只执行一次并显示进行中状态，完成后可再次操作', async () => {
  let accepts = 0;
  let resolveAccept!: () => void;
  const accept = () => {
    accepts += 1;
    return new Promise<void>((resolve) => {
      resolveAccept = resolve;
    });
  };
  act(() => {
    root.render(
      <PatchReviewPanel
        suggestion={sampleSuggestion()}
        editorFontSize={14}
        editorFontFamily="test-font"
        onAccept={accept}
        onAcceptHunk={() => undefined}
        onReject={() => undefined}
        onSaveNote={() => undefined}
        onRetryWithoutKnowledge={() => undefined}
      />,
    );
  });

  click('suggestion-accept');
  click('suggestion-accept');
  assert.equal(accepts, 1, 'in-flight 时重复点击不得再次调用接受回调');
  assert.equal((byTestId('suggestion-accept') as HTMLButtonElement).disabled, true);
  assert.match(byTestId('patch-action-status')?.textContent ?? '', /处理中/);

  await act(async () => {
    resolveAccept();
  });
  assert.equal((byTestId('suggestion-accept') as HTMLButtonElement).disabled, false);
  assert.equal(byTestId('patch-action-status'), null);
});

test('动作失败保留补丁并恢复重试入口', async () => {
  let rejectAccept!: (error: Error) => void;
  act(() => {
    root.render(
      <PatchReviewPanel
        suggestion={sampleSuggestion()}
        editorFontSize={14}
        editorFontFamily="test-font"
        onAccept={() =>
          new Promise<void>((_resolve, reject) => {
            rejectAccept = reject;
          })
        }
        onAcceptHunk={() => undefined}
        onReject={() => undefined}
        onSaveNote={() => undefined}
        onRetryWithoutKnowledge={() => undefined}
      />,
    );
  });

  click('suggestion-accept');
  await act(async () => {
    rejectAccept(new Error('写回失败'));
  });
  assert.ok(byTestId('patch-review'), '失败后补丁面板必须保留');
  assert.match(byTestId('patch-action-status')?.textContent ?? '', /写回失败/);
  assert.equal((byTestId('suggestion-accept') as HTMLButtonElement).disabled, false);
});

test('确认键的字面随有没有话说而变', () => {
  mountPanel();
  click('suggestion-reject');
  assert.equal(byTestId('patch-reject-confirm')?.textContent, '否掉');

  type('patch-reject-input', '再写一版');
  assert.equal(byTestId('patch-reject-confirm')?.textContent, '否掉并重来');
});

test('留空直接确认也走得通——拒绝不该变得昂贵', () => {
  mountPanel();
  click('suggestion-reject');
  click('patch-reject-confirm');

  assert.deepEqual(rejected, ['']);
});

test('展示后端实际使用的知识，并允许按条目移除后重试', () => {
  const retried: Array<[string, string]> = [];
  act(() => {
    root.render(
      <PatchReviewPanel
        suggestion={sampleSuggestion({
          knowledgeEntries: [
            {
              knowledgeId: 'pk_550e8400-e29b-41d4-a716-446655440001',
              relativePath: '设定/天枢.md',
              selectionSource: 'auto_retrieved',
              evidenceState: 'stale',
              warningCount: 1,
              snapshotId: 'llmctx-knowledge',
            },
          ],
        })}
        editorFontSize={14}
        editorFontFamily="test-font"
        onAccept={() => undefined}
        onAcceptHunk={() => undefined}
        onReject={() => undefined}
        onSaveNote={() => undefined}
        onRetryWithoutKnowledge={(id, path) => retried.push([id, path])}
      />,
    );
  });

  assert.match(byTestId('patch-knowledge-context')?.textContent ?? '', /设定\/天枢\.md/);
  assert.match(byTestId('patch-knowledge-context')?.textContent ?? '', /来源待复核/);
  click('patch-knowledge-retry');
  assert.deepEqual(retried, [['pk_550e8400-e29b-41d4-a716-446655440001', '设定/天枢.md']]);
});

test('隐藏及 inert 的补丁操作区不消费接受快捷键', () => {
  let accepts = 0;
  act(() =>
    root.render(
      <PatchReviewPanel
        suggestion={sampleSuggestion()}
        editorFontSize={14}
        editorFontFamily="test"
        onAccept={() => {
          accepts += 1;
        }}
        onAcceptHunk={() => {}}
        onReject={() => {}}
        onSaveNote={() => {}}
        onRetryWithoutKnowledge={() => {}}
      />,
    ),
  );
  for (const attribute of ['hidden', 'inert', 'aria-hidden']) {
    container.setAttribute(attribute, 'true');
    const event = new KeyboardEvent('keydown', {
      key: 'y',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => byTestId('suggestion-accept')!.dispatchEvent(event));
    assert.equal(event.defaultPrevented, false);
    assert.equal(accepts, 0);
    container.removeAttribute(attribute);
  }
});

test('旧补丁操作失败不会把错误投递到同 ID 的新补丁', async () => {
  let fail!: (error: Error) => void;
  const common = {
    editorFontSize: 14,
    editorFontFamily: 'test',
    onAcceptHunk: () => {},
    onReject: () => {},
    onSaveNote: () => {},
    onRetryWithoutKnowledge: () => {},
  };
  act(() =>
    root.render(
      <PatchReviewPanel
        {...common}
        suggestion={sampleSuggestion()}
        onAccept={() =>
          new Promise<void>((_resolve, reject) => {
            fail = reject;
          })
        }
      />,
    ),
  );
  click('suggestion-accept');
  act(() =>
    root.render(
      <PatchReviewPanel
        {...common}
        suggestion={sampleSuggestion({ after: '新版正文' })}
        onAccept={() => {}}
      />,
    ),
  );
  await act(async () => fail(new Error('旧请求失败')));
  assert.equal(byTestId('patch-action-status'), null);
  assert.equal((byTestId('suggestion-accept') as HTMLButtonElement).disabled, false);
});

test('拒绝输入的 IME Enter 和 Escape 都保留草稿且不提交', () => {
  mountPanel();
  click('suggestion-reject');
  type('patch-reject-input', '输入法选字');
  for (const key of ['Enter', 'Escape']) {
    act(() =>
      byTestId('patch-reject-input')!.dispatchEvent(
        new KeyboardEvent('keydown', { key, isComposing: true, bubbles: true }),
      ),
    );
    assert.deepEqual(rejected, []);
    assert.equal((byTestId('patch-reject-input') as HTMLInputElement).value, '输入法选字');
  }
});

test('外部接受/旁注/分块/重试锁同样保护拒绝表单，不清方向草稿', () => {
  const suggestion = sampleSuggestion();
  const render = (actionKind: 'accept' | 'hunk' | 'note' | 'retry' | null) =>
    act(() =>
      root.render(
        <PatchReviewPanel
          suggestion={suggestion}
          actionKind={actionKind}
          editorFontSize={14}
          editorFontFamily="test"
          onAccept={() => {}}
          onAcceptHunk={() => {}}
          onReject={(direction) => {
            rejected.push(direction);
          }}
          onSaveNote={() => {}}
          onRetryWithoutKnowledge={() => {}}
        />,
      ),
    );
  render(null);
  click('suggestion-reject');
  type('patch-reject-input', '保留我的方向');
  for (const kind of ['accept', 'hunk', 'note', 'retry'] as const) {
    render(kind);
    press('patch-reject-input', 'Enter');
    assert.deepEqual(rejected, []);
    assert.equal((byTestId('patch-reject-input') as HTMLInputElement).value, '保留我的方向');
  }
  render(null);
  press('patch-reject-input', 'Enter');
  assert.deepEqual(rejected, ['保留我的方向']);
});

test('异步拒绝失败保留方向和补丁，作者可以修正后重试', async () => {
  let fail!: (error: Error) => void;
  act(() =>
    root.render(
      <PatchReviewPanel
        suggestion={sampleSuggestion()}
        editorFontSize={14}
        editorFontFamily="test"
        onAccept={() => {}}
        onAcceptHunk={() => {}}
        onReject={() =>
          new Promise<void>((_resolve, reject) => {
            fail = reject;
          })
        }
        onSaveNote={() => {}}
        onRetryWithoutKnowledge={() => {}}
      />,
    ),
  );
  click('suggestion-reject');
  type('patch-reject-input', '更克制');
  click('patch-reject-confirm');
  await act(async () => fail(new Error('控制请求失败')));
  assert.equal((byTestId('patch-reject-input') as HTMLInputElement).value, '更克制');
  assert.ok(byTestId('patch-review'));
  assert.match(byTestId('patch-action-status')?.textContent ?? '', /控制请求失败/);
});
