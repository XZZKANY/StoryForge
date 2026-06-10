'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { apiFetch } from '../../lib/api-client';

function readTrimmedString(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function buildProjectsUrl(status: 'created' | 'invalid' | 'failed', message?: string): string {
  const params = new URLSearchParams({ view: 'projects', project_create_status: status });
  if (message) params.set('project_create_message', message);
  return `/?${params.toString()}`;
}

export async function createHomeProjectAction(formData: FormData): Promise<never> {
  const title = readTrimmedString(formData, 'title');
  const description = readTrimmedString(formData, 'description');
  if (!title) {
    return redirect(buildProjectsUrl('invalid', '项目名称不能为空。'));
  }

  try {
    const response = await apiFetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, description: description ?? null, seat_limit: 1 }),
    });
    if (!response.ok) {
      return redirect(buildProjectsUrl('failed', `Projects API 返回 ${response.status}`));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return redirect(buildProjectsUrl('failed', message));
  }

  revalidatePath('/');
  return redirect(buildProjectsUrl('created'));
}
