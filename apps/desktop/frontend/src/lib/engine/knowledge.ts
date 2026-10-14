import {
  materializeKnowledgeProposal,
  refreshKnowledgeEvidence,
  resolveKnowledgeProposal,
  reviseKnowledgeProposalGroup,
  type KnowledgeInboxDeps,
} from '@storyforge/engine';
import type {
  ApiKnowledgeProposalInbox,
  ApiKnowledgeProposalItemEdit,
  ApiKnowledgeProposalPatch,
  ApiKnowledgeProposalResolveRequest,
} from '../api/contracts';
import { platform } from './assistant';
import { nativeProjectReader } from './reader';
import { engineRuns, engineSecrets } from './store';

async function deps(): Promise<KnowledgeInboxDeps> {
  const [{ store }, secrets] = await Promise.all([
    engineRuns(),
    // WebView 里能脱敏的只有占位串；收件箱不该因为模型配置读不出而打不开。
    engineSecrets().catch(() => ({ values: [] })),
  ]);
  return {
    store,
    secrets,
    reader: nativeProjectReader,
    platform: platform(),
    proposals: { newUuid: () => crypto.randomUUID(), now: () => new Date() },
  };
}

/** 引擎错误的文本就是 Python 路由的 detail（409 / 422）；交给调用方的是普通 Error。 */
function asApiError(error: unknown): unknown {
  if (error instanceof Error && typeof (error as { status?: unknown }).status === 'number')
    return new Error(error.message);
  return error;
}

async function call<T>(run: (deps: KnowledgeInboxDeps) => Promise<unknown>): Promise<T> {
  try {
    return (await run(await deps())) as T;
  } catch (error) {
    throw asApiError(error);
  }
}

export const refreshEngineKnowledge = (projectRoot: string) =>
  call<ApiKnowledgeProposalInbox>((d) => refreshKnowledgeEvidence(d, projectRoot));

export const reviseEngineKnowledge = (input: {
  projectRoot: string;
  artifactId: number;
  revision: number;
  proposals: ApiKnowledgeProposalItemEdit[];
}) => call<ApiKnowledgeProposalInbox>((d) => reviseKnowledgeProposalGroup(d, input));

export const materializeEngineKnowledge = (input: {
  projectRoot: string;
  artifactId: number;
  revision: number;
  proposalId: string;
}) => call<ApiKnowledgeProposalPatch>((d) => materializeKnowledgeProposal(d, input));

export const resolveEngineKnowledge = (input: ApiKnowledgeProposalResolveRequest) =>
  call<ApiKnowledgeProposalInbox>((d) =>
    resolveKnowledgeProposal(d, {
      projectRoot: input.project_root,
      artifactId: input.artifact_id,
      revision: input.revision,
      proposalId: input.proposal_id,
      resolution: input.resolution,
      patchIdentity: input.patch_identity ?? null,
      authorConfirmationEventId: input.author_confirmation_event_id ?? null,
    }),
  );
