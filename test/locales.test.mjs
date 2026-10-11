import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSrc() {
  const srcDir = path.join(root, "apps/telegram/src");
  return fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => fs.readFileSync(path.join(srcDir, f), "utf8"))
    .join("\n");
}

function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

const locales = JSON.parse(
  fs.readFileSync(path.join(root, "apps/telegram/src/locales/en.json"), "utf8"),
);

function keys(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") out.push(...keys(v, key));
    else out.push(key);
  }
  return out;
}

describe("telegram locales", () => {
  it("has no unused keys", () => {
    const src = readSrc();
    const unused = keys(locales).filter((k) => !src.includes(k));
    assert.deepEqual(unused, [], `unused locale keys: ${unused.join(", ")}`);
  });

  it("every key used in source exists in en.json", () => {
    const src = readSrc();
    const used = [...src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)].map((m) => m[1]);
    const known = new Set(keys(locales));
    const missing = [...new Set(used)].filter((k) => !known.has(k));
    assert.deepEqual(missing, [], `missing locale keys: ${missing.join(", ")}`);
  });

  it("placeholders in messages are supplied by callers", () => {
    const src = readSrc();
    for (const [k, v] of Object.entries(flatten(locales))) {
      const vars = [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      if (vars.length === 0) continue;
      const supplied = vars.every((name) => new RegExp(`${name}\\s*[,:]`).test(src));
      assert.ok(supplied, `key ${k} uses {${vars.join(",")}} but no caller supplies it`);
    }
  });
});
