/**
 * 版本记录的一行说明（作者 10-17 巡检）：AI 版本的标签是当时那条回复的 Markdown 原文，
 * 「**第4章已起草，请确认写盘。** --- ### …」，分支图里还露着 patch 内部编号。
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { BranchCanvas } from '../src/components/editor/BranchCanvas';
import { buildGraph, emptyManifest } from '../src/lib/branches';
import { versionLabel, versionSummaryText } from '../src/lib/version-label';

const AGENT_SUMMARY = [
  '**第4章已起草，请确认写盘。** 内容概要：',
  '---',
  '### 第4章·《缝隙》',
  '**开篇接续：** 陈默被困屋内，门外呼吸声未消。',
  '- 制造声源吸引变异体注意力',
].join('\n');

test('AI 回复原文压成一行纯文本：不露星号、分隔线、标题井号和列表符号', () => {
  const text = versionSummaryText(AGENT_SUMMARY)!;
  assert.equal(
    text,
    '第4章已起草，请确认写盘。 内容概要： 第4章·《缝隙》 开篇接续： 陈默被困屋内，门外呼吸声未消。 制造声源吸引变异体注意力',
  );
  assert.equal(
    versionSummaryText('**已起草** 内容概要： --- ### 第4章 正文'),
    '已起草 内容概要： 第4章 正文',
  );
});

test('来源与筛选按钮同名：Agent 叫 AI，Editor 叫手动；没摘要时退到文件名', () => {
  assert.equal(versionLabel({ source: 'Agent', summary: '**改好了**' }), 'AI · 改好了');
  assert.equal(
    versionLabel({ source: 'Editor', summary: '手动保存前快照' }),
    '手动 · 手动保存前快照',
  );
  assert.equal(versionLabel({ file: '正文/第004章.md' }), '正文/第004章.md');
});

test('分支图节点不再露出 patch 内部编号', () => {
  const versions = [
    {
      path: 'v1',
      contentRef: {
        kind: 'shadow-tree' as const,
        treeHash: 'a'.repeat(40),
        file: '正文/第004章.md',
      },
      timestamp: 1785422183736,
      source: 'Agent',
      summary: AGENT_SUMMARY,
      patchId: 'file-creation-cde8055a6d6541d0a2c1a96e27eea7e6',
    },
  ];
  const graph = buildGraph(versions as never, emptyManifest());
  const html = renderToStaticMarkup(
    <BranchCanvas
      graph={graph}
      activeBranchId="main"
      selectedNodeId={null}
      onSelectNode={() => {}}
      onSelectBranch={() => {}}
      onCheckout={() => {}}
      onBranchFrom={() => {}}
      readNodeState={async () => ({ exists: true, content: '' })}
    />,
  );
  assert.doesNotMatch(html, /patch file-creation/);
  assert.doesNotMatch(html, /\*\*/);
  assert.match(html, /AI · 第4章已起草/);
});
