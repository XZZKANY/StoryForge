import assert from 'node:assert/strict';
import { act, createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, test, vi } from 'vitest';
import { Input, InputShell, Select, Textarea } from '../src/components/ui';
import { ProjectLibrary } from '../src/components/app/ProjectLibrary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];
function mount(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => root.render(element));
  return { host, render: (next: React.ReactNode) => act(() => root.render(next)) };
}
afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

test('原生 ref、表单值、label/aria 与尺寸透传，visual size 不占用原生 size', () => {
  const input = createRef<HTMLInputElement>();
  const textarea = createRef<HTMLTextAreaElement>();
  const select = createRef<HTMLSelectElement>();
  const { host } = mount(
    <form>
      <label htmlFor="title">书名</label>
      <Input id="title" name="title" defaultValue="远山" ref={input} size={12} required />
      <Textarea name="summary" defaultValue="开篇" rows={5} controlSize="lg" ref={textarea} />
      <Select
        name="genre"
        defaultValue="fantasy"
        controlSize="sm"
        ref={select}
        aria-describedby="hint"
      >
        <option value="fantasy">幻想</option>
      </Select>
      <span id="hint">选择题材</span>
    </form>,
  );
  assert.ok(input.current && textarea.current && select.current);
  assert.equal(input.current.labels?.[0]?.textContent, '书名');
  assert.equal(input.current.size, 12);
  assert.equal(input.current.required, true);
  assert.equal(textarea.current.getAttribute('rows'), '5');
  assert.equal(select.current.getAttribute('aria-describedby'), 'hint');
  assert.deepEqual(
    [input.current, textarea.current, select.current].map((e) => e.dataset.controlSize),
    ['md', 'lg', 'sm'],
  );
  for (const element of [input.current, textarea.current, select.current]) {
    assert.ok(element.classList.contains('sf-input'));
    act(() => element.focus());
    assert.equal(document.activeElement, element);
  }
  const form = host.querySelector('form');
  assert.ok(form);
  assert.deepEqual(Array.from(new FormData(form)), [
    ['title', '远山'],
    ['summary', '开篇'],
    ['genre', 'fantasy'],
  ]);
});

test('受控 input/textarea/select 的修改、失焦、IME 事件由调用方持有', () => {
  const blur = vi.fn();
  const composition = vi.fn();
  function Harness() {
    const [text, setText] = useState('');
    const [genre, setGenre] = useState('a');
    return (
      <>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={blur}
          onCompositionEnd={composition}
        />
        <Textarea value={text} onChange={(e) => setText(e.target.value)} />
        <Select value={genre} onChange={(e) => setGenre(e.target.value)}>
          <option>a</option>
          <option>b</option>
        </Select>
        <output>
          {text}:{genre}
        </output>
      </>
    );
  }
  const { host } = mount(<Harness />);
  const input = host.querySelector('input')!;
  const textarea = host.querySelector('textarea')!;
  const select = host.querySelector('select')!;
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '新书');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '书' }));
    input.blur();
  });
  assert.equal(textarea.value, '新书');
  assert.equal(blur.mock.calls.length, 1);
  assert.equal(composition.mock.calls.length, 1);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      textarea,
      '新章',
    );
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    select.value = 'b';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(input.value, '新章');
  assert.equal(host.querySelector('output')?.textContent, '新章:b');
});

test('外壳统一 owner、尺寸、错误和原生禁用，恢复状态不重建控件或丢失草稿', () => {
  const shell = createRef<HTMLFieldSetElement>();
  function Example({ disabled, invalid }: { disabled: boolean; invalid: boolean }) {
    return (
      <InputShell
        ref={shell}
        controlSize="lg"
        disabled={disabled}
        invalid={invalid}
        aria-label="复合输入"
      >
        <span aria-hidden="true">图标</span>
        <Input aria-label="标题" defaultValue="草稿" disabled={false} />
        <Textarea aria-label="简介" />
        <Select aria-label="题材">
          <option>幻想</option>
        </Select>
        <button type="button">清除</button>
      </InputShell>
    );
  }
  const { host, render } = mount(<Example disabled invalid />);
  const input = host.querySelector('input')!;
  assert.ok(shell.current?.disabled);
  assert.equal(shell.current?.getAttribute('aria-invalid'), 'true');
  for (const element of host.querySelectorAll('input, textarea, select')) {
    assert.equal(element.getAttribute('data-control-size'), 'lg');
    assert.ok(element.hasAttribute('disabled'));
    assert.equal(element.getAttribute('aria-invalid'), 'true');
    assert.ok(element.classList.contains('sf-inner-input'));
    assert.ok(!element.classList.contains('sf-input'));
  }
  // Native fieldset disables action buttons in actual browsers; happy-dom does not emulate this fully.
  assert.ok(host.querySelector('button')?.closest('fieldset[disabled]'));
  render(<Example disabled={false} invalid={false} />);
  assert.equal(host.querySelector('input'), input);
  assert.equal(input.value, '草稿');
  assert.equal(input.disabled, false);
  assert.equal(input.getAttribute('aria-invalid'), null);
});

test('aria-invalid 各合法值保留；外壳错误不得被子控件 false 覆盖', () => {
  const { host } = mount(
    <>
      <Input aria-invalid="grammar" />
      <Textarea aria-invalid="spelling" />
      <Select aria-invalid="false" />
      <InputShell aria-invalid="true">
        <Input aria-invalid={false} />
        <Input disabled controlSize="sm" />
      </InputShell>
    </>,
  );
  assert.deepEqual(
    Array.from(host.querySelectorAll('input, textarea, select')).map((e) =>
      e.getAttribute('aria-invalid'),
    ),
    ['grammar', 'spelling', 'false', 'true', 'true'],
  );
  assert.ok(host.querySelector('fieldset input:last-child')?.hasAttribute('disabled'));
  assert.equal(
    host.querySelector('fieldset input:last-child')?.getAttribute('data-control-size'),
    'sm',
  );
});

test('原生多选和只读不被基础控件改写', () => {
  const { host } = mount(
    <form>
      <Input name="read" readOnly defaultValue="保留" />
      <Input name="disabled" disabled defaultValue="不提交" />
      <Select name="genres" multiple size={4} defaultValue={['a', 'c']}>
        <option value="a">A</option>
        <option value="b">B</option>
        <option value="c">C</option>
      </Select>
    </form>,
  );
  assert.equal(host.querySelector('input')?.readOnly, true);
  assert.equal(host.querySelector('select')?.getAttribute('size'), '4');
  assert.equal(host.querySelector('select')?.multiple, true);
  assert.deepEqual(
    Array.from(host.querySelectorAll<HTMLOptionElement>('option'))
      .filter((option) => option.selected)
      .map((option) => option.value),
    ['a', 'c'],
  );
  assert.equal(new FormData(host.querySelector('form')!).has('disabled'), false);
});

test('作品库实际消费 InputShell 后搜索仍过滤真实列表，不改写选择回调', () => {
  const select = vi.fn();
  const noop = () => {};
  const { host } = mount(
    <ProjectLibrary
      projects={['C:/作品/远山', 'C:/作品/长河']}
      activeProject={null}
      onNewProject={noop}
      onOpenProject={noop}
      onSelectProject={select}
      onResumeProject={noop}
      onOpenSettings={noop}
    />,
  );
  const input = host.querySelector('input[type="search"]')!;
  assert.ok(input.closest('.sf-input-shell'));
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '远山');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const rows = host.querySelectorAll<HTMLButtonElement>('button[data-project-path]');
  assert.equal(rows.length, 1);
  act(() => rows[0].click());
  assert.deepEqual(select.mock.calls, [['C:/作品/远山']]);
});
