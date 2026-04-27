---
name: web-fetch
description: >-
  Fetch a URL and return clean reader-friendly Markdown by trying r.jina.ai →
  markdown.new → defuddle.md in order, falling back when one fails. Use this
  whenever the user shares a URL and wants to read, summarize, quote, translate,
  extract from, or otherwise work with the page's actual content — even if they
  don't literally say "fetch". Prefer this over the built-in WebFetch tool when
  you need the raw page text instead of a model-summarized answer, when the
  built-in WebFetch is blocked by the network, or when the page lives behind a
  region/IP wall and a proxy is required. Honors a WEB_FETCH_PROXY variable
  exported from settings.json's `env` block.
argument-hint: <url>
---

## Task

Convert a URL into clean Markdown so its content can be cited, summarized,
translated, or excerpted in the answer.

## Path Resolution

This skill bundles a Node.js script under its installation directory. Before
running anything, resolve the absolute path of the `scripts/` directory and
store it as `$SKILL_SCRIPTS_DIR`:

1. Try the relative path `scripts/` first (works for project-level installs).
2. If that fails, search for the anchor file `fetch.mjs` under:
   - `~/.claude/plugins/cache/**/web-fetch/scripts/fetch.mjs` (global plugin install)
   - `<plugin-source>/skills/web-fetch/scripts/fetch.mjs` (project-level install via marketplace)
3. Use the resolved path in every command below.

## Steps

1. Resolve `$SKILL_SCRIPTS_DIR` per **Path Resolution**.
2. Run:
   ```
   node "$SKILL_SCRIPTS_DIR/fetch.mjs" "<url>"
   ```
3. On success the script writes one source-tag comment line followed by the
   Markdown body, e.g.:
   ```
   <!-- web-fetch: source=r.jina.ai url=https://example.com -->
   # Example Domain
   ...
   ```
4. Read the Markdown directly. Keep the source tag in any quoted excerpt so the
   user can audit which fallback served the request.

## Failure handling

- **Exit 1** — all three endpoints failed. The script prints a per-endpoint
  reason to stderr. Show the relevant lines and suggest one of:
  - Set `WEB_FETCH_PROXY` (see **Configuration**) if the failures look like
    network errors (`ETIMEDOUT`, `ECONNREFUSED`, `ENOTFOUND`, `CONNECT failed`).
  - Verify the URL is correct and publicly reachable (`HTTP 4xx` on every
    endpoint usually means the upstream URL itself is bad).
  - Fall back to the built-in `WebFetch` for a model-summarized answer when
    the user is okay with a non-original-text response.
- **Exit 2** — no URL was passed. Re-invoke with the URL as the first arg.

## Configuration

Set the proxy in `.claude/settings.json` (or `~/.claude/settings.json`) under
the `env` block — Claude Code injects it into the spawned script's
environment automatically:

```json
{
  "env": {
    "WEB_FETCH_PROXY": "http://proxy.example:8080"
  }
}
```

Notes:

- An empty string is treated as "no proxy".
- The URL scheme selects the tunnel protocol: `http://...` uses HTTP `CONNECT`;
  `socks5://...` and `socks5h://...` use SOCKS5 (no-auth, hostname-style).
  Other schemes (`socks4://`, `https://` proxy, etc.) are not supported.
- Basic auth in HTTP CONNECT proxy URLs works: `http://user:pass@proxy.example:8080`.
- TLS is terminated at the script, not at the proxy.

## Output format

The first line of stdout is always a single HTML comment:

```
<!-- web-fetch: source=<endpoint> url=<requested-url> -->
```

The rest of stdout is the Markdown body returned by the winning endpoint,
verbatim. Trailing newline is normalized.

## Notes

- Cascade order is fixed: `r.jina.ai` → `markdown.new` → `defuddle.md`. Each
  endpoint has a 30-second timeout. The first endpoint to return HTTP 2xx with
  a non-empty body wins; everything else (timeouts, 4xx/5xx, empty body,
  thrown errors) advances to the next endpoint.
- Implementation uses Node's standard library only — no `npm install` needed.
- If all three URL services fail (paywalled SPAs, hard anti-scraping), a
  future revision may shell out to Scrapling. Not implemented in this version.
