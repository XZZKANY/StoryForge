import { queryChapterCheckHistory } from '@storyforge/engine';
import type { ChapterCheckHistoryRequest } from '../api/chapter-checks';
import { platform } from './assistant';
import { engineRuns, engineSecrets, engineSessions } from './store';

/** 引擎错误的文本就是 Python 路由的 detail（404 / 409 / 422）；交给调用方的是普通 Error。 */
function asApiError(error: unknown): unknown {
  if (error instanceof Error && typeof (error as { status?: unknown }).status === 'number')
    return new Error(error.message);
  return error;
}

/** 检查历史的 ts 档：会话与 run 都在引擎库，回包与 Python 路由同一种形状（由调用方解码核对）。 */
export async function queryEngineChapterChecks(request: ChapterCheckHistoryRequest) {
  // WebView 里能脱敏的只有占位串；历史不该因为模型配置读不出而打不开。
  const secrets = await engineSecrets().catch(() => ({ values: [] }));
  const [{ store }, sessions] = await Promise.all([engineRuns(), engineSessions(secrets)]);
  try {
    return await queryChapterCheckHistory(
      { store, sessions, secrets, platform: platform() },
      request,
    );
  } catch (error) {
    throw asApiError(error);
  }
}
