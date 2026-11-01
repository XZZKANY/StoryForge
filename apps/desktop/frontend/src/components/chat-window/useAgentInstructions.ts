import { useCallback, useEffect, useState } from 'react';

import {
  loadAuthorInstructions,
  type AuthorInstructionsState,
} from '../../lib/api/author-instructions';
import { useAsyncEffect } from '../../lib/async-guards';
import { emitOpenFileRequest } from '../../lib/assistant-events';
import { resolveProjectRelativePath } from '../../lib/project-context';
import { normalizePathForMatch } from '../../lib/project/path';
import { FS_MUTATION_EVENT, TauriFileSystem } from '../../lib/tauri-fs';
import { emitToast } from '../../lib/toast';

// 这段说明也会原样带给模型，所以只写怎么用、不举例（例子会被当成真规矩）。
export const AUTHOR_INSTRUCTIONS_TEMPLATE =
  '# 长期规矩\n\n（在下面写你希望 AI 每轮都遵守的要求，一行一条；这行说明可以删掉。）\n';

/** 新建长期规矩文件并返回它的绝对路径；文件已在就原样返回，绝不覆盖。 */
export async function createAuthorInstructionsFile(projectRoot: string): Promise<string> {
  const dir = resolveProjectRelativePath(projectRoot, '.storyforge');
  const file = resolveProjectRelativePath(projectRoot, '.storyforge/agent-instructions.md');
  if (dir === null || file === null) throw new Error('长期规矩的路径不在当前作品里');
  if (await TauriFileSystem.projectPathExists(projectRoot, file)) return file;
  await TauriFileSystem.createDir(projectRoot, dir, true);
  await TauriFileSystem.writeFile(projectRoot, file, AUTHOR_INSTRUCTIONS_TEMPLATE);
  return file;
}

export type AgentInstructionsView =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | AuthorInstructionsState;

// 写盘广播带路径时只认这份文件（或它所在的目录）；不带路径的是整体失效，也重读。
function touchesInstructions(changed: string | undefined): boolean {
  if (!changed) return true;
  const path = `/${normalizePathForMatch(changed)}`;
  return path.endsWith('/.storyforge/agent-instructions.md') || path.endsWith('/.storyforge');
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 对话栏「上下文」的长期规矩块：展开时读一次，之后跟着写盘广播刷新。 */
export function useAgentInstructions(projectPath: string | null) {
  // 结果连同读的是哪部作品一起存：切作品时旧结果不冒充新作品的。
  const [loaded, setLoaded] = useState<{ projectPath: string; view: AgentInstructionsView } | null>(
    null,
  );
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const onMutation = (event: Event) => {
      if (touchesInstructions((event as CustomEvent<{ path?: string }>).detail?.path))
        setVersion((value) => value + 1);
    };
    window.addEventListener(FS_MUTATION_EVENT, onMutation);
    return () => window.removeEventListener(FS_MUTATION_EVENT, onMutation);
  }, []);

  useAsyncEffect(
    (isCurrent) => {
      if (!projectPath) return;
      const settle = (view: AgentInstructionsView) => {
        if (isCurrent()) setLoaded({ projectPath, view });
      };
      loadAuthorInstructions(projectPath).then(settle, (error: unknown) =>
        settle({ status: 'error', message: errorText(error) }),
      );
    },
    [projectPath, version],
  );

  const create = useCallback(async () => {
    if (!projectPath || creating) return;
    setCreating(true);
    try {
      emitOpenFileRequest(await createAuthorInstructionsFile(projectPath));
    } catch (error) {
      emitToast(`新建长期规矩失败：${errorText(error)}`, { tone: 'error' });
    } finally {
      setCreating(false);
      setVersion((value) => value + 1);
    }
  }, [creating, projectPath]);

  const view: AgentInstructionsView = !projectPath
    ? { status: 'idle' }
    : loaded?.projectPath === projectPath
      ? loaded.view
      : { status: 'loading' };
  return { view, creating, create };
}
