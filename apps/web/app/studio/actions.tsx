import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ScenePacketPanel } from "../../components/scene-packet/ScenePacketPanel";
import { phase6DataSources, phase6FirstDataSourceSpike } from "../../lib/phase6-data-sources";

type StudioBookListItem = {
  readonly id: number;
  readonly title: string;
  readonly recent_chapter_ordinal: number | null;
};

type StudioBookListState =
  | { readonly status: "ready"; readonly books: readonly StudioBookListItem[] }
  | { readonly status: "error"; readonly message: string };

type StudioTarget = {
  readonly book_id: number;
  readonly target_ordinal: number;
};

type StudioChapterGoal = {
  readonly book_id: number;
  readonly target_chapter_id: number;
  readonly target_chapter_ordinal: number;
  readonly target_chapter_title: string;
  readonly chapter_goal: string;
  readonly previous_chapter_summary: string | null;
  readonly continuity_constraints: readonly string[];
};

type StudioChapterGoalState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "ready"; readonly goal: StudioChapterGoal }
  | { readonly status: "error"; readonly message: string };

type StudioScenePacket = {
  readonly book_id: number;
  readonly target_chapter_ordinal: number;
  readonly scene_id: number;
  readonly scene_packet_id: number;
  readonly job_run_id: number | null;
  readonly status: string;
  readonly chapter_goal: string | null;
  readonly evidence_count: number;
  readonly compiled_context_id: string | null;
  readonly budget_summary: Record<string, unknown>;
};

type StudioScenePacketState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "ready"; readonly packet: StudioScenePacket }
  | { readonly status: "error"; readonly message: string };

type StudioJudgeIssue = {
  readonly id: number;
  readonly category: string;
  readonly severity: string;
  readonly summary: string;
  readonly span_start: number;
  readonly span_end: number;
  readonly recommended_repair_mode: string;
};

type StudioJudgeReview = {
  readonly scene_packet_id: number;
  readonly status: string;
  readonly issue_count: number;
  readonly highest_severity: string | null;
  readonly score: number;
  readonly issues: readonly StudioJudgeIssue[];
};

type StudioJudgeReviewState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "ready"; readonly review: StudioJudgeReview }
  | { readonly status: "error"; readonly message: string };

type StudioRepairPatch = {
  readonly id: number;
  readonly issue_id: number;
  readonly status: string;
  readonly target_span: string;
  readonly replacement_text: string;
  readonly reason: string;
  readonly requires_rejudge: boolean;
};

type StudioRepairPatchState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "ready"; readonly patches: readonly StudioRepairPatch[] }
  | { readonly status: "error"; readonly message: string };

type StudioApprovalSummary = {
  readonly can_approve: boolean;
  readonly approvable_object: { readonly object_type: string; readonly id: number; readonly status: string; readonly scene_id: number } | null;
  readonly target_chapter: { readonly id: number; readonly ordinal: number; readonly title: string; readonly status: string } | null;
  readonly writeback_status: string;
  readonly unavailable_reason: string | null;
};

type StudioApprovalSummaryState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "ready"; readonly summary: StudioApprovalSummary }
  | { readonly status: "error"; readonly message: string };

type StudioApprovalExecuteResult = {
  readonly writeback_status: string;
  readonly approved_chapter_id: number | null;
  readonly continuity_update_summary: string | null;
  readonly unavailable_reason: string | null;
};

type StudioRecoverySummary = {
  readonly can_recover: boolean;
  readonly failed_node: string | null;
  readonly checkpoint: Record<string, unknown> | null;
  readonly recoverable_steps: readonly string[];
  readonly error_summary: string | null;
  readonly unrecoverable_reason: string | null;
};

type StudioRecoverySummaryState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "ready"; readonly summary: StudioRecoverySummary }
  | { readonly status: "error"; readonly message: string };

const generationChain = [
  "作品选择",
  "章节目标",
  "检索素材证据",
  "生成 Scene Packet",
  "Judge 评审",
  "Repair 修订",
  "批准回写",
  "失败恢复",
];

const studioBooksEndpoint = "/api/studio/books";
const studioChapterGoalsEndpoint = "/api/studio/chapter-goals";
const studioScenePacketsEndpoint = "/api/studio/scene-packets";
const studioJudgeReviewsEndpoint = "/api/studio/judge-reviews";
const studioRepairPatchesEndpoint = "/api/studio/repair-patches";
const studioApprovalSummaryEndpoint = "/api/studio/approval-summary";
const studioApproveEndpoint = "/api/studio/approve";
const studioRecoverySummaryEndpoint = "/api/studio/recovery-summary";

const getStudioApiBaseUrl = () => process.env.STORYFORGE_API_BASE_URL ?? "http://127.0.0.1:8000";

function getStudioTarget(book: StudioBookListItem | undefined): StudioTarget | undefined {
  if (!book) {
    return undefined;
  }
  return { book_id: book.id, target_ordinal: book.recent_chapter_ordinal ?? 1 };
}

async function readStudioBooks(): Promise<StudioBookListState> {
  try {
    const response = await fetch(new URL(studioBooksEndpoint, getStudioApiBaseUrl()), { cache: "no-store" });
    if (!response.ok) {
      return { status: "error", message: `作品列表 API 返回 ${response.status}` };
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      return { status: "error", message: "作品列表 API 返回格式不符合预期" };
    }

    return { status: "ready", books: payload as StudioBookListItem[] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return { status: "error", message };
  }
}

async function readStudioChapterGoal(target: StudioTarget | undefined): Promise<StudioChapterGoalState> {
  if (!target) {
    return { status: "idle", message: "读取章节目标需要先获得作品列表。" };
  }

  const url = new URL(studioChapterGoalsEndpoint, getStudioApiBaseUrl());
  url.searchParams.set("book_id", String(target.book_id));
  url.searchParams.set("target_ordinal", String(target.target_ordinal));

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { status: "error", message: `章节目标 API 返回 ${response.status}` };
    }

    const payload: unknown = await response.json();
    if (!isStudioChapterGoal(payload)) {
      return { status: "error", message: "章节目标 API 返回格式不符合预期" };
    }

    return { status: "ready", goal: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return { status: "error", message };
  }
}

function isStudioChapterGoal(value: unknown): value is StudioChapterGoal {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<StudioChapterGoal>;
  return (
    typeof candidate.book_id === "number" &&
    typeof candidate.target_chapter_id === "number" &&
    typeof candidate.target_chapter_ordinal === "number" &&
    typeof candidate.target_chapter_title === "string" &&
    typeof candidate.chapter_goal === "string" &&
    (typeof candidate.previous_chapter_summary === "string" || candidate.previous_chapter_summary === null) &&
    Array.isArray(candidate.continuity_constraints)
  );
}

async function readStudioScenePacket(target: StudioTarget | undefined): Promise<StudioScenePacketState> {
  if (!target) {
    return { status: "idle", message: "读取 Scene Packet 需要先获得作品列表。" };
  }

  const url = new URL(studioScenePacketsEndpoint, getStudioApiBaseUrl());
  url.searchParams.set("book_id", String(target.book_id));
  url.searchParams.set("target_ordinal", String(target.target_ordinal));

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { status: "error", message: `Scene Packet API 返回 ${response.status}` };
    }

    const payload: unknown = await response.json();
    if (!isStudioScenePacket(payload)) {
      return { status: "error", message: "Scene Packet API 返回格式不符合预期" };
    }

    return { status: "ready", packet: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return { status: "error", message };
  }
}

function isStudioScenePacket(value: unknown): value is StudioScenePacket {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<StudioScenePacket>;
  return (
    typeof candidate.book_id === "number" &&
    typeof candidate.target_chapter_ordinal === "number" &&
    typeof candidate.scene_id === "number" &&
    typeof candidate.scene_packet_id === "number" &&
    (typeof candidate.job_run_id === "number" || candidate.job_run_id === null) &&
    typeof candidate.status === "string" &&
    (typeof candidate.chapter_goal === "string" || candidate.chapter_goal === null) &&
    typeof candidate.evidence_count === "number" &&
    (typeof candidate.compiled_context_id === "string" || candidate.compiled_context_id === null) &&
    typeof candidate.budget_summary === "object" &&
    candidate.budget_summary !== null
  );
}

async function readStudioJudgeReview(scenePacketState: StudioScenePacketState): Promise<StudioJudgeReviewState> {
  if (scenePacketState.status !== "ready") {
    return { status: "idle", message: "读取 Judge 评审需要先获得 Scene Packet。" };
  }

  const url = new URL(studioJudgeReviewsEndpoint, getStudioApiBaseUrl());
  url.searchParams.set("scene_packet_id", String(scenePacketState.packet.scene_packet_id));

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { status: "error", message: `Judge 评审 API 返回 ${response.status}` };
    }

    const payload: unknown = await response.json();
    if (!isStudioJudgeReview(payload)) {
      return { status: "error", message: "Judge 评审 API 返回格式不符合预期" };
    }

    return { status: "ready", review: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return { status: "error", message };
  }
}

function isStudioJudgeReview(value: unknown): value is StudioJudgeReview {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<StudioJudgeReview>;
  return (
    typeof candidate.scene_packet_id === "number" &&
    typeof candidate.status === "string" &&
    typeof candidate.issue_count === "number" &&
    (typeof candidate.highest_severity === "string" || candidate.highest_severity === null) &&
    typeof candidate.score === "number" &&
    Array.isArray(candidate.issues)
  );
}

async function readStudioRepairPatches(scenePacketState: StudioScenePacketState): Promise<StudioRepairPatchState> {
  if (scenePacketState.status !== "ready") {
    return { status: "idle", message: "读取 Repair 修订需要先获得 Judge 评审。" };
  }

  const url = new URL(studioRepairPatchesEndpoint, getStudioApiBaseUrl());
  url.searchParams.set("scene_packet_id", String(scenePacketState.packet.scene_packet_id));

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { status: "error", message: `Repair 修订 API 返回 ${response.status}` };
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload) || !payload.every(isStudioRepairPatch)) {
      return { status: "error", message: "Repair 修订 API 返回格式不符合预期" };
    }

    return { status: "ready", patches: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return { status: "error", message };
  }
}

function isStudioRepairPatch(value: unknown): value is StudioRepairPatch {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<StudioRepairPatch>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.issue_id === "number" &&
    typeof candidate.status === "string" &&
    typeof candidate.target_span === "string" &&
    typeof candidate.replacement_text === "string" &&
    typeof candidate.reason === "string" &&
    typeof candidate.requires_rejudge === "boolean"
  );
}


async function readStudioApprovalSummary(
  scenePacketState: StudioScenePacketState,
  repairPatchState: StudioRepairPatchState,
): Promise<StudioApprovalSummaryState> {
  if (repairPatchState.status === "ready" && repairPatchState.patches.length > 0) {
    return readStudioApprovalSummaryByQuery("repair_patch_id", repairPatchState.patches[0].id);
  }
  if (scenePacketState.status === "ready") {
    return readStudioApprovalSummaryByQuery("scene_packet_id", scenePacketState.packet.scene_packet_id);
  }
  return { status: "idle", message: "读取批准回写摘要需要先获得 Repair 修订或 Scene Packet。" };
}

async function readStudioApprovalSummaryByQuery(key: "scene_packet_id" | "repair_patch_id", value: number): Promise<StudioApprovalSummaryState> {
  const url = new URL(studioApprovalSummaryEndpoint, getStudioApiBaseUrl());
  url.searchParams.set(key, String(value));

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { status: "error", message: `批准回写摘要 API 返回 ${response.status}` };
    }

    const payload: unknown = await response.json();
    if (!isStudioApprovalSummary(payload)) {
      return { status: "error", message: "批准回写摘要 API 返回格式不符合预期" };
    }

    return { status: "ready", summary: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return { status: "error", message };
  }
}

function isStudioApprovalSummary(value: unknown): value is StudioApprovalSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<StudioApprovalSummary>;
  return (
    typeof candidate.can_approve === "boolean" &&
    (typeof candidate.approvable_object === "object" || candidate.approvable_object === null) &&
    (typeof candidate.target_chapter === "object" || candidate.target_chapter === null) &&
    typeof candidate.writeback_status === "string" &&
    (typeof candidate.unavailable_reason === "string" || candidate.unavailable_reason === null)
  );
}

function isStudioApprovalExecuteResult(value: unknown): value is StudioApprovalExecuteResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<StudioApprovalExecuteResult>;
  return (
    typeof candidate.writeback_status === "string" &&
    (typeof candidate.approved_chapter_id === "number" || candidate.approved_chapter_id === null) &&
    (typeof candidate.continuity_update_summary === "string" || candidate.continuity_update_summary === null) &&
    (typeof candidate.unavailable_reason === "string" || candidate.unavailable_reason === null)
  );
}

async function readStudioRecoverySummary(scenePacketState: StudioScenePacketState): Promise<StudioRecoverySummaryState> {
  if (scenePacketState.status !== "ready") {
    return { status: "idle", message: "读取失败恢复摘要需要先获得 Scene Packet 中的任务线索。" };
  }

  const jobRunId = getJobRunIdFromScenePacket(scenePacketState.packet);
  if (jobRunId === undefined) {
    return { status: "idle", message: "当前 Scene Packet 未提供 job_run_id，暂不读取失败恢复摘要。" };
  }

  const url = new URL(studioRecoverySummaryEndpoint, getStudioApiBaseUrl());
  url.searchParams.set("job_run_id", String(jobRunId));

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { status: "error", message: `失败恢复摘要 API 返回 ${response.status}` };
    }

    const payload: unknown = await response.json();
    if (!isStudioRecoverySummary(payload)) {
      return { status: "error", message: "失败恢复摘要 API 返回格式不符合预期" };
    }

    return { status: "ready", summary: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return { status: "error", message };
  }
}

function getJobRunIdFromScenePacket(packet: StudioScenePacket): number | undefined {
  return packet.job_run_id ?? undefined;
}

function isStudioRecoverySummary(value: unknown): value is StudioRecoverySummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<StudioRecoverySummary>;
  return (
    typeof candidate.can_recover === "boolean" &&
    (typeof candidate.failed_node === "string" || candidate.failed_node === null) &&
    (typeof candidate.checkpoint === "object" || candidate.checkpoint === null) &&
    Array.isArray(candidate.recoverable_steps) &&
    (typeof candidate.error_summary === "string" || candidate.error_summary === null) &&
    (typeof candidate.unrecoverable_reason === "string" || candidate.unrecoverable_reason === null)
  );
}

function getRequiredFormValue(formData: FormData, key: "scene_packet_id" | "repair_patch_id"): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function buildApprovalResultUrl(payload: Partial<StudioApprovalExecuteResult>): string {
  const params = new URLSearchParams();
  params.set("approval_submitted", "1");
  params.set("writeback_status", payload.writeback_status ?? "提交失败");
  if (typeof payload.approved_chapter_id === "number") {
    params.set("approved_chapter_id", String(payload.approved_chapter_id));
  }
  if (typeof payload.continuity_update_summary === "string" && payload.continuity_update_summary.length > 0) {
    params.set("continuity_update_summary", payload.continuity_update_summary);
  }
  if (typeof payload.unavailable_reason === "string" && payload.unavailable_reason.length > 0) {
    params.set("unavailable_reason", payload.unavailable_reason);
  }
  return `/studio?${params.toString()}`;
}

async function approveStudioWritebackAction(formData: FormData) {
  "use server";

  const scenePacketId = getRequiredFormValue(formData, "scene_packet_id");
  const repairPatchId = getRequiredFormValue(formData, "repair_patch_id");
  const requestBody: { scene_packet_id?: number; repair_patch_id?: number } = {};

  if (scenePacketId !== undefined && repairPatchId !== undefined) {
    redirect(buildApprovalResultUrl({ writeback_status: "未执行", unavailable_reason: "Scene Packet ID 与 Repair Patch ID 只能提供一个。" }));
  }
  if (scenePacketId !== undefined) {
    requestBody.scene_packet_id = Number(scenePacketId);
  }
  if (repairPatchId !== undefined) {
    requestBody.repair_patch_id = Number(repairPatchId);
  }
  if (requestBody.scene_packet_id === undefined && requestBody.repair_patch_id === undefined) {
    redirect(buildApprovalResultUrl({ writeback_status: "未执行", unavailable_reason: "需要提供 Scene Packet ID 或 Repair Patch ID。" }));
  }

  try {
    const response = await fetch(new URL(studioApproveEndpoint, getStudioApiBaseUrl()), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
      cache: "no-store",
    });
    if (!response.ok) {
      redirect(buildApprovalResultUrl({ writeback_status: "提交失败", unavailable_reason: `批准写回 API 返回 ${response.status}` }));
    }
    const payload: unknown = await response.json();
    if (!isStudioApprovalExecuteResult(payload)) {
      redirect(buildApprovalResultUrl({ writeback_status: "提交失败", unavailable_reason: "批准写回 API 返回格式不符合预期" }));
    }
    revalidatePath("/studio");
    redirect(buildApprovalResultUrl(payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    redirect(buildApprovalResultUrl({ writeback_status: "提交失败", unavailable_reason: message }));
  }
}

export async function StudioPageContent({ searchParams }: { readonly searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const resolvedSearchParams = await searchParams;
  const bookListState = await readStudioBooks();
  const selectedBook = bookListState.status === "ready" ? bookListState.books[0] : undefined;
  const studioTarget = getStudioTarget(selectedBook);
  const [chapterGoalState, scenePacketState] = await Promise.all([readStudioChapterGoal(studioTarget), readStudioScenePacket(studioTarget)]);
  const [judgeReviewState, repairPatchState] = await Promise.all([readStudioJudgeReview(scenePacketState), readStudioRepairPatches(scenePacketState)]);
  const [approvalSummaryState, recoverySummaryState] = await Promise.all([
    readStudioApprovalSummary(scenePacketState, repairPatchState),
    readStudioRecoverySummary(scenePacketState),
  ]);

  return (
    <main aria-labelledby="studio-title">
      <h1 id="studio-title">Studio 创作工作台</h1>
      <p>Studio 用于编排从作品选择、章节目标到批准回写和失败恢复的连续创作链路。</p>
      <section aria-labelledby="generation-chain-title">
        <h2 id="generation-chain-title">生成链路</h2>
        <ol>
          {generationChain.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="studio-data-sources-title">
        <h2 id="studio-data-sources-title">数据源契约</h2>
        <ul>
          {phase6DataSources.studio.map((source) => (
            <li key={source.name}>
              <strong>{source.name}</strong>：{source.output}（{source.status}）
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="studio-first-spike-title">
        <h2 id="studio-first-spike-title">首个真实读取 spike</h2>
        <p>{phase6FirstDataSourceSpike.name} 是当前唯一允许优先打穿的 Studio 数据源。</p>
        <dl>
          <dt>读取输入</dt>
          <dd>{phase6FirstDataSourceSpike.input}</dd>
          <dt>读取输出</dt>
          <dd>{phase6FirstDataSourceSpike.output}</dd>
          <dt>失败态</dt>
          <dd>作品列表 API 读取失败时保留当前契约占位，并显示可重试的错误摘要。</dd>
        </dl>
      </section>
      <section aria-labelledby="studio-book-list-title">
        <h2 id="studio-book-list-title">读取作品列表</h2>
        <p>当前 Web Studio 只读取 {studioBooksEndpoint} 这一个后端端点，不扩展全量 API client。</p>
        {bookListState.status === "error" ? (
          <p role="status">可重试错误摘要：{bookListState.message}</p>
        ) : bookListState.books.length === 0 ? (
          <p>空列表：当前工作区暂无作品，请先创建或导入作品。</p>
        ) : (
          <ul>
            {bookListState.books.map((book) => (
              <li key={book.id}>
                <strong>{book.title}</strong>
                <span>作品 ID：{book.id}</span>
                <span>最近章节编号：{book.recent_chapter_ordinal ?? "暂无章节"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="studio-chapter-goal-title">
        <h2 id="studio-chapter-goal-title">读取章节目标</h2>
        <p>
          当前 Web Studio 只在作品列表之后读取 {studioChapterGoalsEndpoint}，用于展示章节目标、上章摘要和连续性约束。
        </p>
        {chapterGoalState.status === "idle" ? (
          <p>{chapterGoalState.message}</p>
        ) : chapterGoalState.status === "error" ? (
          <p role="status">可重试错误摘要：{chapterGoalState.message}</p>
        ) : (
          <dl>
            <dt>目标章节</dt>
            <dd>
              第 {chapterGoalState.goal.target_chapter_ordinal} 章：{chapterGoalState.goal.target_chapter_title}
            </dd>
            <dt>章节目标</dt>
            <dd>{chapterGoalState.goal.chapter_goal}</dd>
            <dt>上章摘要</dt>
            <dd>{chapterGoalState.goal.previous_chapter_summary ?? "暂无上章摘要"}</dd>
            <dt>连续性约束</dt>
            <dd>
              {chapterGoalState.goal.continuity_constraints.length === 0
                ? "暂无连续性约束"
                : chapterGoalState.goal.continuity_constraints.join("；")}
            </dd>
          </dl>
        )}
      </section>
      <section aria-labelledby="studio-scene-packet-title">
        <h2 id="studio-scene-packet-title">读取 Scene Packet</h2>
        <p>
          当前 Web Studio 只在章节目标之后读取 {studioScenePacketsEndpoint}，用于展示 Scene Packet 的证据数量和上下文预算摘要。
        </p>
        {scenePacketState.status === "idle" ? (
          <p>{scenePacketState.message}</p>
        ) : scenePacketState.status === "error" ? (
          <p role="status">可重试错误摘要：{scenePacketState.message}</p>
        ) : (
          <dl>
            <dt>Scene Packet ID</dt>
            <dd>{scenePacketState.packet.scene_packet_id}</dd>
            <dt>状态</dt>
            <dd>{scenePacketState.packet.status}</dd>
            <dt>证据数量</dt>
            <dd>{scenePacketState.packet.evidence_count}</dd>
            <dt>上下文预算摘要</dt>
            <dd>{JSON.stringify(scenePacketState.packet.budget_summary)}</dd>
            <dt>Compiled Context</dt>
            <dd>{scenePacketState.packet.compiled_context_id ?? "暂无上下文快照"}</dd>
          </dl>
        )}
      </section>
      <section aria-labelledby="studio-judge-review-title">
        <h2 id="studio-judge-review-title">读取 Judge 评审</h2>
        <p>
          当前 Web Studio 只在 Scene Packet 之后读取 {studioJudgeReviewsEndpoint}，用于展示评审摘要、评审分数和关键问题。
        </p>
        {judgeReviewState.status === "idle" ? (
          <p>{judgeReviewState.message}</p>
        ) : judgeReviewState.status === "error" ? (
          <p role="status">可重试错误摘要：{judgeReviewState.message}</p>
        ) : (
          <dl>
            <dt>评审状态</dt>
            <dd>{judgeReviewState.review.status}</dd>
            <dt>评审分数</dt>
            <dd>{judgeReviewState.review.score}</dd>
            <dt>问题数量</dt>
            <dd>{judgeReviewState.review.issue_count}</dd>
            <dt>最高严重级别</dt>
            <dd>{judgeReviewState.review.highest_severity ?? "暂无问题"}</dd>
            <dt>关键问题</dt>
            <dd>
              {judgeReviewState.review.issues.length === 0
                ? "暂无关键问题"
                : judgeReviewState.review.issues.map((issue) => issue.summary).join("；")}
            </dd>
          </dl>
        )}
      </section>
      <section aria-labelledby="studio-repair-patches-title">
        <h2 id="studio-repair-patches-title">读取 Repair 修订</h2>
        <p>
          当前 Web Studio 只在 Scene Packet 之后与 Judge 评审并行读取 {studioRepairPatchesEndpoint}，用于展示修订文本、差异摘要和采纳建议。
        </p>
        {repairPatchState.status === "idle" ? (
          <p>{repairPatchState.message}</p>
        ) : repairPatchState.status === "error" ? (
          <p role="status">可重试错误摘要：{repairPatchState.message}</p>
        ) : repairPatchState.patches.length === 0 ? (
          <p>空列表：当前评审暂无 Repair 修订补丁。</p>
        ) : (
          <ul>
            {repairPatchState.patches.map((patch) => (
              <li key={patch.id}>
                <strong>补丁 #{patch.id}</strong>
                <span>问题 ID：{patch.issue_id}</span>
                <span>状态：{patch.status}</span>
                <span>差异摘要：将“{patch.target_span}”替换为“{patch.replacement_text}”</span>
                <span>采纳建议：{patch.reason}</span>
                <span>是否需要重评：{patch.requires_rejudge ? "需要重新评审" : "无需重新评审"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {resolvedSearchParams?.approval_submitted === "1" ? (
        <section aria-labelledby="studio-approval-execute-result-title">
          <h2 id="studio-approval-execute-result-title">批准写回已提交</h2>
          <dl>
            <dt>回写状态</dt>
            <dd>{resolvedSearchParams.writeback_status ?? "暂无回写状态"}</dd>
            <dt>批准章节</dt>
            <dd>{resolvedSearchParams.approved_chapter_id ?? "暂无批准章节"}</dd>
            <dt>连续性更新</dt>
            <dd>{resolvedSearchParams.continuity_update_summary ?? "暂无连续性更新摘要"}</dd>
            <dt>不可批准原因</dt>
            <dd>{resolvedSearchParams.unavailable_reason ?? "暂无阻塞原因"}</dd>
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="studio-approval-summary-title">
        <h2 id="studio-approval-summary-title">批准回写摘要</h2>
        <p>
          当前 Web Studio 只在 Repair 后读取 {studioApprovalSummaryEndpoint}，用于展示可批准对象、目标章节、回写状态和不可批准原因。
        </p>
        {approvalSummaryState.status === "idle" ? (
          <p>{approvalSummaryState.message}</p>
        ) : approvalSummaryState.status === "error" ? (
          <p role="status">读取失败：{approvalSummaryState.message}</p>
        ) : (
          <dl>
            <dt>批准状态</dt>
            <dd>{approvalSummaryState.summary.can_approve ? "可批准" : "不可批准"}</dd>
            <dt>可批准对象</dt>
            <dd>
              {approvalSummaryState.summary.approvable_object
                ? `${approvalSummaryState.summary.approvable_object.object_type} #${approvalSummaryState.summary.approvable_object.id}`
                : "暂无可批准对象"}
            </dd>
            <dt>目标章节</dt>
            <dd>
              {approvalSummaryState.summary.target_chapter
                ? `第 ${approvalSummaryState.summary.target_chapter.ordinal} 章：${approvalSummaryState.summary.target_chapter.title}`
                : "暂无目标章节"}
            </dd>
            <dt>回写状态</dt>
            <dd>{approvalSummaryState.summary.writeback_status}</dd>
            <dt>不可批准原因</dt>
            <dd>{approvalSummaryState.summary.unavailable_reason ?? "暂无阻塞原因"}</dd>
          </dl>
        )}
      </section>
      <section aria-labelledby="studio-approve-execution-title">
        <h2 id="studio-approve-execution-title">批准写回执行入口</h2>
        <p>后端已提供 {studioApproveEndpoint} 执行契约；页面通过 Server Action 提交批准写回，并在提交后重新读取 Studio 状态。</p>
        {approvalSummaryState.status !== "ready" ? (
          <p>批准写回执行需要先读取批准摘要。</p>
        ) : approvalSummaryState.summary.can_approve && approvalSummaryState.summary.approvable_object ? (
          <>
            <dl>
              <dt>执行状态</dt>
              <dd>可执行批准写回</dd>
              <dt>执行对象</dt>
              <dd>{`${approvalSummaryState.summary.approvable_object.object_type} #${approvalSummaryState.summary.approvable_object.id}`}</dd>
              <dt>POST 请求体</dt>
              <dd>{approvalSummaryState.summary.approvable_object.object_type === "repair_patch" ? "repair_patch_id" : "scene_packet_id"}</dd>
            </dl>
            <form action={approveStudioWritebackAction}>
              {approvalSummaryState.summary.approvable_object.object_type === "repair_patch" ? (
                <input type="hidden" name="repair_patch_id" value={approvalSummaryState.summary.approvable_object.id} />
              ) : (
                <input type="hidden" name="scene_packet_id" value={approvalSummaryState.summary.approvable_object.id} />
              )}
              <button type="submit">提交批准写回</button>
            </form>
          </>
        ) : (
          <p>暂不可执行批准写回：{approvalSummaryState.summary.unavailable_reason ?? "暂无阻塞原因"}</p>
        )}
      </section>
      <section aria-labelledby="studio-recovery-summary-title">
        <h2 id="studio-recovery-summary-title">失败恢复摘要</h2>
        <p>当前 Web Studio 在 Repair 后读取 {studioRecoverySummaryEndpoint}，用于展示失败节点、checkpoint 和可恢复步骤。</p>
        {recoverySummaryState.status === "idle" ? (
          <p>{recoverySummaryState.message}</p>
        ) : recoverySummaryState.status === "error" ? (
          <p role="status">读取失败：{recoverySummaryState.message}</p>
        ) : (
          <dl>
            <dt>恢复状态</dt>
            <dd>{recoverySummaryState.summary.can_recover ? "可恢复" : "不可恢复"}</dd>
            <dt>失败节点</dt>
            <dd>{recoverySummaryState.summary.failed_node ?? "暂无失败节点"}</dd>
            <dt>Checkpoint</dt>
            <dd>{recoverySummaryState.summary.checkpoint ? JSON.stringify(recoverySummaryState.summary.checkpoint) : "暂无 checkpoint"}</dd>
            <dt>可恢复步骤</dt>
            <dd>
              {recoverySummaryState.summary.recoverable_steps.length === 0
                ? "暂无可恢复步骤"
                : recoverySummaryState.summary.recoverable_steps.join("；")}
            </dd>
            <dt>错误摘要</dt>
            <dd>{recoverySummaryState.summary.error_summary ?? "暂无错误摘要"}</dd>
            <dt>不可恢复原因</dt>
            <dd>{recoverySummaryState.summary.unrecoverable_reason ?? "暂无阻塞原因"}</dd>
          </dl>
        )}
      </section>
      <ScenePacketPanel />
    </main>
  );

}
