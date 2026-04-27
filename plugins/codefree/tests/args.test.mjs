import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs, splitRawArgumentString } from "../scripts/lib/args.mjs";

test("parseArgs - bare positionals", () => {
  const { options, positionals } = parseArgs(["foo", "bar baz"]);
  assert.deepEqual(options, {});
  assert.deepEqual(positionals, ["foo", "bar baz"]);
});

test("parseArgs - long boolean option", () => {
  const { options, positionals } = parseArgs(["--background", "task"], {
    booleanOptions: ["background"]
  });
  assert.equal(options.background, true);
  assert.deepEqual(positionals, ["task"]);
});

test("parseArgs - long boolean option with =false", () => {
  const { options } = parseArgs(["--background=false"], {
    booleanOptions: ["background"]
  });
  assert.equal(options.background, false);
});

test("parseArgs - value option separated by space", () => {
  const { options, positionals } = parseArgs(["--model", "qwen3-coder", "task"], {
    valueOptions: ["model"]
  });
  assert.equal(options.model, "qwen3-coder");
  assert.deepEqual(positionals, ["task"]);
});

test("parseArgs - value option using = form", () => {
  const { options } = parseArgs(["--model=qwen3-coder"], {
    valueOptions: ["model"]
  });
  assert.equal(options.model, "qwen3-coder");
});

test("parseArgs - missing value throws", () => {
  assert.throws(
    () => parseArgs(["--model"], { valueOptions: ["model"] }),
    /Missing value for --model/
  );
});

test("parseArgs - short alias maps to canonical key", () => {
  const { options, positionals } = parseArgs(["-m", "qwen", "-y", "do thing"], {
    valueOptions: ["model"],
    booleanOptions: ["yolo"],
    aliasMap: { m: "model", y: "yolo" }
  });
  assert.equal(options.model, "qwen");
  assert.equal(options.yolo, true);
  assert.deepEqual(positionals, ["do thing"]);
});

test("parseArgs - unknown long flag falls into positionals", () => {
  const { options, positionals } = parseArgs(["--unknown", "value"], {});
  assert.deepEqual(options, {});
  assert.deepEqual(positionals, ["--unknown", "value"]);
});

test("parseArgs - passthrough after --", () => {
  const { options, positionals } = parseArgs(["--background", "--", "--not-a-flag", "x"], {
    booleanOptions: ["background"]
  });
  assert.equal(options.background, true);
  assert.deepEqual(positionals, ["--not-a-flag", "x"]);
});

test("parseArgs - lone dash is positional", () => {
  const { positionals } = parseArgs(["-"]);
  assert.deepEqual(positionals, ["-"]);
});

test("splitRawArgumentString - basic whitespace split", () => {
  assert.deepEqual(splitRawArgumentString("a b c"), ["a", "b", "c"]);
});

test("splitRawArgumentString - single quotes preserve spaces", () => {
  assert.deepEqual(splitRawArgumentString("a 'b c' d"), ["a", "b c", "d"]);
});

test("splitRawArgumentString - double quotes preserve spaces", () => {
  assert.deepEqual(splitRawArgumentString('a "b c" d'), ["a", "b c", "d"]);
});

test("splitRawArgumentString - escape character keeps next char literal", () => {
  assert.deepEqual(splitRawArgumentString("a\\ b c"), ["a b", "c"]);
});

test("splitRawArgumentString - trailing escape is preserved", () => {
  assert.deepEqual(splitRawArgumentString("foo\\"), ["foo\\"]);
});

test("splitRawArgumentString - empty input yields empty array", () => {
  assert.deepEqual(splitRawArgumentString(""), []);
});
