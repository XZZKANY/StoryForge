/**
 * 测试替身后端（`http-*-double.ts`）的地址与 key。产品里已经没有 HTTP 后端；
 * 需要特定地址的测试可以 vi.mock 这个模块，浏览器回归经 Vite define 注入。
 */
export async function getApiConfig(): Promise<{ baseUrl: string; apiKey: string }> {
  const env = import.meta.env ?? {};
  return {
    baseUrl: env.VITE_STORYFORGE_API_BASE_URL ?? 'http://storyforge.test',
    apiKey: env.VITE_STORYFORGE_API_KEY ?? 'fixture',
  };
}

export function trimApiBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}
