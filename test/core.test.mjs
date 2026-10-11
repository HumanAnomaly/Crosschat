import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  makePairingCode,
  normalizeTelegramUsername,
  pairingCodeSchema,
  parsePairingCode,
  safeFilename,
} from "../packages/core/dist/index.js";

describe("pairing codes", () => {
  it("generates canonical XXXX-XXXX codes", () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const code = makePairingCode();
      assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      assert.ok(pairingCodeSchema.safeParse(code).success);
      seen.add(code);
    }
    assert.ok(seen.size > 190, "codes should be unique");
  });

  it("parses variants into canonical form", () => {
    assert.equal(parsePairingCode("ab12-cd34"), "AB12-CD34");
    assert.equal(parsePairingCode("ab12cd34"), "AB12-CD34");
    assert.equal(parsePairingCode("  ab12 cd34 "), "AB12-CD34");
    assert.equal(parsePairingCode("short"), null);
    assert.equal(parsePairingCode("!!!!"), null);
    assert.equal(parsePairingCode(123), null);
  });
});

describe("telegram usernames", () => {
  it("normalizes and rejects bad input", () => {
    assert.equal(normalizeTelegramUsername("@alice_1"), "alice_1");
    assert.equal(normalizeTelegramUsername("  bob "), "bob");
    assert.equal(normalizeTelegramUsername("not valid!"), null);
    assert.equal(normalizeTelegramUsername(42), null);
  });
});

describe("safeFilename", () => {
  it("strips paths and traversal", () => {
    assert.equal(safeFilename("../../.env"), ".env");
    assert.equal(safeFilename("a/b\\c.pdf"), "c.pdf");
    assert.equal(safeFilename(""), "file");
    assert.ok(!safeFilename("../x").includes(".."));
  });
});
