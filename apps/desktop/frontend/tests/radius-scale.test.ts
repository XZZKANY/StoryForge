import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

// 圆角阶梯指纹护栏：值只有 index.css 的 --radius-* 一处，Tailwind 只转发。
// 谁写回任意值圆角（rounded-[10px]）、阶梯外档位（rounded-2xl）、裸 rounded（默认 4px）
// 或裸 border-radius: Npx，这里就红——因为这三种写法都会绕开「内圆角 = 外圆角 − 内边距」的同心关系。

const abs = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(abs(rel), 'utf8');

const LADDER = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
// full / none 不是尺寸档而是形状开关，允许但不参与同心关系
const SIZES = [...LADDER, 'full', 'none'];
const SIDES = ['', 't-', 'b-', 'l-', 'r-', 'tl-', 'tr-', 'bl-', 'br-', 's-', 'e-'];
const ALLOWED = new Set(SIDES.flatMap((side) => SIZES.map((size) => `rounded-${side}${size}`)));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(?:tsx?|css)$/.test(entry) ? [full] : [];
  });
}

test('--radius-* 五档各只定义一次', () => {
  const css = read('../src/index.css');
  for (const step of LADDER) {
    const hits = css.match(new RegExp(`--radius-${step}:`, 'g')) ?? [];
    assert.equal(hits.length, 1, `--radius-${step} 应恰好定义一次，实际 ${hits.length} 次`);
  }
});

test('tailwind 的 borderRadius 只转发 var(--radius-*)，不写死像素', () => {
  const config = read('../tailwind.config.js');
  const block = config.match(/borderRadius:\s*\{([^}]*)\}/)?.[1];
  assert.ok(block, 'tailwind.config.js 里找不到 borderRadius 配置块');
  const values = [...block.matchAll(/:\s*'([^']*)'/g)].map((m) => m[1]);
  assert.equal(values.length, LADDER.length);
  for (const value of values) {
    assert.match(value, /^var\(--radius-(?:xs|sm|md|lg|xl)\)$/, `越界圆角值：${value}`);
  }
});

test('src 下不存在阶梯外的 rounded 工具类', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(abs('../src'))) {
    for (const token of readFileSync(file, 'utf8').match(/\brounded[\w[\]().%-]*/g) ?? []) {
      if (!ALLOWED.has(token)) offenders.push(`${file.replace(/.*[\\/]src[\\/]/, 'src/')}: ${token}`);
    }
  }
  assert.deepEqual(offenders, [], `越界圆角写法（应改用 rounded-{xs,sm,md,lg,xl,full}）：\n${offenders.join('\n')}`);
});

test('index.css 里的 border-radius 只用 token 或纯圆', () => {
  const offenders = (read('../src/index.css').match(/border-radius:[^;]+;/g) ?? []).filter(
    (rule) => !/var\(--radius-(?:xs|sm|md|lg|xl)\)/.test(rule) && !/\b9{3,4}px\b|50%/.test(rule),
  );
  assert.deepEqual(offenders, [], `裸像素圆角：\n${offenders.join('\n')}`);
});
