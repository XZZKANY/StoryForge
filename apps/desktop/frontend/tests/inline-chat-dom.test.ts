/**
 * Ctrl+K 行间对话 zone DOM 的键盘/读屏可达性行为测试（E21）。
 *
 * 修前这三类 zone（输入 / loading+流式 / diff）是 hook 里裸 document.createElement 的命令式
 * 拼装：容器无 role/aria、按钮只挂 mousedown（preventDefault 顺手抑制兼容性 click，
 * 键盘 Enter/Space 完全无法激活）、状态 toast 无 live region。DOM 构造收进
 * inline-chat-dom.ts 后，这些契约都能在这里直接钉死，不用起 Monaco。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, vi } from 'vitest';

import {
  activateOnActivationKeys,
  buildDiffZoneDom,
  buildInlineToast,
  buildInputZoneDom,
  buildLoadingZoneDom,
  buildPendingActionsDom,
} from '../src/components/editor/inline-chat-dom';

const anchor = { startLine: 3, endLine: 5, text: '锚定文本', isSelection: true };

function keydown(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

// —— a) zone 容器与控件的可访问身份 ——————————————————————————————

test('输入 zone：容器是命名的 group，textarea 有可访问名，组字保护在位', () => {
  const onSend = vi.fn();
  const onCancel = vi.fn();
  const { container, textarea } = buildInputZoneDom(anchor, 'revise', { onSend, onCancel });
  assert.equal(container.getAttribute('role'), 'group');
  assert.equal(container.getAttribute('aria-label'), '行间对话输入');
  assert.equal(textarea.getAttribute('aria-label'), '修订指令');
  assert.match(container.textContent ?? '', /行间对话 · 第 3–5 行/);

  // Enter 发送、Shift+Enter 换行、Esc 关闭——交互逻辑不因补 aria 而改变。
  textarea.value = '收紧节奏';
  keydown(textarea, 'Enter');
  assert.deepEqual(onSend.mock.calls, [['收紧节奏']]);
  keydown(textarea, 'Enter', { shiftKey: true });
  assert.equal(onSend.mock.calls.length, 1, 'Shift+Enter 不得触发发送');

  // IME 组字中的 Enter 是选词上屏，不得发送（compositionstart 旗标）。
  textarea.dispatchEvent(new CompositionEvent('compositionstart'));
  keydown(textarea, 'Enter');
  assert.equal(onSend.mock.calls.length, 1, '组字中的 Enter 不得触发发送');
  textarea.dispatchEvent(new CompositionEvent('compositionend'));

  const esc = keydown(textarea, 'Escape');
  assert.equal(onCancel.mock.calls.length, 1);
  assert.equal(esc.defaultPrevented, true);
});

test('续写模式的输入 zone 有自己的名字', () => {
  const { container, textarea } = buildInputZoneDom(anchor, 'continue', {
    onSend: () => {},
    onCancel: () => {},
  });
  assert.equal(container.getAttribute('aria-label'), '行间续写输入');
  assert.equal(textarea.getAttribute('aria-label'), '续写方向（可留空）');
});

// —— b) 按钮双通道：mousedown 保留防 Monaco 吞点击，Enter/Space 也能激活 ————————————

test('diff 动作条：接受/弃用按钮 mousedown 与键盘 Enter/Space 都能激活', () => {
  const onAccept = vi.fn();
  const onReject = vi.fn();
  const dom = buildDiffZoneDom(
    {
      removedStartLine: 2,
      removedEndLine: 2,
      afterLineNumber: 2,
      newLines: ['新行'],
      removedLineCount: 1,
      addedLineCount: 1,
    },
    { addedLines: 1, removedLines: 1, hunkCount: 1, droppedOffAnchor: 2 },
    'monospace',
    null,
    { onAccept, onReject },
  );
  assert.equal(dom.getAttribute('role'), 'group');
  assert.equal(dom.getAttribute('aria-label'), '行间修订结果');

  const [accept, reject] = [...dom.querySelectorAll('button')];
  assert.match(accept.textContent ?? '', /接受（Alt\+Enter）/);
  assert.match(reject.textContent ?? '', /弃用（Esc）/);
  assert.match(dom.textContent ?? '', /\+1 \/ -1 · 已忽略别处 2 处/);

  // 鼠标路径：mousedown 即触发并 preventDefault（抢在 Monaco 移光标/夺焦点之前）。
  const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 });
  accept.dispatchEvent(mouse);
  assert.equal(mouse.defaultPrevented, true, 'mousedown 通道必须保持 preventDefault');
  assert.equal(onAccept.mock.calls.length, 1);

  // 键盘路径：Enter 与 Space 都能激活；激活只走 keydown（派发 detail=0 的 click）。
  keydown(reject, 'Enter');
  keydown(reject, ' ');
  assert.equal(onReject.mock.calls.length, 2);

  // 去重：mousedown 触发后即使浏览器补发 click（detail≥1），也不得二次触发。
  reject.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.equal(onReject.mock.calls.length, 2, 'mousedown 路径的兼容性 click 不得重复触发');

  // 键盘事件的默认行为不得被吃掉：Space 若 preventDefault 会被 Monaco 循环内快捷键判定吞掉。
  const space = keydown(reject, ' ');
  assert.equal(space.defaultPrevented, false);
});

test('loading / 流式的取消按钮同样支持键盘激活，且容器与状态有读屏身份', () => {
  const onCancel = vi.fn();
  const { dom, cancel } = buildLoadingZoneDom(onCancel);
  assert.equal(dom.getAttribute('role'), 'group');
  assert.equal(dom.getAttribute('aria-label'), '行间修订进行中');
  assert.equal(dom.querySelector('[role="status"]')?.textContent, '正在请求 AI 修订…');
  keydown(cancel, 'Enter');
  assert.equal(onCancel.mock.calls.length, 1);

  const streaming = buildPendingActionsDom('正在续写…', onCancel);
  assert.equal(streaming.bar.querySelector('[role="status"]')?.textContent, '正在续写…');
  keydown(streaming.cancel, ' ');
  assert.equal(onCancel.mock.calls.length, 2);
});

// —— c) 状态 toast 是 live region，失败 assertive ————————————————————————

test('状态 toast：polite 用 role=status，失败 assertive 用 role=alert', () => {
  const info = buildInlineToast('行间修订已写回当前文件', 'polite');
  assert.equal(info.className, 'sf-inline-toast');
  assert.equal(info.getAttribute('role'), 'status');
  assert.equal(info.getAttribute('aria-live'), 'polite');
  assert.equal(info.getAttribute('aria-atomic'), 'true');
  assert.equal(info.textContent, '行间修订已写回当前文件');

  const failure = buildInlineToast('AI 修订失败：超时', 'assertive');
  assert.equal(failure.getAttribute('role'), 'alert');
  assert.equal(failure.getAttribute('aria-live'), 'assertive');
});

// —— e) 键盘激活不打扰 IME ————————————————————————————————————

test('activateOnActivationKeys：组字中（isComposing / keyCode 229）不得激活', () => {
  const button = document.createElement('button');
  document.body.append(button);
  const onActivate = vi.fn();
  activateOnActivationKeys(button, onActivate);

  keydown(button, 'Enter', { isComposing: true });
  // keyCode 是只读实例属性，派发前定义一枚带 229 的。
  const composing229 = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
  Object.defineProperty(composing229, 'keyCode', { value: 229 });
  button.dispatchEvent(composing229);
  assert.equal(onActivate.mock.calls.length, 0);

  keydown(button, 'a');
  assert.equal(onActivate.mock.calls.length, 0, '普通字符键不得触发');
  button.remove();
});

// 壳层（useInlineChat）装配护栏：DOM 构造搬出去之后，焦点管理这类装配逻辑
// 只能以源码断言钉住（起真实 Monaco 走 hook 的代价远超收益，流式路径还依赖 SSE mock）。
test('壳层装配护栏：阶段切换搬焦点、会话结束归还焦点、失败走 assertive', () => {
  const source = readFileSyncHook();
  // diff 画完后焦点进动作条（host zone 的第一个按钮 = 接受）。
  assert.match(
    source,
    /hostDom\?\.querySelector\('button'\)\?\.focus\(\{ preventScroll: true \}\)/,
  );
  // loading / 流式的取消键同样接焦点（focusWhenSettled 二次 rAF 兜底）。
  assert.ok(
    (source.match(/focusWhenSettled\(cancel, isActive\)/g) ?? []).length === 2,
    'loading 与流式两条路径都要把焦点交给取消键',
  );
  // 会话 teardown 时焦点归还编辑器，且只在焦点确实曾在 zone 里时（不抢别处的焦点）。
  assert.match(source, /focusWasInZone[\s\S]{0,160}?editor\.focus\(\)/);
  // 三处失败提示必须 assertive 抢读。
  //（prettier 会把实参折成多行，判定容忍空白。）
  assert.equal((source.match(/,\s*'assertive',?\s*\)/g) ?? []).length, 3);
  // 流式逐字中间态不得进 live region（防读屏轰炸）。
  assert.match(source, /aria-hidden', 'true'/);
});

function readFileSyncHook(): string {
  // vitest module runner 下 import.meta.url 不是 file://，用相对包根的 cwd 路径
  //（与 focus-styles 里 readFileSync('src/index.css') 同款）。
  return readFileSync('src/components/editor/useInlineChat.ts', 'utf8');
}
