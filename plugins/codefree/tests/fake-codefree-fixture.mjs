import fs from "node:fs";
import path from "node:path";

import { writeExecutable } from "./helpers.mjs";

const FIXTURE_TEMPLATE = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function readFixtureConfig() {
  const fixturePath = process.env.CODEFREE_FIXTURE_FILE;
  if (!fixturePath || !fs.existsSync(fixturePath)) {
    return { mode: "happy", stdout: "fake codefree default output", exitCode: 0 };
  }
  try {
    return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  } catch {
    return { mode: "happy", stdout: "fake codefree default output", exitCode: 0 };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const config = readFixtureConfig();

  if (config.recordInvocation) {
    const recordPath = config.recordInvocation;
    const record = {
      argv,
      cwd: process.cwd(),
      env: {
        CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA ?? null,
        CODEFREE_COMPANION_SESSION_ID: process.env.CODEFREE_COMPANION_SESSION_ID ?? null
      },
      timestamp: new Date().toISOString()
    };
    fs.appendFileSync(recordPath, JSON.stringify(record) + "\\n", "utf8");
  }

  switch (config.mode) {
    case "happy": {
      const lines = (config.stdoutLines ?? [config.stdout ?? "fake codefree completed"]).filter(Boolean);
      for (const line of lines) {
        process.stdout.write(line + "\\n");
      }
      process.exit(config.exitCode ?? 0);
      break;
    }
    case "fail": {
      if (config.stderr) {
        process.stderr.write(config.stderr + "\\n");
      }
      process.exit(config.exitCode ?? 1);
      break;
    }
    case "slow": {
      const sleepMs = config.sleepMs ?? 5000;
      if (config.preSleepLine) {
        process.stdout.write(config.preSleepLine + "\\n");
      }
      const sentinel = config.sentinelFile;
      if (sentinel) {
        fs.writeFileSync(sentinel, String(process.pid), "utf8");
      }
      // ignore SIGTERM briefly to allow process group test, but DO exit on signal
      process.on("SIGTERM", () => {
        if (config.sigtermSentinel) {
          try { fs.writeFileSync(config.sigtermSentinel, String(process.pid)); } catch {}
        }
        process.exit(143);
      });
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
      process.stdout.write("done\\n");
      process.exit(0);
      break;
    }
    default: {
      process.stderr.write("unknown fixture mode: " + config.mode + "\\n");
      process.exit(2);
    }
  }
}

main();
`;

export function installFakeCodefree(fakeBinDir) {
  if (process.platform === "win32") {
    // On Windows, spawn cannot directly execute a shebang'd extensionless file.
    // Write the fixture body as an importable .mjs and a .cmd shim that calls it
    // via node so the binary resolver can find "codefree.cmd" through PATHEXT.
    const implPath = path.join(fakeBinDir, "codefree-impl.mjs");
    fs.writeFileSync(implPath, FIXTURE_TEMPLATE, "utf8");

    const nodeBin = process.execPath.replace(/\\/g, "\\\\");
    const implEscaped = implPath.replace(/\\/g, "\\\\");
    const cmdBody = `@echo off\r\n"${nodeBin}" "${implEscaped}" %*\r\n`;
    const cmdPath = path.join(fakeBinDir, "codefree.cmd");
    fs.writeFileSync(cmdPath, cmdBody, "utf8");
    return cmdPath;
  }

  // POSIX: extensionless executable with shebang
  const binPath = path.join(fakeBinDir, "codefree");
  writeExecutable(binPath, FIXTURE_TEMPLATE);
  return binPath;
}

export function writeFixtureConfig(tempDir, config) {
  const filePath = path.join(tempDir, "fixture.json");
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
  return filePath;
}

export function makeFakeBinEnv(env, fixtureFile, recordPath = null) {
  const next = { ...env, CODEFREE_FIXTURE_FILE: fixtureFile };
  if (recordPath) {
    next.CODEFREE_FIXTURE_RECORD = recordPath;
  }
  return next;
}
