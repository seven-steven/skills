#!/usr/bin/env node
import { validateMessage, formatErrorReport } from "./lib/commit-message.mjs";
import { readMessageInput } from "./lib/input.mjs";

async function main() {
  const message = await readMessageInput();

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
