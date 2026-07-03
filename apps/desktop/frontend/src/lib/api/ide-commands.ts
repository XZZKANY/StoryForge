import { getApiConfig, trimApiBaseUrl } from './config';
import { readErrorDetail } from './errors';

export async function executeIdeCommand(
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
