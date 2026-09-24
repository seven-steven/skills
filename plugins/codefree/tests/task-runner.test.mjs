import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChildEnv,
  buildCodefreeArgv,
  resolveTransport
} from "../scripts/lib/task-runner.mjs";
import { UsageError } from "../scripts/lib/errors.mjs";

// ---------------------------------------------------------------------------
// buildChildEnv — CODEFREE_PROXY single-URL shortcut
// ---------------------------------------------------------------------------

test("buildChildEnv - single http URL sets HTTP/HTTPS/ALL proxy and forces local NO_PROXY", () => {
  const env = buildChildEnv({
    CODEFREE_PROXY: "http://user:pass@proxy.example.com:1080",
    HTTP_PROXY: "http://old.example.com:2080",
    NO_PROXY: "10.0.0.0/8"
  });

  assert.equal(env.HTTP_PROXY, "http://user:pass@proxy.example.com:1080");
  assert.equal(env.HTTPS_PROXY, "http://user:pass@proxy.example.com:1080");
  assert.equal(env.ALL_PROXY, "http://user:pass@proxy.example.com:1080");
  const noProxy = env.NO_PROXY.split(",");
  assert.ok(noProxy.includes("localhost"));
  assert.ok(noProxy.includes("127.0.0.1"));
  assert.ok(noProxy.includes("10.0.0.0/8"), "existing entries are preserved");
});

test("buildChildEnv - empty/unset CODEFREE_PROXY passes inherited env through unchanged", () => {
  const inherited = { HTTP_PROXY: "http://session.example.com:2080", LANG: "en_US" };
  assert.equal(buildChildEnv({ ...inherited }).HTTP_PROXY, "http://session.example.com:2080");
  assert.equal(buildChildEnv({ ...inherited, CODEFREE_PROXY: "" }).HTTP_PROXY, "http://session.example.com:2080");
  // When LANG is already set it is preserved (not overridden to C.UTF-8).
  assert.equal(buildChildEnv({ LANG: "en_US" }).LANG, "en_US");
  // When LANG is unset, defaults to C.UTF-8.
  assert.equal(buildChildEnv({}).LANG, "C.UTF-8");
});

test("buildChildEnv - defaults LANG to C.UTF-8 when unset", () => {
  const env = buildChildEnv({});
  assert.equal(env.LANG, "C.UTF-8");
});

// ---------------------------------------------------------------------------
// buildChildEnv — KEY=VALUE form
// ---------------------------------------------------------------------------

test("buildChildEnv - KEY=VALUE form sets each proxy var independently", () => {
  const env = buildChildEnv({
    CODEFREE_PROXY:
      "HTTP_PROXY=http://user:pass@proxy.example.com:1080 " +
      "HTTPS_PROXY=http://user:pass@proxy.example.com:1080 " +
      "ALL_PROXY=socks5h://user:pass@proxy.example.com " +
      "NO_PROXY=127.0.0.1,10.0.0.0/8"
  });

  assert.equal(env.HTTP_PROXY, "http://user:pass@proxy.example.com:1080");
  assert.equal(env.HTTPS_PROXY, "http://user:pass@proxy.example.com:1080");
  assert.equal(env.ALL_PROXY, "socks5h://user:pass@proxy.example.com");
  const noProxy = env.NO_PROXY.split(",");
  assert.ok(noProxy.includes("localhost"));
  assert.ok(noProxy.includes("127.0.0.1"));
  assert.ok(noProxy.includes("10.0.0.0/8"));
});

test("buildChildEnv - NO_PROXY overrides the list but only adds local entries when a proxy is also set", () => {
  // With only NO_PROXY, there's no proxy to bypass — localhost is not force-added.
  const envNoProxy = buildChildEnv({ CODEFREE_PROXY: "NO_PROXY=10.0.0.0/8" });
  assert.equal(envNoProxy.NO_PROXY, "10.0.0.0/8");
  assert.equal(envNoProxy.HTTP_PROXY, undefined);

  // With HTTP_PROXY + NO_PROXY, localhost/127.0.0.1 are injected because there IS a proxy to bypass.
  const envBoth = buildChildEnv({
    CODEFREE_PROXY: "HTTP_PROXY=http://proxy:1080 NO_PROXY=10.0.0.0/8"
  });
  const noProxy = envBoth.NO_PROXY.split(",");
  assert.ok(noProxy.includes("localhost"));
  assert.ok(noProxy.includes("127.0.0.1"));
  assert.ok(noProxy.includes("10.0.0.0/8"));
});

// ---------------------------------------------------------------------------
// buildChildEnv — fail-fast on invalid values
// ---------------------------------------------------------------------------

test("buildChildEnv - rejects unknown keys and bad schemes", () => {
  const cases = [
    ["SOCKS_PROXY=socks5h://proxy.example.com", /invalid segment/],
    ["HTTP_PROXY=socks5h://proxy.example.com", /HTTP_PROXY must be an http\(s\) URL/],
    ["HTTPS_PROXY=socks5h://proxy.example.com", /HTTPS_PROXY must be an http\(s\) URL/],
    ["ALL_PROXY=not-a-url", /ALL_PROXY must be an http\(s\) or socks5\(h\) URL/],
    ["not a url", /invalid segment/]
  ];
  for (const [raw, pattern] of cases) {
    assert.throws(
      () => buildChildEnv({ CODEFREE_PROXY: raw }),
      (err) => {
        assert.ok(err instanceof UsageError, `expected UsageError for ${raw}`);
        assert.match(err.message, pattern);
        return true;
      },
      raw
    );
  }
});

// ---------------------------------------------------------------------------
// buildCodefreeArgv — flag layout
// ---------------------------------------------------------------------------

test("buildCodefreeArgv - fixed --format json --auto, --dir, and prompt after -- separator", () => {
  const argv = buildCodefreeArgv({
    prompt: "Fix the bug",
    options: {},
    resolvedCwd: "/workspace"
  });
  assert.deepEqual(argv, ["run", "--format", "json", "--auto", "--dir", "/workspace", "--", "Fix the bug"]);
});

test("buildCodefreeArgv - conditional flags appear in order", () => {
  const argv = buildCodefreeArgv({
    prompt: "go",
    options: {
      model: "provider/model-x",
      agent: "build",
      session: "ses-42",
      continue: true,
      fork: true
    },
    resolvedCwd: "/w"
  });
  assert.deepEqual(argv, [
    "run",
    "--format", "json",
    "--auto",
    "--model", "provider/model-x",
    "--agent", "build",
    "--session", "ses-42",
    "--continue",
    "--fork",
    "--dir", "/w",
    "--",
    "go"
  ]);
});

test("buildCodefreeArgv - omits the -- separator when prompt is empty", () => {
  const argv = buildCodefreeArgv({
    prompt: "",
    options: { continue: true },
    resolvedCwd: "/w"
  });
  assert.deepEqual(argv, ["run", "--format", "json", "--auto", "--continue", "--dir", "/w"]);
  assert.ok(!argv.includes("--"), "no separator for empty prompt");
});

test("buildCodefreeArgv - prompt starting with a dash stays after --", () => {
  const argv = buildCodefreeArgv({
    prompt: "--resume-first run tests",
    options: {},
    resolvedCwd: "/w"
  });
  assert.equal(argv[argv.indexOf("--") + 1], "--resume-first run tests");
});

// ---------------------------------------------------------------------------
// resolveTransport
// ---------------------------------------------------------------------------

test("resolveTransport - defaults to serve and rejects unknown values", () => {
  const saved = process.env.CODEFREE_TRANSPORT;
  try {
    delete process.env.CODEFREE_TRANSPORT;
    assert.equal(resolveTransport(), "serve");
    process.env.CODEFREE_TRANSPORT = "run";
    assert.equal(resolveTransport(), "run");
    process.env.CODEFREE_TRANSPORT = "carrier-pigeon";
    assert.throws(() => resolveTransport(), /Invalid CODEFREE_TRANSPORT/);
  } finally {
    if (saved === undefined) delete process.env.CODEFREE_TRANSPORT;
    else process.env.CODEFREE_TRANSPORT = saved;
  }
});
