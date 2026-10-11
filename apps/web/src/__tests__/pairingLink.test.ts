import { describe, expect, it } from "vitest";
import { buildPairingLink, stashPairCode, takePairCodeParam, takeStashedPairCode } from "../pairingLink";

describe("pairingLink", () => {
  it("builds a /chat link carrying the code", () => {
    expect(buildPairingLink("AB12-CD34")).toBe(`${window.location.origin}/chat?code=AB12-CD34`);
  });

  it("reads ?code= once and cleans the URL", () => {
    window.history.replaceState(null, "", "/chat?code=ab12-cd34");
    expect(takePairCodeParam()).toBe("AB12-CD34");
    expect(window.location.search).toBe("");
    expect(takePairCodeParam()).toBeNull();
  });

  it("consumes a malformed code too so it never re-triggers", () => {
    window.history.replaceState(null, "", "/chat?code=nope");
    expect(takePairCodeParam()).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("stashes a code across reads exactly once", () => {
    stashPairCode("AB12-CD34");
    expect(takeStashedPairCode()).toBe("AB12-CD34");
    expect(takeStashedPairCode()).toBeNull();
  });
});
