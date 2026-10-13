import { pythonCasefold } from '../../kernel/casefold';
import { fsList, fsSearch } from '../../kernel/fsProjectTools';
import { fsRead, FsToolError } from '../../kernel/fsTools';
import type { JsonObject, JsonValue } from '../../kernel/json';
import { buildLlmContextSnapshot, llmContextSnapshotTraceSummary } from '../../kernel/llmContext';
import { llmContextSnapshotToPromptContextBundle } from '../../kernel/llmPromptContext';
import {
  buildKnowledgeProposalGroup,
  KNOWLEDGE_PROPOSAL_ARTIFACT_KIND,
} from '../../kernel/knowledgeProposals';
import { projectKnowledgeCandidates } from '../../kernel/projectKnowledge';
import {
  projectKnowledgeEntryIndex,
  projectKnowledgeRead,
  projectKnowledgeSearch,
} from '../../kernel/projectKnowledgeFiles';
import { PYTHON_WHITESPACE } from '../../kernel/pythonText';
import type { PlainJson } from '../../kernel/redaction';
import { reviewContextSummary } from '../../kernel/reviewSkills';
import { detectIntent, optionalString, roleHints, roleMentions } from '../runPayloads';
import type { ToolExecutionContext, ToolHandler, ToolResult } from './execution';
import type { ToolDeps } from './handlerDeps';
import { fsIntArg, requiredString } from './runtimeArguments';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const cpLen = (text: string) => Array.from(text).length;
const WHITESPACE_RUN = new RegExp(`${PYTHON_WHITESPACE}+`, 'u');

const completed = (
  output: Obj,
  trace: ToolResult['trace'],
  artifacts: ToolResult['artifacts'] = [],
) => ({ status: 'completed', output, trace, artifacts }) satisfies ToolResult;

function knowledgeSourceCounts(entries: readonly Obj[]): Obj {
  const counts: Record<string, number> = {};
  for (const entry of entries)
    if (typeof entry.source_type === 'string')
      counts[entry.source_type] = (counts[entry.source_type] ?? 0) + 1;
  return counts;
}

const normalizedKnowledgeTitle = (value: string) =>
  pythonCasefold(value.normalize('NFKC')).split(WHITESPACE_RUN).filter(Boolean).join(' ');

export function fsToolHandlers(deps: ToolDeps): Record<string, ToolHandler> {
  const { reader, platform, secrets } = deps;

  const contextLoad: ToolHandler = async (context, payload) => {
    const filePath = requiredString(payload, 'file_path');
    const content = requiredString(payload, 'content');
    const bundle = isObj(payload.context_bundle) ? payload.context_bundle : null;
    const summary = reviewContextSummary(bundle as never);
    const snapshot = await buildLlmContextSnapshot(
      reader,
      {
        runState: context.run as never,
        intent:
          optionalString(payload._agent_intent) ??
          detectIntent(context.userMessage, context.args, context.args.intent),
        userMessage: context.userMessage,
        filePath,
        content,
        contextBundle: bundle as PlainJson,
        roleHints: roleHints(context.args),
        roleMentions: roleMentions(context.args),
        eventHistory: context.run.events as PlainJson[],
        artifacts: context.run.artifacts as PlainJson[],
      },
      { platform, secrets },
    );
    return completed(
      {
        file_path: filePath,
        content,
        context_bundle: bundle,
        context_summary: summary,
        llm_context_snapshot: snapshot,
        llm_prompt_context_bundle: llmContextSnapshotToPromptContextBundle(snapshot, secrets),
      },
      {
        tool_name: 'context.load',
        status: 'completed',
        input_summary: { file_path: filePath, content_chars: cpLen(content) },
        output_summary: {
          context_file_count: summary.file_count,
          context_kinds: summary.kinds,
          llm_context: llmContextSnapshotTraceSummary(snapshot),
        },
      },
    );
  };

  const fsListHandler: ToolHandler = async (_context, payload) => {
    const root = requiredString(payload, 'project_root');
    const subpath = optionalString(payload.subpath);
    const output = await fsList(reader, root, subpath);
    return completed(output, {
      tool_name: 'fs.list',
      status: 'completed',
      input_summary: { subpath },
      output_summary: { entry_count: output.entries.length, truncated: output.truncated },
    });
  };

  const fsReadHandler: ToolHandler = async (_context, payload) => {
    const root = requiredString(payload, 'project_root');
    const path = requiredString(payload, 'path');
    const output = await fsRead(reader, root, path, {
      offset: fsIntArg(payload, 'offset', 0),
      limit: fsIntArg(payload, 'limit', 20_000),
    });
    return completed(output, {
      tool_name: 'fs.read',
      status: 'completed',
      input_summary: { path },
      output_summary: {
        path: output.path,
        returned_chars: output.returned_chars,
        truncated: output.truncated,
      },
    });
  };

  const fsSearchHandler: ToolHandler = async (_context, payload) => {
    const root = requiredString(payload, 'project_root');
    const query = requiredString(payload, 'query');
    const glob = optionalString(payload.glob) ?? '*.md';
    const output = await fsSearch(reader, root, query, {
      glob,
      useRegex: payload.use_regex === true,
      platform,
      ...(deps.regex ? { compile: deps.regex } : {}),
      ...(deps.clock ? { clock: deps.clock } : {}),
    });
    return completed(output, {
      tool_name: 'fs.search',
      status: 'completed',
      input_summary: { query: Array.from(query).slice(0, 200).join(''), glob },
      output_summary: { match_count: output.matches.length, truncated: output.truncated },
    });
  };

  const projectKnowledge: ToolHandler = async (_context, payload) => {
    const root = requiredString(payload, 'project_root');
    const action = requiredString(payload, 'action');
    let output: Obj;
    let summary: Obj;
    if (action === 'list') {
      const discovered = await projectKnowledgeCandidates(reader, root, 201);
      const entries = discovered.slice(0, 200) as Obj[];
      output = { action, entries, truncated: discovered.length > 200, warnings: [] };
      summary = {
        action,
        candidate_count: entries.length,
        source_counts: knowledgeSourceCounts(entries),
        truncated: output.truncated,
        warning_count: 0,
      };
    } else if (action === 'read') {
      const read = (await projectKnowledgeRead(reader, root, requiredString(payload, 'path'), {
        secrets,
        offset: fsIntArg(payload, 'offset', 0),
        limit: fsIntArg(payload, 'limit', 20_000),
      })) as Obj;
      output = { ...read, action };
      summary = {
        action,
        path: read.path,
        source_type: read.source_type,
        returned_chars: read.returned_chars,
        truncated: read.truncated,
        redacted: read.redacted,
        warning_count: (read.warnings as unknown[]).length,
      };
    } else if (action === 'search') {
      const found = (await projectKnowledgeSearch(reader, root, requiredString(payload, 'query'), {
        secrets,
        useRegex: payload.use_regex === true,
        ...(deps.regex ? { compile: deps.regex } : {}),
        ...(deps.clock ? { clock: deps.clock } : {}),
      })) as Obj;
      output = { ...found, action };
      summary = {
        action,
        match_count: (found.matches as unknown[]).length,
        scanned_files: found.scanned_files,
        truncated: found.truncated,
        redacted: found.redacted,
        warning_count: (found.warnings as unknown[]).length,
      };
    } else throw new FsToolError(`不支持的 Project Knowledge action：${action}`);
    return completed(output, {
      tool_name: 'project.knowledge',
      status: 'completed',
      input_summary: { action },
      output_summary: summary,
    });
  };

  const knowledgePropose: ToolHandler = async (context: ToolExecutionContext, payload) => {
    if (
      context.args._knowledge_proposal_group_created === true ||
      (await deps.artifacts.runHasArtifact(context.run.public_id, KNOWLEDGE_PROPOSAL_ARTIFACT_KIND))
    )
      throw new FsToolError('每个 AgentRun 最多生成一组 Project Knowledge 提议。');
    const root = requiredString(payload, 'project_root');
    const group = (await buildKnowledgeProposalGroup(reader, root, payload as JsonObject, {
      ...deps.proposals,
      platform,
    })) as Obj;
    context.args._knowledge_proposal_group_created = true;
    const index = await projectKnowledgeEntryIndex(reader, root);
    const known = new Set(index.entries.map((indexed) => indexed.entry.claim_fingerprint));
    const proposals = group.proposals as Obj[];
    for (const proposal of proposals) {
      if (proposal.operation !== 'create' && proposal.operation !== 'migrate') continue;
      const title = normalizedKnowledgeTitle(proposal.title as string);
      const conflicts = index.entries.filter(
        (indexed) =>
          indexed.entry.kind === proposal.kind &&
          normalizedKnowledgeTitle(indexed.entry.title) === title &&
          indexed.entry.claim_fingerprint !== proposal.claim_fingerprint,
      );
      if (conflicts.length) {
        const target = conflicts[0].relativePath;
        proposal.operation = 'conflict';
        proposal.target_path = target;
        proposal.related_knowledge_ids = conflicts
          .filter((indexed) => indexed.relativePath === target)
          .map((indexed) => indexed.entry.id);
      }
    }
    for (const raw of await deps.artifacts.artifactPayloads(KNOWLEDGE_PROPOSAL_ARTIFACT_KIND)) {
      const existing = isObj(raw) ? raw : {};
      if (existing.project_fingerprint !== group.project_fingerprint) continue;
      if (Array.isArray(existing.proposals))
        for (const item of existing.proposals)
          if (isObj(item) && typeof item.claim_fingerprint === 'string')
            known.add(item.claim_fingerprint);
    }
    const kept = proposals.filter((item) => !known.has(item.claim_fingerprint as string));
    const suppressed = proposals.length - kept.length;
    group.proposals = kept;
    return completed(
      {
        proposal_group_id: group.proposal_group_id,
        proposal_count: kept.length,
        suppressed_count: suppressed,
        targets: kept.map((item) => item.target_path),
        status: kept.length ? 'pending_author_review' : 'duplicate_suppressed',
      },
      {
        tool_name: 'knowledge.propose',
        status: 'completed',
        input_summary: { proposal_count: kept.length },
        output_summary: {
          proposal_count: kept.length,
          suppressed_count: suppressed,
          target_paths: kept.map((item) => item.target_path) as JsonValue[],
        },
      },
      kept.length
        ? [{ kind: KNOWLEDGE_PROPOSAL_ARTIFACT_KIND, payload: group, requires_confirmation: false }]
        : [],
    );
  };

  return {
    'context.load': contextLoad,
    'fs.list': fsListHandler,
    'fs.read': fsReadHandler,
    'fs.search': fsSearchHandler,
    'project.knowledge': projectKnowledge,
    'knowledge.propose': knowledgePropose,
  };
}
