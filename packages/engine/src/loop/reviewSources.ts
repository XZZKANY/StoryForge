import { isObj, pythonTruthy, type JsonValue, type Obj } from '../kernel/json';
import type { ConversationSources } from './conversationHistory';
import { AgentOrchestrationError } from './runPayloads';

const truthy = (value: unknown) => pythonTruthy(value as JsonValue);

/**
 * 当前会话最新的审稿报告（events/review_sources）：只认整份报告，不认孤立的 issue id。
 * transient 是本轮循环里刚产出、尚未结算落库的报告，优先于库里的。
 */
export async function currentConversationReview(
  conversation: ConversationSources,
  sessionId: number,
  options: { offered?: Obj | null; transient?: Obj | null; required?: boolean } = {},
): Promise<Obj | null> {
  const offered = options.offered ?? null;
  const required = options.required ?? false;
  let stored = options.transient ?? null;
  if (stored === null) {
    const reports = (await conversation.runArtifacts(sessionId)).filter(
      (row) => row.kind === 'review_report',
    );
    const latest = reports.length ? reports[reports.length - 1].payload : null;
    stored = isObj(latest) ? latest : null;
  }
  if (offered !== null) {
    // 未绑定的旧报告只在不指向审稿的请求里兼容，不能为序号作证，也不能盖过已落库的报告。
    if (!truthy(offered.report_id) && !truthy(offered.content_sha256) && !required) return offered;
    if (!truthy(stored) || !truthy(stored!.report_id) || offered.report_id !== stored!.report_id)
      throw new AgentOrchestrationError('审稿报告不是当前会话的最新报告，请重新审稿后修订。');
  }
  if (
    required &&
    (!truthy(stored) || !truthy(stored!.report_id) || !truthy(stored!.content_sha256))
  )
    throw new AgentOrchestrationError('当前会话没有已绑定的审稿报告，请先审稿再选择问题。');
  return stored;
}
