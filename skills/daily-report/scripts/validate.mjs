#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { validate } from "./lib/validator.mjs";

async function readInput() {
  const src = process.argv[2] ? createReadStream(process.argv[2]) : process.stdin;
  const chunks = [];
  for await (const chunk of src) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const text = await readInput();
const errors = validate(text);

if (errors.length === 0) {
  process.stdout.write("格式校验通过\n");
  process.exit(0);
} else {
  process.stdout.write("格式校验失败：\n");
  for (const e of errors) process.stdout.write(`  ${e}\n`);
  process.exit(1);
}
