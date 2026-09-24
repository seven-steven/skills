#!/usr/bin/env node
import { buildCommit } from "./lib/build-commit.mjs";

async function main() {
  const result = await buildCommit(process.argv, process.stdin);
  if (!result.ok) {
    if (result.errors) {
      process.stderr.write(`  - ${result.errors.join("\n  - ")}\n`);
    } else {
      process.stderr.write(
        "usage: validate.mjs [--cwd <repo-path>] [--task-id <task-id>] <message>  # or pipe via stdin\n"
      );
    }
    process.exit(result.exitCode);
  }
  // validate-only: message is valid, no git commit
}

main();