#!/usr/bin/env node
import { tryEndpoints } from "./lib/fetcher.mjs";

const url = process.argv[2];
if (!url) {
  process.stderr.write("usage: fetch.mjs <url>\n");
  process.exit(2);
}

const proxy = (process.env.WEB_FETCH_PROXY || "").trim() || null;

const result = await tryEndpoints(url, { proxy });

if (result.ok) {
  process.stdout.write(`<!-- web-fetch: source=${result.source} url=${url} -->\n`);
  process.stdout.write(result.body);
  if (!result.body.endsWith("\n")) process.stdout.write("\n");
  process.exit(0);
}

process.stderr.write("web-fetch: all endpoints failed\n");
for (const e of result.errors) {
  process.stderr.write(`  - ${e.source}: ${e.message}\n`);
}
process.exit(1);
