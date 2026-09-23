/**
 * fake-codefree-fixture.mjs
 *
 * Scenario-driven fake `codefree-o` binary for zero-network contract tests.
 *
 * The generated bin script (see tests/helpers.mjs `writeFakeBin`) imports
 * `runFakeBin` from this module. Behaviour is controlled entirely through
 * env vars so the same fixture covers happy paths, failures, hangs, and
 * byte-level chunk splitting:
 *
 *   CODEFREE_FAKE_RECORD    path to write { argv, cwd } as JSON (spy output)
 *   CODEFREE_FAKE_SCENARIO  path to a scenario JSON file:
 *     {
 *       events:     [ ...NDJSON event objects, emitted one per line... ],
 *       rawLines:   [ "...raw non-JSON stdout lines..." ],
 *       splitText:  { text: "...", splitAt: <byte offset> },  // UTF-8 chunk test
 *       stderr:     "...",
 *       exitCode:   0,
 *       hangMs:     0        // stay alive this long before exiting
 *     }
 */

import fs from "node:fs";
import { spawn } from "node:child_process";
import process from "node:process";

export function runFakeBin() {
  const recordPath = process.env.CODEFREE_FAKE_RECORD;
  const scenarioPath = process.env.CODEFREE_FAKE_SCENARIO;

  if (recordPath) {
    fs.writeFileSync(
      recordPath,
      JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }, null, 2),
      "utf8"
    );
  }

  const scenario = scenarioPath
    ? JSON.parse(fs.readFileSync(scenarioPath, "utf8"))
    : { events: [], exitCode: 0 };

  // Note: lines are written with explicit \n and NO extra encoding layer so
  // the companion's readline sees exactly one event per line. splitText is
  // written as raw bytes split mid-character to prove UTF-8 reassembly.
  const lines = [];
  for (const event of scenario.events ?? []) {
    lines.push(JSON.stringify(event));
  }
  for (const raw of scenario.rawLines ?? []) {
    lines.push(raw);
  }

  if (lines.length > 0) {
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  if (scenario.splitText) {
    // One complete JSON event line, written as raw UTF-8 bytes split at the
    // given byte offset (mid-character) to prove UTF-8 reassembly.
    const eventLine = JSON.stringify({
      type: "text",
      sessionID: "ses-split",
      part: { type: "text", text: scenario.splitText.text }
    });
    const bytes = Buffer.from(eventLine, "utf8");
    const at = Math.min(scenario.splitText.splitAt, bytes.length - 1);
    process.stdout.write(bytes.subarray(0, at));
    process.stdout.write(bytes.subarray(at));
    process.stdout.write("\n");
  }

  if (scenario.stderr) {
    process.stderr.write(scenario.stderr);
  }

  // Let stdout drain naturally instead of process.exit, which can truncate
  // pending pipe writes.
  const finish = () => {
    process.exitCode = typeof scenario.exitCode === "number" ? scenario.exitCode : 0;
  };

  if (scenario.grandchild) {
    // Spawn a same-process-group grandchild (detached: false so group kills
    // reach it) with stdio ignored. When combined with hangMs the direct
    // child stays alive until the timeout group-SIGTERM kills it, leaving
    // the SIGTERM-immune grandchild behind — reproducing the F3 leak that
    // only the companion's armed SIGKILL grace timer can clean up.
    const child = spawn(process.execPath, [scenario.grandchild.scriptFile], {
      stdio: "ignore",
      detached: false
    });
    child.unref();
  }

  if (scenario.hangMs > 0) {
    // Hang until the companion (timeout or signal) kills this process tree.
    // Record the fake child's pid so tests can verify the kill happened.
    // The hangMs timer bounds the process lifetime so a leaked orphan (e.g.
    // after a test failure) can never outlive the test run by much.
    const pidPath = scenario.hangPidFile;
    if (pidPath) {
      fs.writeFileSync(pidPath, String(process.pid), "utf8");
    }
    setInterval(() => {}, 60_000);
    setTimeout(() => process.exit(0), scenario.hangMs);
  } else {
    finish();
  }
}
