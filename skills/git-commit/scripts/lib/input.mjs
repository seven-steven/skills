import { createInterface } from "node:readline";

export async function readMessageInput({ argv = process.argv, stdin = process.stdin } = {}) {
  if (argv[2] !== undefined) return argv[2];
  if (stdin.isTTY) return undefined;

  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin });
    const lines = [];
    rl.on("line", (line) => lines.push(line));
    rl.on("close", () => resolve(lines.join("\n")));
  });
}
