import { spawnSync } from "node:child_process";
import os from "node:os";

export function getClipboardCandidates({
  platform = process.platform,
  release = os.release(),
  env = process.env,
} = {}) {
  if (platform === "darwin") return [{ cmd: "pbcopy", args: [] }];
  if (platform === "win32") return [{ cmd: "clip", args: [] }];
  // linux & other Unix
  const out = [];
  const isWSL = Boolean(env.WSL_DISTRO_NAME) || /microsoft/i.test(release);
  if (isWSL) out.push({ cmd: "clip.exe", args: [] });
  if (env.WAYLAND_DISPLAY) out.push({ cmd: "wl-copy", args: [] });
  out.push({ cmd: "xclip", args: ["-selection", "clipboard"] });
  out.push({ cmd: "xsel", args: ["--clipboard", "--input"] });
  // deduplicate by cmd+args key
  const seen = new Set();
  return out.filter((c) => {
    const k = c.cmd + "\0" + c.args.join("\0");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function copyToClipboard(text, opts = {}) {
  if (text == null || text.replace(/\s/g, "") === "") {
    return { ok: false, reason: "empty-input", tried: [] };
  }
  const spawn = opts.spawn ?? spawnSync;
  const candidates = getClipboardCandidates(opts);
  const tried = [];
  for (const { cmd, args } of candidates) {
    // wl-copy and xclip fork a background daemon that holds the clipboard
    // contents; if spawnSync inherits stdout/stderr, it waits for the daemon
    // to close them and times out. Redirect both to "ignore" so spawnSync
    // returns as soon as the parent process exits.
    const r = spawn(cmd, args, {
      input: text,
      encoding: "utf8",
      timeout: opts.timeout ?? 5000,
      stdio: ["pipe", "ignore", "ignore"],
    });
    if (r.error?.code === "ENOENT") { tried.push(`${cmd}(missing)`); continue; }
    if (r.error?.code === "ETIMEDOUT") { tried.push(`${cmd}(timeout)`); continue; }
    if (r.error) { tried.push(`${cmd}(${r.error.code || "error"})`); continue; }
    if (r.status === 0) return { ok: true, tool: cmd, tried };
    tried.push(`${cmd}(exit=${r.status})`);
  }
  const allMissing = tried.length > 0 && tried.every((t) => t.endsWith("(missing)"));
  return { ok: false, reason: allMissing ? "no-tool-found" : "all-tools-failed", tried };
}
