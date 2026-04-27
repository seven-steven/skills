import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

export const ENDPOINTS = [
  { name: "r.jina.ai", template: "https://r.jina.ai/{url}" },
  { name: "markdown.new", template: "https://markdown.new/{url}" },
  { name: "defuddle.md", template: "https://defuddle.md/{url}" },
];

export const REQUEST_HEADERS = {
  "User-Agent": "claude-code-web-fetch/1.0",
  "Accept": "text/markdown, text/plain, text/html;q=0.9, */*;q=0.5",
  "X-Return-Format": "markdown",
};

export const DEFAULT_TIMEOUT_MS = 30000;

export function buildEndpointUrl(template, targetUrl) {
  return template.replace("{url}", targetUrl);
}

export async function tryEndpoints(targetUrl, opts = {}) {
  const {
    proxy = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    httpClient = httpGet,
    endpoints = ENDPOINTS,
    headers = REQUEST_HEADERS,
  } = opts;

  const errors = [];
  for (const { name, template } of endpoints) {
    const url = buildEndpointUrl(template, targetUrl);
    try {
      const { status, body } = await httpClient({ url, proxy, headers, timeoutMs });
      if (status < 200 || status >= 300) {
        errors.push({ source: name, message: `HTTP ${status}` });
        continue;
      }
      if (!body || !body.trim()) {
        errors.push({ source: name, message: "empty body" });
        continue;
      }
      return { ok: true, source: name, status, body };
    } catch (e) {
      errors.push({ source: name, message: describeError(e) });
    }
  }
  return { ok: false, errors };
}

export function describeError(e) {
  if (!e) return String(e);
  if (Array.isArray(e.errors) && e.errors.length) {
    const inner = e.errors[0];
    const innerMsg = inner?.message || inner?.code || String(inner);
    return `${e.name || "AggregateError"}: ${innerMsg}`;
  }
  if (e.code) return `${e.message || e.name}: ${e.code}`;
  return e.message || String(e);
}

export function httpGet({ url, proxy, headers, timeoutMs }) {
  if (proxy) return getViaProxy({ url, proxy, headers, timeoutMs });
  return getDirect({ url, headers, timeoutMs });
}

// ---------------------------------------------------------------------------
// Direct path (no proxy) — uses Node's built-in http/https.request
// ---------------------------------------------------------------------------

function collectBody(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", reject);
  });
}

function getDirect({ url, headers, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const isTls = target.protocol === "https:";
    const lib = isTls ? https : http;
    const port = Number(target.port) || (isTls ? 443 : 80);

    const req = lib.request(
      {
        method: "GET",
        hostname: target.hostname,
        port,
        path: target.pathname + target.search,
        headers: { ...headers, Host: target.host },
      },
      async (res) => {
        try {
          const body = await collectBody(res);
          resolve({ status: res.statusCode, body });
        } catch (e) {
          reject(e);
        }
      }
    );

    req.on("error", reject);
    req.setTimeout(timeoutMs, () =>
      req.destroy(new Error(`request timeout after ${timeoutMs}ms`))
    );
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Proxy path — manual tunnel + manual HTTP/1.1 over socket
// ---------------------------------------------------------------------------

async function getViaProxy({ url, proxy, headers, timeoutMs }) {
  const target = new URL(url);
  const isTls = target.protocol === "https:";
  const targetPort = Number(target.port) || (isTls ? 443 : 80);

  const socket = await openTunnel(proxy, target.hostname, targetPort, timeoutMs);
  return requestOverSocket({ socket, target, headers, isTls, timeoutMs });
}

function openTunnel(proxyUrl, targetHost, targetPort, timeoutMs) {
  const p = new URL(proxyUrl);
  if (p.protocol === "http:" || p.protocol === "https:") {
    return httpConnectTunnel(p, targetHost, targetPort, timeoutMs);
  }
  if (p.protocol === "socks5:" || p.protocol === "socks5h:") {
    return socks5Tunnel(p, targetHost, targetPort, timeoutMs);
  }
  return Promise.reject(
    new Error(`unsupported proxy scheme: ${p.protocol.replace(":", "")}`)
  );
}

function httpConnectTunnel(p, targetHost, targetPort, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proxyHeaders = { Host: `${targetHost}:${targetPort}` };
    if (p.username || p.password) {
      const auth = Buffer.from(
        `${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`
      ).toString("base64");
      proxyHeaders["Proxy-Authorization"] = `Basic ${auth}`;
    }

    const req = http.request({
      method: "CONNECT",
      host: p.hostname,
      port: Number(p.port) || 80,
      path: `${targetHost}:${targetPort}`,
      headers: proxyHeaders,
    });

    let done = false;
    const fail = (e) => {
      if (done) return;
      done = true;
      req.destroy();
      reject(e);
    };

    req.setTimeout(timeoutMs, () =>
      fail(new Error(`proxy CONNECT timeout after ${timeoutMs}ms`))
    );
    req.on("error", fail);
    req.on("connect", (res, socket) => {
      if (done) return;
      done = true;
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error(`proxy CONNECT failed with status ${res.statusCode}`));
      }
      resolve(socket);
    });
    req.end();
  });
}

function socks5Tunnel(p, targetHost, targetPort, timeoutMs) {
  return new Promise((resolve, reject) => {
    const hostBytes = Buffer.from(targetHost, "utf8");
    if (hostBytes.length > 255) {
      return reject(new Error(`SOCKS5 hostname too long: ${targetHost}`));
    }

    const username = p.username || "";
    const password = p.password || "";
    const hasAuth = username.length > 0;

    const socket = net.connect({
      host: p.hostname,
      port: Number(p.port) || 1080,
    });

    let buf = Buffer.alloc(0);
    let state = "greeting";
    let timer;

    function sendConnect() {
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(targetPort);
      socket.write(
        Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBytes.length]),
          hostBytes,
          portBuf,
        ])
      );
    }

    const fail = (e) => {
      clearTimeout(timer);
      socket.destroy();
      reject(e);
    };

    timer = setTimeout(
      () => fail(new Error(`SOCKS5 tunnel timeout after ${timeoutMs}ms`)),
      timeoutMs
    );

    socket.on("error", fail);

    socket.once("connect", () => {
      if (hasAuth) {
        // Offer NO_AUTH(0x00) + USERNAME/PASSWORD(0x02)
        socket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
      } else {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      }
    });

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);

      if (state === "greeting") {
        if (buf.length < 2) return;
        const chosen = buf[1];
        if (buf[0] !== 0x05 || chosen === 0xff) {
          return fail(
            new Error(
              `SOCKS5 auth failed: server rejected all methods (0x${buf[1].toString(16)})`
            )
          );
        }
        buf = buf.subarray(2);

        if (chosen === 0x02) {
          // RFC 1929 USERNAME/PASSWORD sub-negotiation
          const userBuf = Buffer.from(username, "utf8");
          const passBuf = Buffer.from(password, "utf8");
          socket.write(
            Buffer.concat([
              Buffer.from([0x01, userBuf.length]),
              userBuf,
              Buffer.from([passBuf.length]),
              passBuf,
            ])
          );
          state = "auth";
          return;
        }

        // NO_AUTH chosen — send CONNECT directly
        sendConnect();
        state = "connect";
        return;
      }

      if (state === "auth") {
        if (buf.length < 2) return;
        if (buf[1] !== 0x00) {
          return fail(new Error("SOCKS5 authentication failed: wrong credentials"));
        }
        buf = buf.subarray(2);
        sendConnect();
        state = "connect";
        return;
      }

      if (state === "connect") {
        if (buf.length < 4) return;
        if (buf[1] !== 0x00) {
          return fail(
            new Error(`SOCKS5 CONNECT failed: REP=0x${buf[1].toString(16)}`)
          );
        }
        // Determine response length to consume
        const atyp = buf[3];
        let addrLen;
        if (atyp === 0x01) {
          addrLen = 4; // IPv4
        } else if (atyp === 0x04) {
          addrLen = 16; // IPv6
        } else if (atyp === 0x03) {
          if (buf.length < 5) return;
          addrLen = 1 + buf[4]; // 1-byte length prefix + domain bytes
        } else {
          return fail(new Error(`SOCKS5: unknown ATYP 0x${atyp.toString(16)}`));
        }
        const responseLen = 4 + addrLen + 2;
        if (buf.length < responseLen) return;
        // Tunnel established
        state = "done";
        clearTimeout(timer);
        socket.removeAllListeners("data");
        socket.removeAllListeners("error");
        resolve(socket);
      }
    });
  });
}

async function requestOverSocket({ socket, target, headers, isTls, timeoutMs }) {
  let iface = socket;
  if (isTls) {
    iface = await new Promise((resolve, reject) => {
      const ts = tls.connect({ socket, servername: target.hostname });
      ts.once("secureConnect", () => resolve(ts));
      ts.once("error", reject);
    });
  }

  const path = (target.pathname || "/") + (target.search || "");
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");
  const requestStr = [
    `GET ${path} HTTP/1.1`,
    `Host: ${target.host}`,
    headerLines,
    "Accept-Encoding: identity",
    "Connection: close",
    "",
    "",
  ].join("\r\n");

  iface.write(requestStr);

  return new Promise((resolve, reject) => {
    const chunks = [];
    let timer;

    const fail = (e) => {
      clearTimeout(timer);
      try { iface.destroy(); } catch (_) {}
      try { socket.destroy(); } catch (_) {}
      reject(e);
    };

    timer = setTimeout(
      () => fail(new Error(`tunneled request timeout after ${timeoutMs}ms`)),
      timeoutMs
    );

    iface.on("data", (c) => chunks.push(c));
    iface.on("end", () => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks);
      try {
        const { status, body } = parseHttpResponse(raw);
        resolve({ status, body });
      } catch (e) {
        reject(e);
      }
    });
    iface.on("error", fail);
  });
}

// ---------------------------------------------------------------------------
// HTTP/1.1 response parser (exported for testing)
// ---------------------------------------------------------------------------

export function parseHttpResponse(rawBuf) {
  // Locate \r\n\r\n header/body boundary
  let sepIdx = -1;
  for (let i = 0; i <= rawBuf.length - 4; i++) {
    if (
      rawBuf[i] === 0x0d &&
      rawBuf[i + 1] === 0x0a &&
      rawBuf[i + 2] === 0x0d &&
      rawBuf[i + 3] === 0x0a
    ) {
      sepIdx = i;
      break;
    }
  }
  if (sepIdx < 0) {
    throw new Error("malformed HTTP response: no header/body separator");
  }

  const headerSection = rawBuf.slice(0, sepIdx).toString("utf8");
  const bodyBuf = rawBuf.slice(sepIdx + 4);

  const lines = headerSection.split("\r\n");
  const m = lines[0].match(/^HTTP\/[\d.]+ (\d{3})/);
  if (!m) throw new Error(`malformed status line: ${lines[0]}`);
  const status = parseInt(m[1], 10);

  const headersMap = new Map();
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    headersMap.set(
      line.slice(0, colon).trim().toLowerCase(),
      line.slice(colon + 1).trim()
    );
  }

  const te = headersMap.get("transfer-encoding") || "";
  const body = te.toLowerCase().includes("chunked")
    ? decodeChunked(bodyBuf).toString("utf8")
    : bodyBuf.toString("utf8");

  return { status, headers: headersMap, body };
}

function decodeChunked(data) {
  const parts = [];
  let i = 0;
  while (i < data.length) {
    let eol = -1;
    for (let j = i; j < data.length - 1; j++) {
      if (data[j] === 0x0d && data[j + 1] === 0x0a) {
        eol = j;
        break;
      }
    }
    if (eol < 0) throw new Error("chunked encoding: missing chunk size line");
    const sizeStr = data.slice(i, eol).toString("ascii").split(";")[0].trim();
    const size = parseInt(sizeStr, 16);
    if (isNaN(size)) {
      throw new Error(`chunked encoding: invalid chunk size: ${JSON.stringify(sizeStr)}`);
    }
    if (size === 0) break;
    i = eol + 2;
    if (i + size > data.length) {
      throw new Error("chunked encoding: truncated chunk data");
    }
    parts.push(data.slice(i, i + size));
    i += size + 2;
  }
  return Buffer.concat(parts);
}
