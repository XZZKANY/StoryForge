export type ApiErrorResponse = {
  readonly detail: string;
};

export type ProviderCapability = "llm" | "embedding" | "reranker";

export type ProviderResolution = {
  readonly provider_id: number | null;
  readonly provider_name: string;
  readonly capability: ProviderCapability;
  readonly model_aliases: Record<string, string>;
  readonly resolution_summary: string;
  readonly resolution_source: string;
  readonly credential_status: string;
};

export type JobRunSummary = {
  readonly id: number;
  readonly job_type: string;
  readonly status: string;
  readonly progress: Record<string, unknown>;
  readonly checkpoint: Record<string, unknown> | null;
  readonly error_message: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};
