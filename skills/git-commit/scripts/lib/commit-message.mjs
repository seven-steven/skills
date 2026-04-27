export const ANGULAR_TYPES = [
  "feat", "fix", "docs", "style", "refactor",
  "test", "chore", "perf", "build", "ci", "revert",
];

export const MAX_SUBJECT_LENGTH = 72;

// Permissive: allows empty subject so we can give a specific error
const HEADER_RE = /^(\w+)(?:\(([^)]+)\))?: ?(.*)$/;
const CO_AUTHORED_RE = /^co-authored-by:/i;

function normalize(text) {
  return text
    .replace(/^﻿/, "")      // strip BOM
    .replace(/\r\n/g, "\n")
    .replace(/\n+$/, "");
}

export function parseMessage(text) {
  const normalized = normalize(text);
  const parts = normalized.split(/\n\n+/);
  const subject = parts[0]?.trim() ?? "";
  const rest = parts.slice(1);
  const last = rest[rest.length - 1] ?? "";
  const trailers = last
    ? last.split("\n").filter((l) => /^\w[\w-]*: /.test(l))
    : [];
  const body = rest.length > 0 ? rest.join("\n\n") : "";
  return { subject, body, trailers };
}

export function validateMessage(text) {
  const normalized = normalize(text);
  const errors = [];

  if (!normalized.trim()) {
    return { ok: false, errors: ["subject is empty"] };
  }

  const lines = normalized.split("\n");
  const subject = lines[0];

  if (!subject.trim()) {
    errors.push("subject is empty");
    return { ok: false, errors };
  }

  if (subject.length > MAX_SUBJECT_LENGTH) {
    errors.push(
      `subject exceeds 72 characters (${subject.length})`
    );
  }

  const match = subject.match(HEADER_RE);
  if (!match) {
    errors.push('missing "<type>(<scope>): <subject>" header');
    return { ok: false, errors };
  }

  const [, type, scope, subjectPart] = match;

  if (!ANGULAR_TYPES.includes(type)) {
    errors.push(
      `unknown type "${type}"; expected one of: ${ANGULAR_TYPES.join(", ")}`
    );
  }

  if (!subjectPart || !subjectPart.trim()) {
    errors.push("subject must not be empty after the colon");
  } else {
    if (/^[A-Z]/.test(subjectPart)) {
      errors.push("subject must not start with uppercase");
    }
    if (subjectPart.endsWith(".")) {
      errors.push("subject must not end with a period");
    }
  }

  if (lines.length > 1 && lines[1].trim() !== "") {
    errors.push("body must be separated from subject by a blank line");
  }

  for (let i = 0; i < lines.length; i++) {
    if (CO_AUTHORED_RE.test(lines[i].trim())) {
      errors.push(
        `Co-Authored-By trailer is forbidden (line ${i + 1})`
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    parsed: { type, scope: scope ?? null, subject: subjectPart },
  };
}

export function formatErrorReport(errors) {
  return errors.map((e) => `  - ${e}`).join("\n") + "\n";
}
