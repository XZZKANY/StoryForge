import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postcss, { type Rule } from 'postcss';
import tailwindcss from 'tailwindcss';
import ts from 'typescript';
import { test } from 'vitest';
import config from '../tailwind.config.js';

// Compile the production stylesheet: source-only checks missed Tailwind cascade ordering.
// This locks the layering contract; actual geometry/colors still need browser verification.
test('编译后的默认焦点是 base 兜底，不覆盖组件 outline/ring 或注入第二套 shadow', async () => {
  const { root } = await postcss([tailwindcss(config)]).process(
    readFileSync('src/index.css', 'utf8'),
    {
      from: 'src/index.css',
    },
  );
  const rules: Rule[] = [];
  root.walkRules((rule) => {
    rules.push(rule);
  });
  const find = (selector: string) => {
    const result = rules.find((rule) => rule.selectors.includes(selector));
    assert.ok(result, `Missing compiled selector: ${selector}`);
    return result;
  };
  const declarations = (rule: Rule) => {
    const values: Record<string, string> = {};
    rule.walkDecls((decl) => {
      values[decl.prop] = decl.value;
    });
    return values;
  };
  const fallback = find(':focus-visible');
  assert.equal(
    rules.filter((rule) => rule.selectors.some((selector) => selector.startsWith(':focus-visible')))
      .length,
    1,
    'Do not append another global focus rule after utilities',
  );
  assert.equal(declarations(fallback).outline, '2px solid rgb(var(--agent))');
  assert.equal(declarations(fallback)['box-shadow'], undefined);
  assert.ok(rules.indexOf(fallback) < rules.indexOf(find('.outline-none')));
  assert.ok(rules.indexOf(fallback) < rules.indexOf(find('.focus-visible\\:ring-2:focus-visible')));
  assert.deepEqual(declarations(find('.sf-input:focus')), {
    outline: 'none',
    'border-color': 'rgb(var(--accent))',
    'box-shadow': 'inset 0 0 0 1px rgb(var(--accent))',
  });
  assert.deepEqual(declarations(find('.sf-inner-input:focus')), {
    outline: 'none',
    'box-shadow': 'none',
  });
  const forced = rules.find(
    (rule) =>
      rule.selectors.includes('.sf-input:focus') &&
      rule.parent?.type === 'atrule' &&
      'params' in rule.parent &&
      rule.parent.params === '(forced-colors: active)',
  );
  assert.ok(forced, 'High contrast needs a system-color outline, not only box-shadow');
  assert.equal(declarations(forced).outline, '2px solid Highlight');
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.tsx') ? [path] : [];
  });
}

test('所有第一方文本/数字/下拉控件都声明焦点 owner，checkbox/range 不豁免默认焦点', () => {
  const missing: string[] = [];
  let controls = 0;
  for (const path of sourceFiles('src')) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = node.tagName.getText(source);
        if (['input', 'textarea', 'select', 'Input', 'Textarea', 'Select'].includes(tag)) {
          controls++;
          const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
          const value = (name: string) =>
            attrs.find((a) => a.name.getText(source) === name)?.initializer;
          const type = value('type');
          const native =
            type &&
            ts.isStringLiteral(type) &&
            ['checkbox', 'radio', 'range', 'file', 'hidden', 'color'].includes(type.text);
          const classes = value('className');
          const primitive = ['Input', 'Textarea', 'Select'].includes(tag);
          const forwardedControl =
            path.replaceAll('\\', '/') === 'src/components/ui/FormControls.tsx' &&
            node.attributes.properties.some(
              (attribute) =>
                ts.isJsxSpreadAttribute(attribute) &&
                attribute.expression.getText(source) === 'control',
            );
          const hasOwner =
            primitive ||
            forwardedControl ||
            (classes &&
              ts.isStringLiteral(classes) &&
              classes.text
                .split(/\s+/)
                .some((token) => ['sf-input', 'sf-inner-input'].includes(token)));
          if (native ? hasOwner : !hasOwner)
            missing.push(
              `${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`,
            );
          for (const name of ['onFocus', 'onBlur', 'style']) {
            assert.doesNotMatch(
              value(name)?.getText(source) ?? '',
              /boxShadow/,
              `${path}: focus styling belongs in CSS, not ${name}`,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.ok(controls >= 25, 'Audit must cover the application, not a hand-picked list');
  assert.deepEqual(missing, []);
});

test('命令面板和命令式内联提问同样声明外壳焦点，不遗漏 React 之外的 textarea', () => {
  const palette = readFileSync('src/components/CommandPalette.tsx', 'utf8');
  assert.match(palette, /className="sf-input-shell [^"]*focus-within:border-accent/);
  // 行间 zone 的 DOM 已收进 inline-chat-dom.ts（E21 可达性修复时从 hook 抽离）。
  const inline = readFileSync('src/components/editor/inline-chat-dom.ts', 'utf8');
  assert.match(inline, /container.className = 'sf-inline-chat sf-input-shell'/);
  assert.match(inline, /textarea.className = 'sf-inline-chat__textarea sf-inner-input'/);
});

test('基础组件编译样式集中定义尺寸/主题/禁用，错误焦点覆盖普通焦点但不叠加内环', async () => {
  const { root } = await postcss([tailwindcss(config)]).process(
    readFileSync('src/index.css', 'utf8'),
    { from: 'src/index.css' },
  );
  const rules: Rule[] = [];
  root.walkRules((rule) => {
    rules.push(rule);
  });
  const find = (selector: string) => {
    const found = rules.find((rule) => rule.selectors.includes(selector));
    assert.ok(found, `Missing compiled selector: ${selector}`);
    return found;
  };
  const value = (rule: Rule, prop: string) => {
    let result: string | undefined;
    rule.walkDecls(prop, (decl) => {
      result = decl.value;
    });
    return result;
  };
  const base = find('.sf-form-control');
  assert.equal(value(base, '--control-height'), '36px');
  assert.equal(value(base, 'border-radius'), 'var(--radius-md)');
  assert.equal(value(base, 'background'), 'rgb(var(--background))');
  for (const [size, height] of [
    ['sm', '32px'],
    ['lg', '40px'],
  ]) {
    assert.equal(
      value(
        find(`:is(.sf-form-control, .sf-form-shell)[data-control-size='${size}']`),
        '--control-height',
      ),
      height,
    );
  }
  assert.equal(value(find(':is(.sf-form-control, .sf-form-shell):disabled'), 'opacity'), '0.5');
  assert.equal(value(find('.sf-form-shell:disabled .sf-form-control'), 'opacity'), '1');
  const inner = find('.sf-form-control[data-in-shell]');
  assert.equal(value(inner, 'border'), '0');
  assert.equal(value(inner, 'background'), 'transparent');
  assert.equal(value(find('.sf-inner-input:focus'), 'box-shadow'), 'none');
  const error = find(".sf-form-control.sf-input[aria-invalid]:not([aria-invalid='false']):focus");
  assert.equal(value(error, 'box-shadow'), 'inset 0 0 0 1px rgb(var(--error))');
  assert.ok(rules.indexOf(error) > rules.indexOf(find('.sf-input:focus')));
  assert.ok(rules.indexOf(error) > rules.indexOf(find('.sf-form-shell:focus-within')));
});

test('图标按钮所有尺寸由新底座管理，旧 28px 样式不能覆盖组件', async () => {
  const { root } = await postcss([tailwindcss(config)]).process(
    readFileSync('src/index.css', 'utf8'),
    { from: 'src/index.css' },
  );
  const conflicting: string[] = [];
  let square = false;
  root.walkRules((rule) => {
    if (rule.selector === '.sf-button.sf-icon-button') {
      const declarations = new Map<string, string>();
      rule.walkDecls((d) => {
        declarations.set(d.prop, d.value);
      });
      assert.equal(declarations.get('width'), 'var(--button-height)');
      assert.equal(declarations.get('height'), 'var(--button-height)');
      assert.equal(declarations.get('padding'), '0');
      square = true;
    }
    if (rule.selector === '.sf-icon-button' || rule.selector === '.sf-icon-button:hover')
      conflicting.push(rule.selector);
  });
  assert.equal(square, true);
  assert.deepEqual(conflicting, []);
});
