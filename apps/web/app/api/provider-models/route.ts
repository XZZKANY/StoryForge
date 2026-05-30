import { NextResponse } from 'next/server';

import { probeProviderModels, type ProviderModelsRequest } from './provider-models';

export async function POST(request: Request) {
  const payload = (await request.json()) as ProviderModelsRequest;
  const result = await probeProviderModels(payload);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
