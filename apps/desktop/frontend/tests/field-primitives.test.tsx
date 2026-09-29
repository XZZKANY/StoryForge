import assert from 'node:assert/strict';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, test } from 'vitest';
import { Field, Input, Select } from '../src/components/ui';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Array<{ host: HTMLElement; root: ReturnType<typeof createRoot> }> = [];
function mount(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push({ host, root });
  act(() => root.render(element));
  return { host, render: (next: React.ReactNode) => act(() => root.render(next)) };
}
afterEach(() => {
  for (const { host, root } of roots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});
test('Field 生成唯一稳定 ID、label 和 description/error 关联，动态移除错误不留悬空 ID', () => {
  const ref = createRef<HTMLInputElement>();
  const renderFields = (error?: string) => (
    <>
      <span id="external">外部说明</span>
      <Field
        label="书名"
        description="本地名称"
        error={error}
        aria-describedby="external external"
        required
      >
        {(control) => <Input {...control} ref={ref} />}
      </Field>
      <Field label="题材" optional>
        {(control) => (
          <Select {...control}>
            <option>幻想</option>
          </Select>
        )}
      </Field>
    </>
  );
  const { host, render } = mount(renderFields('不能为空'));
  const input = ref.current!;
  const id = input.id;
  const select = host.querySelector('select')!;
  assert.notEqual(input.id, select.id);
  assert.equal(input.labels?.[0]?.htmlFor, id);
  assert.equal(input.required, true);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  const ids = input.getAttribute('aria-describedby')!.split(' ');
  assert.equal(new Set(ids).size, 3);
  for (const id of ids) assert.ok(document.getElementById(id));
  assert.equal(document.getElementById(`${id}-error`)?.textContent, '不能为空');
  render(renderFields());
  assert.equal(ref.current, input);
  assert.equal(input.id, id);
  assert.equal(input.getAttribute('aria-invalid'), null);
  assert.equal(document.getElementById(`${id}-error`), null);
  assert.equal(input.getAttribute('aria-describedby'), `external ${id}-description`);
});
test('显式 ID 与帮助 ID 保留，空帮助/错误不创建描述；禁用和只读由控件持有', () => {
  const { host } = mount(
    <Field id="explicit" label="设置" description="" error="" layout="horizontal">
      {(control) => <Input {...control} disabled readOnly defaultValue="保持" />}
    </Field>,
  );
  const input = host.querySelector('input')!;
  assert.equal(input.id, 'explicit');
  assert.equal(input.getAttribute('aria-describedby'), null);
  assert.equal(input.disabled, true);
  assert.equal(input.readOnly, true);
  assert.equal(host.querySelector('[data-layout]')?.getAttribute('data-layout'), 'horizontal');
  assert.equal(input.labels?.[0]?.textContent, '设置');
});
