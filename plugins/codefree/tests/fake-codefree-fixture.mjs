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
 *       grandchild: { scriptFile },  // spawn a SIGTERM-immune grandchild
 *       serve: {                  // argv[0] === "serve" mode: real local HTTP server
 *         stallMs:      0,        // prompt_async → messages-ready delay (cold start sim)
 *         neverReady:  false,     // keep status busy forever (timeout test)
 *         messages:    [ ... ],   // GET message response once ready
 *         sessions:    [ "ses_a", ... ],   // GET /session list (newest first)
 *         permissions: [ { id: "per_1", permission: "read", patterns: ["x.env"] } ],
 *         questions:   [ { id: "que_1", questions: [ { question: "color?" } ] } ],
 *         rejectQuestionFails: false,   // POST /question/:id/reject → 500
 *         promptFile:  "..."      // where to append each received prompt body
 *       }
 *     }
 */

import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import process from "node:process";

export function runFakeBin() {
  const recordPath = process.env.CODEFREE_FAKE_RECORD;
  const scenarioPath = process.env.CODEFREE_FAKE_SCENARIO;

  if (recordPath) {
    fs.writeFileSync(
      recordPath,
      JSON.stringify(
        {
          argv: process.argv.slice(2),
          cwd: process.cwd(),
          proxy: {
            HTTP_PROXY: process.env.HTTP_PROXY ?? null,
            HTTPS_PROXY: process.env.HTTPS_PROXY ?? null,
            ALL_PROXY: process.env.ALL_PROXY ?? null,
            NO_PROXY: process.env.NO_PROXY ?? null
          }
        },
        null,
        2
      ),
      "utf8"
    );
  }

  const scenario = scenarioPath
    ? JSON.parse(fs.readFileSync(scenarioPath, "utf8"))
    : { events: [], exitCode: 0 };

  if (process.argv[2] === "serve") {
    runFakeServe(scenario);
    return;
  }

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

/**
 * argv[0] === "serve" mode: a real local HTTP server speaking the subset of
 * the codefree-o serve API the companion drives (see scripts/lib/serve-client.mjs
 * for the contract). State machine: POST prompt_async starts a stallMs timer;
 * once elapsed (unless neverReady) the session's messages become visible and
 * its status flips busy → idle. Permission/question requests clear when the
 * companion replies/rejects (or linger when the endpoint is told to fail).
 */
function runFakeServe(scenario) {
  const config = scenario.serve ?? {};
  const portIndex = process.argv.indexOf("--port");
  const requestedPort = portIndex !== -1 ? Number(process.argv[portIndex + 1]) : 0;

  let ready = false;
  const permissions = new Map((config.permissions ?? []).map((p) => [p.id, p]));
  const questions = new Map((config.questions ?? []).map((q) => [q.id, q]));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const route = `${req.method} ${url.pathname}`;
    const sendJson = (status, value) => {
      const body = value === undefined ? "" : JSON.stringify(value);
      res.writeHead(status, body ? { "content-type": "application/json" } : {});
      res.end(body);
    };

    if (route === "POST /session") {
      readBody(req, (body) => sendJson(200, { id: "ses_fake_serve", ...body }));
      return;
    }
    if (route === "GET /session") {
      sendJson(200, (config.sessions ?? ["ses_fake_serve"]).map((id) => ({ id })));
      return;
    }
    if (url.pathname.startsWith("/session/") && url.pathname.endsWith("/prompt_async") && req.method === "POST") {
      readBody(req, (body) => {
        if (config.promptFile) {
          fs.appendFileSync(config.promptFile, JSON.stringify(body) + "\n", "utf8");
        }
        const stall = config.stallMs ?? 0;
        if (config.neverReady) {
          // Busy forever — exercises the companion's timeout path.
        } else if (stall > 0) {
          setTimeout(() => {
            ready = true;
          }, stall);
        } else {
          ready = true;
        }
        sendJson(204);
      });
      return;
    }
    const messageMatch = req.method === "GET" && url.pathname.match(/^\/session\/([^/]+)\/message$/);
    if (messageMatch) {
      sendJson(200, ready ? (config.messages ?? []) : []);
      return;
    }
    if (route === "GET /session/status") {
      // 对齐真实 v1.7.0 行为：运行中 {"ses":{"type":"busy"}}；完成后该会话
      // 条目被直接移除（返回 {}），而不是置 "idle"。
      if (config.neverReady || !ready) {
        sendJson(200, { ses_fake_serve: { type: "busy" } });
      } else {
        sendJson(200, {});
      }
      return;
    }
    if (route === "GET /permission") {
      sendJson(200, [...permissions.values()]);
      return;
    }
    const permissionReply = req.method === "POST" && url.pathname.match(/^\/permission\/([^/]+)\/reply$/);
    if (permissionReply) {
      readBody(req, (body) => {
        const id = decodeURIComponent(url.pathname.split("/")[2]);
        if (config.permissionReplyFails) {
          sendJson(500, { error: "boom" });
          return;
        }
        permissions.delete(id);
        if (config.permissionReplyFile) {
          fs.appendFileSync(config.permissionReplyFile, `${id} ${JSON.stringify(body)}\n`, "utf8");
        }
        sendJson(200, true);
      });
      return;
    }
    if (route === "GET /question") {
      sendJson(200, [...questions.values()]);
      return;
    }
    const questionReject = req.method === "POST" && url.pathname.match(/^\/question\/([^/]+)\/reject$/);
    if (questionReject) {
      const id = decodeURIComponent(url.pathname.split("/")[2]);
      if (config.rejectQuestionFails) {
        sendJson(500, { error: "boom" });
        return;
      }
      questions.delete(id);
      if (config.questionRejectFile) {
        fs.appendFileSync(config.questionRejectFile, `${id}\n`, "utf8");
      }
      sendJson(200, true);
      return;
    }
    const abort = req.method === "POST" && url.pathname.match(/^\/session\/([^/]+)\/abort$/);
    if (abort) {
      if (config.abortFile) {
        fs.appendFileSync(config.abortFile, `${decodeURIComponent(url.pathname.split("/")[2])}\n`, "utf8");
      }
      sendJson(200, true);
      return;
    }
    sendJson(404, { error: `unmatched route ${route}` });
  });

  server.listen(requestedPort, "127.0.0.1", () => {
    const { port } = server.address();
    process.stdout.write(`codefree-o server listening on http://127.0.0.1:${port}\n`);
  });

  // Serve until killed; the companion's process-tree SIGTERM/SIGKILL ends us.
  setInterval(() => {}, 60_000);
}

function readBody(req, consume) {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    consume(raw ? JSON.parse(raw) : {});
  });
}
