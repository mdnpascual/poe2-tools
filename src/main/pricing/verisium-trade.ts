/**
 * Verisium Trade API Price Fetcher
 *
 * Queries the official PoE2 trade API for prices of Verisium skill and support gems.
 * Uses POESESSID for authentication, respects rate limits, and caches prices for 24 hours.
 */
import https from "https";
import fs from "fs";
import path from "path";
import { app } from "electron";
import { getPriceCache } from "./price-fetcher";

// --- Gem Lists ---

export const VERISIUM_SKILLS: string[] = [
  "Rain of Blades",
  "Wardbound Minions",
  "Voltaic Barrier",
  "Hollow Shell",
  "Explosive Transmutation",
  "Animus Splinters",
  "Skyfall",
  "Triskelion Cascade",
  "Refutation",
  "Runic Reprieve",
  "Leylines",
  "Animus Exchange",
  "Verisium Manifestations",
  "Powered by Verisium",
  "Remnants of Kalguur",
  "Grim Pillars",
  "Bitter Dead",
  "Conductive Runes",
  "Repulsion",
  "Frostflame Nova",
  "Fragments Of The Past",
  "Eternal March",
  "Detonate Living",
];

export const VERISIUM_SUPPORTS: string[] = [
  "Concussive Runes",
  "Runic Infusion",
  "Runeforged Blades",
  "Runic Extraction",
  "Scouring Flame",
  "Fist Of Kalguur",
  "Healing Runes",
];

const LEAGUE = "Runes of Aldur";
const API_BASE = "https://www.pathofexile.com";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const STATIC_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30_000;

// --- Currency Mapping (fetched from trade API /data/static) ---

interface StaticCacheFile {
  timestamp: number;
  currencyMap: Record<string, string>; // trade API id -> item name (e.g. "chaos" -> "Chaos Orb")
}

let currencyMap: Record<string, string> = {};

function getStaticCachePath(): string {
  return path.join(app.getPath("userData"), "trade-static-cache.json");
}

/**
 * Load the trade API currency ID -> item name mapping.
 * Fetches from /api/trade2/data/static and caches for 1 week.
 */
export async function loadCurrencyMap(): Promise<void> {
  const cachePath = getStaticCachePath();

  // Try loading from cache
  try {
    if (fs.existsSync(cachePath)) {
      const data: StaticCacheFile = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      if (Date.now() - data.timestamp < STATIC_CACHE_TTL_MS && Object.keys(data.currencyMap).length > 0) {
        currencyMap = data.currencyMap;
        console.log(`[verisium-trade] Loaded ${Object.keys(currencyMap).length} currency mappings from cache`);
        return;
      }
    }
  } catch (e) {
    console.warn("[verisium-trade] Static cache read failed:", e);
  }

  // Fetch fresh from trade API
  try {
    const res = await httpsRequest("GET", `${API_BASE}/api/trade2/data/static`, {
      "User-Agent": "PoE2-Tools/0.1.0",
    });

    if (res.statusCode !== 200) {
      console.warn(`[verisium-trade] Static data fetch failed: HTTP ${res.statusCode}`);
      return;
    }

    const json = JSON.parse(res.body);
    const currencyGroup = json.result?.find((g: any) => g.id === "Currency");
    if (!currencyGroup?.entries) {
      console.warn("[verisium-trade] No Currency group in static data");
      return;
    }

    const map: Record<string, string> = {};
    for (const entry of currencyGroup.entries) {
      if (entry.id && entry.text) {
        map[entry.id] = entry.text;
      }
    }

    currencyMap = map;
    console.log(`[verisium-trade] Loaded ${Object.keys(map).length} currency mappings from API`);

    // Save to cache
    const cacheData: StaticCacheFile = { timestamp: Date.now(), currencyMap: map };
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
  } catch (e) {
    console.error("[verisium-trade] Failed to fetch static data:", e);
  }
}

/**
 * Convert a trade API price (amount + currency ID) to exalt value
 * using the poe2scout price cache. Returns the amount directly if currency is exalted
 * or if the currency can't be found in the cache.
 */
export function toExaltValue(amount: number, currency: string): number {
  if (currency === "exalted") return amount;

  const cacheName = currencyMap[currency];
  if (!cacheName) return amount; // unknown currency, return raw

  const cache = getPriceCache();
  const entry = cache.find((p) => p.name === cacheName);
  if (!entry || entry.chaosValue <= 0) return amount;

  // chaosValue in the price cache is actually the exalt value of 1 unit
  return amount * entry.chaosValue;
}

// --- Types ---

export interface VerisiumPrice {
  amount: number;
  currency: string;
}

export interface VerisiumStatus {
  state: "idle" | "fetching" | "done" | "error";
  progress?: string;
  valid?: boolean;
}

interface CacheFile {
  timestamp: number;
  sessionId: string;
  prices: Record<string, VerisiumPrice | null>;
}

// --- Rate Limiter ---

class RateLimiter {
  private nextReady = 0;
  private responseTimes: number[] = [];

  async waitBeforeRequest(): Promise<void> {
    const delay = this.nextReady - Date.now();
    // Mark as in-flight to prevent overlapping requests on the same limiter
    this.nextReady = Infinity;
    if (delay > 0) {
      console.log(`[verisium-trade] Rate limit wait: ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
  }

  handleResponse(headers: Record<string, string>): void {
    const now = Date.now();
    this.responseTimes.push(now);
    this.responseTimes = this.responseTimes.filter((t) => now - t <= 300_000);

    const rules = [
      ...(headers["x-rate-limit-account"] || "").split(","),
      ...(headers["x-rate-limit-ip"] || "").split(","),
    ].filter(Boolean);
    const states = [
      ...(headers["x-rate-limit-account-state"] || "").split(","),
      ...(headers["x-rate-limit-ip-state"] || "").split(","),
    ].filter(Boolean);

    if (rules.length === 0) {
      this.nextReady = Date.now() + 1000;
      return;
    }

    const delays = rules.map((rule, i) => this.calculateDelay(rule, states[i] || "0:0:0"));
    const maxDelay = Math.max(...delays, 500);
    this.nextReady = Date.now() + maxDelay;
  }

  private calculateDelay(ruleStr: string, stateStr: string): number {
    const rule = ruleStr.split(":");
    const state = stateStr.split(":");
    const now = Date.now();
    const maxHits = Number(rule[0]);
    const period = Number(rule[1]) * 1000;
    const hits = Number(state[0]);
    const timeout = Number(state[2]) * 1000;
    const periodResponses = this.responseTimes.filter((t) => now - t < period);

    if (timeout > 0) return timeout + 5000;

    // Backfill responseTimes if the API reports more hits than we've tracked
    // (e.g. other requests from the same account counted against us)
    if (periodResponses.length < hits) {
      this.responseTimes.push(...Array(hits - periodResponses.length).fill(now));
    }

    const remaining = maxHits - hits;
    if (remaining > 1) return 500;

    return period - (periodResponses[0] ? now - periodResponses[0] : 0) + 1000;
  }
}

// --- Module State ---

let priceCache: Record<string, VerisiumPrice | null> = {};
let currentStatus: VerisiumStatus = { state: "idle", valid: undefined };
let statusCallback: ((status: VerisiumStatus) => void) | null = null;
let isFetching = false;

// --- Public API ---

export function getVerisiumPrices(): Record<string, VerisiumPrice | null> {
  return { ...priceCache };
}

export function getVerisiumStatus(): VerisiumStatus {
  return { ...currentStatus };
}

export function onVerisiumStatusChange(cb: (status: VerisiumStatus) => void): void {
  statusCallback = cb;
}

/**
 * Clear all verisium-related cached data (prices + static currency mapping).
 */
export function clearVerisiumCaches(): void {
  const pricePath = getCachePath();
  const staticPath = getStaticCachePath();
  try { if (fs.existsSync(pricePath)) fs.unlinkSync(pricePath); } catch {}
  try { if (fs.existsSync(staticPath)) fs.unlinkSync(staticPath); } catch {}
  priceCache = {};
  currencyMap = {};
  setStatus({ state: "idle", valid: undefined });
  console.log("[verisium-trade] All caches cleared");
}

/**
 * Look up a verisium gem price by name.
 * Returns the price if available, undefined if the gem is unknown, or null if fetch pending/failed.
 */
export function lookupVerisiumPrice(gemName: string): VerisiumPrice | null | undefined {
  if (gemName in priceCache) return priceCache[gemName];
  // Check if it's a known gem that just hasn't been fetched yet
  const allGems = [...VERISIUM_SKILLS, ...VERISIUM_SUPPORTS];
  if (allGems.some((g) => g.toLowerCase() === gemName.toLowerCase())) return null;
  return undefined;
}

/**
 * Start the verisium price fetcher. Call on app startup.
 * If cache is fresh (<24h) and session matches, loads from cache.
 * Otherwise validates session and fetches all prices.
 */
export async function startVerisiumFetcher(sessionId: string): Promise<void> {
  if (!sessionId) {
    setStatus({ state: "idle", valid: undefined });
    return;
  }
  if (isFetching) return;

  const cachePath = getCachePath();

  // Try loading from cache
  try {
    if (fs.existsSync(cachePath)) {
      const data: CacheFile = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      if (
        data.sessionId === sessionId &&
        Date.now() - data.timestamp < CACHE_TTL_MS &&
        data.prices &&
        Object.keys(data.prices).length > 0
      ) {
        priceCache = data.prices;
        const count = Object.values(priceCache).filter((p) => p !== null).length;
        console.log(`[verisium-trade] Loaded ${count} prices from cache (${Math.round((Date.now() - data.timestamp) / 3600000)}h old)`);
        setStatus({ state: "done", progress: `Prices loaded (${count}/${VERISIUM_SKILLS.length + VERISIUM_SUPPORTS.length})`, valid: true });
        return;
      }
    }
  } catch (e) {
    console.warn("[verisium-trade] Cache read failed:", e);
  }

  // Fetch fresh prices
  await fetchAllPrices(sessionId);
}

/**
 * Called when the user changes their POESESSID in settings.
 * Validates and re-fetches if different from cached session.
 */
export async function updateSessionId(sessionId: string): Promise<void> {
  if (!sessionId) {
    setStatus({ state: "idle", valid: undefined });
    priceCache = {};
    return;
  }
  if (isFetching) return;
  await fetchAllPrices(sessionId);
}

// --- Internal ---

function getCachePath(): string {
  return path.join(app.getPath("userData"), "verisium-price-cache.json");
}

function setStatus(status: VerisiumStatus): void {
  currentStatus = status;
  statusCallback?.(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders(sessionId: string): Record<string, string> {
  return {
    "User-Agent": "PoE2-Tools/0.1.0",
    Cookie: `POESESSID=${sessionId}`,
    "Content-Type": "application/json",
    "x-requested-with": "XMLHttpRequest",
  };
}

function buildSearchBody(gemName: string, isSkill: boolean): string {
  const query: any = {
    query: {
      status: { option: "securable" },
      type: gemName,
      stats: [{ type: "and", filters: [] }],
    },
    sort: { price: "asc" },
  };

  if (isSkill) {
    query.query.filters = {
      misc_filters: {
        filters: {
          corrupted: { option: "false" },
          gem_level: { min: 20 },
        },
      },
    };
  }

  return JSON.stringify(query);
}

function httpsRequest(
  method: string,
  urlStr: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const opts: https.RequestOptions = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers,
    };

    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const responseHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(res.headers)) {
          if (typeof val === "string") responseHeaders[key] = val;
          else if (Array.isArray(val)) responseHeaders[key] = val.join(",");
        }
        resolve({ statusCode: res.statusCode || 0, headers: responseHeaders, body: data });
      });
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function searchGem(
  sessionId: string,
  gemName: string,
  isSkill: boolean,
  searchRateLimiter: RateLimiter,
  fetchRateLimiter: RateLimiter
): Promise<VerisiumPrice | null> {
  const headers = buildHeaders(sessionId);
  const body = buildSearchBody(gemName, isSkill);
  const searchUrl = `${API_BASE}/api/trade2/search/poe2/${encodeURIComponent(LEAGUE)}`;

  // Wait for search rate limit
  await searchRateLimiter.waitBeforeRequest();

  // Search request
  const searchRes = await httpsRequest("POST", searchUrl, headers, body);
  searchRateLimiter.handleResponse(searchRes.headers);

  if (searchRes.statusCode === 403) {
    throw new Error("INVALID_SESSION");
  }

  if (searchRes.statusCode !== 200) {
    console.warn(`[verisium-trade] Search failed for "${gemName}": HTTP ${searchRes.statusCode}`);
    return null;
  }

  let searchJson: any;
  try {
    searchJson = JSON.parse(searchRes.body);
  } catch {
    console.warn(`[verisium-trade] Invalid JSON response for "${gemName}"`);
    return null;
  }

  if (searchJson.error) {
    if (searchJson.error.code === 2) throw new Error("INVALID_SESSION");
    console.warn(`[verisium-trade] API error for "${gemName}":`, searchJson.error);
    return null;
  }

  if (!searchJson.result || searchJson.result.length === 0) {
    console.log(`[verisium-trade] No results for "${gemName}"`);
    return null;
  }

  // Fetch the first item to get its price
  const firstItemId = searchJson.result[0];
  const searchId = searchJson.id;
  const fetchUrl = `${API_BASE}/api/trade2/fetch/${firstItemId}?query=${searchId}&realm=poe2`;

  await fetchRateLimiter.waitBeforeRequest();

  const fetchRes = await httpsRequest("GET", fetchUrl, headers);
  fetchRateLimiter.handleResponse(fetchRes.headers);

  if (fetchRes.statusCode === 403) {
    throw new Error("INVALID_SESSION");
  }

  if (fetchRes.statusCode !== 200) {
    console.warn(`[verisium-trade] Fetch failed for "${gemName}": HTTP ${fetchRes.statusCode}`);
    return null;
  }

  let fetchJson: any;
  try {
    fetchJson = JSON.parse(fetchRes.body);
  } catch {
    return null;
  }

  if (fetchJson.error) {
    if (fetchJson.error.code === 2) throw new Error("INVALID_SESSION");
    return null;
  }

  const listing = fetchJson.result?.[0]?.listing?.price;
  if (!listing) return null;

  return {
    amount: listing.amount,
    currency: listing.currency,
  };
}

async function fetchAllPrices(sessionId: string): Promise<void> {
  isFetching = true;
  const searchRateLimiter = new RateLimiter();
  const fetchRateLimiter = new RateLimiter();
  const allGems = [
    ...VERISIUM_SKILLS.map((name) => ({ name, isSkill: true })),
    ...VERISIUM_SUPPORTS.map((name) => ({ name, isSkill: false })),
  ];
  const total = allGems.length;
  let completed = 0;

  setStatus({ state: "fetching", progress: `0/${total}`, valid: true });
  console.log(`[verisium-trade] Starting price fetch for ${total} gems...`);

  for (const gem of allGems) {
    let retries = 0;
    let price: VerisiumPrice | null = null;

    while (retries < MAX_RETRIES) {
      try {
        price = await searchGem(sessionId, gem.name, gem.isSkill, searchRateLimiter, fetchRateLimiter);
        break;
      } catch (e: any) {
        if (e.message === "INVALID_SESSION") {
          console.error("[verisium-trade] Session invalid/expired");
          setStatus({ state: "error", progress: "Session expired or invalid", valid: false });
          isFetching = false;
          return;
        }
        retries++;
        if (retries < MAX_RETRIES) {
          console.warn(`[verisium-trade] Retry ${retries}/${MAX_RETRIES} for "${gem.name}" in ${RETRY_DELAY_MS / 1000}s`);
          await sleep(RETRY_DELAY_MS);
        }
      }
    }

    priceCache[gem.name] = price;
    completed++;
    setStatus({ state: "fetching", progress: `${completed}/${total}`, valid: true });

    if (price) {
      console.log(`[verisium-trade] ${gem.name}: ${price.amount} ${price.currency}`);
    } else {
      console.log(`[verisium-trade] ${gem.name}: no price`);
    }
  }

  // Save to cache
  const cacheData: CacheFile = {
    timestamp: Date.now(),
    sessionId,
    prices: priceCache,
  };

  try {
    fs.writeFileSync(getCachePath(), JSON.stringify(cacheData, null, 2));
    console.log(`[verisium-trade] Cache saved to ${getCachePath()}`);
  } catch (e) {
    console.error("[verisium-trade] Failed to save cache:", e);
  }

  const priceCount = Object.values(priceCache).filter((p) => p !== null).length;
  setStatus({ state: "done", progress: `Prices loaded (${priceCount}/${total})`, valid: true });
  isFetching = false;
  console.log(`[verisium-trade] Done. ${priceCount}/${total} prices fetched.`);
}
