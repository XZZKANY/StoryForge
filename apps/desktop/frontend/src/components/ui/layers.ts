import { createContext, useContext, useId, useLayoutEffect, useRef, type RefObject } from 'react';

export function canFocus(element: Element | null | undefined): element is HTMLElement {
  if (
    !(element instanceof HTMLElement) ||
    !element.isConnected ||
    element === document.body ||
    element.matches(':disabled') ||
    element.closest('[hidden], [inert], [aria-hidden="true"]')
  )
    return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (node.tagName === 'DETAILS' && !node.hasAttribute('open')) {
      const summary = Array.from(node.children).find((child) => child.tagName === 'SUMMARY');
      if (!summary?.contains(element)) return false;
    }
  }
  return true;
}
export function focusables(node: HTMLElement): HTMLElement[] {
  return Array.from(
    node.querySelectorAll<HTMLElement>(
      'button, input, textarea, select, a[href], summary, [tabindex], [contenteditable="true"]',
    ),
  ).filter((el) => el.tabIndex >= 0 && canFocus(el));
}
export type DismissReason = 'escape' | 'outside' | 'blur' | 'tab';
type LayerOptions = {
  open: boolean;
  nodeRef: RefObject<HTMLElement | null>;
  triggerRef?: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  modal?: boolean;
  dismissOutside?: boolean;
  dismissOnBlur?: boolean;
  dismissOnTab?: boolean;
  restoreFocus?: boolean;
  shouldRestoreOpener?: () => boolean;
  onDismiss: (reason: DismissReason) => void;
};
type Layer = {
  id: string;
  parent: string | null;
  options: () => LayerOptions;
  opener: Element | null;
  fallback: HTMLElement | null;
  style: string;
};
export const LayerContext = createContext<string | null>(null);
const layers: Layer[] = [];
const isolated = new Map<HTMLElement, { inert: string | null; hidden: string | null }>();
let bodyOverflow: string | undefined;
function restoreIsolation() {
  for (const [node, saved] of isolated) {
    if (saved.inert === null) node.removeAttribute('inert');
    else node.setAttribute('inert', saved.inert);
    if (saved.hidden === null) node.removeAttribute('aria-hidden');
    else node.setAttribute('aria-hidden', saved.hidden);
  }
  isolated.clear();
}
function isChild(layer: Layer, ancestor: Layer): boolean {
  let current: Layer | undefined = layer;
  while (current) {
    if (current.id === ancestor.id) return true;
    current = layers.find((item) => item.id === current?.parent);
  }
  return false;
}
function surface(layer: Layer) {
  const node = layer.options().nodeRef.current;
  return layer.options().modal
    ? (node?.closest<HTMLElement>('[data-modal-backdrop]') ?? node)
    : node;
}
function refresh() {
  restoreIsolation();
  layers.forEach((layer, index) => {
    const node = surface(layer);
    if (node) node.style.zIndex = String(100 + index * 10);
  });
  const modal = [...layers].reverse().find((layer) => layer.options().modal);
  if (!modal) {
    if (bodyOverflow !== undefined) {
      document.body.style.overflow = bodyOverflow;
      bodyOverflow = undefined;
    }
    return;
  }
  if (bodyOverflow === undefined) bodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const allowed = layers
    .filter((layer) => isChild(layer, modal))
    .map((layer) => surface(layer))
    .filter((node): node is HTMLElement => !!node);
  for (const root of allowed) {
    for (let node: HTMLElement | null = root; node?.parentElement; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (
          !(sibling instanceof HTMLElement) ||
          sibling === node ||
          // 游离豁免层（如全局通知浮层）：不属于任何弹窗链，模态打开时仍要可见、可点、读屏可达。
          sibling.hasAttribute('data-layer-exempt') ||
          allowed.some((el) => sibling.contains(el)) ||
          isolated.has(sibling)
        )
          continue;
        isolated.set(sibling, {
          inert: sibling.getAttribute('inert'),
          hidden: sibling.getAttribute('aria-hidden'),
        });
        sibling.setAttribute('inert', '');
        sibling.setAttribute('aria-hidden', 'true');
      }
      if (node.parentElement === document.body) break;
    }
  }
}
function ownsTarget(layer: Layer, target: EventTarget | null) {
  return (
    target instanceof Node &&
    layers.some(
      (child) => isChild(child, layer) && child.options().nodeRef.current?.contains(target),
    )
  );
}
function keydown(event: KeyboardEvent) {
  const top = layers[layers.length - 1];
  if (!top || event.defaultPrevented) return;
  const options = top.options();
  if (event.isComposing || event.keyCode === 229) {
    if (
      event.key === 'Enter' &&
      layers.some((layer) => layer.options().modal && ownsTarget(layer, event.target))
    )
      event.preventDefault();
    return;
  }
  if (event.key === 'Escape') {
    // Monaco（关补全/撤选区）和显式声明自理 Escape 的容器先吃自己的 Escape。
    if (
      event.target instanceof Element &&
      event.target.closest('.monaco-editor, [data-esc-handled]')
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    options.onDismiss('escape');
    return;
  }
  if (event.key !== 'Tab') return;
  const modal = [...layers].reverse().find((layer) => layer.options().modal);
  if (options.dismissOnTab) {
    // A menu exits relative to its trigger, not its portal's position in body.
    const roots = modal
      ? layers
          .filter((layer) => isChild(layer, modal) && !isChild(layer, top))
          .map((layer) => layer.options().nodeRef.current)
      : [document.body];
    const candidates = [...new Set(roots.flatMap((root) => (root ? focusables(root) : [])))].filter(
      (node) => !ownsTarget(top, node),
    );
    const anchor = options.triggerRef?.current ?? top.opener;
    const index = candidates.indexOf(anchor as HTMLElement);
    const next = index + (event.shiftKey ? -1 : 1);
    const target =
      candidates[next] ??
      (modal
        ? candidates[event.shiftKey ? candidates.length - 1 : 0]
        : canFocus(anchor)
          ? anchor
          : undefined);
    event.preventDefault();
    event.stopImmediatePropagation();
    options.onDismiss('tab');
    target?.focus({ preventScroll: true });
    return;
  }
  if (!modal) return;
  const nodes = layers
    .filter((layer) => isChild(layer, modal))
    .flatMap((layer) => {
      const root = layer.options().nodeRef.current;
      return root ? focusables(root) : [];
    });
  const first = nodes[0],
    last = nodes[nodes.length - 1],
    active = document.activeElement;
  if (!first) {
    event.preventDefault();
    modal.options().nodeRef.current?.focus();
  } else if (event.shiftKey && (active === first || !nodes.includes(active as HTMLElement))) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && (active === last || !nodes.includes(active as HTMLElement))) {
    event.preventDefault();
    first.focus();
  }
}
function pointerdown(event: Event) {
  const top = layers[layers.length - 1];
  if (!top || !top.options().dismissOutside) return;
  const trigger = top.options().triggerRef?.current;
  if (
    ownsTarget(top, event.target) ||
    (event.target instanceof Node && trigger?.contains(event.target))
  )
    return;
  top.options().onDismiss('outside');
}
function blur() {
  const top = layers[layers.length - 1];
  if (top?.options().dismissOnBlur) top.options().onDismiss('blur');
}
function focusin(event: FocusEvent) {
  const modal = [...layers].reverse().find((layer) => layer.options().modal);
  if (!modal || ownsTarget(modal, event.target)) return;
  const node = modal.options().nodeRef.current;
  if (!node) return;
  (focusables(node)[0] ?? node).focus({ preventScroll: true });
}
export function useLayer(options: LayerOptions) {
  const id = useId();
  const parent = useContext(LayerContext);
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  useLayoutEffect(() => {
    if (!options.open) return;
    const node = options.nodeRef.current;
    if (!node && options.modal) return;
    const item: Layer = {
      id,
      parent,
      options: () => latest.current,
      opener: document.activeElement,
      fallback: options.fallbackFocusRef?.current ?? null,
      style: '',
    };
    item.style = surface(item)?.style.zIndex ?? '';
    const childIndex = layers.findIndex((child) => child.parent === id);
    if (childIndex < 0) layers.push(item);
    else layers.splice(childIndex, 0, item);
    refresh();
    if (layers.length === 1) {
      window.addEventListener('keydown', keydown, true);
      window.addEventListener('pointerdown', pointerdown, true);

      window.addEventListener('blur', blur);
      document.addEventListener('focusin', focusin, true);
    }
    if (options.modal && node && layers[layers.length - 1] === item) {
      const target = options.initialFocusRef?.current;
      (canFocus(target) ? target : (focusables(node)[0] ?? node)).focus({ preventScroll: true });
    }
    return () => {
      const current = latest.current;
      const active = document.activeElement;
      const wasTop = layers[layers.length - 1] === item;
      const shouldRestore =
        wasTop &&
        (active === document.body ||
          active === null ||
          ownsTarget(item, active) ||
          !active.isConnected);
      const index = layers.indexOf(item);
      if (index >= 0) layers.splice(index, 1);
      const root = surface(item);
      if (root) root.style.zIndex = item.style;
      refresh();
      if (layers.length === 0) {
        window.removeEventListener('keydown', keydown, true);
        window.removeEventListener('pointerdown', pointerdown, true);

        window.removeEventListener('blur', blur);
        document.removeEventListener('focusin', focusin, true);
      }
      if (current.restoreFocus !== false && shouldRestore) {
        const opener = current.shouldRestoreOpener?.() === false ? null : item.opener;
        const target = canFocus(opener) ? opener : item.fallback;
        if (canFocus(target)) target.focus({ preventScroll: true });
      }
    };
    // Registration lifetime follows visibility, not callbacks or state updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, parent, options.open]);
  return id;
}
