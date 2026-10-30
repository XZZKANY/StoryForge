import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

// 界面用词表见仓库根 CONTEXT.md「界面用词」。只查含中文的字符串与 JSX 文字，
// 代码标识符照旧用 project / patch / agent / writeback / diff。
// 英文词按整词、不分大小写查；前后挨着字母、数字、下划线或连字符的不算，
// 所以 agent_run、agent-instructions.md 这类标识符与文件名不会被当成界面用词。
const englishWord = (word: string) => new RegExp(`(?<![A-Za-z0-9_-])${word}(?![A-Za-z0-9_-])`, 'i');
const RETIRED_TERMS: Array<{ term: string; pattern: RegExp; current: string }> = [
  { term: '项目', pattern: /项目/, current: '作品' },
  { term: '补丁', pattern: /补丁/, current: '修订' },
  { term: 'agent', pattern: englishWord('agent'), current: 'AI' },
  { term: '写回', pattern: /写回/, current: '写进文件' },
  { term: '写盘', pattern: /写盘/, current: '写进文件' },
  { term: '落盘', pattern: /落盘/, current: '写进文件' },
  { term: 'diff', pattern: englishWord('diff'), current: '对比' },
  { term: '稿件', pattern: /稿件/, current: '正文或文件' },
  { term: '稿子', pattern: /稿子/, current: '正文或文件' },
];
// 文件 → 这个文件里允许出现的弃用词。
const EXEMPTIONS: Record<string, ReadonlySet<string>> = {
  // 匹配作者在对话里打的字：作者还会打旧说法「写回」，要继续认。
  'src/lib/local-conversation-action.ts': new Set(['写回']),
  // 新建作品时写进示例文件的小说内容（「完成第一份能被读者追下去的稿子」），不是界面文案。
  'src/lib/project/initialize.ts': new Set(['稿子']),
};
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
    const exempt = EXEMPTIONS[file] ?? new Set<string>();
    return uiTexts(path).flatMap(({ line, text }) =>
      RETIRED_TERMS.filter(({ term }) => !exempt.has(term)).flatMap(({ pattern, current }) => {
        const retired = pattern.exec(text)?.[0];
        return retired ? [`${file}:${line} 「${retired}」改说「${current}」`] : [];
      }),
    );
  });
  expect(hits).toEqual([]);
});
