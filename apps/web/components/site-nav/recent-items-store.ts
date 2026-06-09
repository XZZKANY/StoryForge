export type RecentItemType = 'conversation' | 'project' | 'artifact' | 'run';

export type RecentItem = {
  readonly id: string;
  readonly type: RecentItemType;
  readonly title: string;
  readonly href: string;
  readonly timestamp: number;
  readonly metadata?: {
    readonly status?: string;
    readonly icon?: string;
  };
};

const STORAGE_KEY = 'storyforge-recent-items';
const MAX_RECENT_ITEMS = 10;

export function mergeRecentItems(
  initialItems: readonly RecentItem[],
  storedItems: readonly RecentItem[],
): readonly RecentItem[] {
  const seen = new Set<string>();
  const merged: RecentItem[] = [];
  for (const item of [...initialItems, ...storedItems]) {
    const key = `${item.type}-${item.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return merged
    .toSorted((left, right) => right.timestamp - left.timestamp)
    .slice(0, MAX_RECENT_ITEMS);
}

export function readRecentItems(): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const items = JSON.parse(stored) as RecentItem[];
    return items.slice(0, MAX_RECENT_ITEMS);
  } catch {
    return [];
  }
}

export function addRecentItem(item: Omit<RecentItem, 'timestamp'>): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = readRecentItems();
    const deduplicated = existing.filter((i) => i.id !== item.id || i.type !== item.type);
    const updated: RecentItem[] = [{ ...item, timestamp: Date.now() }, ...deduplicated].slice(
      0,
      MAX_RECENT_ITEMS,
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('storyforge:recent-items-change'));
  } catch {
    /* localStorage unavailable */
  }
}

export function clearRecentItems(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event('storyforge:recent-items-change'));
  } catch {
    /* localStorage unavailable */
  }
}

export function subscribeRecentItems(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  window.addEventListener('storage', callback);
  window.addEventListener('storyforge:recent-items-change', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('storyforge:recent-items-change', callback);
  };
}
