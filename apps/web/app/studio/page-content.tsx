import Link from 'next/link';

import { ScenePacketPanel } from '../../components/scene-packet/ScenePacketPanel';
import { JudgeIssueList } from '../../components/judge-panel/JudgeIssueList';
import { RepairDiffViewer } from '../../components/diff-viewer/RepairDiffViewer';

import { approveStudioWritebackAction } from './actions';
import {
  generationChain,
  getStudioTarget,
  readStudioApprovalSummary,
  readStudioBooks,
  readStudioChapterGoal,
  readStudioJudgeReview,
  readStudioRecoverySummary,
  readStudioRepairPatches,
  readStudioScenePacket,
  studioApprovalSummaryEndpoint,
  studioApproveEndpoint,
  studioBooksEndpoint,
  studioChapterGoalsEndpoint,
  studioJudgeReviewsEndpoint,
  studioRecoverySummaryEndpoint,
  studioRepairPatchesEndpoint,
  studioScenePacketsEndpoint,
} from './api';
import { StudioFlow, type StudioFlowStep } from './StudioFlow';

export async function StudioPageContent({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const bookListState = await readStudioBooks();
  const requestedBookId = resolvedSearchParams?.book_id
    ? Number(resolvedSearchParams.book_id)
    : undefined;
  const selectedBook =
    bookListState.status === 'ready'
      ? ((requestedBookId
          ? bookListState.books.find((b) => b.id === requestedBookId)
          : undefined) ?? bookListState.books[0])
      : undefined;
  const studioTarget = getStudioTarget(selectedBook);
  const [chapterGoalState, scenePacketState] = await Promise.all([
    readStudioChapterGoal(studioTarget),
    readStudioScenePacket(studioTarget),
  ]);
  const [judgeReviewState, repairPatchState] = await Promise.all([
    readStudioJudgeReview(scenePacketState),
    readStudioRepairPatches(scenePacketState),
  ]);
  const [approvalSummaryState, recoverySummaryState] = await Promise.all([
    readStudioApprovalSummary(scenePacketState, repairPatchState),
    readStudioRecoverySummary(scenePacketState),
  ]);
  const approvalSubmitted = resolvedSearchParams?.approval_submitted === '1';

  const studioSteps: StudioFlowStep[] = [
    {
      id: 'book',
      label: '选作品',
      title: '选作品',
      description: '先确认当前工作区的作品列表，并选择本轮生成要推进的作品。',
      completed: selectedBook !== undefined,
      content: (
        <section aria-labelledby="studio-book-list-title">
          <h2 id="studio-book-list-title">读取作品列表</h2>
          <p>
            当前 Web Studio 只读取 {studioBooksEndpoint} 这一个后端端点，不扩展全量 API client。
          </p>
          {bookListState.status === 'error' ? (
            <p role="status">可重试错误摘要：{bookListState.message}</p>
          ) : bookListState.books.length === 0 ? (
            <p>空列表：当前工作区暂无作品，请先创建或导入作品。</p>
          ) : (
            <ul>
              {bookListState.books.map((book) => (
                <li key={book.id}>
                  <Link
                    href={`/studio?book_id=${book.id}`}
                    className={book.id === selectedBook?.id ? 'font-bold text-amber-700' : ''}
                  >
                    <strong>{book.title}</strong>
                    <span>作品 ID：{book.id}</span>
                    <span>最近章节编号：{book.recent_chapter_ordinal ?? '暂无章节'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ),
    },
    {
      id: 'goal',
      label: '设目标',
      title: '设目标',
      description: '在作品确定后核对目标章节、章节目标、上章摘要和连续性约束。',
      completed: chapterGoalState.status === 'ready',
      content: (
        <section aria-labelledby="studio-chapter-goal-title">
          <h2 id="studio-chapter-goal-title">读取章节目标</h2>
          <p>
            当前 Web Studio 只在作品列表之后读取 {studioChapterGoalsEndpoint}
            ，用于展示章节目标、上章摘要和连续性约束。
          </p>
          {chapterGoalState.status === 'idle' ? (
            <p>{chapterGoalState.message}</p>
          ) : chapterGoalState.status === 'error' ? (
            <p role="status">可重试错误摘要：{chapterGoalState.message}</p>
          ) : (
            <dl>
              <dt>目标章节</dt>
              <dd>
                第 {chapterGoalState.goal.target_chapter_ordinal} 章：
                {chapterGoalState.goal.target_chapter_title}
              </dd>
              <dt>章节目标</dt>
              <dd>{chapterGoalState.goal.chapter_goal}</dd>
              <dt>上章摘要</dt>
              <dd>{chapterGoalState.goal.previous_chapter_summary ?? '暂无上章摘要'}</dd>
              <dt>连续性约束</dt>
              <dd>
                {chapterGoalState.goal.continuity_constraints.length === 0
                  ? '暂无连续性约束'
                  : chapterGoalState.goal.continuity_constraints.join('；')}
              </dd>
            </dl>
          )}
        </section>
      ),
    },
    {
      id: 'generate',
      label: '生成',
      title: '生成 Scene Packet',
      description: '目标确认后生成 Scene Packet，并核对证据数量、预算摘要和上下文快照。',
      completed: scenePacketState.status === 'ready',
      content: (
        <section aria-labelledby="studio-scene-packet-title">
          <h2 id="studio-scene-packet-title">读取 Scene Packet</h2>
          <p>
            当前 Web Studio 只在章节目标之后读取 {studioScenePacketsEndpoint}，用于展示 Scene Packet
            的证据数量和上下文预算摘要。
          </p>
          {scenePacketState.status === 'idle' ? (
            <p>{scenePacketState.message}</p>
          ) : scenePacketState.status === 'error' ? (
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
              <dd>
                {Object.keys(scenePacketState.packet.budget_summary).length === 0 ? (
                  '暂无预算数据'
                ) : (
                  <dl>
                    {Object.entries(scenePacketState.packet.budget_summary).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </dd>
              <dt>Compiled Context</dt>
              <dd>{scenePacketState.packet.compiled_context_id ?? '暂无上下文快照'}</dd>
            </dl>
          )}
        </section>
      ),
    },
    {
      id: 'review',
      label: '评审并批准',
      title: '评审并批准',
      description: '合并 Judge 评审、Repair 修订、批准摘要和批准按钮，形成最后确认步骤。',
      completed: approvalSubmitted,
      content: (
        <>
          <section aria-labelledby="studio-judge-review-title">
            <h2 id="studio-judge-review-title">读取 Judge 评审</h2>
            <p>
              当前 Web Studio 只在 Scene Packet 之后读取 {studioJudgeReviewsEndpoint}
              ，用于展示评审摘要、评审分数和关键问题。
            </p>
            {judgeReviewState.status === 'idle' ? (
              <p>{judgeReviewState.message}</p>
            ) : judgeReviewState.status === 'error' ? (
              <p role="status">可重试错误摘要：{judgeReviewState.message}</p>
            ) : (
              <>
                <dl>
                  <dt>评审状态</dt>
                  <dd>{judgeReviewState.review.status}</dd>
                  <dt>评审分数</dt>
                  <dd>{judgeReviewState.review.score}</dd>
                  <dt>问题数量</dt>
                  <dd>{judgeReviewState.review.issue_count}</dd>
                  <dt>最高严重级别</dt>
                  <dd>{judgeReviewState.review.highest_severity ?? '暂无问题'}</dd>
                  <dt>关键问题</dt>
                  <dd>
                    {judgeReviewState.review.issues.length === 0
                      ? '暂无关键问题'
                      : `${judgeReviewState.review.issue_count} 个问题`}
                  </dd>
                </dl>
                {judgeReviewState.review.issues.length > 0 && (
                  <JudgeIssueList
                    issues={judgeReviewState.review.issues.map((issue) => ({
                      id: String(issue.id),
                      severity:
                        issue.severity === 'critical'
                          ? ('高' as const)
                          : issue.severity === 'major'
                            ? ('中' as const)
                            : ('低' as const),
                      location: `[${issue.span_start}–${issue.span_end}]`,
                      message: issue.summary,
                    }))}
                  />
                )}
              </>
            )}
          </section>
          <section aria-labelledby="studio-repair-patches-title">
            <h2 id="studio-repair-patches-title">读取 Repair 修订</h2>
            <p>
              当前 Web Studio 只在 Scene Packet 之后与 Judge 评审并行读取{' '}
              {studioRepairPatchesEndpoint}，用于展示修订文本、差异摘要和采纳建议。
            </p>
            {repairPatchState.status === 'idle' ? (
              <p>{repairPatchState.message}</p>
            ) : repairPatchState.status === 'error' ? (
              <p role="status">可重试错误摘要：{repairPatchState.message}</p>
            ) : repairPatchState.patches.length === 0 ? (
              <p>空列表：当前评审暂无 Repair 修订补丁。</p>
            ) : (
              <div>
                {repairPatchState.patches.map((patch) => (
                  <div key={patch.id}>
                    <p>
                      <strong>补丁 #{patch.id}</strong>（问题 #{patch.issue_id}，{patch.status}）
                      {patch.requires_rejudge && <span> — 需要重新评审</span>}
                    </p>
                    <RepairDiffViewer
                      originalText={patch.target_span}
                      revisedText={patch.replacement_text}
                    />
                    <p>采纳建议：{patch.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
          {approvalSubmitted ? (
            <section aria-labelledby="studio-approval-execute-result-title">
              <h2 id="studio-approval-execute-result-title">批准写回已提交</h2>
              <dl>
                <dt>回写状态</dt>
                <dd>{resolvedSearchParams.writeback_status ?? '暂无回写状态'}</dd>
                <dt>批准章节</dt>
                <dd>{resolvedSearchParams.approved_chapter_id ?? '暂无批准章节'}</dd>
                <dt>连续性更新</dt>
                <dd>{resolvedSearchParams.continuity_update_summary ?? '暂无连续性更新摘要'}</dd>
                <dt>不可批准原因</dt>
                <dd>{resolvedSearchParams.unavailable_reason ?? '暂无阻塞原因'}</dd>
              </dl>
            </section>
          ) : null}
          <section aria-labelledby="studio-approval-summary-title">
            <h2 id="studio-approval-summary-title">批准回写摘要</h2>
            <p>
              当前 Web Studio 只在 Repair 后读取 {studioApprovalSummaryEndpoint}
              ，用于展示可批准对象、目标章节、回写状态和不可批准原因。
            </p>
            {approvalSummaryState.status === 'idle' ? (
              <p>{approvalSummaryState.message}</p>
            ) : approvalSummaryState.status === 'error' ? (
              <p role="status">读取失败：{approvalSummaryState.message}</p>
            ) : (
              <dl>
                <dt>批准状态</dt>
                <dd>{approvalSummaryState.summary.can_approve ? '可批准' : '不可批准'}</dd>
                <dt>可批准对象</dt>
                <dd>
                  {approvalSummaryState.summary.approvable_object
                    ? `${approvalSummaryState.summary.approvable_object.object_type} #${approvalSummaryState.summary.approvable_object.id}`
                    : '暂无可批准对象'}
                </dd>
                <dt>目标章节</dt>
                <dd>
                  {approvalSummaryState.summary.target_chapter
                    ? `第 ${approvalSummaryState.summary.target_chapter.ordinal} 章：${approvalSummaryState.summary.target_chapter.title}`
                    : '暂无目标章节'}
                </dd>
                <dt>回写状态</dt>
                <dd>{approvalSummaryState.summary.writeback_status}</dd>
                <dt>不可批准原因</dt>
                <dd>{approvalSummaryState.summary.unavailable_reason ?? '暂无阻塞原因'}</dd>
              </dl>
            )}
          </section>
          <section aria-labelledby="studio-approve-execution-title">
            <h2 id="studio-approve-execution-title">批准写回执行入口</h2>
            <p>
              后端已提供 {studioApproveEndpoint} 执行契约；页面通过 Server Action
              提交批准写回，并在提交后重新读取 Studio 状态。
            </p>
            {approvalSummaryState.status !== 'ready' ? (
              <p>批准写回执行需要先读取批准摘要。</p>
            ) : approvalSummaryState.summary.can_approve &&
              approvalSummaryState.summary.approvable_object ? (
              <>
                <dl>
                  <dt>执行状态</dt>
                  <dd>可执行批准写回</dd>
                  <dt>执行对象</dt>
                  <dd>{`${approvalSummaryState.summary.approvable_object.object_type} #${approvalSummaryState.summary.approvable_object.id}`}</dd>
                  <dt>POST 请求体</dt>
                  <dd>
                    {approvalSummaryState.summary.approvable_object.object_type === 'repair_patch'
                      ? 'repair_patch_id'
                      : 'scene_packet_id'}
                  </dd>
                </dl>
                <form action={approveStudioWritebackAction}>
                  {approvalSummaryState.summary.approvable_object.object_type === 'repair_patch' ? (
                    <input
                      type="hidden"
                      name="repair_patch_id"
                      value={approvalSummaryState.summary.approvable_object.id}
                    />
                  ) : (
                    <input
                      type="hidden"
                      name="scene_packet_id"
                      value={approvalSummaryState.summary.approvable_object.id}
                    />
                  )}
                  <button
                    className="rounded-full bg-amber-700 px-5 py-2 font-semibold text-white hover:enabled:bg-amber-800 disabled:opacity-50"
                    type="submit"
                  >
                    提交批准写回
                  </button>
                </form>
              </>
            ) : (
              <p>
                暂不可执行批准写回：
                {approvalSummaryState.summary.unavailable_reason ?? '暂无阻塞原因'}
              </p>
            )}
          </section>
        </>
      ),
    },
  ];
  return (
    <main aria-labelledby="studio-title">
      <h1 id="studio-title">Studio 创作工作台</h1>
      <p>Studio 用于核对从作品选择、章节目标到批准回写和失败恢复的连续创作证据链。</p>
      <section aria-labelledby="studio-current-scope-title">
        <h2 id="studio-current-scope-title">当前对象 / 当前证据 / 当前动作</h2>
        <dl>
          <dt>当前对象</dt>
          <dd>作品、目标章节、Scene Packet、Judge 评审与 Repair Patch。</dd>
          <dt>当前证据</dt>
          <dd>章节目标、检索素材摘要、预算摘要、评审问题、修订差异、批准摘要和恢复摘要。</dd>
          <dt>当前动作</dt>
          <dd>按步骤完成选作品、设目标、生成、评审并批准。</dd>
          <dt>当前边界</dt>
          <dd>本页只展示已验证的最小闭环。未联通能力不会伪装为可用操作。</dd>
        </dl>
      </section>
      <section aria-labelledby="generation-chain-title">
        <h2 id="generation-chain-title">生成链路</h2>
        <ol>
          {generationChain.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
      <StudioFlow steps={studioSteps} />
      <section aria-labelledby="studio-recovery-summary-title">
        <h2 id="studio-recovery-summary-title">失败恢复摘要</h2>
        <p>
          当前 Web Studio 在 Repair 后读取 {studioRecoverySummaryEndpoint}
          ，用于展示失败节点、checkpoint 和可恢复步骤。
        </p>
        {recoverySummaryState.status === 'idle' ? (
          <p>{recoverySummaryState.message}</p>
        ) : recoverySummaryState.status === 'error' ? (
          <p role="status">读取失败：{recoverySummaryState.message}</p>
        ) : (
          <dl>
            <dt>恢复状态</dt>
            <dd>{recoverySummaryState.summary.can_recover ? '可恢复' : '不可恢复'}</dd>
            <dt>失败节点</dt>
            <dd>{recoverySummaryState.summary.failed_node ?? '暂无失败节点'}</dd>
            <dt>Checkpoint</dt>
            <dd>
              {recoverySummaryState.summary.checkpoint
                ? JSON.stringify(recoverySummaryState.summary.checkpoint)
                : '暂无 checkpoint'}
            </dd>
            <dt>可恢复步骤</dt>
            <dd>
              {recoverySummaryState.summary.recoverable_steps.length === 0
                ? '暂无可恢复步骤'
                : recoverySummaryState.summary.recoverable_steps.join('；')}
            </dd>
            <dt>错误摘要</dt>
            <dd>{recoverySummaryState.summary.error_summary ?? '暂无错误摘要'}</dd>
            <dt>不可恢复原因</dt>
            <dd>{recoverySummaryState.summary.unrecoverable_reason ?? '暂无阻塞原因'}</dd>
          </dl>
        )}
      </section>
      <ScenePacketPanel
        title={
          chapterGoalState.status === 'ready'
            ? chapterGoalState.goal.target_chapter_title
            : undefined
        }
        goal={chapterGoalState.status === 'ready' ? chapterGoalState.goal.chapter_goal : undefined}
        requiredFacts={
          chapterGoalState.status === 'ready'
            ? [...chapterGoalState.goal.continuity_constraints]
            : undefined
        }
        evidenceLinks={
          scenePacketState.status === 'ready'
            ? [
                {
                  label: `证据素材（${scenePacketState.packet.evidence_count} 条）`,
                  href: '#studio-scene-packet-title',
                },
                ...(scenePacketState.packet.compiled_context_id
                  ? [{ label: 'Compiled Context', href: '#studio-scene-packet-title' }]
                  : []),
              ]
            : undefined
        }
      />
    </main>
  );
}
