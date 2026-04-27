#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { copyToClipboard } from "./lib/clipboard.mjs";

if (process.env.DAILY_REPORT_NO_CLIPBOARD === "1") {
  process.stdout.write("跳过剪贴板复制（DAILY_REPORT_NO_CLIPBOARD=1）\n");
  process.exit(0);
}

async function readInput() {
  const src = process.argv[2] ? createReadStream(process.argv[2]) : process.stdin;
  const chunks = [];
  for await (const chunk of src) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const text = await readInput();
const result = copyToClipboard(text);

if (result.ok) {
  process.stdout.write(`已复制到剪贴板（${result.tool}）\n`);
  process.exit(0);
}

if (result.reason === "empty-input") {
  process.stderr.write("复制到剪贴板失败：empty-input（已尝试：无）\n");
} else {
  const triedStr = result.tried.join(", ") || "无";
  process.stderr.write(`复制到剪贴板失败：${result.reason}（已尝试：${triedStr}）\n`);
}
process.exit(0);
