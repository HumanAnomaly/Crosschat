// The server must refuse to start on placeholder values.
// These run without booting the server.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const { auditSecretValue, assertSecretsUsable } = await load("apps/realtime/dist/secrets.js");

describe("placeholder detection", () => {
  // Kept as a regression guard: the string itself is the denylisted value, not
  // sample copy, so it must stay byte-identical to the old template.
  it("rejects the legacy non-English template placeholder", () => {
    const r = auditSecretValue("SESSION_SECRET", "ganti-dengan-string-acak-panjang");
    assert.equal(r.ok, false);
  });

  it("rejects obvious placeholders", () => {
    for (const v of ["change-me", "secret123", "password", "placeholder-abc"]) {
      assert.equal(auditSecretValue("SESSION_SECRET", v).ok, false, `${v} should be rejected`);
    }
  });

  it("rejects a single repeated character", () => {
    const r = auditSecretValue("SESSION_SECRET", "a".repeat(64));
    assert.equal(r.ok, false);
    assert.match(r.problems[0], /repeated character/i);
  });

  it("treats an empty value as absent, not as a failure", () => {
    // Presence is decided by the caller's production-mode check.
    assert.equal(auditSecretValue("SESSION_SECRET", "").ok, true);
    assert.equal(auditSecretValue("SESSION_SECRET", "   ").ok, true);
  });

  it("warns but does not fail on a short value", () => {
    const r = auditSecretValue("SESSION_SECRET", "abc123");
    assert.equal(r.ok, true);
    assert.equal(r.warnings.length, 1);
  });
});

describe("assertSecretsUsable", () => {
  it("passes a healthy configuration", () => {
    assertSecretsUsable({
      SESSION_SECRET: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      TELEGRAM_WEBHOOK_SECRET: "f0e1d2c3b4a5968778695a4b3c2d1e0f",
      GOOGLE_CLIENT_SECRET: "GOCSPX-brandnewsecretvalue_1234567890ab",
      TELEGRAM_BOT_TOKEN: "111111:AAHsomefreshlymintedtoken_abcdefghijk",
    });
  });

  it("collects every problem instead of failing on the first", () => {
    let message = "";
    try {
      assertSecretsUsable({
        SESSION_SECRET: "change-me-now",
        TELEGRAM_BOT_TOKEN: "z".repeat(46),
      });
    } catch (e) {
      message = e.message;
    }
    assert.match(message, /SESSION_SECRET/);
    assert.match(message, /TELEGRAM_BOT_TOKEN/);
    assert.match(message, /Refusing to start/);
  });

  it("accepts an empty set so tests can boot without credentials", () => {
    assertSecretsUsable({});
  });
});
