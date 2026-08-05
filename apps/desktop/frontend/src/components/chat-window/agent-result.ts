import type { AgentResultMessage } from '../../lib/api-client';
import type { KnowledgeContextEntry } from '../../lib/assistant-suggestions';
import {
  looksAbsolutePath,
  relativePathInsideProject,
  resolveProjectRelativePath,
} from '../../lib/project-context';
import { reviewReportFromMessage } from './review';

/**
 * 按**结构**而不是 kind 白名单判定「这个补丁能不能写回正文」。
 *
 * 后端有三个工具产出可写回的补丁，payload 同形（file_path + before + after），只有
 * audit 字段不同：`file_revision`（file.revise / file.create）、`prose_trim`
 * （project.trim_prose）、`prose_continue`（prose.continue）。此前这里只认
 * `file_revision`，于是后两者的正文在前端被静默丢弃——而对话里已经跟作者说了
 * 「等你确认后才会写盘」、流程树也亮着等确认，作者去编辑器却找不到那个 diff。
 *
 * 用白名单的话，后端每加一个产字工具就会重演一次这个静默丢弃；用结构判定则新工具
 * 只要 payload 同形就自动接得住。`repair_patch` 不会被误收：它顶层没有这三个字段，
 * 走 repairPatchApproval。
 */
export function writableFilePatch(message: AgentResultMessage): {
  id: string;
  file_path: string;
  before: string;
  after: string;
  requires_confirmation: boolean;
} | null {
  const patch = message.proposed_patch as Record<string, unknown> | null | undefined;
  if (!patch || typeof patch !== 'object') return null;
  const { file_path: filePath, before, after, id } = patch;
  if (typeof filePath !== 'string' || typeof before !== 'string' || typeof after !== 'string') {
    return null;
  }
  return {
    id:
      typeof id === 'string' && id.trim()
        ? id
        : `${message.run_id ?? message.session_id}:file-suggestion`,
    file_path: filePath,
    before,
    after,
    // 失败关闭：字段缺失、类型不对、老后端一律按「要作者点接受」。免点击落盘只在
    // 后端明确判定 false 时发生（判定源是 API 的权限档位，前端不自己按档位推）。
    requires_confirmation: patch.requires_confirmation !== false,
  };
}

export function resolveProposedPatchFilePath(
  projectPath: string | null,
  filePath: string,
): string | null {
  if (!projectPath) return null;
  const resolved = resolveProjectRelativePath(projectPath, filePath);
  const relative = resolved ? relativePathInsideProject(projectPath, resolved) : null;
  return relative === null ? null : resolveProjectRelativePath(projectPath, relative);
}

export function repairPatchApproval(message: AgentResultMessage): {
  summary: string;
  command: { command_id: string; args: Record<string, unknown> } | null;
} | null {
  const patch = message.proposed_patch;
  if (!patch || patch.kind !== 'repair_patch') return null;
  const repair =
    patch.repair_patch && typeof patch.repair_patch === 'object'
      ? (patch.repair_patch as Record<string, unknown>)
      : {};
  const targetSpan = typeof repair.target_span === 'string' ? repair.target_span : '';
  const replacement = typeof repair.replacement_text === 'string' ? repair.replacement_text : '';
  const reason = typeof repair.reason === 'string' ? repair.reason : '';
  const rawCommand = patch.approval_command;
  const command =
    rawCommand &&
    typeof rawCommand === 'object' &&
    typeof (rawCommand as { command_id?: unknown }).command_id === 'string'
      ? {
          command_id: (rawCommand as { command_id: string }).command_id,
          args:
            (rawCommand as { args?: unknown }).args &&
            typeof (rawCommand as { args?: unknown }).args === 'object'
              ? (rawCommand as { args: Record<string, unknown> }).args
              : {},
        }
      : null;
  const lines = [
    targetSpan || replacement
      ? `章节修复建议：将「${targetSpan}」替换为「${replacement}」。`
      : '章节修复建议已生成。',
    reason,
    command
      ? `点击「批准」将执行 ${command.command_id} 完成写回。`
      : '该补丁缺少可执行的批准命令，暂时无法从对话内写回。',
  ];
  return { summary: lines.filter(Boolean).join('\n'), command };
}

export function filePathFromAgentResult(message: AgentResultMessage): string | null {
  const patch = writableFilePatch(message);
  if (patch) return patch.file_path;
  const report = reviewReportFromMessage(message);
  const filePath = report?.file_path;
  return typeof filePath === 'string' && filePath.trim() ? filePath : null;
}

export function shouldApplyAgentControlAck(
  activeRunId: string | null,
  requestedRunId: string,
  ackRunId?: string,
): boolean {
  return activeRunId === requestedRunId && (!ackRunId || ackRunId === requestedRunId);
}

export function modelFromToolTrace(message: AgentResultMessage): string {
  for (const trace of message.tool_trace) {
    const model = trace.output_summary?.model;
    if (typeof model === 'string' && model.trim()) return model;
  }
  return 'StoryForge Agent';
}

function sanitizedRelativeContextFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim().replace(/\\/g, '/');
    if (!normalized || looksAbsolutePath(normalized)) continue;
    const parts = normalized.split('/').filter((part) => part && part !== '.');
    if (!parts.length || parts.some((part) => part === '..') || parts[0].includes(':')) continue;
    const relativePath = parts.join('/');
    const key = relativePath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(relativePath);
  }
  return result;
}

export type WritingContextProvenance = {
  contextFiles: string[];
  knowledgeEntries: KnowledgeContextEntry[];
};

function sanitizedKnowledgeEntries(value: unknown): KnowledgeContextEntry[] {
  if (!Array.isArray(value)) return [];
  const result: KnowledgeContextEntry[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const knowledgeId = typeof raw.knowledge_id === 'string' ? raw.knowledge_id.trim() : '';
    const paths = sanitizedRelativeContextFiles([raw.relative_path]);
    if (!/^pk_[0-9a-f-]{36}$/.test(knowledgeId) || paths.length !== 1) continue;
    if (raw.selection_source !== 'author_pinned' && raw.selection_source !== 'auto_retrieved') {
      continue;
    }
    if (raw.evidence_state !== 'current' && raw.evidence_state !== 'stale') continue;
    if (typeof raw.snapshot_id !== 'string' || !raw.snapshot_id) continue;
    const warningCount =
      typeof raw.warning_count === 'number' && Number.isInteger(raw.warning_count)
        ? Math.max(raw.warning_count, 0)
        : 0;
    if (seen.has(knowledgeId)) continue;
    seen.add(knowledgeId);
    result.push({
      knowledgeId,
      relativePath: paths[0],
      selectionSource: raw.selection_source,
      evidenceState: raw.evidence_state,
      warningCount,
      snapshotId: raw.snapshot_id,
    });
  }
  return result;
}

function backendWritingContext(message: AgentResultMessage): WritingContextProvenance | null {
  for (let index = message.tool_trace.length - 1; index >= 0; index -= 1) {
    const trace = message.tool_trace[index];
    if (trace.tool_name !== 'file.create' && trace.tool_name !== 'file.revise') continue;
    const raw = trace.input_summary.context_provenance;
    if (!raw || typeof raw !== 'object') continue;
    const provenance = raw as Record<string, unknown>;
    if (
      provenance.context_source !== 'request_bundle' ||
      typeof provenance.snapshot_id !== 'string' ||
      trace.input_summary.llm_context_snapshot_id !== provenance.snapshot_id ||
      !Array.isArray(provenance.context_files) ||
      provenance.context_file_count !== provenance.context_files.length
    ) {
      continue;
    }
    const rawKnowledgeEntries = Array.isArray(provenance.knowledge_entries)
      ? provenance.knowledge_entries
      : [];
    const knowledgeEntries = rawKnowledgeEntries.length
      ? sanitizedKnowledgeEntries(rawKnowledgeEntries)
      : [];
    if (knowledgeEntries.some((entry) => entry.snapshotId !== provenance.snapshot_id)) continue;
    if (
      typeof provenance.knowledge_entry_count === 'number' &&
      provenance.knowledge_entry_count !== rawKnowledgeEntries.length
    ) {
      continue;
    }
    return {
      contextFiles: sanitizedRelativeContextFiles(provenance.context_files),
      knowledgeEntries,
    };
  }
  return null;
}

export function writingContextFromAgentResult(
  message: AgentResultMessage,
  fallback: string[] = [],
): WritingContextProvenance {
  return (
    backendWritingContext(message) ?? {
      contextFiles: sanitizedRelativeContextFiles(fallback),
      knowledgeEntries: [],
    }
  );
}

export function contextFilesFromAgentResult(
  message: AgentResultMessage,
  fallback: string[] = [],
): string[] {
  return writingContextFromAgentResult(message, fallback).contextFiles;
}

export function issueIdsFromAgentResult(message: AgentResultMessage): string[] {
  const scope = message.agent_result.applied_scope;
  if (!scope || typeof scope !== 'object') return [];
  const ids = (scope as { issue_ids?: unknown }).issue_ids;
  return Array.isArray(ids) ? ids.filter((item): item is string => typeof item === 'string') : [];
}
