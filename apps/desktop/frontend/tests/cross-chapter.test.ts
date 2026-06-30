import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatCrossChapterFindings,
  resolveChapterRefs,
} from '../src/components/chat-window/cross-chapter';
import { requestCrossChapterConsistency } from '../src/lib/api/cross-chapter';
import type { SemanticFile } from '../src/lib/project/types';

function draft(name: string, path: string): SemanticFile {
  return { path, relativePath: name, name, kind: 'draft', modified: 0, size: 0 };
}

const files: SemanticFile[] = [
  draft('第01章.md', '/proj/正文/第01章.md'),
  draft('第02章.md', '/proj/正文/第02章.md'),
  draft('第03章.md', '/proj/正文/第03章.md'),
  {
    path: '/proj/人物/沈砚.md',
    relativePath: '人物/沈砚.md',
    name: '沈砚.md',
    kind: 'character',
    modified: 0,
    size: 0,
  },
];

test('resolveChapterRefs maps 第N章 to draft files, zero-pad-insensitive, ordered', () => {
  const refs = resolveChapterRefs('第1章 跟 第3章 时间线对不对', files);
  assert.deepEqual(
    refs.map((ref) => ref.name),
    ['第01章', '第03章'],
  );
  assert.deepEqual(
    refs.map((ref) => ref.path),
    ['/proj/正文/第01章.md', '/proj/正文/第03章.md'],
  );
});

test('resolveChapterRefs supports @N and dedupes the same chapter', () => {
  const refs = resolveChapterRefs('@2 和 第2章 还有 @3', files);
  assert.deepEqual(
    refs.map((ref) => ref.name),
    ['第02章', '第03章'],
  );
});

test('resolveChapterRefs returns fewer than 2 when only one chapter is named', () => {
  assert.equal(resolveChapterRefs('把第1章改紧张', files).length, 1);
});

test('formatCrossChapterFindings renders findings with citations', () => {
  const text = formatCrossChapterFindings(
    [
      {
        type: 'naming',
        severity: 'high',
        chapters: ['第01章', '第02章'],
        finding: '主角称谓漂移',
        evidence: '沈砚/沈岩',
      },
    ],
    ['第01章', '第02章'],
    'deepseek-v4-pro',
  );
  assert.match(text, /发现 1 条/);
  assert.match(text, /naming·high/);
  assert.match(text, /沈砚\/沈岩/);
});

test('formatCrossChapterFindings reports a clean check', () => {
  const text = formatCrossChapterFindings([], ['第01章', '第03章'], null);
  assert.match(text, /未发现跨章硬冲突/);
});

test('requestCrossChapterConsistency posts chapters and maps the response', async () => {
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          findings: [
            {
              type: 'setting',
              severity: 'high',
              chapters: ['第01章', '第03章'],
              finding: '位置矛盾',
              evidence: '东南角/城北角',
            },
          ],
          model: 'deepseek-v4-pro',
          latency_ms: 42,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  try {
    const result = await requestCrossChapterConsistency({
      chapters: [
        { name: '第01章', content: '旧水门在东南角' },
        { name: '第03章', content: '旧水门在城北角' },
      ],
      focus: '设定一致性',
    });

    assert.equal(fetchCalls[0].url, 'http://127.0.0.1:8000/api/ide/review/cross-chapter');
    assert.equal(fetchCalls[0].init?.method, 'POST');
    assert.equal(
      (fetchCalls[0].init?.headers as Record<string, string>)['X-StoryForge-API-Key'],
      'local-dev-key',
    );
    assert.deepEqual(JSON.parse(String(fetchCalls[0].init?.body)), {
      chapters: [
        { name: '第01章', content: '旧水门在东南角' },
        { name: '第03章', content: '旧水门在城北角' },
      ],
      focus: '设定一致性',
    });
    assert.equal(result.findings[0].type, 'setting');
    assert.equal(result.model, 'deepseek-v4-pro');
    assert.equal(result.latencyMs, 42);
  } finally {
    if (previousFetch) {
      Object.defineProperty(globalThis, 'fetch', previousFetch);
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  }
});
