const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns").promises;
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

// Only these hosts are contacted by the resolver. Add a provider's exact
// hostname here after verifying that it is a legitimate short-link service.
const SHORTENER_HOSTS = new Set(
  (process.env.SHORTENER_HOSTS || "sfl.gl,www.sfl.gl")
    .split(",").map(x => x.trim().toLowerCase()).filter(Boolean)
);

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const requests = new Map();

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const p = address.split(".").map(Number);
    return p[0] === 10 ||
      p[0] === 127 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      p[0] === 0 ||
      p[0] >= 224;
  }
  if (family === 6) {
    const a = address.toLowerCase();
    return a === "::1" || a === "::" ||
      a.startsWith("fc") || a.startsWith("fd") ||
      a.startsWith("fe80:") || a.startsWith("::ffff:127.");
  }
  return true;
}

async function assertPublicHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || net.isIP(host)) {
    throw new Error("Host tujuan tidak diizinkan.");
  }
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some(r => isBlockedAddress(r.address))) {
    throw new Error("Host tujuan mengarah ke jaringan privat atau tidak valid.");
  }
}

function parseHttpUrl(raw) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Hanya URL HTTP/HTTPS yang didukung.");
  }
  if (url.username || url.password) {
    throw new Error("URL dengan username/password tidak diizinkan.");
  }
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new Error("Port khusus tidak diizinkan.");
  }
  return url;
}

function requestWithoutFollowingRedirect(url) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, {
      method: "GET",
      headers: {
        "User-Agent": "BypassLinkResolver/1.0",
        "Accept": "text/html,*/*;q=0.8"
      },
      timeout: 8000
    }, res => {
      // Do not download the page body; only inspect its HTTP redirect header.
      res.destroy();
      resolve({
        status: res.statusCode || 0,
        location: res.headers.location || null
      });
    });
    req.on("timeout", () => req.destroy(new Error("Waktu koneksi habis.")));
    req.on("error", reject);
    req.end();
  });
}

async function resolveRedirect(input) {
  let current = parseHttpUrl(input);
  const visited = new Set();

  for (let hop = 0; hop < 6; hop++) {
    const host = current.hostname.toLowerCase();
    if (!SHORTENER_HOSTS.has(host)) {
      throw new Error("Domain ini belum ada dalam daftar shortener yang didukung.");
    }
    await assertPublicHostname(host);

    const key = current.href;
    if (visited.has(key)) throw new Error("Redirect loop terdeteksi.");
    visited.add(key);

    const response = await requestWithoutFollowingRedirect(current);
    if (response.status < 300 || response.status >= 400 || !response.location) {
      throw new Error(
        "Server tidak memberikan redirect HTTP. Link mungkin memakai JavaScript, CAPTCHA, atau verifikasi lain."
      );
    }

    const next = parseHttpUrl(new URL(response.location, current).href);
    await assertPublicHostname(next.hostname);

    // Only contact another explicitly allowlisted shortener. For any other
    // public host, return the destination without requesting that site.
    if (!SHORTENER_HOSTS.has(next.hostname.toLowerCase())) {
      return next.href;
    }
    current = next;
  }
  throw new Error("Terlalu banyak redirect.");
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(data));
}

function rateLimited(req) {
  const ip = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = requests.get(ip) || { start: now, count: 0 };
  if (now - entry.start > RATE_WINDOW_MS) {
    entry.start = now;
    entry.count = 0;
  }
  entry.count++;
  requests.set(ip, entry);
  return entry.count > RATE_LIMIT;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/resolve") {
    if (rateLimited(req)) return sendJson(res, 429, { error: "Terlalu banyak permintaan. Coba lagi sebentar." });

    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 4096) {
        req.destroy();
      }
    });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}");
        if (typeof parsed.url !== "string" || parsed.url.length > 2048) {
          return sendJson(res, 400, { error: "URL tidak valid." });
        }
        const destination = await resolveRedirect(parsed.url.trim());
        sendJson(res, 200, { destination });
      } catch (err) {
        sendJson(res, 400, { error: err.message || "Gagal memeriksa link." });
      }
    });
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    });
    return fs.createReadStream(path.join(PUBLIC_DIR, "index.html")).pipe(res);
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Bypass Link berjalan di http://localhost:${PORT}`);
  console.log(`Shortener yang diizinkan: ${[...SHORTENER_HOSTS].join(", ")}`);
});
