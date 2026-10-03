// Static hygiene checks: catches the dead-code and leftover-debug patterns that
// a linter would not flag (unused React context fields, stray console.log in
// app code, stale comments referencing removed things).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".turbo") continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|mjs)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const appFiles = [
  ...walk("apps"),
  ...walk("packages"),
].filter((f) => !f.includes("test") && !f.includes("scripts"));

describe("no leftover debug code", () => {
  it("app code has no console.log", () => {
    const offenders = appFiles.filter((f) => /console\.log\(/.test(read(f)));
    assert.deepEqual(offenders, [], `console.log in: ${offenders.join(", ")}`);
  });

  it("console.warn is only used where a swallowed error is reported", () => {
    // A warning that is not attached to a caught error is noise, not signal.
    const offenders = [];
    for (const f of appFiles) {
      const src = read(f);
      if (!/console\.warn\(/.test(src)) continue;
      if (!/catch\s*(\([^)]*\))?\s*\{[^}]*console\.warn\(/.test(src)) offenders.push(f);
    }
    assert.deepEqual(offenders, [], `unexplained console.warn in: ${offenders.join(", ")}`);
  });
});

describe("no TODO/FIXME/HACK left in app code", () => {
  it("clean", () => {
    const offenders = [];
    for (const f of appFiles) {
      const src = read(f);
      if (/\b(TODO|FIXME|HACK|XXX)\b/.test(src)) offenders.push(f);
    }
    assert.deepEqual(offenders, [], `markers in: ${offenders.join(", ")}`);
  });
});

describe("no swallowed errors in app code", () => {
  it("every catch block either logs or has an explanatory comment", () => {
    const offenders = [];
    for (const f of appFiles) {
      const src = read(f);
      // catch { } with an empty body and no comment = silently swallowed
      const re = /catch\s*(\([^)]*\))?\s*\{\s*\}/g;
      let m;
      while ((m = re.exec(src)) !== null) offenders.push(`${f}:${src.slice(0, m.index).split("\n").length}`);
    }
    assert.deepEqual(offenders, [], `empty catch blocks: ${offenders.join(", ")}`);
  });
});

describe("no unused context fields", () => {
  it("session context exposes only consumed fields", () => {
    const provider = read("apps/web/src/auth/session.tsx");
    const value = provider.match(/value=\{\{([^}]*)\}\}/)?.[1] ?? "";
    const exposed = value.split(",").map((s) => s.trim().split(":")[0]).filter(Boolean);
    const consumers = appFiles
      .filter((f) => !f.endsWith("auth\\session.tsx") && !f.endsWith("auth/session.tsx") && /useSession\(\)/.test(read(f)))
      .map((f) => read(f))
      .join("\n");
    for (const field of exposed) {
      assert.ok(
        new RegExp(`\\b${field}\\b`).test(consumers),
        `session context exposes "${field}" but no consumer destructures it`,
      );
    }
  });
});

describe("web components are all reachable", () => {
  it("every exported component is imported somewhere", () => {
    const compDir = "apps/web/src/components";
    const files = fs.readdirSync(path.join(root, compDir)).filter((f) => f.endsWith(".tsx"));
    const allSrc = appFiles.map((f) => read(f)).join("\n");
    for (const f of files) {
      const mod = f.replace(/\.tsx$/, "");
      const used = new RegExp(`["']\\.\\.?/[^"']*${mod}["']`).test(allSrc);
      assert.ok(used, `${f} is never imported (dead component)`);
    }
  });
});

describe("secret handling", () => {
  it("no hardcoded secret fallbacks that look real", () => {
    const src = read("apps/realtime/src/env.ts");
    assert.ok(!/sessionSecret:\s*process\.env\.SESSION_SECRET\s*\?\?\s*"[a-z]/.test(src),
      "SESSION_SECRET must not have a plaintext fallback");
  });

  it("env example ships empty secrets", () => {
    const example = read(".env.example");
    const leaked = example
      .split("\n")
      .filter((l) => /^(SESSION_SECRET|TELEGRAM_WEBHOOK_SECRET|GOOGLE_CLIENT_SECRET|TELEGRAM_BOT_TOKEN)=.+/.test(l));
    assert.deepEqual(leaked, [], `secrets must be blank in .env.example: ${leaked.join(" | ")}`);
  });
});
