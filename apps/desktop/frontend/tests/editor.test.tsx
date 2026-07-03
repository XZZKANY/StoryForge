import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Editor } from '../src/components/Editor';
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
  assert.match(html, /data-render-has-file="false"/);
  assert.match(html, /data-testid="editor-empty"/);
  assert.match(html, /未选择文件/);
});

test('空状态根据 projectPath 给出打开项目后的提示文案', () => {
  const html = renderEditor({ projectPath: 'D:\\Books\\雾港回声' });
  assert.match(html, /在资源管理器中双击文件开始编辑/);
});

test('无项目时给出打开项目后的提示文案', () => {
  const html = renderEditor({ projectPath: null });
  assert.match(html, /打开项目后即可开始编辑/);
});

test('顶部工具栏常驻历史按钮与（传入回调时的）导出按钮', () => {
  const withExport = renderEditor({ onExportCurrent: noop });
  assert.match(withExport, /data-testid="editor-export-btn"/);
  assert.match(withExport, /导出当前稿/);
  assert.match(withExport, /data-testid="editor-history-btn"/);
  assert.match(withExport, /查看版本记录/);

  const withoutExport = renderEditor({});
  assert.equal(withoutExport.includes('editor-export-btn'), false);
});

test('源文本保留 e2e 规格依赖的关键符号（拆分 C3 前移护栏）', () => {
  // 注意：ide-shell.spec.ts 断言 editor-panel 在 Editor.tsx 中，但实际位于 App.tsx。
  // 此处仅断言 Editor.tsx 实际存在的标记，e2e spec 的 bug 需单独修复。
  const markers = [
    'recordRevisionLoop',
    'emitAuthorLoopResult',
    'editor-save-btn',
    'editor-export-btn',
  ];
  for (const marker of markers) {
    assert.ok(
      editorSource.includes(marker),
      `Editor.tsx 源文本缺失关键符号：${marker}（e2e 规格 ide-judge-repair 依赖此引用）`,
    );
  }
});

test('源文本保留已知 data-testid 标记集合（拆分时壳层引用须留在壳层）', () => {
  const knownTestIds = [
    'editor-root',
    'editor-empty',
    'editor-export-btn',
    'editor-history-btn',
    'editor-container',
  ];
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
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const rightWorkspaceSource = readFileSync('src/components/app/RightWorkspace.tsx', 'utf8');
  const activeSources = [appSource, editorSource, rightWorkspaceSource].join('\n');

  assert.equal(activeSources.includes('window.prompt'), false);
  assert.equal(activeSources.includes('window.alert'), false);
  assert.equal(activeSources.includes('window.confirm'), false);
  assert.equal(/(?<![.\w])alert\(/.test(activeSources), false);
  assert.equal(/(?<![.\w])confirm\(/.test(activeSources), false);
});
