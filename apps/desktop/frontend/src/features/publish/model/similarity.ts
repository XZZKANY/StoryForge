/** 简介过近检测：字符 bigram Jaccard（非洗稿，仅提示） */

function bigrams(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：""''（）【】\[\]().,!?;:'"`~]/g, '');
  const set = new Set<string>();
  if (normalized.length < 2) {
    if (normalized) set.add(normalized);
    return set;
  }
  for (let i = 0; i < normalized.length - 1; i += 1) {
    set.add(normalized.slice(i, i + 2));
  }
  return set;
}

export function jaccardSimilarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) {
    if (B.has(x)) inter += 1;
  }
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export type BlurbNearMatch = {
  otherProjectKey: string;
  otherTitle: string;
  score: number;
};

export function findNearBlurbs(
  blurb: string,
  others: { projectKey: string; title: string; blurb: string }[],
  threshold: number,
  excludeProjectKey?: string,
): BlurbNearMatch[] {
  const text = blurb.trim();
  if (text.length < 8) return [];
  const hits: BlurbNearMatch[] = [];
  for (const o of others) {
    if (excludeProjectKey && o.projectKey === excludeProjectKey) continue;
    if (!o.blurb?.trim()) continue;
    const score = jaccardSimilarity(text, o.blurb);
    if (score >= threshold) {
      hits.push({ otherProjectKey: o.projectKey, otherTitle: o.title, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}
