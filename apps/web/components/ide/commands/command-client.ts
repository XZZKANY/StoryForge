export type IdeCommandResponse = {
  readonly command_id: string;
  readonly status: string;
  readonly audit_event_id?: string | null;
  readonly payload: Record<string, unknown>;
};

export async function executeIdeCommand(
  commandId: string,
  args: Record<string, unknown> = {},
): Promise<IdeCommandResponse> {
  const { apiFetch } = await import('../../../lib/api-client');
  const response = await apiFetch(`/api/ide/commands/${encodeURIComponent(commandId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args }),
  });
  if (!response.ok) {
    throw new Error(`IDE 命令执行失败：${response.status}`);
  }
  return (await response.json()) as IdeCommandResponse;
}
