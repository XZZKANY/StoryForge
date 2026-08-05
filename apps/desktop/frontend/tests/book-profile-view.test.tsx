/**
 * 左栏作品视图的行为红线。
 *
 * 这个视图第一次让「一本书」在 IDE 里有了目录名以外的身份，所以要紧的是它别撒谎、别丢字：
 * - **不画假进度**：没设目标就不渲染进度条，统计失败就说失败，绝不拿 0 字冒充空书；
 * - **不丢没提交的编辑**：书名敲到一半去点封面 / 加题材，那半个书名必须一起落盘。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, test, vi } from 'vitest';

import type { BookProfileHandle } from '../src/components/app/useBookProfile';
import { BookProfileView } from '../src/components/shell/BookProfileView';
import { emptyBookProfile } from '../src/lib/book-profile';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = 'D:\\连载\\末世吞噬';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function makeHandle(overrides: Partial<BookProfileHandle> = {}): BookProfileHandle {
  return {
    profile: emptyBookProfile(),
    loading: false,
    save: vi.fn(async () => {}),
    coverUrl: null,
    pickCover: vi.fn(async () => {}),
    totals: { chapters: 12, chars: 124000, unreadable: 0 },
    totalsError: null,
    outline: [],
    outlineDropped: 0,
    notes: [],
    addNote: vi.fn(async () => {}),
    toggleNote: vi.fn(async () => {}),
    removeNote: vi.fn(async () => {}),
    refreshing: false,
    refresh: vi.fn(),
    ...overrides,
  };
}

async function renderView(handle: BookProfileHandle, onOpenOutline = vi.fn()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BookProfileView
        projectPath={PROJECT}
        handle={handle}
        dailyWordGoal={3000}
        onOpenOutline={onOpenOutline}
        onBackToExplorer={() => {}}
      />,
    );
  });
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const byTestId = (testid: string) =>
  container!.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;

/** React 受控输入：直接赋 .value 不会触发 onChange，必须走原型 setter 再派发 input。 */
function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

test('没起过书名时用目录名占位，不显示空白标题', async () => {
  await renderView(makeHandle());
  const input = byTestId('book-title-input') as HTMLInputElement;
  assert.equal(input.value, '');
  assert.equal(input.placeholder, '末世吞噬');
});

test('未设全书目标就不渲染进度条——不画一条永远 0% 的条', async () => {
  await renderView(makeHandle());
  assert.equal(byTestId('book-goal-bar'), null);
  assert.match(byTestId('book-total-chars')!.textContent ?? '', /12 章 · 12\.4 万字/);
});

test('设了目标才出现进度条，并按已写字数给出百分比', async () => {
  await renderView(makeHandle({ profile: { ...emptyBookProfile(), wordGoal: 1000000 } }));
  assert.equal(byTestId('book-goal-bar')?.dataset.progress, '12');
});

test('统计失败就说失败，绝不拿 0 字冒充一本空书', async () => {
  await renderView(makeHandle({ totals: null, totalsError: '读取 正文/第003章.md 失败' }));
  assert.equal(byTestId('book-total-chars'), null);
  assert.match(container!.textContent ?? '', /统计失败：读取 正文\/第003章\.md 失败/);
});

test('读不了的章节数如实报出，不混进总和', async () => {
  await renderView(makeHandle({ totals: { chapters: 12, chars: 124000, unreadable: 2 } }));
  assert.match(container!.textContent ?? '', /2 个文件读取失败，未计入总和/);
});

test('书名敲到一半去点封面：那半个书名跟着一起落盘，不丢', async () => {
  const handle = makeHandle();
  await renderView(handle);

  await act(async () => typeInto(byTestId('book-title-input') as HTMLInputElement, '末世吞噬'));
  // 不触发 blur，直接点封面槽。
  await act(async () => (byTestId('book-cover-slot') as HTMLButtonElement).click());

  const saved = vi.mocked(handle.save).mock.calls[0]?.[0];
  assert.equal(saved?.title, '末世吞噬', '点封面前必须先把未提交的书名提交');
  // 换封面流程拿到的也必须是「此刻的档案」——否则选完图写回时会把书名覆盖回空。
  const handed = vi.mocked(handle.pickCover).mock.calls[0]?.[0];
  assert.equal(handed?.title, '末世吞噬');
});

test('加题材同样带上未提交的简介', async () => {
  const handle = makeHandle();
  await renderView(handle);

  await act(async () =>
    typeInto(byTestId('book-synopsis-input') as HTMLTextAreaElement, '一场蓝色雨后。'),
  );
  const tagInput = byTestId('book-tag-input') as HTMLInputElement;
  await act(async () => typeInto(tagInput, '末世'));
  await act(async () =>
    tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );

  const saved = vi.mocked(handle.save).mock.calls.at(-1)?.[0];
  assert.deepEqual(saved?.tags, ['末世']);
  assert.equal(saved?.synopsis, '一场蓝色雨后。');
});

test('简介失焦后提交草稿并恢复静息内凹阴影', async () => {
  const handle = makeHandle();
  await renderView(handle);
  const input = byTestId('book-synopsis-input') as HTMLTextAreaElement;

  await act(async () => input.focus());
  assert.match(input.style.boxShadow, /0 0 0 3px/);

  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  assert.equal(input.style.boxShadow, 'var(--shadow-inset)');
  assert.equal(vi.mocked(handle.save).mock.calls.length, 1);
});

test('字数目标输入里的逗号与「字」被剥掉，存成纯数字', async () => {
  const handle = makeHandle();
  await renderView(handle);
  const input = byTestId('book-word-goal-input') as HTMLInputElement;
  await act(async () => typeInto(input, '1,000,000 字'));
  // React 的 onBlur 委托在 focusout 上；派发不冒泡的原生 blur 不会触发它。
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  assert.equal(vi.mocked(handle.save).mock.calls.at(-1)?.[0].wordGoal, 1000000);
});

test('速记回车即存，输入框随即清空', async () => {
  const handle = makeHandle();
  await renderView(handle);
  const input = byTestId('book-note-input') as HTMLInputElement;

  await act(async () => typeInto(input, '给女二加一条独立线'));
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );

  assert.deepEqual(vi.mocked(handle.addNote).mock.calls, [['给女二加一条独立线']]);
  assert.equal((byTestId('book-note-input') as HTMLInputElement).value, '');
});

test('勾选把那一条原样交回去，已完成的划掉', async () => {
  const note = { line: 4, text: '补第 12 章的雨', done: false };
  const handle = makeHandle({ notes: [note, { line: 5, text: '已办', done: true }] });
  await renderView(handle);

  const rows = container!.querySelectorAll('[data-testid="book-note-row"]');
  assert.equal(rows.length, 2);
  assert.equal((rows[1] as HTMLElement).dataset.done, 'true');

  await act(async () => (rows[0].querySelector('button') as HTMLButtonElement).click());
  assert.deepEqual(vi.mocked(handle.toggleNote).mock.calls, [[note]]);
});

test('档案还在读盘时整个档案区停用——空档案不得被写回磁盘', async () => {
  const handle = makeHandle({ loading: true });
  await renderView(handle);

  const cover = byTestId('book-cover-slot') as HTMLButtonElement;
  assert.equal(cover.disabled, true, '读盘期间点封面会拿空档案覆盖磁盘上的书名简介');
  assert.equal((byTestId('book-title-input') as HTMLInputElement).disabled, true);
  assert.equal((byTestId('book-synopsis-input') as HTMLTextAreaElement).disabled, true);
  assert.equal((byTestId('book-word-goal-input') as HTMLInputElement).disabled, true);

  await act(async () => cover.click());
  assert.equal(vi.mocked(handle.save).mock.calls.length, 0);
  assert.equal(vi.mocked(handle.pickCover).mock.calls.length, 0);
});

test('点大纲标题带着绝对路径与行号跳转', async () => {
  const onOpenOutline = vi.fn();
  await renderView(
    makeHandle({
      outline: [
        {
          line: 12,
          level: 2,
          text: '第三幕 · 塌方',
          path: 'D:\\连载\\末世吞噬\\大纲\\总纲.md',
          relativePath: '大纲/总纲.md',
        },
      ],
    }),
    onOpenOutline,
  );

  await act(async () =>
    (container!.querySelector('[data-testid="book-outline-row"]') as HTMLButtonElement).click(),
  );
  assert.deepEqual(onOpenOutline.mock.calls, [['D:\\连载\\末世吞噬\\大纲\\总纲.md', 12]]);
});

test('大纲被截断时把丢掉的条数写成数字，不静默省略', async () => {
  await renderView(
    makeHandle({
      outline: [
        {
          line: 0,
          level: 1,
          text: '总纲',
          path: 'D:\\连载\\末世吞噬\\大纲\\总纲.md',
          relativePath: '大纲/总纲.md',
        },
      ],
      outlineDropped: 7,
    }),
  );
  assert.match(container!.textContent ?? '', /另有\s*7\s*条标题没列出来/);
});

test('大纲为空时给出可照做的下一步，而不是一句「无数据」', async () => {
  await renderView(makeHandle());
  assert.match(container!.textContent ?? '', /还没有带标题的文档/);
});
