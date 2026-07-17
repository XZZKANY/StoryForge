/**
 * 轻量更新检查：对比运行中版本与 GitHub 仓库最新 v* tag（仓库公开、无需鉴权）。
 * 不做静默下载/替换——发行流程仍是本机重建 NSIS 手动安装，这里只负责「知道有新版」。
 * 用户网络对 GitHub 依赖代理，失败必须静默降级（启动自检）或明确报错（手动检查）。
 */

export type UpdateCheckResult =
  | { kind: 'up-to-date'; current: string }
  | { kind: 'update-available'; current: string; latest: string }
  | { kind: 'error'; message: string };

const TAGS_URL = 'https://api.github.com/repos/XZZKANY/StoryForge/tags?per_page=20';

export function parseVersionTag(tag: string): [number, number, number] | null {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export async function checkForUpdate(
  currentVersion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateCheckResult> {
  const current = parseVersionTag(
    currentVersion.startsWith('v') ? currentVersion : `v${currentVersion}`,
  );
  if (!current) return { kind: 'error', message: `无法解析当前版本：${currentVersion}` };

  let tags: Array<{ name?: unknown }>;
  try {
    const response = await fetchImpl(TAGS_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      return { kind: 'error', message: `GitHub 返回 ${response.status}` };
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return { kind: 'error', message: 'tag 列表响应格式异常' };
    tags = body as Array<{ name?: unknown }>;
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  let latest: [number, number, number] | null = null;
  let latestName = '';
  for (const tag of tags) {
    if (typeof tag.name !== 'string') continue;
    const parsed = parseVersionTag(tag.name);
    if (!parsed) continue;
    if (!latest || compareVersions(parsed, latest) > 0) {
      latest = parsed;
      latestName = tag.name;
    }
  }
  if (!latest) return { kind: 'error', message: '仓库没有可解析的版本 tag' };

  const currentLabel = `v${current.join('.')}`;
  if (compareVersions(latest, current) > 0) {
    return { kind: 'update-available', current: currentLabel, latest: latestName };
  }
  return { kind: 'up-to-date', current: currentLabel };
}

/** 运行中应用版本：Tauri 运行时读 tauri.conf 版本；非桌面运行时返回 null。 */
export async function currentAppVersion(): Promise<string | null> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return null;
  }
}
