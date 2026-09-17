/**
 * D6 可达性护栏：壳子层的图标-only 按钮必须有显式可访问名；文本对比度达 WCAG 阈值。
 *
 * 背景：`title` 属性做可访问名的支持度因屏读者而异（NVDA 默认不读悬停 title、
 * VoiceOver 可能跳过），而裸 Lucide <svg> 不产生文本节点。只画了图标的按钮
 * 对屏幕阅读器就是「无名按钮」。显式 `aria-label` 才是稳定身份。
 *
 * 本测试读源码钉死两件事：
 *  1. 指定文件里「图标-only」的按钮，其 <button> 标签必须带非空 aria-label。
 *  2. index.css 里 --foreground/--muted/--subtle 对 --background 的 WCAG 比值达阈值（双主题）。
 *
 * 踩过的坑（别再回退）：
 *  - 不能用 `[^>]*>` 啃 JSX 开标签：按钮属性里普遍含箭头函数（`onClick={() => f()}`），
 *    `=>` 的 `>` 会被当成开标签结尾。这里用「按引号/花括号计深」的扫描器 `openingTagEnd`。
 *  - 「图标-only」的判定必须保守：条件渲染（`{badge && <span>3</span>}`）在静态层面
 *    无法确定到底渲不渲染文本。宁可漏报也不误报——误报会逼人给本来就有文字的按钮
 *    硬塞 aria-label，把护栏变成噪音。规则：摘掉图标节点后，只要还剩任何内容就放行。
 */
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const abs = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

// 已完成 aria-label 补齐的壳子面板（图标-only 按钮都在此钉死）。
const SWEPT_FILES = [
  'src/components/shell/ActivityBar.tsx',
  'src/components/shell/Titlebar.tsx',
  'src/components/shell/ObsPanel.tsx',
  'src/components/shell/SearchView.tsx',
  'src/components/shell/SidePanel.tsx',
  'src/components/shell/ToastHost.tsx',
  'src/components/shell/KnowledgeInboxView.tsx',
  'src/components/shell/ManuscriptView.tsx',
  'src/components/shell/ObservatoryView.tsx',
  'src/components/shell/BookProfileView.tsx',
];

/** 从 start 处的 `<标签` 起，按引号/花括号计深找开标签的 `>` 下标（避开 `=>` 与属性里的 `>`）。 */
function openingTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return i;
  }
  return source.length;
}

/**
 * 判定按钮子树是否「图标-only」。
 * 摘掉图标节点（内联 `<svg>` 与自闭合 PascalCase 组件，如 `<X size={11} />`）后，
 * 若只剩空白 → 铁定图标-only；只要还剩任何内容（裸文本 / `{...}` 表达式 / `<span>`）就放行。
 */
function isIconOnly(children: string): boolean {
  const withoutIcons = children
    .replace(/<svg[\s\S]*?<\/svg>/g, '') // 内联矢量
    .replace(/<[A-Z][A-Za-z0-9]*[^>]*\/>/g, ''); // 自闭合 PascalCase 图标
  // 剩下的可见字符（裸文本）或任何标签/表达式 → 可能有文字。
  return !/[一-龥A-Za-z0-9<{!]/.test(withoutIcons);
}

/** 收集每个 `<button>` 的「开标签源码 + 子节点源码」。 */
function buttons(source: string): Array<{ tag: string; children: string }> {
  const result: Array<{ tag: string; children: string }> = [];
  const openRe = /<button\b/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(source))) {
    const openEnd = openingTagEnd(source, m.index);
    const closeIdx = source.indexOf('</button>', openEnd);
    const childrenEnd = closeIdx === -1 ? source.length : closeIdx;
    result.push({
      tag: source.slice(m.index, openEnd + 1),
      children: source.slice(openEnd + 1, childrenEnd),
    });
  }
  return result;
}

test('壳子面板的图标-only 按钮都带非空 aria-label', () => {
  const offenders: string[] = [];
  for (const rel of SWEPT_FILES) {
    const source = readFileSync(abs(`../${rel}`), 'utf8');
    for (const { tag, children } of buttons(source)) {
      if (!isIconOnly(children)) continue;
      // aria-label 可以是字面量（"…"/'…'）、模板字符串（`…`）或 JSX 表达式（{…}）。
      const label = tag.match(/\baria-label\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|\{([^}]*)\})/);
      if (!label) {
        offenders.push(
          `${rel}: 图标-only 按钮缺 aria-label :: ${tag.replace(/\s+/g, ' ').slice(0, 140)}`,
        );
        continue;
      }
      const value = label.slice(1).find((part) => part !== undefined) ?? '';
      // 表达式里含变量/模板占位即视为运行时有名；纯空串才算缺名。
      if (!/[一-龥A-Za-z0-9$]/.test(value)) {
        offenders.push(`${rel}: aria-label 为空串`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `以下图标-only 按钮缺显式可访问名（aria-label）：\n${offenders.join('\n')}`,
  );
});

test('isIconOnly 只认铁证：有文字/元素/表达式一律不算图标-only', () => {
  // 真·图标-only：子节点只剩一个自闭合图标（或内联 svg）。
  assert.equal(isIconOnly('<X size={11} strokeWidth={2} />'), true);
  assert.equal(isIconOnly('<svg><path d="M0 0" /></svg>'), true);
  assert.equal(
    isIconOnly("\n  <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />\n"),
    true,
  );
  // 有可见文本 / 额外元素 / 条件渲染 → 一律不判为图标-only（宁可漏报不误报）。
  assert.equal(isIconOnly('<FilePlus size={14} /> <span>新建文件</span>'), false);
  assert.equal(
    isIconOnly("<BookOpen size={12} /> {breakdownRunning ? '生成中…' : '生成拆书报告'}"),
    false,
  );
  assert.equal(isIconOnly('<span className="dot">{count}</span>'), false);
});

test('SWEPT_FILES 列表里的文件都真实存在（防改名后护栏空转）', () => {
  for (const rel of SWEPT_FILES) {
    assert.ok(statSync(abs(`../${rel}`)).isFile(), `护栏目标不存在：${rel}`);
  }
});

// D2/D5：骨架屏与 sr-only 是一对搭档——.skeleton 做可见的加载占位，.sr-only 把语义留给
// 屏幕阅读器。两者都定义在 index.css；谁删了其中一个、或引用它们的地方被删光，这里就红，
// 防止「定义了但没人用」的孤儿工具悄悄堆积（.skeleton 在接入前就是这么躺了很久）。
test('骨架屏与 sr-only 工具既已定义也被实际引用', () => {
  const css = readFileSync(abs('../src/index.css'), 'utf8');
  assert.match(css, /\.skeleton\s*\{/, '.skeleton 定义缺失');
  assert.match(css, /\.sr-only\s*\{/, '.sr-only 定义缺失');
  const overview = readFileSync(abs('../src/components/app/BookOverview.tsx'), 'utf8');
  assert.ok(overview.includes('skeleton'), 'BookOverview 骨架屏引用了 .skeleton');
  assert.ok(overview.includes('sr-only'), 'BookOverview 用 sr-only 承载加载语义');
});

// ---------------------------------------------------------------------------
// 对比度护栏：把 index.css 里 --muted / --subtle 的 WCAG 注释变成可证伪的断言。
// 有人把提示文本调暗到低于阈值（或在亮色下调浅），这里就红。
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function parseToken(css: string, name: string, theme: 'dark' | 'light'): RGB {
  const scope =
    theme === 'dark'
      ? css.match(/:root\s*\{([\s\S]*?)\}/)?.[1]
      : css.match(/:root\[data-theme='light'\]\s*\{([\s\S]*?)\}/)?.[1];
  assert.ok(scope, `index.css 找不到 ${theme} 主题根块`);
  const m = scope.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  assert.ok(m, `找不到 --${name} token`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** WCAG 相对亮度（sRGB → 线性 → 加权）。 */
function relativeLuminance([r, g, b]: RGB): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 对比度 (L1+0.05)/(L2+0.05)。 */
function contrastRatio(a: RGB, b: RGB): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)];
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

test('正文/次级/提示文本对画布的对比度达 WCAG 阈值（双主题）', () => {
  const css = readFileSync(abs('../src/index.css'), 'utf8');
  for (const theme of ['dark', 'light'] as const) {
    const foreground = parseToken(css, 'foreground', theme);
    const muted = parseToken(css, 'muted', theme);
    const subtle = parseToken(css, 'subtle', theme);
    const background = parseToken(css, 'background', theme);

    // 主文本（大段正文）必须 AA 级 4.5:1。
    assert.ok(
      contrastRatio(foreground, background) >= 4.5,
      `${theme} --foreground/--background 对比度 ${contrastRatio(foreground, background).toFixed(2)} < 4.5`,
    );
    // 次级文本（次级标签/分区标题）AA 级 4.5:1。
    assert.ok(
      contrastRatio(muted, background) >= 4.5,
      `${theme} --muted/--background 对比度 ${contrastRatio(muted, background).toFixed(2)} < 4.5`,
    );
    // 提示/占位文本（非关键信息）按非文本控件 3:1 保底。
    assert.ok(
      contrastRatio(subtle, background) >= 3.0,
      `${theme} --subtle/--background 对比度 ${contrastRatio(subtle, background).toFixed(2)} < 3.0`,
    );
  }
});
