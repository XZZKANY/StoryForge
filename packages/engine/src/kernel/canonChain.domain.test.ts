import { describe, expect, it } from 'vitest';
import type { ProjectReader } from '../readPort';
import { buildSceneConstraintBlock } from './canonContext';
import { buildCanonProjection } from './canonService';
import type { EncodedFile } from './contextFixture.test-support';
import { GenerationSourceCapture } from './generationSources';
import { InputDomainError } from './json';
import { memoryProject } from './memoryProject.test-support';

const ROOT = 'D:\\synthetic-book';
const file = (text: string): EncodedFile => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const chapters = { '正文/第001章.md': file('林舟出场。'), '正文/第002章.md': file('沈禾出场。') };

// 迁移计划 §4.3.1：作者声明写错直接报错（Python 静默丢弃或按 Python 语义继续）。
describe('canon declarations outside the input domain', () => {
  const cases: [string, string, string][] = [
    [
      'aliases as a string',
      '{"entities":[{"id":"a","canonical_name":"林舟","aliases":"阿舟"}]}',
      'entities[0].aliases',
    ],
    [
      'boolean chapter',
      '{"invariants":{"single_holder":[{"item":"刀","holder":"a","from_chapter":true}]}}',
      'invariants.single_holder[0].from_chapter',
    ],
    [
      'float chapter',
      '{"invariants":{"lifespan":[{"entity":"a","exits_after_chapter":2.0}]}}',
      'invariants.lifespan[0].exits_after_chapter',
    ],
    [
      'evidence line as text',
      '{"entities":[{"id":"a","evidence":[{"quote":"q","path":"p","start_line":"3"}]}]}',
      'entities[0].evidence[0].start_line',
    ],
    ['non-object entity', '{"entities":["林舟"]}', 'entities[0]'],
    ['syntax error', '{"entities":[}', '第 1 行'],
    ['byte order mark', '\ufeff{}', 'BOM'],
  ];
  for (const [name, canon, message] of cases) {
    it(name, async () => {
      const project = memoryProject(ROOT, {
        ...chapters,
        '.storyforge/canon/canon.json': file(canon),
      });
      const run = () =>
        buildCanonProjection(project.reader, project.writer, ROOT, { platform: 'windows' });
      await expect(run()).rejects.toThrow(InputDomainError);
      await expect(run()).rejects.toThrow(message);
      expect(project.takeWrites()).toEqual({});
    });
  }

  it('rejects a hook anchor chapter written as text', async () => {
    const project = memoryProject(ROOT, {
      ...chapters,
      '.storyforge/canon/hooks.json': file(
        '{"hooks":[{"description":"井底","status":"active","planted_at":{"chapter":"3"}}]}',
      ),
    });
    await expect(
      buildSceneConstraintBlock(project.reader, ROOT, null, { platform: 'windows' }),
    ).rejects.toThrow('hooks[0].planted_at.chapter');
  });

  it('treats an out-of-shape presence cache as stale and rebuilds it', async () => {
    const project = memoryProject(ROOT, {
      ...chapters,
      '.storyforge/canon/canon.json': file('{"entities":[{"id":"a","canonical_name":"林舟"}]}'),
    });
    const first = await buildCanonProjection(project.reader, project.writer, ROOT, {
      platform: 'windows',
    });
    project.takeWrites();
    const cache = JSON.stringify({
      ...first.presence,
      entities: [{ ...first.presence.entities[0], id: 5 }],
      _storyforge_source_revision: first.sourceRevision,
    });
    project.apply({ '.storyforge/canon/derived/presence.json': file(cache) });
    const second = await buildCanonProjection(project.reader, project.writer, ROOT, {
      platform: 'windows',
      refresh: false,
    });
    expect(second.presence).toEqual(first.presence);
    expect(Object.keys(project.takeWrites())).toContain('.storyforge/canon/derived/presence.json');
  });
});

describe('scene constraint current-file identity', () => {
  it('never lets a drive-relative path stand in for a project chapter', async () => {
    const project = memoryProject(ROOT, {
      ...chapters,
      '.storyforge/canon/canon.json': file(
        '{"invariants":{"lifespan":[{"entity":"a","exits_after_chapter":1}]}}',
      ),
    });
    // A host could resolve `D:第001章.md` against the drive's working directory.
    const reader: ProjectReader = {
      ...project.reader,
      resolveProjectPath: async (root, path) =>
        path === 'D:第001章.md'
          ? { relativePath: '正文/第002章.md', resolvedRelativePath: '正文/第002章.md' }
          : project.reader.resolveProjectPath(root, path),
    };
    const capture = await GenerationSourceCapture.create({
      root: ROOT,
      platform: 'windows',
      secrets: { values: [] },
    });
    const block = await buildSceneConstraintBlock(reader, ROOT, 'D:第001章.md', {
      platform: 'windows',
      capture,
    });
    expect(block).toContain('[canon 分阶段声明]');
    expect(capture.selections).toEqual([]);
  });
});
