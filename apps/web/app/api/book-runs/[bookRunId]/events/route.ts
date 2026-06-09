import { apiFetch } from '../../../../../lib/api-client';

export async function GET(_request: Request, context: { params: Promise<{ bookRunId: string }> }) {
  const { bookRunId } = await context.params;
  const upstream = await apiFetch(`/api/ide/runs/${bookRunId}/events`);

  if (!upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
