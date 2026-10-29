import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, test } from 'vitest';
import { __getLastDiffEditor } from 'monaco-editor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { buildPatchReviewTraceTitle, PatchReviewPanel } from '../src/components/PatchReviewPanel';
import type { AssistantFileSuggestion } from '../src/lib/assistant-suggestions';
import { buildPatchHunks, type PatchHunk } from '../src/lib/patch-hunks';

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

// 逐处接受挪进对比区每处改动下方（作者试用 #3/#11）：横幅上不再有那一行小键。
// 带「第 N 处 · 第 M 行」的按钮现在挂在 view zone 里、挂载后才有，断言见文末的挂载用例。
test('横幅里不再挤一排逐处接受的小键', () => {
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
  assert.doesNotMatch(html, /data-testid="suggestion-accept-hunk"/);
  assert.doesNotMatch(html, /逐处接受/);
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
  // 补丁一来审阅就占满编辑区；Esc 或「收起对比」收成一条操作栏，再点「查看对比」展开。
  assert.equal(byTestId('patch-expand')?.getAttribute('aria-expanded'), 'true');
  assert.equal(byTestId('patch-review')?.getAttribute('data-review-expanded'), 'true');
  assert.equal(byTestId('patch-expand')?.textContent, '收起对比');
  press('patch-expand', 'Escape');
  assert.equal(byTestId('patch-review')?.getAttribute('data-review-expanded'), 'false');
  assert.equal(byTestId('patch-expand')?.textContent, '查看对比');
  click('patch-expand');
  assert.equal(byTestId('patch-review')?.getAttribute('data-review-expanded'), 'true');
  click('patch-expand');
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

test('U-24：定位类拒写每次结果都一样，不再提示可重试，指给作者重出一版或逐处接受', () => {
  const render = (error: string) =>
    act(() => {
      root.render(
        <PatchReviewPanel
          suggestion={sampleSuggestion()}
          editorFontSize={14}
          editorFontFamily="test-font"
          onAccept={() => undefined}
          onAcceptHunk={() => undefined}
          onReject={() => undefined}
          onSaveNote={() => undefined}
          onRetryWithoutKnowledge={() => undefined}
          error={error}
        />,
      );
    });
  const status = () => byTestId('patch-action-status')?.textContent ?? '';

  render('接受失败: 第 2 处修改（原稿第 9 行附近）是插入，插入点前文已变，无法安全定位。');
  assert.equal(
    status(),
    '操作失败：接受失败: 第 2 处修改（原稿第 9 行附近）是插入，插入点前文已变，无法安全定位。可以让 AI 重出一版，或逐处接受。',
  );
  render('接受失败: 第 1 处修改（原稿第 3 行附近）在当前文件里无法唯一确定位置');
  assert.match(status(), /无法唯一确定位置。可以让 AI 重出一版，或逐处接受。$/);
  assert.doesNotMatch(status(), /可重试/);

  // 已经是逐处接受失败：不再把作者指回逐处接受。
  render('接受分块失败: 这个修改块在原文中的位置已被改动，无法安全定位；已拒绝接受。');
  assert.match(status(), /已拒绝接受。可以让 AI 重出一版。$/);

  // 对照：写盘失败这类偶发错误仍提示可重试。
  render('接受失败: 写回失败');
  assert.equal(status(), '操作失败：接受失败: 写回失败，可重试');
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

test('审阅栏的说明是纯文本：模型回复里的 **加粗** 不露星号', () => {
  const html = renderToStaticMarkup(
    <PatchReviewPanel
      suggestion={sampleSuggestion({
        summary: '改好了：结尾换成了**卷帘门底下的拖痕**，把悬念从动作换成了一个问题。',
      })}
      editorFontSize={14}
      editorFontFamily="test-font"
      onAccept={() => undefined}
      onAcceptHunk={() => undefined}
      onReject={() => undefined}
      onSaveNote={() => undefined}
      onRetryWithoutKnowledge={() => undefined}
    />,
  );
  assert.match(html, /结尾换成了卷帘门底下的拖痕，把悬念/);
  assert.doesNotMatch(html, /\*\*/);
});

test('补丁一来审阅占满编辑区，差异算完才停到第一处改动；同一补丁再算不再跳', () => {
  mountPanel();
  assert.equal(byTestId('patch-review')?.getAttribute('data-review-expanded'), 'true');
  assert.equal(byTestId('patch-review')?.className.includes('absolute inset-0'), true);
  const diff = __getLastDiffEditor();
  assert.equal(diff.revealFirstDiffCalls, 0, '差异还没算完就跳，跳到的是空的');
  act(() => diff.__fireDiffUpdate());
  assert.equal(diff.revealFirstDiffCalls, 1);
  act(() => diff.__fireDiffUpdate());
  assert.equal(diff.revealFirstDiffCalls, 1, '作者滚开之后差异重算（比如改了字号）不该把他拽回去');
});

test('换了新补丁：收起只对上一版算数，新补丁又占满，并在新差异算完后停到它的第一处改动', () => {
  mountPanel({ id: 'patch-a' });
  const diff = __getLastDiffEditor();
  act(() => diff.__fireDiffUpdate());
  click('patch-expand');
  assert.equal(byTestId('patch-review')?.getAttribute('data-review-expanded'), 'false');
  mountPanel({
    id: 'patch-b',
    after: ['另一版的第一行', '第二行', ''].join(String.fromCharCode(10)),
  });
  assert.equal(byTestId('patch-review')?.getAttribute('data-review-expanded'), 'true');
  assert.equal(diff.revealFirstDiffCalls, 1, '新补丁的差异没算完，不能拿上一版的差异去跳');
  act(() => diff.__fireDiffUpdate());
  assert.equal(diff.revealFirstDiffCalls, 2);
});

test('横幅收成一行：长说明默认折起、点「说明」再看，范围警告照常显示，用 AI 紫淡底', () => {
  mountPanel();
  const details = byTestId('patch-details')!;
  assert.equal(details.hidden, true, '长说明默认不占正文上方的位置');
  assert.match(details.textContent ?? '', /收紧开篇节奏/);
  assert.ok(byTestId('patch-scope-warning'), '范围警告不藏');
  assert.match(byTestId('patch-controls')!.className, /bg-agent\/10/);
  click('patch-details-toggle');
  assert.equal(byTestId('patch-details')!.hidden, false);
  assert.equal(byTestId('patch-details-toggle')!.getAttribute('aria-expanded'), 'true');
  click('patch-details-toggle');
  assert.equal(byTestId('patch-details')!.hidden, true);
});

test('收起时只剩一条操作栏，不在正文下方再劈出半块对比', () => {
  mountPanel();
  click('patch-expand');
  const panel = byTestId('patch-review')!;
  assert.equal(panel.className.includes('max-h-[70%]'), false);
  assert.equal(byTestId('patch-diff')?.hidden, true);
  assert.ok(byTestId('suggestion-accept'), '收起后接受 / 拒绝仍然够得着');
  click('patch-expand');
  assert.equal(byTestId('patch-diff')?.hidden, false);
});

test('对比区只把真正改了的字标深色，整行底色压淡', () => {
  mountPanel();
  assert.ok(byTestId('patch-diff')?.classList.contains('sf-patch-diff'));
  const css = readFileSync('src/index.css', 'utf8');
  const alpha = (selector: string) => {
    const rule = new RegExp(
      String.raw`\.sf-patch-diff \.monaco-editor \.${selector}\s*\{\s*background-color:\s*rgb\(var\(--(?:success|error)\) / ([0-9.]+)\);`,
    ).exec(css);
    assert.ok(rule, `缺少 ${selector} 的规则`);
    return Number(rule[1]);
  };
  assert.ok(alpha('line-insert') < alpha('char-insert') / 3, '新增整行要明显比改动字淡');
  assert.ok(alpha('line-delete') < alpha('char-delete') / 3, '删除整行要明显比改动字淡');
});

test('否掉没成（全项目审计 E-19，恢复记录写不进去等）：修改方向留在输入框里', async () => {
  let finish!: (rejected: boolean) => void;
  const calls: string[] = [];
  await act(async () => {
    root.render(
      <PatchReviewPanel
        suggestion={sampleSuggestion()}
        editorFontSize={14}
        editorFontFamily="test-font"
        onAccept={() => undefined}
        onAcceptHunk={() => undefined}
        onReject={(direction) => {
          calls.push(direction);
          return new Promise<boolean>((resolve) => {
            finish = resolve;
          });
        }}
        onSaveNote={() => undefined}
        onRetryWithoutKnowledge={() => undefined}
      />,
    );
  });
  click('suggestion-reject');
  type('patch-reject-input', '这段独白太满，删到两句');
  press('patch-reject-input', 'Enter');
  await act(async () => finish(false));
  assert.deepEqual(calls, ['这段独白太满，删到两句']);
  assert.equal(
    (byTestId('patch-reject-input') as HTMLInputElement | null)?.value,
    '这段独白太满，删到两句',
  );

  press('patch-reject-input', 'Enter');
  await act(async () => finish(true));
  assert.equal(calls.length, 2);
  assert.equal(byTestId('patch-reject-form'), null);
});

function renderWithHunks(
  overrides: Partial<AssistantFileSuggestion>,
  onAcceptHunk: (hunk: PatchHunk) => void = () => undefined,
  actionKind: 'hunk' | null = null,
) {
  act(() => {
    root.render(
      <PatchReviewPanel
        suggestion={sampleSuggestion(overrides)}
        actionKind={actionKind}
        editorFontSize={14}
        editorFontFamily="test-font"
        onAccept={() => undefined}
        onAcceptHunk={onAcceptHunk}
        onReject={() => undefined}
        onSaveNote={() => undefined}
        onRetryWithoutKnowledge={() => undefined}
      />,
    );
  });
}

function hunkButtons(): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>('[data-testid="suggestion-accept-hunk"]'),
  ];
}

const TWO_LINES = { before: '甲\n乙\n丙\n丁\n戊\n', after: '甲改\n乙\n丙\n丁改\n戊\n' };

test('逐处接受挂在对比区每处改动的正下方，按钮带「第 N 处 · 第 M 行」，点了交出这一处', () => {
  const accepted: PatchHunk[] = [];
  renderWithHunks(TWO_LINES, (hunk) => {
    accepted.push(hunk);
  });
  const modified = __getLastDiffEditor().getModifiedEditor();
  assert.deepEqual(
    modified.viewZones.map((zone) => zone.afterLineNumber),
    [1, 4],
  );
  assert.ok(
    modified.viewZones.every((zone) => (zone.ordinal ?? 0) > 10000),
    '排在 Monaco 删除行之后',
  );
  const buttons = hunkButtons();
  assert.equal(buttons.length, 2);
  buttons.forEach((button, index) => {
    assert.ok(modified.viewZones[index].domNode.contains(button), '按钮在 zone 里');
    assert.ok(byTestId('patch-diff')!.contains(button), 'zone 挂在对比区里');
  });
  assert.match(buttons[0].textContent ?? '', /^接受这处/);
  assert.match(buttons[0].textContent ?? '', /第 1 处 · 第 1 行/);
  assert.match(buttons[1].textContent ?? '', /第 2 处 · 第 4 行/);
  assert.equal(
    byTestId('patch-controls')!.querySelector('[aria-label="补丁分块操作"]'),
    null,
    '能定位的都进了 zone，横幅不再留逐处接受那一行',
  );

  act(() => buttons[1].click());
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].afterText, '丁改\n');

  renderWithHunks(TWO_LINES, () => undefined, 'hunk');
  assert.ok(
    hunkButtons().every((button) => button.disabled),
    '有动作在跑时 zone 里的键一起锁住',
  );
});

test('同一行的几处句段合进一个 zone：接受这处 ①②', () => {
  const accepted: PatchHunk[] = [];
  renderWithHunks(
    { before: '甲说，天晴了。他说，乙笑了。\n', after: '甲说，天阴了。他说，乙哭了。\n' },
    (hunk) => {
      accepted.push(hunk);
    },
  );
  const modified = __getLastDiffEditor().getModifiedEditor();
  assert.deepEqual(
    modified.viewZones.map((zone) => zone.afterLineNumber),
    [1],
  );
  const buttons = hunkButtons();
  assert.equal(buttons.length, 2);
  assert.match(buttons[0].textContent ?? '', /^接受这处 ①/);
  assert.match(buttons[1].textContent ?? '', /^接受这处 ②/);
  act(() => buttons[1].click());
  assert.equal(accepted[0].afterText, '乙哭了。\n');
});

test('zone 的焦点也算补丁分块操作区：Ctrl+Y 照样整份接受', () => {
  let accepts = 0;
  act(() => {
    root.render(
      <PatchReviewPanel
        suggestion={sampleSuggestion(TWO_LINES)}
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
  act(() => {
    hunkButtons()[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }),
    );
  });
  assert.equal(accepts, 1);
});

test('差异重算不叠 zone；收起摘掉、展开重挂；换补丁换 zone；卸载摘干净', () => {
  renderWithHunks(TWO_LINES);
  const diff = __getLastDiffEditor();
  const modified = diff.getModifiedEditor();
  assert.equal(modified.viewZones.length, 2);
  act(() => diff.__fireDiffUpdate());
  assert.equal(modified.viewZones.length, 2, '差异重算后按原位置重挂，不叠第二份');
  assert.equal(hunkButtons().length, 2);

  click('patch-expand');
  assert.equal(modified.viewZones.length, 0, '收起后对比区不在了，zone 也摘掉');
  assert.equal(hunkButtons().length, 0);
  click('patch-expand');
  assert.equal(modified.viewZones.length, 2);
  assert.equal(hunkButtons().length, 2);

  renderWithHunks({
    id: 'patch-next',
    before: '一\n二\n三\n',
    after: '一改\n二\n三改\n四\n',
  });
  assert.deepEqual(
    modified.viewZones.map((zone) => zone.afterLineNumber),
    [1, 4],
  );
  assert.equal(hunkButtons().length, 2);
  assert.match(hunkButtons()[1].title, /第 2 处/);

  act(() => root.unmount());
  assert.equal(modified.viewZones.length, 0, '卸载后不留 zone');
  root = createRoot(container);
});

test('分块接受之后：对比区里认不出位置的、冲突的留在横幅「N 处无法定位」，能定位的进 zone', () => {
  const ops = buildPatchHunks('A\nB\nC\nD\nE\n', 'A1\nB\nC1\nD\nE1\n');
  assert.equal(ops.length, 3);
  const accepted: PatchHunk[] = [];
  renderWithHunks(
    {
      // 作者把 C 改成了 X：C 的操作在当前差异里认不出；E 的操作被判冲突。
      before: 'A\nB\nX\nD\nE\n',
      after: 'A1\nB\nX1\nD\nE\n',
      operationView: { operations: ops, conflicts: { [ops[2].id]: '原修改区间已变化' } },
    },
    (hunk) => {
      accepted.push(hunk);
    },
  );
  const modified = __getLastDiffEditor().getModifiedEditor();
  assert.deepEqual(
    modified.viewZones.map((zone) => zone.afterLineNumber),
    [1],
  );
  const row = byTestId('patch-controls')!.querySelector('[aria-label="补丁分块操作"]');
  assert.ok(row, '定位不到的留在横幅一行');
  assert.match(row.textContent ?? '', /2 处无法定位/);
  const rowButtons = [
    ...row.querySelectorAll<HTMLButtonElement>('[data-testid="suggestion-accept-hunk"]'),
  ];
  assert.equal(rowButtons.length, 2);
  assert.match(rowButtons[0].textContent ?? '', /第 2 处 · 原稿第 3 行/);
  assert.equal(rowButtons[0].disabled, false, '只是认不出位置，仍可接受');
  assert.equal(rowButtons[1].disabled, true, '冲突的禁用');
  const zoneButton = modified.viewZones[0].domNode.querySelector('button')!;
  assert.match(zoneButton.textContent ?? '', /第 1 处 · 原稿第 1 行/);
  act(() => zoneButton.click());
  assert.equal(accepted[0], ops[0], '交回的是原操作对象，不是当前差异重算出来的');
});

test('引擎标了新稿可能没写完：横幅醒目显示警告；普通补丁不显示', () => {
  const warning = 'AI 的输出可能没写完：原文最后的『七、伏笔』『八、边界』共 7 段在新稿里没有。';
  mountPanel({ truncationWarning: warning });
  const banner = byTestId('patch-truncation-warning');
  assert.ok(banner, '截断警告必须显示在修订横幅里');
  assert.equal(banner.getAttribute('role'), 'alert');
  assert.match(banner.textContent ?? '', /原文最后的『七、伏笔』『八、边界』/);
  assert.equal(byTestId('patch-details')!.hidden, true, '警告不能折进「说明」里');
  mountPanel();
  assert.equal(byTestId('patch-truncation-warning'), null);
});

test('截断两步已武装：「接受」就地换成「仍然整份接受」并说明，失焦、移开、点拒绝都撤销', () => {
  let cancels = 0;
  const render = (armed: boolean) =>
    act(() => {
      root.render(
        <PatchReviewPanel
          suggestion={sampleSuggestion({ truncationWarning: 'AI 的输出可能没写完。' })}
          editorFontSize={14}
          editorFontFamily="test-font"
          truncationArmed={armed}
          onCancelTruncatedAccept={() => {
            cancels += 1;
          }}
          onAccept={() => undefined}
          onAcceptHunk={() => undefined}
          onReject={() => undefined}
          onSaveNote={() => undefined}
          onRetryWithoutKnowledge={() => undefined}
        />,
      );
    });
  render(false);
  assert.equal(byTestId('suggestion-accept')!.textContent, '接受');
  assert.equal(byTestId('patch-truncation-confirm'), null);
  render(true);
  const accept = byTestId('suggestion-accept')!;
  assert.equal(accept.textContent, '仍然整份接受');
  assert.equal(accept.getAttribute('data-armed'), 'true');
  assert.match(byTestId('patch-truncation-confirm')!.textContent ?? '', /再点一次才写/);
  act(() => {
    accept.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  act(() => {
    accept.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
    );
  });
  click('suggestion-reject');
  assert.equal(cancels, 3);
});

test('引擎给了字数提示：横幅用提示色显示，和截断警告分开；普通补丁不显示', () => {
  const hint = '字数提示：目标约 3600–4400 字，这版实际 5999 字（偏多 1599 字）。';
  mountPanel({ lengthHint: hint });
  const line = byTestId('patch-length-hint');
  assert.ok(line, '字数提示必须显示在修订横幅里');
  assert.equal(line.textContent, hint);
  assert.ok(line.classList.contains('text-warning'), '字数提示用提示色');
  assert.ok(!line.classList.contains('text-error'), '字数提示不是错误');
  assert.equal(line.getAttribute('role'), null, '只提示，不当成警报');
  assert.equal(byTestId('patch-truncation-warning'), null);
  assert.equal(byTestId('patch-details')!.hidden, true, '提示不能折进「说明」里');
  mountPanel();
  assert.equal(byTestId('patch-length-hint'), null);
});
