#!/usr/bin/env node
// Static host for the Expense Desk dashboard (web/dist).
//
// - SPA fallback: extensionless paths get index.html; missing files with an
//   extension get a real 404 (so a stale chunk never comes back as HTML).
// - Cache headers: Vite's hashed /assets/* are immutable; index.html revalidates.
// - Serves the .br / .gz files written by precompress.mjs when the client accepts them.
// - GET /healthz for the platform health check (never behind basic auth).
// - Optional basic auth: set BASIC_AUTH_USER and BASIC_AUTH_PASSWORD.
// - Optional same-origin proxy to the agent runtime: set AGENT_UPSTREAM_URL and
//   build the web app with VITE_COPILOTKIT_RUNTIME_URL=/copilotkit. Then the
//   browser never calls the agent cross-origin (no CORS) and basic auth covers it.
//
// No dependencies: the container and a laptop run this same file.
// Local: STATIC_DIR=web/dist PORT=4630 node deploy/web/server.mjs

import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;
const PORT = Number(env.PORT || 8080);
const ROOT = path.resolve(env.STATIC_DIR || fileURLToPath(new URL("./dist", import.meta.url)));
const AUTH_USER = env.BASIC_AUTH_USER || "";
const AUTH_PASSWORD = env.BASIC_AUTH_PASSWORD || "";
const AUTH_REALM = "Contoso Expense Desk";
const UPSTREAM = env.AGENT_UPSTREAM_URL ? new URL(env.AGENT_UPSTREAM_URL) : null;
const PROXY_PATH = (env.RUNTIME_PROXY_PATH || "/copilotkit").replace(/\/+$/, "");

if (Boolean(AUTH_USER) !== Boolean(AUTH_PASSWORD)) {
  console.error("Set both BASIC_AUTH_USER and BASIC_AUTH_PASSWORD, or neither. Refusing to start half-configured.");
  process.exit(1);
}
try {
  if (!(await stat(path.join(ROOT, "index.html"))).isFile()) throw new Error("not a file");
} catch {
  console.error(`No index.html in ${ROOT}. Build the dashboard first (npm --prefix web run build) or set STATIC_DIR.`);
  process.exit(1);
}

// ---------------------------------------------------------------- basic auth

const digest = (s) => createHash("sha256").update(s).digest();
const expectedAuth = AUTH_USER ? digest(`${AUTH_USER}:${AUTH_PASSWORD}`) : null;

function isAuthorized(req) {
  if (!expectedAuth) return true;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(req.headers.authorization || "");
  if (!m) return false;
  // Compare fixed-length digests so the check takes the same time for any input.
  return timingSafeEqual(digest(Buffer.from(m[1], "base64").toString("utf8")), expectedAuth);
}

// With basic auth on, responses must not land in a shared cache (a CDN could
// otherwise hand them to someone without the password).
const CACHE_SCOPE = expectedAuth ? "private" : "public";
const CACHE = {
  immutable: `${CACHE_SCOPE}, max-age=31536000, immutable`,
  revalidate: "no-cache",
  short: `${CACHE_SCOPE}, max-age=3600`,
};

// ------------------------------------------------------------------- static

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

// dist/ never changes while the process runs, so stat results can be memoised.
const statCache = new Map();
async function fileInfo(abs) {
  if (!statCache.has(abs)) {
    statCache.set(
      abs,
      stat(abs).then(
        (s) => (s.isFile() ? s : null),
        () => null,
      ),
    );
  }
  return statCache.get(abs);
}

/** Map a URL path to a file inside ROOT, or null. Never escapes ROOT. */
async function resolveFile(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (rel.includes("\0")) return null;
  const abs = path.join(ROOT, path.normalize(rel));
  if (!abs.startsWith(ROOT + path.sep)) return null;
  const s = await fileInfo(abs);
  return s ? { abs, stat: s } : null;
}

async function sendFile(req, res, file, cacheControl) {
  const ext = path.extname(file.abs).toLowerCase();
  const etag = `W/"${file.stat.size.toString(16)}-${Math.floor(file.stat.mtimeMs).toString(16)}"`;
  const headers = {
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "Cache-Control": cacheControl,
    ETag: etag,
  };

  const accept = String(req.headers["accept-encoding"] || "");
  let body = file.abs;
  let size = file.stat.size;
  const br = await fileInfo(`${file.abs}.br`);
  const gz = await fileInfo(`${file.abs}.gz`);
  if (br || gz) headers.Vary = "Accept-Encoding";
  if (br && /\bbr\b/.test(accept)) {
    body = `${file.abs}.br`;
    size = br.size;
    headers["Content-Encoding"] = "br";
  } else if (gz && /\bgzip\b/.test(accept)) {
    body = `${file.abs}.gz`;
    size = gz.size;
    headers["Content-Encoding"] = "gzip";
  }

  const inm = req.headers["if-none-match"];
  if (inm && inm.split(",").some((t) => t.trim() === etag)) {
    delete headers["Content-Type"];
    delete headers["Content-Encoding"];
    res.writeHead(304, headers);
    return res.end();
  }

  headers["Content-Length"] = size;
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  createReadStream(body)
    .on("error", (err) => {
      console.error(`read failed ${body}: ${err.message}`);
      res.destroy(err);
    })
    .pipe(res);
}

function sendText(res, status, text, extra = {}) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra });
  res.end(text);
}

// -------------------------------------------------------------------- proxy

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function proxyToAgent(req, res, url) {
  const base = UPSTREAM.pathname.replace(/\/+$/, "");
  const target = new URL(`${base}${url.pathname}${url.search}`, UPSTREAM);

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k)) headers[k] = v;
  // The basic-auth header is for this site, not for the agent.
  if (expectedAuth) delete headers.authorization;
  headers["x-forwarded-for"] = [req.headers["x-forwarded-for"], req.socket.remoteAddress].filter(Boolean).join(", ");
  headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || "http";
  headers["x-forwarded-host"] = req.headers["x-forwarded-host"] || req.headers.host || "";

  const started = Date.now();
  const transport = target.protocol === "https:" ? https : http;
  const upstream = transport.request(target, { method: req.method, headers }, (up) => {
    const out = {};
    for (const [k, v] of Object.entries(up.headers)) if (!HOP_BY_HOP.has(k)) out[k] = v;
    // Agent runs stream (SSE). Make sure nothing downstream buffers them.
    out["x-accel-buffering"] = "no";
    res.writeHead(up.statusCode || 502, out);
    res.flushHeaders();
    up.pipe(res);
    up.on("end", () => console.log(`proxy ${req.method} ${url.pathname} ${up.statusCode} ${Date.now() - started}ms`));
  });
  upstream.on("error", (err) => {
    console.error(`proxy ${req.method} ${url.pathname} failed: ${err.message}`);
    if (!res.headersSent) sendText(res, 502, "Agent runtime unreachable.\n");
    else res.destroy(err);
  });
  // A tester closing the tab stops the run upstream instead of burning tokens.
  res.on("close", () => {
    if (res.writableFinished) return;
    upstream.destroy();
    console.log(`proxy ${req.method} ${url.pathname} closed by client after ${Date.now() - started}ms`);
  });
  req.pipe(upstream);
}

// ------------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // A demo link is not meant to be indexed.
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  let url;
  try {
    url = new URL(req.url || "/", "http://localhost");
  } catch {
    return sendText(res, 400, "Bad request.\n");
  }

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(req.method === "HEAD" ? undefined : '{"ok":true}');
  }

  if (!isAuthorized(req)) {
    return sendText(res, 401, "Authentication required.\n", {
      "WWW-Authenticate": `Basic realm="${AUTH_REALM}", charset="UTF-8"`,
    });
  }

  if (UPSTREAM && (url.pathname === PROXY_PATH || url.pathname.startsWith(`${PROXY_PATH}/`))) {
    return proxyToAgent(req, res, url);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendText(res, 405, "Method not allowed.\n", { Allow: "GET, HEAD" });
  }

  try {
    const file = await resolveFile(url.pathname);
    if (file) {
      const cache = url.pathname.startsWith("/assets/")
        ? CACHE.immutable
        : url.pathname === "/index.html"
          ? CACHE.revalidate
          : CACHE.short;
      return await sendFile(req, res, file, cache);
    }
    if (path.extname(url.pathname) === "") {
      const index = await resolveFile("/index.html");
      return await sendFile(req, res, index, CACHE.revalidate);
    }
    return sendText(res, 404, "Not found.\n");
  } catch (err) {
    console.error(`GET ${url.pathname} failed: ${err.stack || err}`);
    if (!res.headersSent) sendText(res, 500, "Internal error.\n");
    else res.destroy();
  }
});

// Longer than the platform proxy's idle timeout, so it never reuses a socket we just closed.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

server.listen(PORT, () => {
  const proxy = UPSTREAM ? `${PROXY_PATH} -> ${UPSTREAM.origin}${UPSTREAM.pathname.replace(/\/+$/, "")}${PROXY_PATH}` : "off";
  console.log(`expense-desk web on :${PORT} | static ${ROOT} | basic auth ${expectedAuth ? "on" : "off"} | agent proxy ${proxy}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    // Open SSE streams would hold close() forever.
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
