// The platform registry must stay generic: no platform is privileged, and the
// web must render whatever the registry lists rather than a hardcoded name.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const registrySrc = fs.readFileSync(path.join(root, "packages/core/src/platforms.ts"), "utf8");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (["node_modules", "dist", ".turbo"].includes(e.name)) continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const webFiles = [
  ...walk("apps/web/src"),
  "packages/core/src/platforms.ts",
].filter((f) => !f.includes("__tests__") && !f.includes("/test/"));

describe("platform registry shape", () => {
  it("declares every field the UI reads", () => {
    for (const field of [
      "id:", "label:", "brandColor:", "icon:", "entryUrl:", "entryLabel:", "steps:", "note:",
    ]) {
      assert.ok(registrySrc.includes(field), `registry entry missing ${field}`);
    }
  });

  it("points telegram at the real bot handle", () => {
    assert.ok(registrySrc.includes("@trycrosschat_bot"), "entryLabel must be the bot handle");
    assert.ok(registrySrc.includes("t.me/trycrosschat_bot"), "entryUrl must deep-link the bot");
  });

  it("tells the user to press Start, then Wired or New code", () => {
    assert.match(registrySrc, /Press Start/i);
    assert.match(registrySrc, /Wired/i);
    assert.match(registrySrc, /New code/i);
  });

  it("has no default or featured platform", () => {
    assert.ok(!/default\s*:/i.test(registrySrc), "no platform may be marked as the default");
    assert.ok(!/featured\s*:/i.test(registrySrc), "no platform may be flagged as featured");
  });
});

describe("web renders platforms from the registry", () => {
  it("components do not hardcode a platform name in user-visible copy", () => {
    const offenders = [];
    for (const f of webFiles) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      // Registry data and test/registry files are allowed to name a platform.
      if (f.endsWith("platforms.ts")) continue;
      for (const m of src.matchAll(/[>"]([^"<>{}\n]*\bTelegram\b[^"<>{}\n]*)[>"]/g)) {
        const text = m[1];
        if (text.includes("@") || text.includes("t.me/")) continue;
        offenders.push(`${f}: ${text.trim()}`);
      }
    }
    assert.deepEqual(offenders, [], `hardcoded platform copy: ${offenders.join(" | ")}`);
  });

  it("the rail iterates the registry instead of a fixed list", () => {
    const rail = fs.readFileSync(path.join(root, "apps/web/src/components/PlatformRail.tsx"), "utf8");
    assert.ok(rail.includes("PLATFORMS"), "rail must render from PLATFORMS");
    assert.ok(/PLATFORMS\.map/.test(rail) || (/platforms\.map/.test(rail) && /=\s*PLATFORMS/.test(rail)), "rail must map over the registry (or a prop defaulting to it)");
    assert.ok(!/platforms\[[0-9]\]/.test(rail), "rail must not index a fixed position");
  });

  it("the icon component resolves from a map with a fallback", () => {
    const icon = fs.readFileSync(path.join(root, "apps/web/src/components/PlatformIcon.tsx"), "utf8");
    assert.ok(/Record<string,/.test(icon), "icons must come from a keyed map");
    // Any unknown icon key must degrade to a neutral glyph, not render broken.
    assert.match(icon, /if \(!Brand\)/, "unknown icon keys need an explicit fallback branch");
  });

  it("a connection payload carries a platform id", () => {
    const schema = fs.readFileSync(path.join(root, "packages/core/src/index.ts"), "utf8");
    assert.ok(/platformId: z\.string\(\)/.test(schema), "connectionSchema must require platformId");
  });
});
