import { apiFetch } from '../../../../../lib/api-client';

export async function POST(request: Request, context: { params: Promise<{ commandId: string }> }) {
  const { commandId } = await context.params;
  const body = await request.text();
  const upstream = await apiFetch(`/api/ide/commands/${encodeURIComponent(commandId)}`, {
    method: 'POST',
    headers: { 'content-type': request.headers.get('content-type') ?? 'application/json' },
    body,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
