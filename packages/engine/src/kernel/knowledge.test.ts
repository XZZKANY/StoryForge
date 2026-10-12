import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-knowledge.windows.json';
import type { EncodedFile } from './contextFixture.test-support';
import { FsToolError } from './fsTools';
import { parseJson, type JsonObject } from './json';
import { collectProjectKnowledgeContext, mergeProjectKnowledgeEntries } from './knowledgeContext';
import {
  hasKnowledgeBlockMarker,
  knowledgeClaimFingerprint,
  parseKnowledgeMarkdown,
  plainNotesOutsideKnowledgeBlocks,
  upsertKnowledgeEntry,
  type KnowledgeEntry,
  type KnowledgeSource,
} from './knowledgeEntries';
import { compileKnowledgeOperation, materializedSource } from './knowledgeMaterialization';
import { buildKnowledgeProposalGroup, projectFingerprint } from './knowledgeProposals';
import { retrieveProjectKnowledge, type KnowledgeRetrievalResult } from './knowledgeRetrieval';
import { memoryProject } from './memoryProject.test-support';
import {
  collectOrdinaryContext,
  ordinaryContextFileAsContext,
  sourceDeliveryManifest,
} from './ordinaryContext';
import {
  projectKnowledgeEntryIndex,
  projectKnowledgeRead,
  projectKnowledgeSearch,
  readProjectContextFile,
} from './projectKnowledgeFiles';

const ROOT = golden.synthetic_root;
const platform = golden.platform as 'windows' | 'posix';
const secrets = { values: [] };
const ID1 = 'pk_11111111-1111-4111-8111-111111111111';
const ID3 = 'pk_33333333-3333-4333-8333-333333333333';
const SOURCE_KEYS = [
  'type',
  'path',
  'content_sha256',
  'agent_event_id',
  'locator',
  'title',
  'accessed_at',
  'summary_sha256',
] as const;
const [year, month, day, hour, minute, second, micro] = golden.fixed_now;
const NOW = new Date(
  Date.UTC(year, month - 1, day, hour, minute, second, Math.floor(micro / 1000)),
);

// 元数据不是合法 JSON 时，两边的 warning 措辞不同（接受的差异）：都归一成同一占位再比。
const PYTHON_JSON_ERROR =
  /(knowledge block \d+: )(?:Expecting|Unterminated|Invalid|Extra data)[^"\]]*?\(char \d+\)/g;
const TS_JSON_ERROR = /(knowledge block \d+: )knowledge metadata 第 \d+ 行第 \d+ 列：[^"\]]*/g;
const normalizeWarnings = (text: string) =>
  text
    .replace(PYTHON_JSON_ERROR, '$1<invalid metadata JSON>')
    .replace(TS_JSON_ERROR, '$1<invalid metadata JSON>');
// Python json 接受 NaN，于是走到下一项校验；TS 在 JSON 解析处就拒绝（范围外）。
const ACCEPTED_DIFFERENT = new Set(['nan-json']);

function sourceDict(source: KnowledgeSource) {
  return Object.fromEntries(SOURCE_KEYS.map((key) => [key, source[key] ?? null]));
}
function entryDict(entry: KnowledgeEntry) {
  return {
    id: entry.id,
    status: entry.status,
    kind: entry.kind,
    evidence_state: entry.evidence_state,
    title: entry.title,
    claim: entry.claim,
    sources: entry.sources.map(sourceDict),
    claim_fingerprint: entry.claim_fingerprint,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    superseded_by: entry.superseded_by,
  };
}
function retrievalDict(result: KnowledgeRetrievalResult) {
  return {
    items: result.items.map((item) => ({
      relative_path: item.relativePath,
      entry: entryDict(item.entry),
      selection_source: item.selectionSource,
      excerpt: item.excerpt,
      score: item.score,
      evidence_state: item.evidenceState,
      warning_count: item.warningCount,
    })),
    warnings: result.warnings,
    total_chars: result.totalChars,
    structured_paths: result.structuredPaths,
    plain_notes: result.plainNotes,
  };
}
function makeEntry(
  id: string,
  title: string,
  claim: string,
  sources: KnowledgeSource[] = [{ type: 'author_statement', agent_event_id: 'ake_1' }],
  updated = '2026-10-02T00:00:00Z',
): KnowledgeEntry {
  return {
    id,
    status: 'active',
    kind: 'world_rule',
    evidence_state: 'current',
    title,
    claim,
    sources,
    claim_fingerprint: knowledgeClaimFingerprint(title, claim),
    created_at: '2026-10-01T00:00:00Z',
    updated_at: updated,
    superseded_by: null,
  };
}

type PureRow = { fn: string; args_json: string; output_json?: string; error?: { message: string } };

function runPure(row: PureRow): unknown {
  const args = parseJson(row.args_json, 'args') as JsonObject;
  switch (row.fn) {
    case 'parse_knowledge_markdown': {
      const result = parseKnowledgeMarkdown(args.content as string);
      return { entries: result.entries.map(entryDict), warnings: result.warnings };
    }
    case 'plain_notes':
      return [
        hasKnowledgeBlockMarker(args.content as string),
        plainNotesOutsideKnowledgeBlocks(args.content as string),
      ];
    case 'knowledge_claim_fingerprint':
      return knowledgeClaimFingerprint(args.title as string, args.claim as string);
    case 'upsert': {
      const entry =
        args.id === 'replace'
          ? makeEntry(ID1, '灵力规则（修订）', '改写后的断言。', undefined, '2026-10-03T00:00:00Z')
          : makeEntry(ID3, '新规则', '新的断言。');
      return upsertKnowledgeEntry(args.content as string, entry);
    }
    case 'compile_operation': {
      const proposed = makeEntry(ID3, '新规则', '新的断言。', [
        { type: 'project_file', path: '设定/钟楼.md', content_sha256: 'sha256:' + 'c'.repeat(64) },
        { type: 'author_statement', agent_event_id: 'ake_9' },
      ]);
      const [after, entry] = compileKnowledgeOperation(args.before as string, proposed, {
        operation: args.operation as string,
        relatedKnowledgeIds: args.related as string[],
        updatedAt: '2026-10-05T00:00:00Z',
      });
      return { after, entry: entryDict(entry) };
    }
    case 'materialized_source':
      return sourceDict(materializedSource(args, 'ake_confirm'));
    case 'project_fingerprint':
      return projectFingerprint(args.root as string, platform);
    default:
      throw new Error(`Unknown pure oracle ${row.fn}`);
  }
}

describe('real Python knowledge pure functions', () => {
  for (const [index, row] of (golden.pure as PureRow[]).entries()) {
    const id = String((parseJson(row.args_json, 'args') as JsonObject).id ?? '');
    it(`${index} ${row.fn} ${id}`, () => {
      if (row.error) {
        expect(() => runPure(row)).toThrow(row.error.message);
        return;
      }
      const actual = normalizeWarnings(JSON.stringify(runPure(row)));
      const expected = normalizeWarnings(JSON.stringify(JSON.parse(row.output_json!)));
      if (row.fn === 'parse_knowledge_markdown' && ACCEPTED_DIFFERENT.has(id)) {
        expect(actual).not.toBe(expected);
        expect(actual).toContain('<invalid metadata JSON>');
      } else {
        expect(JSON.parse(actual)).toEqual(JSON.parse(expected));
      }
    });
  }
});

type Call = {
  fn: string;
  args: Record<string, never>;
  output_json?: string;
  error?: { message: string };
  writes: Record<string, EncodedFile | null>;
};
const record = golden.projects[0] as unknown as {
  files: Record<string, EncodedFile>;
  calls: Call[];
};
let uuidCounter = 0;
const newUuid = () => `00000000-0000-4000-8000-${(++uuidCounter).toString(16).padStart(12, '0')}`;

async function execute(project: ReturnType<typeof memoryProject>, call: Call): Promise<unknown> {
  const { reader } = project;
  const args = call.args;
  switch (call.fn) {
    case 'entry_index': {
      const index = await projectKnowledgeEntryIndex(reader, ROOT);
      return {
        entries: index.entries.map((item) => ({
          relative_path: item.relativePath,
          entry: entryDict(item.entry),
        })),
        warnings: index.warnings,
        structured_paths: index.structuredPaths,
        plain_notes: index.plainNotes,
      };
    }
    case 'project_knowledge_read':
      return projectKnowledgeRead(reader, ROOT, args.path, {
        secrets,
        offset: args.offset,
        limit: args.limit,
      });
    case 'project_knowledge_search':
      return projectKnowledgeSearch(reader, ROOT, args.query, {
        secrets,
        maxMatches: args.max_matches,
      });
    case 'read_project_context_file':
      return readProjectContextFile(reader, ROOT, args.path);
    case 'retrieve':
      return retrievalDict(
        await retrieveProjectKnowledge(reader, ROOT, {
          query: args.query,
          pinnedPaths: args.pinned_paths,
          excludedIds: args.excluded_ids,
          maxItems: args.max_items,
          maxChars: args.max_chars,
        }),
      );
    case 'proposal_group': {
      const group = await buildKnowledgeProposalGroup(reader, ROOT, call.args as JsonObject, {
        newUuid,
        now: () => NOW,
        platform,
      });
      return { ...group, project_fingerprint: '$FINGERPRINT' };
    }
    case 'ordinary': {
      const contextFiles = args.context_files;
      const collected = await collectOrdinaryContext(reader, ROOT, {
        contextFiles,
        structuredPaths: args.structured,
        platform,
        secrets,
      });
      const delivered = collected.files.map(ordinaryContextFileAsContext);
      return {
        files: delivered,
        omitted: collected.omitted,
        warnings: collected.warnings,
        manifest: sourceDeliveryManifest(collected, delivered, {
          requested: [...(contextFiles as []), { relative_path: '未采集.md' }],
          platform,
          secrets,
        }),
      };
    }
    case 'knowledge_context': {
      const bundle =
        args.bundle === 'storyforge'
          ? { project_root: 'storyforge://book' }
          : args.bundle === 'missing-root'
            ? { project_root: `${ROOT}\\missing` }
            : args.bundle === 'none'
              ? null
              : args.max_context_files
                ? { projectRoot: ` ${ROOT} ` }
                : {
                    project_root: ROOT,
                    knowledge_exclusions: { ids: [ID3, 'x', 5, 'pk_' + 'y'.repeat(70)] },
                  };
      const files = args.files;
      const collected = await collectProjectKnowledgeContext(reader, bundle, {
        contextFiles: files,
        query: args.query,
        platform,
        secrets,
      });
      const [merged, mergedWarnings] = mergeProjectKnowledgeEntries(collected, {
        contextFiles: files,
        maxContextFiles: args.max_context_files ?? 8,
        platform,
        secrets,
      });
      return {
        result: collected.result === null ? null : retrievalDict(collected.result),
        warnings: collected.warnings,
        ordinary:
          collected.ordinary === null
            ? null
            : {
                files: collected.ordinary.files,
                omitted: collected.ordinary.omitted,
                warnings: collected.ordinary.warnings,
              },
        recovery_json: collected.recoveryJson,
        merged,
        merged_warnings: mergedWarnings,
        manifest: sourceDeliveryManifest(collected.ordinary, merged as never, {
          requested: files,
          platform,
          secrets,
        }),
      };
    }
    default:
      throw new Error(`Unknown oracle call ${call.fn}`);
  }
}

describe('real Python knowledge project replay', () => {
  const project = memoryProject(ROOT, record.files);
  for (const [index, call] of record.calls.entries()) {
    it(`#${index} ${call.fn} ${JSON.stringify(call.args).slice(0, 80)}`, async () => {
      if (call.fn === 'author_write') {
        project.apply(call.writes);
        return;
      }
      if (call.error) {
        // Run once: a failing proposal group still consumes ids in the same order as Python.
        let failure: unknown = null;
        try {
          await execute(project, call);
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(FsToolError);
        expect((failure as Error).message).toContain(call.error.message);
        return;
      }
      const actual = normalizeWarnings(JSON.stringify(await execute(project, call)));
      expect(JSON.parse(actual)).toEqual(
        JSON.parse(normalizeWarnings(JSON.stringify(JSON.parse(call.output_json!)))),
      );
      expect(project.takeWrites()).toEqual({});
    });
  }
});
