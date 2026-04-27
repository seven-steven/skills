#!/usr/bin/env node
import { createInterface } from "node:readline";
import { validateMessage, formatErrorReport } from "./lib/commit-message.mjs";

async function readStdin() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    const lines = [];
    rl.on("line", (l) => lines.push(l));
    rl.on("close", () => resolve(lines.join("\n")));
  });
}

async function main() {
  let message;

  if (process.argv[2] !== undefined) {
    message = process.argv[2];
  } else if (!process.stdin.isTTY) {
    message = await readStdin();
  }

  if (message === undefined || !message.trim()) {
    process.stderr.write(
      "usage: validate.mjs <message>  # or pipe via stdin\n"
    );
    process.exit(2);
  }

  const result = validateMessage(message);
  if (result.ok) {
    process.exit(0);
  }

  process.stderr.write(formatErrorReport(result.errors));
  process.exit(1);
}

main();
