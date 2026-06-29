export async function readErrorDetail(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: unknown };
    if (typeof data.detail === 'string' && data.detail.trim()) {
      return data.detail;
    }
  } catch {
    // 响应体不是 JSON 时落到下方通用信息。
  }
  return `API 返回 ${response.status}`;
}
