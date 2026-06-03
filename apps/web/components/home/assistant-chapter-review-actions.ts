'use server';

import { redirect as nextRedirect } from 'next/navigation';
import { revalidatePath as nextRevalidatePath } from 'next/cache';

import { apiFetch, type ApiFetchInit } from '../../lib/api-client';
import { appendAssistantSessionMessage, createAssistantSession } from './assistant-session-store';

type AssistantChapterReviewDeps = {
  readonly apiFetch?: (path: string, init: ApiFetchInit) => Promise<Response>;
  readonly revalidatePath?: (path: string) => void;
  readonly redirect?: (url: string) => never;
  readonly writeAssistantChapterReviewSession?: (
    payload: AssistantChapterReviewSessionWrite,
  ) => Promise<number | void>;
};

type AssistantChapterReviewSessionWrite = {
  readonly scenePacketId: number;
  readonly repairPatchId?: number;
  readonly summary: ChapterReviewRedirectSummary;
  readonly assistantSessionId?: number;
};

type RepairPatchSummary = {
  readonly id: number;
  readonly status?: string;
  readonly requires_rejudge?: boolean;
};

type ScenePacketLookup = {
  readonly scene_packet_id: number;
};

type ChapterReviewRedirectSummary = {
  readonly issues: readonly {
    readonly summary?: string;
    readonly severity?: string;
    readonly evidence?: string;
  }[];
  readonly repairPatch?: string;
};

const studioChapterReviewEndpoint = '/api/studio/chapter-review';
const studioScenePacketsEndpoint = '/api/studio/scene-packets';
const maxChapterReviewSummaryUrlLength = 700;
const maxSummaryTextLength = 80;
const maxSummaryIssueCount = 2;

export async function submitAssistantChapterReview(
  formData: FormData,
  deps: AssistantChapterReviewDeps = {},
) {
  const redirect = deps.redirect ?? nextRedirect;
  let scenePacketId = readPositiveInt(formData.get('scene_packet_id'));
  const bookId = readPositiveInt(formData.get('book_id'));
  const targetChapterOrdinal = readPositiveInt(formData.get('target_chapter_ordinal'));
  const assistantSessionId = readPositiveInt(formData.get('assistant_session_id'));
  if (!scenePacketId) {
    if (targetChapterOrdinal && !bookId) {
      const params = new URLSearchParams({ chapter_review_status: 'select_book' });
      params.set('target_chapter_ordinal', String(targetChapterOrdinal));
      if (assistantSessionId) {
        params.set('assistant_session_id', String(assistantSessionId));
      }
      return redirect(`/?${params.toString()}`);
    }
    if (!bookId || !targetChapterOrdinal) {
      const params = new URLSearchParams({ chapter_review_status: 'select_chapter' });
      if (bookId) {
        params.set('book_id', String(bookId));
      }
      if (targetChapterOrdinal) {
        params.set('target_chapter_ordinal', String(targetChapterOrdinal));
      }
      if (assistantSessionId) {
        params.set('assistant_session_id', String(assistantSessionId));
      }
      return redirect(`/?${params.toString()}`);
    }
  }

  const fetcher = deps.apiFetch ?? apiFetch;
  if (!scenePacketId) {
    const lookupBookId = bookId;
    const lookupTargetChapterOrdinal = targetChapterOrdinal;
    if (!lookupBookId || !lookupTargetChapterOrdinal) {
      const params = new URLSearchParams({ chapter_review_status: 'select_chapter' });
      if (assistantSessionId) {
        params.set('assistant_session_id', String(assistantSessionId));
      }
      return redirect(`/?${params.toString()}`);
    }
    try {
      scenePacketId = await locateScenePacketId(fetcher, lookupBookId, lookupTargetChapterOrdinal);
    } catch (error) {
      return redirect(
        buildChapterReviewResultUrl({
          bookId,
          targetChapterOrdinal,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Scene Packet 定位失败',
          summary: { issues: [] },
          assistantSessionId,
        }),
      );
    }
  }

  if (!scenePacketId) {
    const params = new URLSearchParams({ chapter_review_status: 'select_chapter' });
    if (bookId) {
      params.set('book_id', String(bookId));
    }
    if (targetChapterOrdinal) {
      params.set('target_chapter_ordinal', String(targetChapterOrdinal));
    }
    if (assistantSessionId) {
      params.set('assistant_session_id', String(assistantSessionId));
    }
    return redirect(`/?${params.toString()}`);
  }

  let repairPatchId: number | undefined;
  let chapterReviewSummary: ChapterReviewRedirectSummary = { issues: [] };
  let redirectAssistantSessionId: number | undefined;
  try {
    const reviewPayload = await fetchJson(fetcher, studioChapterReviewEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene_packet_id: scenePacketId }),
    });
    const judgePayload = readRecordField(reviewPayload, 'judge_review');
    chapterReviewSummary = mergeChapterReviewSummary(
      chapterReviewSummary,
      extractJudgeReviewSummary(judgePayload),
    );
    const patchesPayload = readRecordField(reviewPayload, 'repair_patches');
    repairPatchId = firstRepairPatchId(patchesPayload);
    chapterReviewSummary = mergeChapterReviewSummary(
      chapterReviewSummary,
      extractRepairPatchSummary(patchesPayload, repairPatchId),
    );
    const writtenAssistantSessionId = await (
      deps.writeAssistantChapterReviewSession ?? writeAssistantChapterReviewSession
    )({
      scenePacketId,
      repairPatchId,
      summary: chapterReviewSummary,
      assistantSessionId,
    });
    redirectAssistantSessionId = writtenAssistantSessionId ?? assistantSessionId;
  } catch (error) {
    return redirect(
      buildChapterReviewResultUrl({
        scenePacketId,
        bookId,
        targetChapterOrdinal,
        status: 'failed',
        error: error instanceof Error ? error.message : '章节审阅链路返回失败',
        summary: chapterReviewSummary,
        assistantSessionId,
      }),
    );
  }

  const revalidatePath = deps.revalidatePath ?? nextRevalidatePath;
  revalidatePath('/');
  return redirect(
    buildChapterReviewResultUrl({
      scenePacketId,
      bookId,
      targetChapterOrdinal,
      status: 'ready',
      repairPatchId,
      summary: chapterReviewSummary,
      assistantSessionId: redirectAssistantSessionId,
    }),
  );
}

async function writeAssistantChapterReviewSession({
  scenePacketId,
  repairPatchId,
  summary,
  assistantSessionId,
}: AssistantChapterReviewSessionWrite): Promise<number> {
  const content = [
    `Scene Packet ID：${scenePacketId}`,
    `Repair Patch ID：${repairPatchId ?? '无'}`,
    `短摘要：${formatChapterReviewSessionSummary(summary)}`,
  ].join('；');

  if (assistantSessionId) {
    const result = await appendAssistantSessionMessage(assistantSessionId, {
      role: 'assistant',
      content,
    });
    if (result.status === 'error') {
      throw new Error(result.message);
    }
    return assistantSessionId;
  }

  const result = await createAssistantSession({
    title: `章节审阅 Scene Packet #${scenePacketId}`,
    task_type: 'chapter_review',
    messages: [{ role: 'assistant', content }],
  });
  if (result.status === 'error') {
    throw new Error(result.message);
  }
  return result.data.id;
}

async function locateScenePacketId(
  fetcher: (path: string, init: ApiFetchInit) => Promise<Response>,
  bookId: number,
  targetChapterOrdinal: number,
): Promise<number> {
  const payload = await fetchJson(fetcher, studioScenePacketsEndpoint, {
    params: { book_id: bookId, target_ordinal: targetChapterOrdinal },
  });
  if (!isScenePacketLookup(payload)) {
    throw new Error('Scene Packet API 返回格式不符合预期');
  }
  return payload.scene_packet_id;
}

function formatChapterReviewSessionSummary(summary: ChapterReviewRedirectSummary): string {
  const issueSummaries = summary.issues
    .map((issue) =>
      [issue.summary, issue.severity ? `级别 ${issue.severity}` : undefined, issue.evidence]
        .filter((value): value is string => Boolean(value))
        .join('，'),
    )
    .filter((value) => value.length > 0);
  const parts = [...issueSummaries, summary.repairPatch ? `修复 ${summary.repairPatch}` : null]
    .filter((value): value is string => value !== null)
    .slice(0, maxSummaryIssueCount + 1);
  return parts.length > 0 ? parts.join('；') : '无';
}

function buildChapterReviewResultUrl({
  scenePacketId,
  bookId,
  targetChapterOrdinal,
  status,
  repairPatchId,
  error,
  summary,
  assistantSessionId,
}: {
  readonly scenePacketId?: number;
  readonly bookId?: number;
  readonly targetChapterOrdinal?: number;
  readonly status: 'ready' | 'failed';
  readonly repairPatchId?: number;
  readonly error?: string;
  readonly summary: ChapterReviewRedirectSummary;
  readonly assistantSessionId?: number;
}): string {
  const params = new URLSearchParams(
    scenePacketId
      ? { scene_packet_id: String(scenePacketId), chapter_review_status: status }
      : { chapter_review_status: status },
  );
  if (bookId) {
    params.set('book_id', String(bookId));
  }
  if (targetChapterOrdinal) {
    params.set('target_chapter_ordinal', String(targetChapterOrdinal));
  }
  if (repairPatchId) {
    params.set('repair_patch_id', String(repairPatchId));
  }
  if (assistantSessionId) {
    params.set('assistant_session_id', String(assistantSessionId));
  }
  if (error) {
    params.set('chapter_review_error', truncateSummaryText(error));
  }
  appendChapterReviewSummaryParam(params, summary);
  return `/?${params.toString()}`;
}

async function fetchJson(
  fetcher: (path: string, init: ApiFetchInit) => Promise<Response>,
  path: string,
  init: ApiFetchInit,
): Promise<unknown> {
  const response = await fetcher(path, { method: 'GET', ...init });
  if (!response.ok) {
    throw new Error(`章节审阅 API 返回 ${response.status}：${path}`);
  }
  return response.json();
}

function firstRepairPatchId(value: unknown): number | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const patch = value.find(isRepairPatchSummary);
  return patch?.id;
}

function isRepairPatchSummary(value: unknown): value is RepairPatchSummary {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<RepairPatchSummary>).id === 'number'
  );
}

function isScenePacketLookup(value: unknown): value is ScenePacketLookup {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<ScenePacketLookup>).scene_packet_id === 'number'
  );
}

function mergeChapterReviewSummary(
  current: ChapterReviewRedirectSummary,
  next: Partial<ChapterReviewRedirectSummary>,
): ChapterReviewRedirectSummary {
  return {
    issues: [...current.issues, ...(next.issues ?? [])].slice(0, maxSummaryIssueCount),
    repairPatch: next.repairPatch ?? current.repairPatch,
  };
}

function extractJudgeReviewSummary(value: unknown): Partial<ChapterReviewRedirectSummary> {
  return {
    issues: collectIssueCandidates(value)
      .map((issue) => ({
        summary: readShortString(issue, ['summary', 'title', 'message']),
        severity: readShortString(issue, ['severity', 'level', 'priority']),
        evidence: readEvidenceReference((issue as Record<string, unknown>).evidence),
      }))
      .filter((issue) => issue.summary || issue.severity || issue.evidence)
      .slice(0, maxSummaryIssueCount),
  };
}

function extractRepairPatchSummary(
  value: unknown,
  repairPatchId: number | undefined,
): Partial<ChapterReviewRedirectSummary> {
  const patch = Array.isArray(value)
    ? value.find((item) => isRecord(item) && (!repairPatchId || item.id === repairPatchId))
    : value;
  if (!isRecord(patch)) return {};
  const repairPatch = readShortString(patch, ['summary', 'title', 'change_summary', 'description']);
  return repairPatch ? { repairPatch } : {};
}

function appendChapterReviewSummaryParam(
  params: URLSearchParams,
  summary: ChapterReviewRedirectSummary,
) {
  if (summary.issues.length === 0 && !summary.repairPatch) return;
  params.set('chapter_review_summary', JSON.stringify(summary));
  if (`/?${params.toString()}`.length > maxChapterReviewSummaryUrlLength) {
    params.delete('chapter_review_summary');
  }
}

function collectIssueCandidates(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectIssueCandidates);
  }
  if (!isRecord(value)) return [];
  const nested = [value.issues, value.judge_issues, value.findings, value.results]
    .filter((item) => item !== undefined)
    .flatMap(collectIssueCandidates);
  return nested.length > 0 ? nested : [value];
}

function readEvidenceReference(value: unknown): string | undefined {
  const evidence = Array.isArray(value) ? value[0] : value;
  if (!isRecord(evidence)) return undefined;
  return readShortString(evidence, [
    'reference',
    'page_ref',
    'source',
    'location',
    'locator',
    'quote_ref',
    'anchor',
  ]);
}

function readShortString(
  value: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return truncateSummaryText(candidate);
    }
  }
  return undefined;
}

function truncateSummaryText(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > maxSummaryTextLength
    ? `${normalized.slice(0, maxSummaryTextLength)}...`
    : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readRecordField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function readPositiveInt(value: FormDataEntryValue | null): number | undefined {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
