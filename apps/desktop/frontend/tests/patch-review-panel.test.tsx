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
  assert.match(html, /data-testid="patch-review"[^>]*role="region"/);
  assert.match(html, /aria-label="待确认补丁：AI 修订"/);
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
  assert.match(html, /data-testid="patch-diff"[^>]*role="region"/);
  assert.match(html, /aria-label="补丁差异"/);
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
  assert.equal(
    byTestId('suggestion-reject')?.getAttribute('aria-controls'),
    byTestId('patch-reject-form')?.getAttribute('id'),
  );
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
  assert.equal(byTestId('patch-diff')?.style.height, '420px');
  assert.equal(byTestId('suggestion-reject')?.getAttribute('aria-expanded'), 'false');
  click('suggestion-reject');
  assert.equal(byTestId('suggestion-reject')?.getAttribute('aria-expanded'), 'true');
  assert.equal(byTestId('patch-reject-input')?.getAttribute('aria-label'), '修改方向（可选）');
  press('patch-reject-input', 'Escape');
  assert.equal(byTestId('suggestion-reject')?.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(rejected, []);
});

test('同一面板切换补丁时不会保留上一个拒绝草稿', () => {
  mountPanel();
  click('suggestion-reject');
  assert.ok(byTestId('patch-reject-form'));
  act(() => {
    root.render(
      <PatchReviewPanel
        suggestion={sampleSuggestion({ id: 'patch-43' })}
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
  assert.equal(byTestId('patch-reject-form'), null);
  assert.equal(byTestId('suggestion-reject')?.getAttribute('aria-controls'), null);
  assert.equal(byTestId('patch-expand')?.getAttribute('aria-controls') !== null, true);
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

test('拒绝提交后把焦点退回拒绝按钮，避免输入框卸载后焦点丢失', async () => {
  mountPanel();
  click('suggestion-reject');
  type('patch-reject-input', '换个开头');
  click('patch-reject-confirm');

  await act(async () => {
    await Promise.resolve();
  });
  assert.equal(document.activeElement, byTestId('suggestion-reject'));
});

test('异步补丁操作进行中锁定面板，重复点击只执行一次', async () => {
  let calls = 0;
  let resolveAccept!: () => void;
  const accept = () => {
    calls += 1;
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

  const acceptButton = byTestId('suggestion-accept');
  assert.ok(acceptButton);
  act(() => {
    acceptButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Simulate a second event before an async writeback settles.
    acceptButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  assert.equal(calls, 1);
  assert.equal(acceptButton.getAttribute('disabled'), '');
  assert.equal(byTestId('patch-review')?.getAttribute('aria-busy'), 'true');
  assert.equal(byTestId('patch-action-status')?.textContent, '正在写回…');

  await act(async () => {
    resolveAccept();
  });
  assert.equal(acceptButton.getAttribute('disabled'), null);
  assert.equal(byTestId('patch-review')?.getAttribute('aria-busy'), 'false');
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

for (const sameTick of [false, true]) {
  test(`保存旁注期间 Enter 不得清除未提交的拒绝方向：同帧=${sameTick}`, async () => {
    let finish!: () => void;
    act(() =>
      root.render(
        <PatchReviewPanel
          suggestion={sampleSuggestion()}
          editorFontSize={14}
          editorFontFamily="test-font"
          onAccept={() => undefined}
          onAcceptHunk={() => undefined}
          onReject={(direction) => {
            rejected.push(direction);
          }}
          onSaveNote={() =>
            new Promise<void>((resolve) => {
              finish = resolve;
            })
          }
          onRetryWithoutKnowledge={() => undefined}
        />,
      ),
    );
    click('suggestion-reject');
    type('patch-reject-input', '保留作者刚写的修改方向');
    const input = byTestId('patch-reject-input') as HTMLInputElement;
    const note = byTestId('suggestion-note') as HTMLButtonElement;
    const enter = () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    input.focus();
    if (sameTick)
      act(() => {
        note.click();
        enter();
      });
    else {
      click('suggestion-note');
      press('patch-reject-input', 'Enter');
    }
    assert.equal(byTestId('patch-reject-input') === input, true);
    assert.equal(input.value, '保留作者刚写的修改方向');
    assert.equal(document.activeElement === input, true);
    assert.deepEqual(rejected, []);
    await act(async () => {
      finish();
    });
    await act(async () => {
      enter();
    });
    assert.deepEqual(rejected, ['保留作者刚写的修改方向']);
  });
}

for (const replace of [true, false]) {
  test(`补丁替换后明确忙碌来源但不放开并发操作：替换=${replace}`, async () => {
    const finishes: Array<() => void> = [];
    const render = (id: string) =>
      act(() =>
        root.render(
          <PatchReviewPanel
            suggestion={sampleSuggestion({ id })}
            editorFontSize={14}
            editorFontFamily="test-font"
            onAccept={() => undefined}
            onAcceptHunk={() => undefined}
            onReject={() => undefined}
            onSaveNote={() => new Promise<void>((resolve) => finishes.push(resolve))}
            onRetryWithoutKnowledge={() => undefined}
          />,
        ),
      );
    render('patch-A');
    click('suggestion-note');
    render(replace ? 'patch-B' : 'patch-A');
    const note = byTestId('suggestion-note') as HTMLButtonElement;
    assert.equal(note.disabled, true);
    assert.equal(
      byTestId('patch-action-status')?.textContent,
      replace ? '正在完成上一份修订的操作…' : '正在保存旁注…',
    );
    note.click();
    assert.equal(finishes.length, 1, '新补丁不能绕过旧操作互斥锁');
    await act(async () => {
      finishes[0]();
    });
    assert.equal(note.disabled, false);
    assert.equal(byTestId('patch-action-status') === null, true);
    click('suggestion-note');
    assert.equal(finishes.length, 2);
    assert.equal(byTestId('patch-action-status')?.textContent, '正在保存旁注…');
    await act(async () => {
      finishes[1]();
    });
  });
}
