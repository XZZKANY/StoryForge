import { readJson, type ApiResponseSchema } from '../../lib/api-client';

type WorkspaceRead = ApiResponseSchema<'WorkspaceRead'>;

export type HomeProjectItem = {
  readonly id: number;
  readonly title: string;
  readonly description: string;
  readonly updatedAt: string;
  readonly href: string;
};

export type HomeProjectListState =
  | { readonly status: 'loading' | 'pending' }
  | { readonly status: 'ready'; readonly projects: readonly HomeProjectItem[] }
  | { readonly status: 'error'; readonly message: string };

export async function readHomeProjects(): Promise<HomeProjectListState> {
  const result = await readJson<readonly WorkspaceRead[]>('/api/workspaces', {
    validate: isWorkspaceReadList,
    invalidMessage: 'Projects API 返回格式不符合预期',
  });

  return result.status === 'ready'
    ? { status: 'ready', projects: result.data.map(mapWorkspaceToHomeProject) }
    : { status: 'error', message: result.message.replace('API 返回', 'Projects API 返回') };
}

export function mapWorkspaceToHomeProject(workspace: WorkspaceRead): HomeProjectItem {
  return {
    id: workspace.id,
    title: workspace.title,
    description: workspace.description?.trim() || `工作区 ${workspace.slug}`,
    updatedAt: workspace.updated_at,
    href: `/?view=projects&workspace_id=${workspace.id}`,
  };
}

function isWorkspaceReadList(value: unknown): value is readonly WorkspaceRead[] {
  return Array.isArray(value) && value.every(isWorkspaceRead);
}

function isWorkspaceRead(value: unknown): value is WorkspaceRead {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<WorkspaceRead>;
  return (
    typeof item.id === 'number' &&
    typeof item.title === 'string' &&
    typeof item.slug === 'string' &&
    typeof item.status === 'string' &&
    (typeof item.description === 'string' || item.description === null) &&
    typeof item.seat_limit === 'number' &&
    typeof item.created_at === 'string' &&
    typeof item.updated_at === 'string'
  );
}
