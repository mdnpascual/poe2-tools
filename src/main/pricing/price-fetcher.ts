import https from "https";

export interface PriceEntry {
  name: string;
  chaosValue: number;
  divineValue: number;
}

const BASE_URL = "https://poe2scout.com/api/poe2";
const LEAGUE = "Runes of Aldur";
let priceCache: PriceEntry[] = [];
let refreshTimer: ReturnType<typeof setInterval> | null = null;

export function getPriceCache(): PriceEntry[] {
  return priceCache;
}

function httpGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "PoE2-Tools/0.1.0" } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

async function fetchItems(): Promise<PriceEntry[]> {
  // Get league info for divine price (in exalts)
  const leagueJson = await httpGet(`${BASE_URL}/Leagues`);
  const leagueList: { Value: string; DivinePrice: number; IsCurrent: boolean }[] = Array.isArray(leagueJson) ? leagueJson : leagueJson.value || leagueJson;
  const league = leagueList.find((l) => l.IsCurrent) || leagueList.find((l) => l.Value === LEAGUE);
  const divineInExalts = league?.DivinePrice || 400;

  // Get all items (prices in exalts)
  const url = `${BASE_URL}/Leagues/${encodeURIComponent(league?.Value || LEAGUE)}/Items`;
  const itemsJson = await httpGet(url);
  const itemList: { Text: string; CurrentPrice: number }[] = Array.isArray(itemsJson) ? itemsJson : itemsJson.value || itemsJson;

  return itemList
    .filter((i) => i.CurrentPrice > 0)
    .map((i) => ({
      name: i.Text,
      chaosValue: i.CurrentPrice,
      divineValue: i.CurrentPrice / divineInExalts,
    }));
}

export async function startPriceFetcher(): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");
  const { app } = await import("electron");
  const cachePath = path.default.join(app.getPath("userData"), "price-cache.json");

  // Use cached file if less than 1 hour old
  try {
    const stat = fs.default.statSync(cachePath);
    if (Date.now() - stat.mtimeMs < 60 * 60 * 1000) {
      priceCache = JSON.parse(fs.default.readFileSync(cachePath, "utf-8"));
      console.log(`[price-fetcher] Loaded ${priceCache.length} prices from cache (${Math.round((Date.now() - stat.mtimeMs) / 60000)}min old)`);
      refreshTimer = setInterval(async () => {
        try {
          priceCache = await fetchItems();
          fs.default.writeFileSync(cachePath, JSON.stringify(priceCache, null, 2));
        } catch (e) {
          console.error("[price-fetcher] Refresh failed:", e);
        }
      }, 60 * 60 * 1000);
      return;
    }
  } catch {}

  try {
    priceCache = await fetchItems();
    console.log(`[price-fetcher] Cached ${priceCache.length} item prices`);
    fs.default.writeFileSync(cachePath, JSON.stringify(priceCache, null, 2));
    console.log(`[price-fetcher] Saved to ${cachePath}`);
  } catch (e) {
    console.error("[price-fetcher] Initial fetch failed:", e);
  }
  refreshTimer = setInterval(async () => {
    try {
      priceCache = await fetchItems();
      fs.default.writeFileSync(cachePath, JSON.stringify(priceCache, null, 2));
    } catch (e) {
      console.error("[price-fetcher] Refresh failed:", e);
    }
  }, 60 * 60 * 1000);
}

export function stopPriceFetcher(): void {
  if (refreshTimer) clearInterval(refreshTimer);
}
