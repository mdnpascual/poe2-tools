import { getPriceCache, PriceEntry } from "./price-fetcher";

export interface MatchResult {
  y: number;
  height: number;
  name: string;
  quantity: number;
  price: PriceEntry | null;
  confidence: number;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ']/g, "").replace(/\s+/g, " ").trim();
}

export function matchPrices(rows: { y: number; height: number; text: string }[]): MatchResult[] {
  const cache = getPriceCache();
  if (cache.length === 0) return [];

  // Pre-normalize cache names
  const normalized = cache.map((p) => ({ entry: p, norm: normalize(p.name) }));

  return rows.map((row) => {
    // Extract quantity prefix (e.g. "3x Exalted Orb" → quantity=3, text="Exalted Orb")
    let quantity = 1;
    let text = row.text;
    const qtyMatch = text.match(/^(\d+)\s*x\s+/i);
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1], 10);
      text = text.slice(qtyMatch[0].length);
    }

    // Default Uncut gems without a level to assumed common level
    if (/uncut\b/i.test(text) && !/level/i.test(text)) {
      const level = /support/i.test(text) ? 5 : 17;
      text = text.replace(/\s*$/, ` (Level ${level})`);
    }

    const ocrNorm = normalize(text);
    let bestMatch: PriceEntry | null = null;
    let bestScore = 0;

    for (const { entry, norm } of normalized) {
      // Try substring match first (fast path)
      if (norm.includes(ocrNorm) || ocrNorm.includes(norm)) {
        const score = norm.length / Math.max(ocrNorm.length, norm.length);
        if (score > bestScore) {
          bestScore = Math.max(score, 0.85);
          bestMatch = entry;
        }
        continue;
      }

      // Levenshtein for short-ish strings
      const maxLen = Math.max(ocrNorm.length, norm.length);
      if (maxLen > 50) continue;
      const dist = levenshtein(ocrNorm, norm);
      const score = 1 - dist / maxLen;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = entry;
      }
    }

    return {
      y: row.y,
      height: row.height,
      name: row.text,
      quantity,
      price: bestScore >= 0.6 ? bestMatch : null,
      confidence: bestScore,
    };
  });
}
