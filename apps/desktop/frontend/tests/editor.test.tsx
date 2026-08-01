import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Editor, EditorLoadStatus } from '../src/components/Editor';
import type { AppDialogApi } from '../src/components/app/AppDialog';

// G1 护栏：Editor.tsx 此前零单测，是所有前端拆分（C3）的硬阻塞。
// 本测试不改变任何行为，只固化两类契约：
//   1) 空状态（未选文件）的静态渲染结构（renderToStaticMarkup 不跑 effects，
//      Tauri invoke stub 抛错仅在 useEffect 内，不影响服务端渲染）。
//   2) e2e 规格（ide-judge-repair.spec.ts / ide-shell.spec.ts）用 readFileSync
//      断言源文本含关键符号，这里镜像成单元级护栏，使 C3 拆分能在 CI 早期失败。

const editorSource = readFileSync('src/components/Editor.tsx', 'utf8');
const suggestionWritebackSource = readFileSync(
  'src/components/editor/useSuggestionWriteback.ts',
  'utf8',
);
const monacoEditorSource = readFileSync('src/components/editor/useMonacoEditor.ts', 'utf8');
const settingsViewSource = readFileSync('src/components/SettingsView.tsx', 'utf8');
const versionHistorySource = readFileSync('src/components/editor/VersionHistory.tsx', 'utf8');

const noop = () => {};
const dialogs: AppDialogApi = {
  alert: async () => {},
  confirm: async () => true,
  prompt: async ({ defaultValue }) => defaultValue ?? '',
};

function renderEditor(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    React.createElement(Editor, {
      projectPath: 'D:\\Books\\雾港回声',
      filePath: null,
      onClose: noop,
      dialogs,
      ...overrides,
    }),
  );
}

test('空状态渲染 editor-root 容器与未选择文件提示', () => {
  const html = renderEditor();

  assert.match(html, /data-testid="editor-root"/);
  assert.match(html, /min-h-0/);
  assert.match(html, /overflow-hidden/);
  assert.match(html, /data-render-has-file="false"/);
  assert.match(html, /data-testid="editor-empty"/);
  assert.match(html, /未选择文件/);
});

test('Monaco 容器被锁在编辑器 flex 区域内，不随长文本撑开外层布局', () => {
  const html = renderEditor({ filePath: 'D:\\Books\\雾港回声\\正文\\第01章.md' });
  assert.match(html, /data-testid="editor-container"/);
  assert.match(html, /class="min-h-0 flex-1 overflow-hidden"[^>]*data-testid="editor-container"/);
});

test('正文编辑区始终铺满：限行宽不许再变成限宽居中的中间一栏（PR #196 观感回退）', () => {
  const prose = renderEditor({
    filePath: 'D:\\Books\\雾港回声\\正文\\第01章.md',
    editorProseMeasure: 'narrow',
  });
  assert.match(prose, /data-prose-measure="narrow"/);
  // 限宽（max-width）+ 居中容器是被回退掉的形状，别再出现在 Monaco 宿主这条链上。
  assert.doesNotMatch(prose, /max-width/);
  assert.doesNotMatch(prose, /justify-center[^>]*>\s*<div[^>]*data-testid="editor-container"/);
});

test('外部 flush 事件读取最新保存闭包，不沿用首个标签的分支状态', () => {
  assert.match(editorSource, /const saveCurrentFileRef = useRef\(saveCurrentFile\)/);
  assert.match(editorSource, /saveCurrentFileRef\.current = saveCurrentFile/);
  assert.match(
    editorSource,
    /REQUEST_SAVE_ACTIVE_FILE_EVENT[\s\S]*?saveCurrentFileRef\s*\.\s*current\(\)/,
  );
});

test('异步文件读取期间明确显示 loading，失败后显示错误而不是旧 model', () => {
  const loading = renderToStaticMarkup(
    React.createElement(EditorLoadStatus, {
      filePath: 'D:\\Books\\a.md',
      loadedFilePath: null,
      loadError: '',
    }),
  );
  assert.match(loading, /data-testid="editor-loading"/);
  assert.match(loading, /正在读取文件/);

  const failed = renderToStaticMarkup(
    React.createElement(EditorLoadStatus, {
      filePath: 'D:\\Books\\a.md',
      loadedFilePath: null,
      loadError: 'access denied',
    }),
  );
  assert.match(failed, /data-testid="editor-load-error"/);
  assert.match(failed, /读取文件失败/);
  assert.match(failed, /access denied/);
});

test('Canon derived 文件以只读 Monaco 打开（Q3a 后只读态由 data-read-only + Monaco 承载，只读徽章移到页签行）', () => {
  const html = renderEditor({
    filePath: 'D:\\Books\\雾港回声\\.storyforge\\canon\\derived\\dossier.md',
  });
  assert.match(html, /data-read-only="true"/);
  assert.match(monacoEditorSource, /updateOptions\(\{ readOnly \}\)/);
});

test('空状态根据 projectPath 给出打开项目后的提示文案', () => {
  const html = renderEditor({ projectPath: 'D:\\Books\\雾港回声' });
  assert.match(html, /在资源管理器中双击文件开始编辑/);
});

test('无项目时给出打开项目后的提示文案', () => {
  const html = renderEditor({ projectPath: null });
  assert.match(html, /打开项目后即可开始编辑/);
});

// Q3a：导出/历史/保存等文件操作已从 Editor 自己的工具行移到 EditorTabs 的「…」菜单，
// 事件通道（EXPORT_CURRENT_FILE / REQUEST_SAVE / 编辑器命令）保持不变。对应护栏见 editor-tabs.test.tsx。

test('源文本保留作者回环关键符号（拆分 C3 前移护栏）', () => {
  const markers = ['recordRevisionLoop', 'emitAuthorLoopResult'];
  for (const marker of markers) {
    assert.ok(editorSource.includes(marker), `Editor.tsx 源文本缺失关键符号：${marker}`);
  }
});

test('切换文件时取消待执行 autosave，避免旧缓冲写入新路径', () => {
  const loaderSource = readFileSync(
    join(process.cwd(), 'src/components/editor/useEditorFileLoader.ts'),
    'utf8',
  );
  assert.ok(loaderSource.includes('window.clearTimeout(autoSaveTimerRef.current)'));
  assert.ok(loaderSource.includes('isDirtyRef.current = false'));
});

test('源文本保留已知 data-testid 标记集合（拆分时壳层引用须留在壳层）', () => {
  const knownTestIds = ['editor-root', 'editor-empty', 'editor-container'];
  for (const testId of knownTestIds) {
    assert.ok(
      editorSource.includes(`data-testid="${testId}"`),
      `Editor.tsx 源文本缺失 data-testid="${testId}"`,
    );
  }
  assert.ok(
    versionHistorySource.includes('data-testid="version-history"'),
    'VersionHistory.tsx 源文本缺失 data-testid="version-history"',
  );
  // N-version：列表模式恢复前可「对比当前」，复用 buildPatchHunks 出 +/- 概要，不再盲恢复。
  assert.ok(
    versionHistorySource.includes('data-testid="version-preview-toggle"'),
    'VersionHistory.tsx 缺「对比当前」入口',
  );
  assert.ok(
    versionHistorySource.includes('buildPatchHunks(getCurrentContent()'),
    'VersionHistory.tsx 必须用 buildPatchHunks 对比选中快照与当前正文',
  );
});

test('建议写回保持整文件硬闸，并让分块接受走 hunk 级定位', () => {
  assert.ok(
    suggestionWritebackSource.includes('旧补丁不能直接写回'),
    '整文件接受必须继续在当前内容偏离 suggestion.before 时拒绝旧补丁',
  );
  assert.ok(
    suggestionWritebackSource.includes(
      'isWholeFileDrifted(currentContent, suggestion.before, normalizeEol)',
    ),
    '整文件漂移守卫必须走已被 patch-hunks 行为测试覆盖的 isWholeFileDrifted 纯函数',
  );
  assert.ok(
    suggestionWritebackSource.includes('applyPatchHunkToCurrent(currentContent, hunk)'),
    '分块接受必须基于当前内容定位单个 hunk，不能再要求整文件等于 suggestion.before',
  );
  assert.equal(
    suggestionWritebackSource.includes('请重新生成修订后再分块接受'),
    false,
    '分块接受不应因为其他 hunk 已写入就整补丁失效',
  );
});

test('恢复“不存在”版本按保存脏缓冲→快照→真删除→退计划→摘页签执行', () => {
  const restoreBlock = editorSource.match(
    /const handleRestore = async[\s\S]*?\/\/ 分支画布：把某节点正文恢复到编辑器/,
  )?.[0];
  assert.ok(restoreBlock, '找不到 handleRestore 不存在态恢复块');
  const saveAt = restoreBlock.indexOf('saveCurrentFileRef.current()');
  const snapshotAt = restoreBlock.indexOf('snapshotBeforeWrite(');
  const deleteAt = restoreBlock.indexOf('TauriFileSystem.deletePath(');
  const unmarkAt = restoreBlock.indexOf('unmarkChapterWrittenInPlan(');
  const dropAt = restoreBlock.indexOf('dropOpenFilePath(path)');
  assert.ok(saveAt >= 0 && saveAt < snapshotAt, '脏缓冲必须先保存，才能进入删除快照');
  assert.ok(snapshotAt < deleteAt, '影子快照失败必须阻断真删除');
  assert.ok(deleteAt < unmarkAt, '文件真删除后才能回退连载计划');
  assert.ok(unmarkAt < dropAt, '删除链完成前不得先摘页签');
  assert.doesNotMatch(restoreBlock, /writeFile\([^)]*,\s*['"]{2}/, '不存在态不得写空串');
});

test('空文件写入正文也必须先取版本 tree，不得被旧空串短路', () => {
  assert.match(
    editorSource,
    /const contentChanged = normalizeEol\(previous\) !== normalizeEol\(content\)/,
  );
  assert.doesNotMatch(editorSource, /contentChanged = previous !== ['"]{2}/);
});

test('设置页明确 Provider 运行时真相源来自后端环境变量', () => {
  assert.ok(
    settingsViewSource.includes('真实模型调用读取后端环境变量'),
    'Provider 设置页必须说明本机字段不驱动后端真实调用',
  );
  assert.ok(
    settingsViewSource.includes('STORYFORGE_LLM_*'),
    'Provider 测试连接说明必须指向后端 STORYFORGE_LLM_* 配置',
  );
  assert.ok(
    settingsViewSource.includes('provider-runtime-env-source'),
    'Provider 设置页必须保留后端 env 真相源提示标记',
  );
});

test('React 桌面入口不再调用原生 prompt/alert/confirm', () => {
  const appSources = [
    'src/App.tsx',
    'src/components/app/AppShell.tsx',
    'src/components/app/useAppPreferences.ts',
    'src/components/app/useEditorWorkspaceTabs.ts',
    'src/components/app/useProjectCommands.ts',
  ].map((path) => readFileSync(path, 'utf8'));
  const sidePanelSource = readFileSync('src/components/shell/SidePanel.tsx', 'utf8');
  const activeSources = [...appSources, editorSource, sidePanelSource].join('\n');

  assert.equal(activeSources.includes('window.prompt'), false);
  assert.equal(activeSources.includes('window.alert'), false);
  assert.equal(activeSources.includes('window.confirm'), false);
  assert.equal(/(?<![.\w])alert\(/.test(activeSources), false);
  assert.equal(/(?<![.\w])confirm\(/.test(activeSources), false);
});
