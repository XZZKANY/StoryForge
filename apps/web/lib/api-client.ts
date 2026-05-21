export type ApiResult<T> =
  | { readonly status: "ready"; readonly data: T }
  | { readonly status: "error"; readonly message: string };

const defaultApiBaseUrl = "http://127.0.0.1:8000";
const defaultApiKey = "local-dev-key";

export function getApiBaseUrl(): string {
  return process.env.STORYFORGE_API_BASE_URL ?? defaultApiBaseUrl;
}

export function buildApiUrl(path: string, params: Record<string, string | number | undefined | null> = {}): URL {
  const url = new URL(path, getApiBaseUrl());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export async function readJson<T>(
  path: string,
  options: {
    readonly params?: Record<string, string | number | undefined | null>;
    readonly validate: (value: unknown) => value is T;
    readonly invalidMessage: string;
    readonly init?: RequestInit;
  },
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(buildApiUrl(path, options.params), {
      cache: "no-store",
      ...options.init,
      headers: {
        "X-StoryForge-API-Key": process.env.STORYFORGE_API_KEY ?? defaultApiKey,
        ...(options.init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      return { status: "error", message: `API 返回 ${response.status}` };
    }
    const payload: unknown = await response.json();
    if (!options.validate(payload)) {
      return { status: "error", message: options.invalidMessage };
    }
    return { status: "ready", data: payload };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "未知错误" };
  }
}
