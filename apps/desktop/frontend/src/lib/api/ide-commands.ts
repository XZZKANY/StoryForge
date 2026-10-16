import { readEngineMode } from '../engine/flags';
import { getApiConfig, trimApiBaseUrl } from './config';
import { readErrorDetail } from './errors';

export async function executeIdeCommand(
  commandId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // 按开关分流（迁移计划 §4.1）：ts 档在进程内跑引擎；影子档照走 Python，引擎在后台比对。
  const mode = readEngineMode('engine.ideCommands');
  if (mode === 'ts')
    return (await import('../engine/ideCommands')).executeIdeCommandWithEngine(commandId, args);
  if (mode === 'shadow') {
    // 影子模块加载失败也不能挡住作者：照走 Python，这一次不比。
    const shadow = await import('../engine/commandShadow').catch(() => null);
    if (shadow)
      return shadow.shadowIdeCommand(commandId, args, () => pythonIdeCommand(commandId, args));
  }
  return pythonIdeCommand(commandId, args);
}

async function pythonIdeCommand(
  commandId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(
    `${trimApiBaseUrl(baseUrl)}/api/ide/commands/${encodeURIComponent(commandId)}`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'X-StoryForge-API-Key': apiKey,
      },
      body: JSON.stringify({ args }),
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }

  return (await response.json()) as Record<string, unknown>;
}
