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

export default async function StudioPage() {
  const bookListState = await readStudioBooks();
  const selectedBook = bookListState.status === "ready" ? bookListState.books[0] : undefined;
  const studioTarget = getStudioTarget(selectedBook);
  const [chapterGoalState, scenePacketState] = await Promise.all([readStudioChapterGoal(studioTarget), readStudioScenePacket(studioTarget)]);
  const [judgeReviewState, repairPatchState] = await Promise.all([readStudioJudgeReview(scenePacketState), readStudioRepairPatches(scenePacketState)]);

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
      <ScenePacketPanel />
    </main>
  );
}
