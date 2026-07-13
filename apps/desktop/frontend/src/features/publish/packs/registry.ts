import type { PublishSettings } from '../model/types';
import { fanqiePack } from './fanqie';
import { qidianPack } from './qidian';
import type { PlatformPack } from './types';

const PACKS: PlatformPack[] = [fanqiePack, qidianPack];

const BY_ID = new Map(PACKS.map((p) => [p.id, p]));

export function listPlatformPacks(): PlatformPack[] {
  return [...PACKS];
}

export function listReadyPlatformPacks(): PlatformPack[] {
  return PACKS.filter((p) => p.ready);
}

export function getPlatformPack(id: string | undefined | null): PlatformPack | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

/** 未知 id 或骨架 pack 作默认平台时回退 fanqie（保证车队可跑） */
export function resolvePlatformPack(
  platformId?: string | null,
  options?: { allowSkeleton?: boolean },
): PlatformPack {
  const found = getPlatformPack(platformId);
  if (found && (found.ready || options?.allowSkeleton)) return found;
  if (found && !found.ready) return fanqiePack;
  return fanqiePack;
}

export function resolvePackFromSettings(settings: Pick<PublishSettings, 'defaultPlatform'>): PlatformPack {
  return resolvePlatformPack(settings.defaultPlatform);
}

export function applyPackSettingsDefaults(
  base: PublishSettings,
  pack: PlatformPack,
): PublishSettings {
  return {
    ...base,
    ...pack.settingsDefaults,
    defaultPlatform: pack.id,
    defaultMonthlyOpenLimit:
      pack.settingsDefaults.defaultMonthlyOpenLimit ??
      pack.defaultMonthlyOpenLimit ??
      base.defaultMonthlyOpenLimit,
  };
}

export type { PlatformPack };
