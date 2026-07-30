import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

// 字号阶梯指纹护栏。改前全站 14 档绝对字号，其中 10/10.5、11/11.5、12/12.5 三对
// 是同一档的漂移（占全部字号声明的 82%）——因为任意值 text-[Npx] 写起来没有阻力。
// 这里把「阶梯是封闭的」变成可证伪断言：值只在 index.css，Tailwind 只转发，
// 任意值字号一处都不许有。字距不逐处手写，它挂在档位上（见 tailwind fontSize 元组）。

const abs = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(abs(rel), 'utf8');

const LADDER = ['3xs', '2xs', 'xs', 'sm', 'base', 'lg', 'xl', 'display'] as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

test('--text-* 八档各只定义一次', () => {
  const css = read('../src/index.css');
  for (const step of LADDER) {
    const hits = css.match(new RegExp(`--text-${step}:`, 'g')) ?? [];
    assert.equal(hits.length, 1, `--text-${step} 应恰好定义一次，实际 ${hits.length} 次`);
  }
});

test('tailwind 的 fontSize 只转发 var(--text-*)，且每档都是阶梯内的名字', () => {
  const config = read('../tailwind.config.js');
  const block = config.match(/fontSize:\s*\{([\s\S]*?)\n {6}\}/)?.[1];
  assert.ok(block, 'tailwind.config.js 里找不到 fontSize 配置块');
  const rungs = [...block.matchAll(/^\s*'?([\w-]+)'?:\s*\['([^']*)'/gm)];
  assert.deepEqual(
    rungs.map((m) => m[1]),
    [...LADDER],
    'fontSize 的档位必须与 --text-* 阶梯一一对应',
  );
  for (const [, name, value] of rungs) {
    assert.equal(value, `var(--text-${name})`, `${name} 档没有转发 token：${value}`);
  }
});

test('src 下不存在任意值字号', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(abs('../src'))) {
    for (const token of readFileSync(file, 'utf8').match(/\btext-\[[^\]]*\]/g) ?? []) {
      // text-[#fff] 之类的任意色不归字号阶梯管，只拦带长度单位的
      if (/\d\s*(?:px|rem|em|pt)\b/.test(token)) {
        offenders.push(`${file.replace(/.*[\\/]src[\\/]/, 'src/')}: ${token}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `任意值字号（应改用 text-{${LADDER.join(',')}}）：\n${offenders.join('\n')}`);
});

test('index.css 的绝对字号只用 token（.assistant-md 内的相对 em 除外）', () => {
  const offenders = (read('../src/index.css').match(/font-size:[^;]+;/g) ?? []).filter(
    (rule) => !/var\(--text-/.test(rule) && !/\d(?:\.\d+)?em\b/.test(rule),
  );
  assert.deepEqual(offenders, [], `裸像素字号：\n${offenders.join('\n')}`);
});

test('body 的 UI 字体走 --font-ui，不另写一条栈', () => {
  // 改前 body 硬编码了一条与 --font-ui 不同的栈（多 Roboto/Arial、少 CJK），
  // 导致全站 UI 实际继承的根本不是 token —— 两条栈打架，token 形同虚设。
  const body = read('../src/index.css').match(/\nbody \{[^}]*\}/)?.[0];
  assert.ok(body, '找不到 body 规则');
  assert.match(body, /font-family:\s*var\(--font-ui\);/);
});
