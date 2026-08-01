import { executeIdeCommand } from './api/ide-commands';

export type PlanMarkOutcome = {
  updated: boolean;
  reason?: string;
  ordinal?: number;
  next_ordinal?: number | null;
  next_goal?: string | null;
};

/**
 * 作者接受补丁、正文真的落盘之后，把对应章在连载计划里标 done。
 *
 * 补的是那个真实缺口：此前「接受之后谁标 done」没人负责，得等作者下一轮开口跟 agent 说话，
 * 中间计划一直显示 pending、每轮 prompt 都白带一段「计划与正文对不上」。
 *
 * **best-effort，绝不抛**：这是写回**成功之后**的收尾动作，抛出去会被 handleAcceptSuggestion
 * 的 catch 翻译成「接受失败」toast，凭空伪造一次假失败——而正文其实已经写进去了。
 *
 * 「没改」同样不是失败：非正文文件、该章不在计划里、项目根本没在用连载计划，后端都如实带
 * reason 返回 updated=false。判断哪一章、要不要改，全在后端按正文算，前端不猜章序。
 */
export async function markChapterWrittenInPlan(
  projectPath: string | null,
  filePath: string,
): Promise<PlanMarkOutcome | null> {
  return runPlanCommand('plan.mark_written', projectPath, filePath, '连载计划标记已写入失败');
}

/**
 * 作者撤销一次「新建」、正文被删之后，把对应章从 done 退回 pending。
 *
 * 只用于删文件那一支：修订的撤销走反向写回，文件还在、那章依然是写完的，退回去就错了。
 * 后端另有一道以正文为准的闸（文件还在就拒绝），这里的克制是不让它白跑一趟。
 */
export async function unmarkChapterWrittenInPlan(
  projectPath: string | null,
  filePath: string,
): Promise<PlanMarkOutcome | null> {
  return runPlanCommand('plan.unmark_written', projectPath, filePath, '连载计划撤销标记失败');
}

async function runPlanCommand(
  commandId: string,
  projectPath: string | null,
  filePath: string,
  failureLabel: string,
): Promise<PlanMarkOutcome | null> {
  if (!projectPath || !filePath) return null;
  try {
    const result = await executeIdeCommand(commandId, {
      project_root: projectPath,
      file_path: filePath,
    });
    const plan = (result as { payload?: { plan?: PlanMarkOutcome } }).payload?.plan;
    return plan ?? null;
  } catch (error) {
    console.error(failureLabel, error);
    return null;
  }
}
