import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ArtifactViewer } from '../components/ide/views/ArtifactViewer';
import { IdeShell } from '../components/ide/shell/IdeShell';

const preview = {
  artifact: {
    id: 9,
    artifact_type: 'book_export',
    lineage_key: 'book-run:42:markdown',
    name: 'book.md',
    status: 'active',
    storage_uri: 'memory://book-runs/42/book.md',
    mime_type: 'text/markdown',
    size_bytes: 128,
    version: 2,
  },
  preview: {
    format: 'markdown',
    content_preview: '# 雾港航线\n\n正文',
    summary: { lineage_key: 'book-run:42:markdown' },
  },
  download: {
    id: 9,
    artifact_type: 'book_export',
    name: 'book.md',
    mime_type: 'text/markdown',
    storage_uri: 'memory://book-runs/42/book.md',
    download_mode: 'payload_preview',
    content_preview: '# 雾港航线',
    payload_summary: { book_run_id: 42 },
  },
  versions: [
    { id: 8, version: 1, name: 'book.md', status: 'active', created_at: '2026-05-28T01:00:00' },
    { id: 9, version: 2, name: 'book.md', status: 'active', created_at: '2026-05-28T02:00:00' },
  ],
  trace: {
    book_run: { id: 42, href: '/ide?panel.bottom=runs&book_run=42', label: 'BookRun' },
    model_run: { id: 101, href: '/ide?panel.bottom=runs&model_run=101', label: 'ModelRun' },
    judge_report: {
      id: 202,
      href: '/ide?panel.bottom=problems&judge_report=202',
      label: 'JudgeReport',
    },
    approve: { id: 303, href: '/ide?tab=scene:303', label: 'Approve' },
  },
} as const;

test('ArtifactViewer 渲染 markdown 预览、下载摘要、版本和追溯链', () => {
  const html = renderToStaticMarkup(React.createElement(ArtifactViewer, { preview }));

  assert.ok(html.includes('Artifact Viewer'));
  assert.ok(html.includes('Artifact #9'));
  assert.ok(html.includes('book.md'));
  assert.ok(html.includes('markdown'));
  assert.ok(html.includes('# 雾港航线'));
  assert.ok(html.includes('payload_preview'));
  assert.ok(html.includes('版本对比'));
  assert.ok(html.includes('v1'));
  assert.ok(html.includes('v2'));
  assert.ok(html.includes('BookRun → ModelRun → Approve'));
  assert.ok(html.includes('BookRun #42'));
  assert.ok(html.includes('ModelRun #101'));
  assert.ok(html.includes('JudgeReport #202'));
  assert.ok(html.includes('Approve #303'));
  assert.ok(html.includes('href="/ide?panel.bottom=runs&amp;book_run=42"'));
  assert.ok(html.includes('href="/ide?tab=scene:303"'));
});

test('ArtifactViewer 渲染 EPUB manifest 摘要', () => {
  const html = renderToStaticMarkup(
    React.createElement(ArtifactViewer, {
      preview: {
        ...preview,
        artifact: {
          ...preview.artifact,
          id: 10,
          name: 'book.epub',
          mime_type: 'application/epub+zip',
        },
        preview: {
          format: 'epub',
          content_preview: 'book.epub（book_epub_export，v1）',
          summary: { chapter_count: 3, manifest: [{ chapter_index: 1, chapter_title: '雾港' }] },
        },
      },
    }),
  );

  assert.ok(html.includes('epub'));
  assert.ok(html.includes('chapter_count'));
  assert.ok(html.includes('manifest'));
});

test('ArtifactViewer 渲染空状态', () => {
  const html = renderToStaticMarkup(React.createElement(ArtifactViewer));

  assert.ok(html.includes('当前没有选中的制品'));
});

test('BottomPanel artifacts 分支渲染 ArtifactViewer', () => {
  const html = renderToStaticMarkup(
    React.createElement(IdeShell, { initialState: { bottomPanel: 'artifacts' } }),
  );

  assert.ok(html.includes('Artifact Viewer'));
});
