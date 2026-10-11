import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, UNAUTHORIZED_EVENT, claimPairCode, disconnect, getConnection, mediaUrl, uploadMedia } from "../api";
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

  it("dispatches an unauthorized event on 401 so the session can drop", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "signed out" }, 401),
    );
    const seen: string[] = [];
    const listener = () => seen.push(UNAUTHORIZED_EVENT);
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    try {
      await expect(getConnection()).rejects.toMatchObject({ status: 401 });
      expect(seen).toEqual([UNAUTHORIZED_EVENT]);
    } finally {
      window.removeEventListener(UNAUTHORIZED_EVENT, listener);
    }
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
  class FakeProgressEvent {
    lengthComputable: boolean;
    loaded: number;
    total: number;
    constructor(lengthComputable: boolean, loaded: number, total: number) {
      this.lengthComputable = lengthComputable;
      this.loaded = loaded;
      this.total = total;
    }
  }

  class FakeXHR {
    static last: FakeXHR | null = null;
    upload: { onprogress: ((e: FakeProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    headers: Record<string, string> = {};
    url = "";
    status = 200;
    responseText = "";
    withCredentials = false;
    private abortListener: (() => void) | null = null;
    open(_method: string, url: string) {
      this.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v;
    }
    addEventListener(type: string, fn: () => void) {
      if (type === "abort") this.abortListener = fn;
    }
    send() {
      FakeXHR.last = this;
    }
    abort() {
      this.abortListener?.();
      this.onabort?.();
    }
    respond(status: number, body: unknown) {
      this.status = status;
      this.responseText = JSON.stringify(body);
      this.onload?.();
    }
    progress(loaded: number, total: number) {
      this.upload.onprogress?.(new FakeProgressEvent(true, loaded, total));
    }
  }

  let realXHR: typeof XMLHttpRequest;
  beforeEach(() => {
    realXHR = globalThis.XMLHttpRequest;
    FakeXHR.last = null;
    (globalThis as Record<string, unknown>).XMLHttpRequest = FakeXHR;
  });
  afterEach(() => {
    globalThis.XMLHttpRequest = realXHR;
    vi.restoreAllMocks();
  });

  function start(
    file = new File(["x"], "a.png", { type: "image/png" }),
    conn = "conn-1",
    caption?: string,
    opts?: { signal?: AbortSignal; onProgress?: (r: number) => void },
  ) {
    const done = uploadMedia(file, conn, caption, opts);
    const xhr = FakeXHR.last;
    if (!xhr) throw new Error("upload did not create an XHR");
    return { done, xhr };
  }

  it("percent-encodes the filename header for the server to decode", async () => {
    const { done, xhr } = start(new File(["x"], "my photo.png", { type: "image/png" }));
    expect(xhr.headers["X-Filename"]).toBe("my%20photo.png");
    expect(xhr.headers["Content-Type"]).toBe("image/png");
    expect(xhr.withCredentials).toBe(true);
    xhr.respond(200, { message: { id: "m1" } });
    await expect(done).resolves.toMatchObject({ message: { id: "m1" } });
  });

  it("sends a caption when provided", async () => {
    const { done, xhr } = start(new File(["x"], "a.png", { type: "image/png" }), "conn-1", "hello");
    expect(xhr.headers["X-Caption"]).toBe("hello");
    xhr.respond(200, { message: { id: "m1" } });
    await done;
  });

  it("omits the caption header when empty", async () => {
    const { done, xhr } = start(new File(["x"], "a.png", { type: "image/png" }), "conn-1", "");
    expect(xhr.headers["X-Caption"]).toBeUndefined();
    xhr.respond(200, { message: { id: "m1" } });
    await done;
  });

  it("encodes the connection id in the query", async () => {
    const { done, xhr } = start(new File(["x"], "a.png", { type: "image/png" }), "a b/c");
    expect(xhr.url).toBe("/api/media/upload?connectionId=a%20b%2Fc");
    xhr.respond(200, { message: { id: "m1" } });
    await done;
  });

  it("reports server rejections as ApiError", async () => {
    const { done } = start(new File(["x"], "a.svg", { type: "image/svg+xml" }), "c");
    FakeXHR.last?.respond(415, { error: "unsupported media type" });
    await expect(done).rejects.toMatchObject({ status: 415, message: "unsupported media type" });
  });

  it("dispatches an unauthorized event on 401", async () => {
    const { done } = start();
    const seen: string[] = [];
    const listener = () => seen.push(UNAUTHORIZED_EVENT);
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    try {
      FakeXHR.last?.respond(401, { error: "signed out" });
      await expect(done).rejects.toMatchObject({ status: 401 });
      expect(seen).toEqual([UNAUTHORIZED_EVENT]);
    } finally {
      window.removeEventListener(UNAUTHORIZED_EVENT, listener);
    }
  });

  it("reports upload progress as a ratio", async () => {
    const ratios: number[] = [];
    const { done, xhr } = start(new File(["x"], "a.png", { type: "image/png" }), "c", undefined, {
      onProgress: (r) => ratios.push(r),
    });
    xhr.progress(25, 100);
    xhr.progress(100, 100);
    xhr.respond(200, { message: { id: "m1" } });
    await done;
    expect(ratios).toEqual([0.25, 1]);
  });

  it("rejects with AbortError when the signal aborts", async () => {
    const ctrl = new AbortController();
    const { done } = start(new File(["x"], "a.png", { type: "image/png" }), "c", undefined, { signal: ctrl.signal });
    ctrl.abort();
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
  });
});
