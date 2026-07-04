/**
 * Restricts all outbound network traffic to whitelisted hostnames.
 * Must be imported early in the main process before any network activity.
 */
import http from "http";
import https from "https";

const ALLOWED_HOSTS = [
  "poe2scout.com",
  "cdn.jsdelivr.net",
  "www.pathofexile.com",
];

function isAllowed(hostname: string | undefined): boolean {
  if (!hostname) return false;
  // Always allow localhost (LM Studio, etc.)
  if (hostname === "127.0.0.1" || hostname === "localhost") return true;
  return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith("." + h));
}

// Patch https.request
const origHttpsRequest = https.request;
(https as any).request = function (opts: any, ...args: any[]) {
  const hostname = typeof opts === "string" ? new URL(opts).hostname : opts?.hostname || opts?.host;
  if (!isAllowed(hostname)) {
    console.warn(`[network] BLOCKED: ${hostname}`);
    const req = new http.ClientRequest({ hostname: "localhost", port: 1 });
    process.nextTick(() => req.emit("error", new Error(`Blocked request to ${hostname}`)));
    return req;
  }
  return (origHttpsRequest as any).apply(https, [opts, ...args]);
};

// Patch https.get
const origHttpsGet = https.get;
(https as any).get = function (opts: any, ...args: any[]) {
  const hostname = typeof opts === "string" ? new URL(opts).hostname : opts?.hostname || opts?.host;
  if (!isAllowed(hostname)) {
    console.warn(`[network] BLOCKED: ${hostname}`);
    const req = new http.ClientRequest({ hostname: "localhost", port: 1 });
    process.nextTick(() => req.emit("error", new Error(`Blocked request to ${hostname}`)));
    return req;
  }
  return (origHttpsGet as any).apply(https, [opts, ...args]);
};

// Patch http.request
const origHttpRequest = http.request;
(http as any).request = function (opts: any, ...args: any[]) {
  const hostname = typeof opts === "string" ? new URL(opts).hostname : opts?.hostname || opts?.host;
  if (!isAllowed(hostname)) {
    console.warn(`[network] BLOCKED: ${hostname}`);
    const req = new http.ClientRequest({ hostname: "localhost", port: 1 });
    process.nextTick(() => req.emit("error", new Error(`Blocked request to ${hostname}`)));
    return req;
  }
  return (origHttpRequest as any).apply(http, [opts, ...args]);
};

// Patch http.get
const origHttpGet = http.get;
(http as any).get = function (opts: any, ...args: any[]) {
  const hostname = typeof opts === "string" ? new URL(opts).hostname : opts?.hostname || opts?.host;
  if (!isAllowed(hostname)) {
    console.warn(`[network] BLOCKED: ${hostname}`);
    const req = new http.ClientRequest({ hostname: "localhost", port: 1 });
    process.nextTick(() => req.emit("error", new Error(`Blocked request to ${hostname}`)));
    return req;
  }
  return (origHttpGet as any).apply(http, [opts, ...args]);
};

console.log("[network] Traffic restricted to:", ALLOWED_HOSTS.join(", "));
