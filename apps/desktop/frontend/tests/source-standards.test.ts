import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// 从 apps/api/tests/test_source_code_standards.py 搬来的前端部分（2026-10，P6-4）：
// 拆过的大文件不许长回去，活跃模块目录下的新文件有行数上限，界面只经 lib/api 进引擎。
const HARD_LINE_LIMITS: Record<string, number> = {
  'src/App.tsx': 400,
  'src/components/ChatWindow.tsx': 500,
  'src/components/app/AppShell.tsx': 500,
  'src/components/app/useAppPreferences.ts': 500,
  'src/components/app/useEditorWorkspaceTabs.ts': 500,
  'src/components/app/useProjectCommands.ts': 500,
  'src/components/chat-window/ChatWindowView.tsx': 500,
  'src/components/chat-window/agent-result.ts': 500,
  'src/components/chat-window/context-files.ts': 500,
  'src/components/chat-window/useAgentRunControls.ts': 500,
  'src/components/chat-window/useAgentRunRecovery.ts': 500,
  'src/components/chat-window/useAgentStreamEvent.ts': 500,
  'src/components/chat-window/useChatSessionContext.ts': 500,
  'src/components/chat-window/useChatSubmission.ts': 500,
  'src/components/chat-window/useChatWindowState.ts': 500,
  'src/components/chat-window/useRunAuthorAgent.ts': 500,
};
const LIVE_MODULE_ROOTS = ['src/components/app', 'src/components/chat-window'];
const LIVE_MODULE_LINE_LIMIT = 500;
// 拆分前就有的叶子视图，是冻结的旧账，不作为新模块的先例。
const LIVE_MODULE_EXCEPTIONS = new Set(['src/components/chat-window/panels.tsx']);
const ENGINE_GATEWAYS = ['src/lib/api/', 'src/lib/engine/'];

function lineCount(path: string): number {
  const text = readFileSync(path, 'utf8');
  if (!text) return 0;
  const lines = text.split('\n').length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const relativePath = (path: string) => relative('.', path).replace(/\\/g, '/');

it('拆过的大文件不超过各自的硬上限', () => {
  const over = Object.entries(HARD_LINE_LIMITS).flatMap(([path, limit]) => {
    expect(existsSync(path), `${path} 不在了：从清单里去掉`).toBe(true);
    const lines = lineCount(path);
    return lines > limit ? [`${path}: ${lines} > ${limit}`] : [];
  });
  expect(over).toEqual([]);
});

it('活跃模块目录下的文件不超过 500 行', () => {
  const over = LIVE_MODULE_ROOTS.flatMap(sourceFiles)
    .map(relativePath)
    .filter((path) => !LIVE_MODULE_EXCEPTIONS.has(path))
    .flatMap((path) => {
      const lines = lineCount(path);
      return lines > LIVE_MODULE_LINE_LIMIT ? [`${path}: ${lines}`] : [];
    });
  expect(over).toEqual([]);
});

it('界面只经 lib/api 进引擎，不直接引引擎包或 lib/engine', () => {
  const offenders = sourceFiles('src')
    .map(relativePath)
    .filter((path) => !ENGINE_GATEWAYS.some((gateway) => path.startsWith(gateway)))
    .filter((path) =>
      /from\s+['"](@storyforge\/engine[^'"]*|[^'"]*\/engine\/[^'"]*)['"]|import\(\s*['"][^'"]*\/engine\/[^'"]*['"]\s*\)/.test(
        readFileSync(path, 'utf8'),
      ),
    );
  expect(offenders).toEqual([]);
});

const ENGINE_SRC = '../../../packages/engine/src';
const isTestSource = (path: string) => /\.test(-support)?\.tsx?$/.test(path);

it('引擎只在 readPort.ts 里解码 UTF-8，别处不自己 new TextDecoder', () => {
  const files = sourceFiles(ENGINE_SRC).filter((path) => !isTestSource(path));
  expect(files.length).toBeGreaterThan(100);
  const decoding = files
    .filter((path) => /new\s+TextDecoder\b/.test(readFileSync(path, 'utf8')))
    .map((path) => relative(ENGINE_SRC, path).replace(/\\/g, '/'));
  expect(decoding).toEqual(['readPort.ts']);
});

it('正文字数只在 project-core 实现一份，界面与引擎都从那里取', () => {
  const offenders = ['src', ENGINE_SRC]
    .flatMap(sourceFiles)
    .filter((path) => !isTestSource(path))
    .filter((path) => {
      const text = readFileSync(path, 'utf8');
      return (
        /\b(function|const|let|var)\s+(chapterChars|countProseChars)\b/.test(text) ||
        /replace\(\/\\s\+?\/[gu]*,\s*''\)\)\.length/.test(text)
      );
    })
    .map(relativePath);
  expect(offenders).toEqual([]);
  expect(readFileSync('src/lib/text-metrics.ts', 'utf8')).toContain(
    "export { countProseChars } from '@storyforge/project-core';",
  );
});
