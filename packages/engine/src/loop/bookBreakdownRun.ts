import type { PlainJsonObject } from '../kernel/contextValues';
import {
  completeAgentRun,
  createOrResumeAgentRun,
  recordAgentArtifact,
  type RunServices,
} from './runEvents';

/**
 * book.breakdown 的运行记录（Python `command_registry._execute_book_breakdown_command` 带会话的那一段）：
 * 一次拆书记成一个 Agent run 与一份 `book_breakdown_report` 产物，同一 analysis_id 再拆续接同一个 run。
 */
export async function recordBookBreakdownRun(
  services: RunServices,
  report: { readonly [key: string]: unknown },
): Promise<{ run_id: string; artifact_id: number }> {
  const output = report as PlainJsonObject;
  const analysisId = String(output.analysis_id);
  const run = await createOrResumeAgentRun(services, {
    publicId: `breakdown-${analysisId}`,
    sessionId: `breakdown:${analysisId}`,
    goal: '生成结构化拆书报告',
    scope: { analysis_id: output.analysis_id ?? null, input_sha256: output.input_sha256 ?? null },
    permissionProfile: null,
    budget: {},
  });
  const selected = output.selected_chapters;
  const { artifact } = await recordAgentArtifact(services, run, {
    kind: 'book_breakdown_report',
    payload: {
      analysis_id: output.analysis_id ?? null,
      input_sha256: output.input_sha256 ?? null,
      schema_version: output.schema_version ?? null,
      selection_strategy_version: output.selection_strategy_version ?? null,
      status: output.status ?? null,
      paths: output.paths ?? null,
      chapter_count: output.chapter_count ?? null,
      selected_count: Array.isArray(selected) ? selected.length : 0,
      provider: output.provider ?? null,
      model: output.model ?? null,
      retries: output.retries ?? 0,
      model_error: output.model_error ?? null,
    },
  });
  await completeAgentRun(
    services,
    run,
    { agent_result: { summary: '结构化拆书底稿已生成。' } },
    { executionId: null },
  );
  return { run_id: run.public_id, artifact_id: artifact.id };
}
