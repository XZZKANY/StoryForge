import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// 从 apps/api/tests/test_source_code_standards.py 搬来的前端部分（2026-10，P6-4）：
// 拆过的大文件不许长回去，活跃模块目录下的新文件有行数上限，界面只经 lib/api 进引擎。
const HARD_LINE_LIMITS: Record<string, number> = {
  'src/App.tsx': 400,
  'src/components/ChatWindow.tsx': 500,
  'src/components/Editor.tsx': 500,
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
// components 下每个子目录都列在这里（下面有测试钉住），加上 components 顶层的文件，
// 就是 components 下的全部文件。
const COMPONENTS_ROOT = 'src/components';
const LIVE_MODULE_ROOTS = [
  'src/components/app',
  'src/components/chat-window',
  'src/components/command-palette',
  'src/components/editor',
  'src/components/icons',
  'src/components/settings',
  'src/components/shell',
  'src/components/ui',
];
const LIVE_MODULE_LINE_LIMIT = 500;
// 拆分前就有的叶子视图，是冻结的旧账，不作为新模块的先例；另一会话 #561 正在改它，等那边合了再拆。
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

function topLevelSourceFiles(root: string): string[] {
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((path) => statSync(path).isFile() && /\.tsx?$/.test(path));
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

it('components 下的文件不超过 500 行', () => {
  const over = [...topLevelSourceFiles(COMPONENTS_ROOT), ...LIVE_MODULE_ROOTS.flatMap(sourceFiles)]
    .map(relativePath)
    .filter((path) => !LIVE_MODULE_EXCEPTIONS.has(path))
    .flatMap((path) => {
      const lines = lineCount(path);
      return lines > LIVE_MODULE_LINE_LIMIT ? [`${path}: ${lines}`] : [];
    });
  expect(over).toEqual([]);
});

it('components 下每个子目录都列进了行数门禁', () => {
  const unlisted = readdirSync(COMPONENTS_ROOT)
    .map((name) => `${COMPONENTS_ROOT}/${name}`)
    .filter((path) => statSync(path).isDirectory() && !LIVE_MODULE_ROOTS.includes(path));
  expect(unlisted).toEqual([]);
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

// 宿主访问只经这些封装；挪进 lib/host/ 待 #561 合后做。
const HOST_ACCESS_MODULES = [
  // lib/engine：给引擎装配原生读写口与应用版本
  'src/lib/engine/agent.ts',
  'src/lib/engine/assistant.ts',
  'src/lib/engine/crossChapter.ts',
  'src/lib/engine/db.ts',
  'src/lib/engine/facts.ts',
  'src/lib/engine/ideCommands.ts',
  'src/lib/engine/llm.ts',
  'src/lib/engine/reader.ts',
  'src/lib/engine/writer.ts',
  // lib 顶层的宿主封装
  'src/lib/app-update.ts',
  'src/lib/book-cover.ts',
  'src/lib/desktop-llm-config.ts',
  'src/lib/host-close.ts',
  'src/lib/host-window.ts',
  'src/lib/native-delivery.ts',
  'src/lib/plugin-library.ts',
  'src/lib/shadow-git.ts',
  'src/lib/tauri-env.ts',
  'src/lib/tauri-fs.ts',
  'src/lib/update-check.ts',
];

it('只有白名单里的封装模块引 @tauri-apps，组件经它们调宿主', () => {
  const importing = sourceFiles('src')
    .map(relativePath)
    .filter((path) => /['"]@tauri-apps\//.test(readFileSync(path, 'utf8')));
  expect(importing.filter((path) => !HOST_ACCESS_MODULES.includes(path))).toEqual([]);
  expect(
    HOST_ACCESS_MODULES.filter((path) => !importing.includes(path)),
    '不再调宿主了：从白名单去掉',
  ).toEqual([]);
});

// 跨组件的窗口事件：名字跟着各自的领域模块以 export const XXX_EVENT 定义一次，派发与监听只引常量。
// localStorage 键也以 storyforge: 开头，所以只认 *_EVENT 常量和事件调用的参数。
const EVENT_CONSTANT = /^(.*?)\b(\w+_EVENT)\s*=\s*['"`](storyforge:[^'"`]*)['"`]/gm;
const EVENT_NAME_LITERAL_IN_CALL =
  /(?:dispatchEvent|addEventListener|removeEventListener|new\s+CustomEvent\s*(?:<[^(]*?>)?)\s*\(\s*['"`]storyforge:/;

it('窗口事件名各在一处定义成 export const XXX_EVENT，别处只用常量', () => {
  const texts = new Map(
    sourceFiles('src').map((path) => [relativePath(path), readFileSync(path, 'utf8')] as const),
  );
  const definitions = [...texts].flatMap(([path, text]) =>
    [...text.matchAll(EVENT_CONSTANT)].map(([, prefix, name, value]) => ({
      path,
      exported: prefix.trim() === 'export const',
      name,
      value,
    })),
  );
  expect(definitions.length).toBeGreaterThan(20);
  expect(definitions.filter((item) => !item.exported).map((item) => item.path)).toEqual([]);
  const repeated = (values: string[]) =>
    values.filter((value, index) => values.indexOf(value) !== index);
  expect(repeated(definitions.map((item) => item.name))).toEqual([]);
  expect(repeated(definitions.map((item) => item.value))).toEqual([]);

  const quotedUses = (text: string, value: string) =>
    ['"', "'", '`'].reduce(
      (count, quote) => count + text.split(`${quote}${value}${quote}`).length - 1,
      0,
    );
  const strayLiterals = definitions.flatMap(({ path: home, value }) =>
    [...texts]
      .filter(([path, text]) => quotedUses(text, value) > (path === home ? 1 : 0))
      .map(([path]) => `${path}: ${value}`),
  );
  expect(strayLiterals).toEqual([]);

  const literalCalls = [...texts]
    .filter(([, text]) => EVENT_NAME_LITERAL_IN_CALL.test(text))
    .map(([path]) => path);
  expect(literalCalls).toEqual([]);
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

// 剥 ``` 代码块的三种写法：正则字面量、模板串拼的 RegExp、按行比对围栏。提示词里示范输出格式的 ``` 不算。
const FENCE_STRIPPING = /\/\^?```|(?:\\`){3}|startsWith\(\s*['"]```|['"]```(?:json)?['"]/i;

it('引擎只在 kernel/json.ts 里剥模型回复外面的 ```json 代码块', () => {
  const files = sourceFiles(ENGINE_SRC).filter((path) => !isTestSource(path));
  expect(files.length).toBeGreaterThan(100);
  const stripping = files
    .filter((path) => FENCE_STRIPPING.test(readFileSync(path, 'utf8')))
    .map((path) => relative(ENGINE_SRC, path).replace(/\\/g, '/'));
  expect(stripping).toEqual(['kernel/json.ts']);
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

// 引擎里原来各抄一份的小函数，合并后只在共享模块定义一次，别处从那里取。
const ENGINE_SHARED_HELPERS: Record<string, string> = {
  isPyInt: 'kernel/json.ts',
  strOr: 'kernel/json.ts',
  countOf: 'kernel/pythonText.ts',
  stripNewlines: 'kernel/pythonText.ts',
  optionalString: 'kernel/pythonText.ts',
  clipWithEllipsis: 'kernel/pythonText.ts',
};

it('引擎的共享小函数各只定义一次，在 kernel/json.ts 或 kernel/pythonText.ts', () => {
  const files = sourceFiles(ENGINE_SRC).filter((path) => !isTestSource(path));
  expect(files.length).toBeGreaterThan(100);
  const definitions = files.flatMap((path) => {
    const text = readFileSync(path, 'utf8');
    const home = relative(ENGINE_SRC, path).replace(/\\/g, '/');
    return Object.keys(ENGINE_SHARED_HELPERS).flatMap((name) =>
      [...text.matchAll(new RegExp(`\\b(?:function|const|let|var)\\s+${name}\\b`, 'g'))].map(
        () => `${home}: ${name}`,
      ),
    );
  });
  expect(definitions.sort()).toEqual(
    Object.entries(ENGINE_SHARED_HELPERS)
      .map(([name, home]) => `${home}: ${name}`)
      .sort(),
  );
});
