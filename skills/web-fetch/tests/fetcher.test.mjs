import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";

import {
  ENDPOINTS,
  REQUEST_HEADERS,
  buildEndpointUrl,
  describeError,
  parseHttpResponse,
  tryEndpoints,
  httpGet,
} from "../scripts/lib/fetcher.mjs";

test("buildEndpointUrl - substitutes {url} placeholder verbatim", () => {
  assert.equal(
    buildEndpointUrl("https://r.jina.ai/{url}", "https://example.com/a?b=1"),
    "https://r.jina.ai/https://example.com/a?b=1"
  );
});

test("buildEndpointUrl - leaves URL with query string and fragment intact", () => {
  assert.equal(
    buildEndpointUrl("https://defuddle.md/{url}", "https://x.test/p?q=1#frag"),
    "https://defuddle.md/https://x.test/p?q=1#frag"
  );
});

test("ENDPOINTS - cascade order matches the user-specified spec", () => {
  assert.deepEqual(
    ENDPOINTS.map((e) => e.name),
    ["r.jina.ai", "markdown.new", "defuddle.md"]
  );
});

test("tryEndpoints - happy path: first endpoint returns 200 markdown", async () => {
  const calls = [];
  const httpClient = async ({ url }) => {
    calls.push(url);
    return { status: 200, body: "# hello world\n" };
  };
  const result = await tryEndpoints("https://example.com", { httpClient });
  assert.equal(result.ok, true);
  assert.equal(result.source, "r.jina.ai");
  assert.equal(result.status, 200);
  assert.equal(result.body, "# hello world\n");
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://r.jina.ai/https://example.com");
});

test("tryEndpoints - falls back when first endpoint throws", async () => {
  let n = 0;
  const httpClient = async () => {
    n += 1;
    if (n === 1) throw new Error("ECONNREFUSED");
    return { status: 200, body: "## from second\n" };
  };
  const result = await tryEndpoints("https://example.com", { httpClient });
  assert.equal(result.ok, true);
  assert.equal(result.source, "markdown.new");
  assert.equal(n, 2);
});

test("tryEndpoints - falls back on non-2xx status", async () => {
  let n = 0;
  const statuses = [404, 503, 200];
  const httpClient = async () => {
    const status = statuses[n++];
    return { status, body: status === 200 ? "ok body" : "err" };
  };
  const result = await tryEndpoints("https://example.com", { httpClient });
  assert.equal(result.ok, true);
  assert.equal(result.source, "defuddle.md");
  assert.equal(n, 3);
});

test("tryEndpoints - falls back on empty body", async () => {
  let n = 0;
  const bodies = ["", "   \n  ", "real content"];
  const httpClient = async () => ({ status: 200, body: bodies[n++] });
  const result = await tryEndpoints("https://example.com", { httpClient });
  assert.equal(result.ok, true);
  assert.equal(result.source, "defuddle.md");
  assert.equal(result.body, "real content");
});

test("tryEndpoints - all endpoints fail returns errors list", async () => {
  let n = 0;
  const httpClient = async () => {
    n += 1;
    if (n === 1) throw new Error("dns failure");
    if (n === 2) return { status: 500, body: "boom" };
    return { status: 200, body: "" };
  };
  const result = await tryEndpoints("https://example.com", { httpClient });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3);
  assert.deepEqual(
    result.errors.map((e) => e.source),
    ["r.jina.ai", "markdown.new", "defuddle.md"]
  );
  assert.match(result.errors[0].message, /dns failure/);
  assert.equal(result.errors[1].message, "HTTP 500");
  assert.equal(result.errors[2].message, "empty body");
});

test("describeError - AggregateError surfaces inner cause", () => {
  const inner = Object.assign(new Error("getaddrinfo ENOTFOUND"), {
    code: "ENOTFOUND",
  });
  const agg = new AggregateError([inner], "all hosts failed");
  const msg = describeError(agg);
  assert.match(msg, /AggregateError/);
  assert.match(msg, /ENOTFOUND/);
});

test("describeError - error with code annotates the message", () => {
  const e = Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" });
  assert.equal(describeError(e), "connect refused: ECONNREFUSED");
});

test("describeError - plain string fallback", () => {
  assert.equal(describeError(new Error("plain")), "plain");
});

test("tryEndpoints - forwards proxy, headers and timeout to httpClient", async () => {
  const seen = [];
  const httpClient = async (args) => {
    seen.push(args);
    return { status: 200, body: "x" };
  };
  await tryEndpoints("https://example.com", {
    httpClient,
    proxy: "http://proxy.local:8080",
    timeoutMs: 1234,
  });
  assert.equal(seen[0].proxy, "http://proxy.local:8080");
  assert.equal(seen[0].timeoutMs, 1234);
  assert.deepEqual(seen[0].headers, REQUEST_HEADERS);
});

test("tryEndpoints - rejects when no endpoints supplied", async () => {
  const result = await tryEndpoints("https://example.com", {
    httpClient: async () => ({ status: 200, body: "x" }),
    endpoints: [],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, []);
});

test("httpGet - performs real GET against a loopback HTTP server", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/foo?bar=1");
    assert.equal(req.headers["user-agent"], REQUEST_HEADERS["User-Agent"]);
    res.writeHead(200, { "Content-Type": "text/markdown" });
    res.end("# loopback\n");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    const result = await httpGet({
      url: `http://127.0.0.1:${port}/foo?bar=1`,
      proxy: null,
      headers: REQUEST_HEADERS,
      timeoutMs: 5000,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body, "# loopback\n");
  } finally {
    server.close();
  }
});

test("httpGet - timeout rejects when server never responds", async () => {
  const server = http.createServer(() => {
    /* never respond */
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    await assert.rejects(
      httpGet({
        url: `http://127.0.0.1:${port}/`,
        proxy: null,
        headers: REQUEST_HEADERS,
        timeoutMs: 100,
      }),
      /timeout/
    );
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test("httpGet - propagates non-2xx status without throwing", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("upstream down");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    const result = await httpGet({
      url: `http://127.0.0.1:${port}/`,
      proxy: null,
      headers: REQUEST_HEADERS,
      timeoutMs: 5000,
    });
    assert.equal(result.status, 503);
    assert.equal(result.body, "upstream down");
  } finally {
    server.close();
  }
});

test("httpGet - tunnels through a CONNECT proxy to a loopback HTTP target", async () => {
  const target = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/markdown" });
    res.end("# via tunnel\n");
  });
  await new Promise((r) => target.listen(0, "127.0.0.1", r));
  const targetPort = target.address().port;

  const proxy = http.createServer((_req, res) => {
    res.writeHead(405);
    res.end("only CONNECT supported here");
  });
  proxy.on("connect", (_req, clientSocket, _head) => {
    const upstream = http.globalAgent.createConnection(
      { host: "127.0.0.1", port: targetPort },
      (err) => {
        if (err) {
          clientSocket.destroy();
          return;
        }
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      }
    );
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  const proxyPort = proxy.address().port;

  try {
    const result = await httpGet({
      url: `http://127.0.0.1:${targetPort}/`,
      proxy: `http://127.0.0.1:${proxyPort}`,
      headers: REQUEST_HEADERS,
      timeoutMs: 5000,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body, "# via tunnel\n");
  } finally {
    proxy.closeAllConnections?.();
    proxy.close();
    target.closeAllConnections?.();
    target.close();
  }
});

test("httpGet - rejects when CONNECT proxy refuses with non-200", async () => {
  const proxy = http.createServer((_req, res) => res.end());
  proxy.on("connect", (_req, socket) => {
    socket.write("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
    socket.end();
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  const proxyPort = proxy.address().port;
  try {
    await assert.rejects(
      httpGet({
        url: "http://127.0.0.1:1/",
        proxy: `http://127.0.0.1:${proxyPort}`,
        headers: REQUEST_HEADERS,
        timeoutMs: 2000,
      }),
      /CONNECT failed with status 407/
    );
  } finally {
    proxy.closeAllConnections?.();
    proxy.close();
  }
});

// ---------------------------------------------------------------------------
// parseHttpResponse unit tests
// ---------------------------------------------------------------------------

test("parseHttpResponse - simple Connection: close response", () => {
  const raw = Buffer.from(
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n# hello\n"
  );
  const { status, body } = parseHttpResponse(raw);
  assert.equal(status, 200);
  assert.equal(body, "# hello\n");
});

test("parseHttpResponse - Transfer-Encoding: chunked", () => {
  const raw = Buffer.from(
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n" +
      "5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n"
  );
  const { status, body } = parseHttpResponse(raw);
  assert.equal(status, 200);
  assert.equal(body, "hello world");
});

test("parseHttpResponse - chunked with multi-byte UTF-8 body", () => {
  const text = "中文内容";
  const textBuf = Buffer.from(text, "utf8");
  const size = textBuf.length.toString(16);
  const raw = Buffer.concat([
    Buffer.from("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"),
    Buffer.from(`${size}\r\n`),
    textBuf,
    Buffer.from(`\r\n0\r\n\r\n`),
  ]);
  const { body } = parseHttpResponse(raw);
  assert.equal(body, text);
});

test("parseHttpResponse - invalid chunk size throws", () => {
  const raw = Buffer.from(
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nZZZ\r\nbad\r\n0\r\n\r\n"
  );
  assert.throws(() => parseHttpResponse(raw), /invalid chunk size/);
});

test("parseHttpResponse - headers are case-insensitive", () => {
  const raw = Buffer.from(
    "HTTP/1.1 404 Not Found\r\nContent-TYPE: text/html\r\nX-Custom: val\r\n\r\nbody"
  );
  const { status, headers } = parseHttpResponse(raw);
  assert.equal(status, 404);
  assert.equal(headers.get("content-type"), "text/html");
  assert.equal(headers.get("x-custom"), "val");
});

test("parseHttpResponse - missing separator throws", () => {
  const raw = Buffer.from("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n");
  assert.throws(() => parseHttpResponse(raw), /no header\/body separator/);
});

// ---------------------------------------------------------------------------
// SOCKS5 proxy tests
// ---------------------------------------------------------------------------

function createMockSocks5Server(opts = {}) {
  return new Promise((resolveServer) => {
    const target = opts.target;

    const proxy = net.createServer((client) => {
      let buf = Buffer.alloc(0);
      let state = "greeting";

      client.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);

        if (state === "greeting") {
          if (buf.length < 2) return;
          const nmethods = buf[1];
          if (buf.length < 2 + nmethods) return;
          if (opts.rejectAuth) {
            client.write(Buffer.from([0x05, 0xff]));
            client.end();
            return;
          }
          client.write(Buffer.from([0x05, 0x00]));
          buf = buf.subarray(2 + nmethods); // consume VER + NMETHODS + methods list
          state = "connect";
          // fall through: connect request may be in the same chunk
        }

        if (state === "connect") {
          if (buf.length < 5) return;
          const atyp = buf[3];
          let consumed;
          if (atyp === 0x03) {
            const hostLen = buf[4];
            consumed = 5 + hostLen + 2;
          } else if (atyp === 0x01) {
            consumed = 4 + 4 + 2;
          } else {
            consumed = 4 + 16 + 2; // IPv6
          }
          if (buf.length < consumed) return;
          state = "done";

          // Success: IPv4 BND 0.0.0.0:0
          client.write(
            Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
          );

          if (target) {
            // Pause + clear before piping so the GET request can't arrive
            // and be consumed by the state-machine listener before pipe is ready.
            client.pause();
            client.removeAllListeners("data");
            const upstream = net.connect({ port: target }, () => {
              client.pipe(upstream); // pipe() calls client.resume() internally
              upstream.pipe(client);
            });
            upstream.on("error", () => client.destroy());
            client.on("error", () => upstream.destroy());
          }
        }
      });

      client.on("error", () => {});
    });

    proxy.listen(0, "127.0.0.1", () => resolveServer(proxy));
  });
}

test("httpGet - tunnels through a SOCKS5 proxy to a loopback HTTP target", async () => {
  const target = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/markdown" });
    res.end("# via socks5\n");
  });
  await new Promise((r) => target.listen(0, "127.0.0.1", r));
  const targetPort = target.address().port;

  const proxy = await createMockSocks5Server({ target: targetPort });
  const proxyPort = proxy.address().port;

  try {
    const result = await httpGet({
      url: `http://127.0.0.1:${targetPort}/`,
      proxy: `socks5h://127.0.0.1:${proxyPort}`,
      headers: REQUEST_HEADERS,
      timeoutMs: 5000,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body, "# via socks5\n");
  } finally {
    proxy.closeAllConnections?.();
    proxy.close();
    target.closeAllConnections?.();
    target.close();
  }
});

test("httpGet - rejects when SOCKS5 proxy rejects all auth methods", async () => {
  const proxy = await createMockSocks5Server({ rejectAuth: true });
  const proxyPort = proxy.address().port;
  try {
    await assert.rejects(
      httpGet({
        url: "http://127.0.0.1:1/",
        proxy: `socks5h://127.0.0.1:${proxyPort}`,
        headers: REQUEST_HEADERS,
        timeoutMs: 2000,
      }),
      /SOCKS5 auth failed/
    );
  } finally {
    proxy.closeAllConnections?.();
    proxy.close();
  }
});

test("httpGet - rejects on unsupported proxy scheme", async () => {
  await assert.rejects(
    httpGet({
      url: "http://127.0.0.1:1/",
      proxy: "socks4://127.0.0.1:1080",
      headers: REQUEST_HEADERS,
      timeoutMs: 2000,
    }),
    /unsupported proxy scheme/
  );
});
