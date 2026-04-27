import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "../scripts/lib/validator.mjs";

test("validator - accepts two-segment line", () => {
  assert.deepEqual(validate("- ProjectA-完成功能开发；"), []);
});

test("validator - accepts three-segment line", () => {
  assert.deepEqual(validate("- ProjectA-用户模块-完成登录功能；"), []);
});

test("validator - accepts multi-line valid input", () => {
  const input = "- ProjectA-完成功能开发；\n- ProjectB-后端模块-修复接口BUG；";
  assert.deepEqual(validate(input), []);
});

test("validator - rejects empty input", () => {
  const errors = validate("");
  assert.ok(errors.length > 0);
  assert.ok(errors[0].includes("输出不能为空"));
});

test("validator - ignores trailing blank lines", () => {
  assert.deepEqual(validate("- ProjectA-完成功能开发；\n\n   \n"), []);
});

test("validator - preserves work content with internal hyphens as third segment", () => {
  assert.deepEqual(validate("- ProjectA-Module-fix-the-bug；"), []);
});

test("validator - accepts Unicode and Chinese project names", () => {
  assert.deepEqual(validate("- 数字地球-GIS模块-接入图层；"), []);
});

test("validator - flags missing '- ' prefix", () => {
  const errors = validate("ProjectA-完成功能；");
  assert.ok(errors.some((e) => e.includes("- ")));
});

test("validator - flags missing '；' suffix", () => {
  const errors = validate("- ProjectA-完成功能");
  assert.ok(errors.some((e) => e.includes("；")));
});

test("validator - flags CRLF line endings", () => {
  const errors = validate("- ProjectA-完成功能；\r\n");
  assert.ok(errors.some((e) => e.includes("\\r")));
});
