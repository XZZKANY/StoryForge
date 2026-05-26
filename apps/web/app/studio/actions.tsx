import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { apiFetch } from '../../lib/api-client';

import { submitStudioApproval } from './approval-action-core';
import { studioApproveEndpoint } from './api';

export async function approveStudioWritebackAction(formData: FormData) {
  'use server';

  return submitStudioApproval(formData, {
    endpoint: studioApproveEndpoint,
    apiFetch,
    revalidatePath,
    redirect,
  });
}
