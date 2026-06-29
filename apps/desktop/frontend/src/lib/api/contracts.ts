import type { components } from '../../../../../../packages/shared/src/generated/api-types';

export type ApiAssistantContextBundle = components['schemas']['AssistantContextBundle'];

export type ApiAssistantReviseRequest = Omit<
  components['schemas']['AssistantReviseRequest'],
  'context_bundle'
> & {
  context_bundle?: ApiAssistantContextBundle | null;
};

export type ApiAssistantReviseResponse = components['schemas']['AssistantReviseResponse'];
export type ApiProviderHealthResponse = components['schemas']['ProviderHealthResponse'];
export type ApiAgentRoleRead = components['schemas']['AgentRoleRead'];
