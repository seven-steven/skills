import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const CJK_TEXT = "查询研发云工作项";

function spawnByteWriter(text, fd = "stdout") {
  const script = `
const buf = Buffer.from(${JSON.stringify(text)}, "utf8");
for (let i = 0; i < buf.length; i++) {
  process.${fd}.write(buf.subarray(i, i + 1));
}
process.${fd}.write(Buffer.from("\\n", "utf8"));
`;
  return spawn(process.execPath, ["-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
}

test("stdout: setEncoding preserves CJK across chunk-split boundaries", (t, done) => {
  const child = spawnByteWriter(CJK_TEXT, "stdout");
  child.stdout.setEncoding("utf8");

  const lines = [];
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => lines.push(line));

  child.on("close", () => {
    assert.deepEqual(lines, [CJK_TEXT]);
    done();
  });
});

test("stderr: setEncoding preserves CJK across chunk-split boundaries", (t, done) => {
  const child = spawnByteWriter(CJK_TEXT, "stderr");
  child.stderr.setEncoding("utf8");

  const chunks = [];
  child.stderr.on("data", (chunk) => chunks.push(chunk));

  child.on("close", () => {
    assert.equal(chunks.join("").trimEnd(), CJK_TEXT);
    done();
  });
});
