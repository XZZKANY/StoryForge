/** 长期规矩：`.storyforge/agent-instructions.md`，引擎每轮对话与产字都会读进去。 */
import { resolveProjectRelativePath } from '../project-context';

export type AuthorInstructionsState =
  | { status: 'missing'; filePath: string }
  /** 文件在，但这一份带不进对话：空的、二进制、过大或读不了。 */
  | { status: 'unused'; filePath: string }
  | {
      status: 'active';
      filePath: string;
      chars: number;
      /** 超过上限时只带最后 limit 字以内（新要求写在末尾）。 */
      truncated: boolean;
      limit: number;
      preview: string[];
    };

const PREVIEW_LINES = 4;

export async function loadAuthorInstructions(
  projectRoot: string,
): Promise<AuthorInstructionsState> {
  const raw = await (
    await import('../engine/authorInstructions')
  ).inspectEngineAuthorInstructions(projectRoot);
  const filePath = resolveProjectRelativePath(projectRoot, raw.path);
  if (filePath === null) throw new Error('长期规矩的路径不在当前作品里');
  if (!raw.exists) return { status: 'missing', filePath };
  if (raw.body === null) return { status: 'unused', filePath };
  const preview = raw.body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, PREVIEW_LINES);
  return {
    status: 'active',
    filePath,
    chars: raw.chars,
    truncated: raw.truncated,
    limit: raw.limit,
    preview,
  };
}
