import { beforeEach, describe, expect, it } from "vitest";
import { getPathname, navigate } from "../router";

describe("router", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("normalizes the root path", () => {
    expect(getPathname()).toBe("/");
    window.history.replaceState(null, "", "/?utm=x");
    expect(getPathname()).toBe("/");
  });

  it("keeps trailing slashes and subpaths out of the chat route", () => {
    window.history.replaceState(null, "", "/chat/");
    expect(getPathname()).toBe("/chat");
    window.history.replaceState(null, "", "/chat/room/42");
    expect(getPathname()).toBe("/chat");
  });

  it("drops query strings and hashes from unknown routes", () => {
    window.history.replaceState(null, "", "/nope?x=1#frag");
    expect(getPathname()).toBe("/nope");
  });

  it("pushed navigation emits popstate so listeners update", () => {
    let seen: string | null = null;
    const onPop = () => { seen = getPathname(); };
    window.addEventListener("popstate", onPop);
    navigate("/chat");
    expect(seen).toBe("/chat");
    expect(window.location.pathname).toBe("/chat");
    window.removeEventListener("popstate", onPop);
  });

  it("does not push a duplicate entry for the current path", () => {
    navigate("/chat");
    const before = window.history.length;
    navigate("/chat");
    expect(window.history.length).toBe(before);
  });

  it("normalizes the target before navigating", () => {
    navigate("/chat/");
    expect(window.location.pathname).toBe("/chat");
  });
});
