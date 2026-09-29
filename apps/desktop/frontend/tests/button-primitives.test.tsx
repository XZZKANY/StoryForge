import assert from 'node:assert/strict';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, test, vi } from 'vitest';
import { Button, IconButton } from '../src/components/ui';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Array<{ root: ReturnType<typeof createRoot>; host: HTMLElement }> = [];
function mount(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push({ host, root });
  act(() => root.render(element));
  return { host, render: (next: React.ReactNode) => act(() => root.render(next)) };
}
afterEach(() => {
  for (const { root, host } of roots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});
test('按钮默认不提交、显式 submit 和 ref 保留，disabled/loading 拦截点击', () => {
  const ref = createRef<HTMLButtonElement>();
  const click = vi.fn();
  const submit = vi.fn((e: React.FormEvent) => e.preventDefault());
  const { host, render } = mount(
    <form onSubmit={submit}>
      <Button ref={ref} onClick={click}>
        保存
      </Button>
      <Button type="submit">提交</Button>
    </form>,
  );
  assert.equal(ref.current?.type, 'button');
  act(() => ref.current?.click());
  assert.equal(click.mock.calls.length, 1);
  assert.equal(submit.mock.calls.length, 0);
  act(() => host.querySelectorAll('button')[1].click());
  assert.equal(submit.mock.calls.length, 1);
  render(
    <Button ref={ref} onClick={click} loading loadingLabel="正在保存">
      保存
    </Button>,
  );
  assert.equal(ref.current?.disabled, true);
  assert.equal(ref.current?.getAttribute('aria-busy'), 'true');
  assert.equal(ref.current?.getAttribute('aria-label'), '正在保存');
  act(() => ref.current?.click());
  assert.equal(click.mock.calls.length, 1);
  render(
    <Button ref={ref} onClick={click} disabled>
      保存
    </Button>,
  );
  act(() => ref.current?.click());
  assert.equal(click.mock.calls.length, 1);
});
test('图标按钮名称/装饰和状态由公共入口派生', () => {
  const { host } = mount(
    <IconButton
      label="删除章节"
      icon={<svg />}
      variant="danger"
      size="xs"
      tooltip="删除需要确认"
    />,
  );
  const button = host.querySelector('button')!;
  assert.equal(button.getAttribute('aria-label'), '删除章节');
  assert.equal(button.dataset.variant, 'danger');
  assert.equal(button.dataset.size, 'xs');
  assert.ok(button.querySelector('[aria-hidden="true"] svg'));
});
