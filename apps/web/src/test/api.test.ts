import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, claimPairCode, disconnect, getConnection, mediaUrl, uploadMedia } from "../api";
import type { ChatMessage } from "@crosschat/core";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("mediaUrl", () => {
  const base: ChatMessage = {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    connectionId: "c",
    sender: "web",
    kind: "photo",
    createdAt: new Date().toISOString(),
  };

  it("uses the backend contract unchanged", () => {
    expect(mediaUrl({ ...base, mediaPath: `/media/${base.id}` })).toBe(`/media/${base.id}`);
  });

  it("derives the url from the id when mediaPath is absent", () => {
    expect(mediaUrl(base)).toBe(`/media/${base.id}`);
  });

  it("does not guess paths out of a stale relative value", () => {
    // Windows separators and relative paths used to produce broken urls.
    expect(mediaUrl({ ...base, mediaPath: "conn\\file.png" })).toBe(`/media/${base.id}`);
  });
});

describe("api error handling", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces the backend error message", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "code expired or not found" }, 404),
    );
    await expect(claimPairCode("AB12-CD34")).rejects.toMatchObject({
      status: 404,
      message: "code expired or not found",
    });
  });

  it("falls back to a status message when the body is not JSON", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("<html>Gateway</html>", { status: 502 }),
    );
    await expect(getConnection()).rejects.toMatchObject({
      status: 502,
      message: "Request failed (502)",
    });
  });

  it("throws ApiError instances so callers can branch on status", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ error: "nope" }, 403));
    await expect(getConnection()).rejects.toBeInstanceOf(ApiError);
  });

  it("returns undefined for a 204 no-content response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 204 }));
    await expect(disconnect()).resolves.toBeUndefined();
  });
});

describe("getConnection", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests a bounded page", async () => {
    const spy = globalThis.fetch as ReturnType<typeof vi.fn>;
    spy.mockResolvedValue(jsonResponse({ connection: null, messages: [] }));
    await getConnection(25);
    expect(spy.mock.calls[0][0]).toBe("/api/connection?limit=25");
  });

  it("sends credentials so the session cookie is included", async () => {
    const spy = globalThis.fetch as ReturnType<typeof vi.fn>;
    spy.mockResolvedValue(jsonResponse({ connection: null, messages: [] }));
    await getConnection();
    expect(spy.mock.calls[0][1].credentials).toBe("include");
  });
});

describe("uploadMedia", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("percent-encodes the filename header for the server to decode", async () => {
    const spy = globalThis.fetch as ReturnType<typeof vi.fn>;
    spy.mockResolvedValue(jsonResponse({ message: { id: "m1" } }));
    const file = new File(["x"], "my photo.png", { type: "image/png" });
    await uploadMedia(file, "conn-1");
    const headers = spy.mock.calls[0][1].headers;
    expect(headers["X-Filename"]).toBe("my%20photo.png");
    expect(headers["Content-Type"]).toBe("image/png");
  });

  it("sends a caption when provided", async () => {
    const spy = globalThis.fetch as ReturnType<typeof vi.fn>;
    spy.mockResolvedValue(jsonResponse({ message: { id: "m1" } }));
    const file = new File(["x"], "a.png", { type: "image/png" });
    await uploadMedia(file, "conn-1", "hello");
    expect(spy.mock.calls[0][1].headers["X-Caption"]).toBe("hello");
  });

  it("omits the caption header when empty", async () => {
    const spy = globalThis.fetch as ReturnType<typeof vi.fn>;
    spy.mockResolvedValue(jsonResponse({ message: { id: "m1" } }));
    const file = new File(["x"], "a.png", { type: "image/png" });
    await uploadMedia(file, "conn-1", "");
    expect(spy.mock.calls[0][1].headers["X-Caption"]).toBeUndefined();
  });

  it("encodes the connection id in the query", async () => {
    const spy = globalThis.fetch as ReturnType<typeof vi.fn>;
    spy.mockResolvedValue(jsonResponse({ message: { id: "m1" } }));
    await uploadMedia(new File(["x"], "a.png", { type: "image/png" }), "a b/c");
    expect(spy.mock.calls[0][0]).toBe("/api/media/upload?connectionId=a%20b%2Fc");
  });

  it("reports server rejections as ApiError", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "unsupported media type" }, 415),
    );
    await expect(uploadMedia(new File(["x"], "a.svg", { type: "image/svg+xml" }), "c")).rejects.toMatchObject({
      status: 415,
      message: "unsupported media type",
    });
  });
});
