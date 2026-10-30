import { ProjectReadError, type ProjectReader } from '../readPort';
import { redactSensitiveText, type SecretContext } from './redaction';
import { sha256Hex } from './sha256';

export const INSTRUCTION_BUDGET = 4000;

/** 编排层可见的失败（未生成补丁）；消息原样给作者。 */
export class AgentOrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentOrchestrationError';
  }
}

const length = (text: string) => Array.from(text).length;
type Issue = { [key: string]: unknown };

function boundedInstruction(text: string, secrets: SecretContext): string {
  const redacted = redactSensitiveText(text, secrets);
  if (length(redacted) > INSTRUCTION_BUDGET)
    throw new AgentOrchestrationError(
      '脱敏后的修订范围超过指令预算，请分批选择审稿问题；未生成修订。',
    );
  return redacted;
}

/** 把选中的审稿问题逐条送达；每条的证据摘录各占一份预算，不让前面的长引文挤掉后面的身份。 */
export function composeScopedInstruction(
  blocks: readonly string[],
  issues: readonly Issue[],
  actions: readonly string[],
  secrets: SecretContext,
): string {
  const suffix = '请只处理上述有效审稿范围内的问题，并保持原有事实连续。';
  const headers = issues.map(
    (issue, index) =>
      `${index + 1}. [${issue.id || issue.agent || 'review'}/${issue.category || 'review'}/${issue.severity || 'info'}] ` +
      `${issue.message || '未命名问题'}` +
      (issue.suggested_action ? ` 建议：${issue.suggested_action}` : ''),
  );
  let review = '上一轮多视角审稿报告（已按本轮指令筛选范围）：\n有效问题：\n' + headers.join('\n');
  if (actions.length) review += '\n建议：\n' + actions.join('\n');
  const mandatory =
    issues.length || actions.length
      ? [...blocks, review, suffix].join('\n\n')
      : blocks.join('\n\n');
  const available = INSTRUCTION_BUDGET - length(mandatory);
  if (available < 0)
    throw new AgentOrchestrationError(
      '修订范围超过指令预算，请缩短指令或分批选择审稿问题；未生成修订。',
    );
  if (!issues.length) return boundedInstruction(mandatory, secrets);
  const quoteBudget = Math.min(320, Math.floor(available / issues.length));
  const lines = headers.map((header, index) => {
    const evidence = issues[index].evidence;
    if (typeof evidence !== 'string' || !evidence) return header;
    const label = ' 证据：';
    const marker = '（证据摘录已截断）';
    if (length(label) + length(evidence) <= quoteBudget) return header + label + evidence;
    if (quoteBudget > length(label) + length(marker))
      return (
        header +
        label +
        Array.from(evidence)
          .slice(0, quoteBudget - length(label) - length(marker))
          .join('') +
        marker
      );
    throw new AgentOrchestrationError('修订范围没有足够证据预算，请分批选择审稿问题；未生成修订。');
  });
  review = '上一轮多视角审稿报告（已按本轮指令筛选范围）：\n有效问题：\n' + lines.join('\n');
  if (actions.length) review += '\n建议：\n' + actions.join('\n');
  return boundedInstruction([...blocks, review, suffix].join('\n\n'), secrets);
}

/** 审稿报告必须是当前文件当前版本的：路径解析到同一文件（在项目内），内容哈希一致。 */
export async function verifyReviewSource(
  reader: ProjectReader,
  report: { [key: string]: unknown } | null,
  filePath: string,
  content: string,
  projectRoot: string | null,
): Promise<void> {
  if (!report || !report.content_sha256) return;
  const reported = report.file_path;
  if (typeof reported !== 'string')
    throw new AgentOrchestrationError('审稿来源缺失，请重新审稿后修订。');
  let sameFile = false;
  if (projectRoot) {
    try {
      const left = (await reader.resolveProjectPath(projectRoot, reported)).resolvedRelativePath;
      const right = (await reader.resolveProjectPath(projectRoot, filePath)).resolvedRelativePath;
      sameFile = left === right;
    } catch (error) {
      if (!(error instanceof ProjectReadError)) throw error;
    }
  } else sameFile = reported === filePath;
  if (!sameFile || report.content_sha256 !== sha256Hex(content))
    throw new AgentOrchestrationError('审稿报告不是当前文件的当前版本，请重新审稿后修订。');
}
