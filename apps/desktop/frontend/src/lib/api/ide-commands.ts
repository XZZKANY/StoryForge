import { readEngineMode } from '../engine/flags';
import { getApiConfig, trimApiBaseUrl } from './config';
import { readErrorDetail } from './errors';

export async function executeIdeCommand(
  commandId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // ts 档在进程内跑引擎（迁移计划 §4.1）；发行版只有 Python，不加载引擎。
  if (readEngineMode('engine.ideCommands') === 'ts')
    return (await import('../engine/ideCommands')).executeIdeCommandWithEngine(commandId, args);
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
