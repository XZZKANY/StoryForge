import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

// 界面用词表见仓库根 CONTEXT.md「界面用词」。只查含中文的字符串与 JSX 文字，
// 代码标识符照旧用 project / patch / agent。
const RETIRED_TERMS: Record<string, string> = { 项目: '作品', 补丁: '修订', Agent: 'AI' };
// 照抄 Rust 宿主原话的测试替身，宿主改词时一起改。
const EXEMPT_FILES = new Set(['src/lib/writeback-receipt-fixture.ts']);
const HAN = /[一-龥]/;

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function uiTexts(path: string): Array<{ line: number; text: string }> {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<{ line: number; text: string }> = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)) &&
      HAN.test(node.text)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      found.push({ line: line + 1, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

it('界面文案不用已弃用的说法', () => {
  const hits = sourceFiles('src').flatMap((path) => {
    const file = relative('.', path).replace(/\\/g, '/');
    if (EXEMPT_FILES.has(file)) return [];
    return uiTexts(path).flatMap(({ line, text }) =>
      Object.entries(RETIRED_TERMS)
        .filter(([retired]) => text.includes(retired))
        .map(([retired, current]) => `${file}:${line} 「${retired}」改说「${current}」`),
    );
  });
  expect(hits).toEqual([]);
});
