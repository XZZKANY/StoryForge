import { NextResponse } from 'next/server';

import { apiFetch } from '../../../lib/api-client';

export async function GET() {
  let response: Response;
  try {
    response = await apiFetch('/api/workspaces', {
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    return NextResponse.json([], { status: 200 });
  }

  if (!response.ok) {
    return NextResponse.json([], { status: 200 });
  }

  const payload: unknown = await response.json().catch(() => ({
    detail: `Workspaces API 返回 ${response.status}`,
  }));

  return NextResponse.json(payload, { status: response.status });
}
