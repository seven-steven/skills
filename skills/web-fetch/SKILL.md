---
name: web-fetch
description: >-
  Retrieve a URL through the r.jina.ai → markdown.new → defuddle.md cascade and
  return the exact, source-tagged Markdown. Use only when the user explicitly
  needs auditable original Markdown, the built-in WebFetch is blocked or fails,
  or the user explicitly requests WEB_FETCH_PROXY or this three-service fallback.
  Do not invoke for ordinary URL summaries, reading, translation, or extraction
  that the built-in WebFetch can perform.
argument-hint: <url>
---

## Task

Retrieve an HTTP(S) URL as clean, auditable Markdown when this skill's narrow
trigger conditions apply.

## Path resolution

The skill load context provides a **Base directory**. Use that directory as the
installation root for this skill. Run the bundled script at:

```
<Base directory>/scripts/fetch.mjs
```

Do not scan plugin caches or search the filesystem for another copy of the
script.

## Steps

1. Verify that the supplied URL is HTTP or HTTPS.
2. Run:
   ```
   node "<Base directory>/scripts/fetch.mjs" "<url>"
   ```
3. On success, read the Markdown emitted after its source-tag comment. Preserve
   the comment when quoting an excerpt so the fallback source remains auditable.

## Failure handling

- **Exit 1** — every fallback endpoint failed. Show the relevant per-endpoint
  errors. Recommend `WEB_FETCH_PROXY` for connection, timeout, or DNS errors;
  otherwise suggest checking that the upstream URL is public and reachable.
- **Exit 2** — the URL argument is missing or invalid. Ask for a valid absolute
  `http://` or `https://` URL.

## Configuration

Set `WEB_FETCH_PROXY` in the `env` block of `.claude/settings.json` or
`~/.claude/settings.json`:

```json
{
  "env": {
    "WEB_FETCH_PROXY": "socks5h://127.0.0.1:1080"
  }
}
```

- An empty value disables the proxy.
- `http://...` uses HTTP `CONNECT`.
- `socks5://...` resolves the target locally and sends an IPv4 or IPv6 SOCKS5
  address. `socks5h://...` sends the target hostname to the proxy for proxy-side
  DNS resolution.
- HTTP Basic and SOCKS5 username/password authentication are supported.
- SOCKS4 and TLS (`https://`) proxy URLs are unsupported.

## Output format

Successful stdout begins with:

```
<!-- web-fetch: source=<endpoint> url=<requested-url> -->
```

The remaining output is the winning endpoint's Markdown body. The cascade order
is fixed: `r.jina.ai`, then `markdown.new`, then `defuddle.md`. Each endpoint
has a 30-second timeout; only a non-empty HTTP 2xx response succeeds.
