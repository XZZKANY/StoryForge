/**
 * Ctrl+K 行间对话的 view zone DOM 与 toast：声明式的纯 DOM 构造，不碰 Monaco 装配
 * （zone 增删 / 高度重排 / 键盘命令仍在 useInlineChat）。与 Monaco 解耦是为了能在
 * vitest 里对可达性契约做行为测试——此前全部挤在 hook 里，「测试不触达」正是
 * 键盘/读屏缺陷长期漏网的原因（E21）。
 */

import { intraLineChangeRange, type InlineAnchor, type LineDiffHunk } from '../../lib/inline-chat';

/** revise=改锚定文本（Ctrl+K）；continue=在光标处往下续写（Ctrl+Shift+K）。与 hook 同义。 */
export type InlineMode = 'revise' | 'continue';

// diff 动作条要展示的汇总（锚定处增删行 + 被丢弃的别处改动数）。
export type InlineDiffActions = {
  addedLines: number;
  removedLines: number;
  hunkCount: number;
  droppedOffAnchor: number;
};

export type IntraLineSeg = ReturnType<typeof intraLineChangeRange>;

/**
 * 给「mousedown 优先」的按钮补上键盘激活通道（Enter/Space）。
 *
 * 为什么按钮监听的是 mousedown 而不是 click：view zone 里的按钮必须抢在 Monaco 的鼠标
 * 处理（移光标/夺焦点）之前触发，否则点击会被编辑器吞掉，表现为「点不动、只能用快捷键」。
 * 代价是 preventDefault 顺手抑制了后继的兼容性 click——键盘激活这条原生路径只能靠补挂。
 *
 * 补挂的 keydown 不 preventDefault（防 Monaco 快捷键分发器因「事件已被处理」而跳过它），
 * click 通道只对键盘触发的 click（detail===0）响应，mousedown 通道由调用方保留原样。
 */
export function activateOnActivationKeys(button: HTMLButtonElement, onActivate: () => void): void {
  button.addEventListener('click', (event) => {
    // 鼠标点击的 click（detail≥1）已由 mousedown 通道处理，否则会触发两次。
    if (event.detail === 0) onActivate();
  });
  button.addEventListener('keydown', (event) => {
    // IME 组字中的 Enter（选词上屏）不能当成按钮激活——229 是组字处理的键码。
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    clickFromKeyboard(button);
  });
}

/** 从键盘路径触发 click：detail 恒为 0，与鼠标点击的 detail≥1 区分开（去重约定见上）。 */
function clickFromKeyboard(button: HTMLButtonElement): void {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 });
  button.dispatchEvent(event);
}

/** mousedown 通道 + 键盘激活通道：zone 按钮的统一接法（防 Monaco 吞点击，也防键盘死键）。 */
function wireZoneButton(button: HTMLButtonElement, onActivate: () => void): void {
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onActivate();
  });
  activateOnActivationKeys(button, onActivate);
}

export function buildInputZoneDom(
  anchor: InlineAnchor,
  mode: InlineMode,
  handlers: { onSend: (value: string) => void; onCancel: () => void },
): { container: HTMLElement; textarea: HTMLTextAreaElement } {
  const container = document.createElement('div');
  container.className = 'sf-inline-chat sf-input-shell';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', mode === 'continue' ? '行间续写输入' : '行间对话输入');
  // 拦掉冒泡，别让 Monaco 把 view zone 里的点击当成移动光标而把焦点从输入框抢走。
  container.addEventListener('mousedown', (event) => event.stopPropagation());

  const head = document.createElement('div');
  head.className = 'sf-inline-chat__head';
  const lineLabel =
    anchor.startLine === anchor.endLine
      ? `第 ${anchor.startLine} 行`
      : `第 ${anchor.startLine}–${anchor.endLine} 行`;
  head.textContent =
    mode === 'continue'
      ? `续写 · ${lineLabel} 之后 · 接着往下写一段`
      : `行间对话 · ${lineLabel} · 只改这附近，不整段重写`;

  const textarea = document.createElement('textarea');
  textarea.className = 'sf-inline-chat__textarea sf-inner-input';
  textarea.rows = 1;
  textarea.setAttribute('aria-label', mode === 'continue' ? '续写方向（可留空）' : '修订指令');
  textarea.placeholder =
    mode === 'continue'
      ? '直接回车＝就接着写；也可给个方向：转到冲突 / 慢下来 / 换个视角…'
      : '对这段说点什么：收紧节奏 / 换个意象 / 口吻更冷…';

  let composing = false;
  textarea.addEventListener('compositionstart', () => {
    composing = true;
  });
  textarea.addEventListener('compositionend', () => {
    composing = false;
  });
  textarea.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey && !composing) {
      event.preventDefault();
      handlers.onSend(textarea.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handlers.onCancel();
    }
  });

  const hint = document.createElement('div');
  hint.className = 'sf-inline-chat__hint';
  hint.textContent =
    mode === 'continue'
      ? 'Enter 开始写 · Shift+Enter 换行 · Esc 关闭'
      : 'Enter 发送 · Shift+Enter 换行 · Esc 关闭';

  container.append(head, textarea, hint);
  return { container, textarea };
}

/** 续写/修订进行中（loading / 流式）的「正在… + 取消（Esc）」动作条。 */
export function buildPendingActionsDom(
  labelText: string,
  onCancel: () => void,
): { bar: HTMLElement; cancel: HTMLButtonElement } {
  const bar = document.createElement('div');
  bar.className = 'sf-inline-diff-actions';
  const label = document.createElement('span');
  label.className = 'sf-inline-diff-note';
  label.style.flex = '1';
  label.textContent = labelText;
  // 告诉读屏「在跑了」；逐块到达的正文不直播（由调用方 aria-hidden）——一个 token 一次
  // 播报就是轰炸，且那些只是中间态（最终结果会经 diff 动作条再次呈现）。
  label.setAttribute('role', 'status');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'sf-inline-btn-reject';
  cancel.textContent = '取消（Esc）';
  wireZoneButton(cancel, onCancel);
  bar.append(label, cancel);
  return { bar, cancel };
}

/** 纯 loading 行（修订的单发请求期）。zone 增删由 hook 做，这里只出 DOM。 */
export function buildLoadingZoneDom(onCancel: () => void): {
  dom: HTMLElement;
  cancel: HTMLButtonElement;
} {
  const dom = document.createElement('div');
  dom.className = 'sf-inline-chat sf-inline-chat--loading';
  dom.setAttribute('role', 'group');
  dom.setAttribute('aria-label', '行间修订进行中');
  const { bar, cancel } = buildPendingActionsDom('正在请求 AI 修订…', onCancel);
  dom.append(bar);
  return { dom, cancel };
}

export function buildDiffZoneDom(
  hunk: LineDiffHunk,
  summaryForActions: InlineDiffActions | null,
  fontFamily: string,
  seg: IntraLineSeg | null,
  handlers: { onAccept: () => void; onReject: () => void },
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'sf-inline-diff-zone';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', '行间修订结果');
  // 内联覆盖 CSS 的 mono 栈：贴编辑器正文字体，绿新行与红旧行字形/字宽一致。
  container.style.fontFamily = fontFamily;
  // 同输入框：拦掉 mousedown，避免点接受/弃用时 Monaco 抢焦点。
  container.addEventListener('mousedown', (event) => event.stopPropagation());

  const highlightNew =
    seg !== null && hunk.newLines.length === 1 && seg.newEndCol > seg.newStartCol;
  for (const line of hunk.newLines) {
    const row = document.createElement('div');
    row.className = 'sf-inline-diff-line';
    if (highlightNew && seg && line.length > 0) {
      // 只把真正改动的中段包成高亮 span，前后逐字保留（对齐红旧行的句内高亮，E22）。
      const start = seg.newStartCol - 1;
      const end = seg.newEndCol - 1;
      if (start > 0) row.append(document.createTextNode(line.slice(0, start)));
      const hi = document.createElement('span');
      hi.className = 'sf-inline-diff-new-seg';
      hi.textContent = line.slice(start, end);
      row.append(hi);
      if (end < line.length) row.append(document.createTextNode(line.slice(end)));
      container.append(row);
      continue;
    }
    row.textContent = line.length > 0 ? line : ' ';
    container.append(row);
  }

  if (summaryForActions) {
    const actions = document.createElement('div');
    actions.className = 'sf-inline-diff-actions';

    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'sf-inline-btn-accept';
    accept.textContent = '接受（Alt+Enter）';
    wireZoneButton(accept, handlers.onAccept);

    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'sf-inline-btn-reject';
    reject.textContent = '弃用（Esc）';
    wireZoneButton(reject, handlers.onReject);

    const note = document.createElement('span');
    note.className = 'sf-inline-diff-note';
    const noteParts = [`+${summaryForActions.addedLines} / -${summaryForActions.removedLines}`];
    if (summaryForActions.hunkCount > 1) noteParts.push(`共 ${summaryForActions.hunkCount} 处`);
    if (summaryForActions.droppedOffAnchor > 0) {
      noteParts.push(`已忽略别处 ${summaryForActions.droppedOffAnchor} 处`);
    }
    note.textContent = noteParts.join(' · ');

    actions.append(accept, reject, note);
    container.append(actions);
  }

  return container;
}

/**
 * 右下角的状态 toast。每次新建元素（避免 mutate 从 ref 取出的旧节点）；
 * 挂载与自动消失计时由 useInlineChat 的 flashStatus 管。
 */
export function buildInlineToast(message: string, tone: 'polite' | 'assertive'): HTMLDivElement {
  const toast = document.createElement('div');
  toast.className = 'sf-inline-toast';
  // 状态反馈对读屏默认可有可无（polite）；失败会打断当前任务，必须 assertive 抢读。
  toast.setAttribute('role', tone === 'assertive' ? 'alert' : 'status');
  toast.setAttribute('aria-live', tone);
  toast.setAttribute('aria-atomic', 'true');
  toast.textContent = message;
  return toast;
}
