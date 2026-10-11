import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("socket.io-client", () => ({
  io: vi.fn(),
}));

async function loadSocket(emit: (...args: never[]) => void) {
  vi.resetModules();
  const { io } = await import("socket.io-client");
  vi.mocked(io).mockReturnValue({ emit } as never);
  return import("../socket");
}

describe("sendAnonText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("resolves {ok:false} when the ack never arrives", async () => {
    const { sendAnonText } = await loadSocket(() => {});
    const p = sendAnonText("hi", 5000);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toEqual({ ok: false });
  });

  it("resolves the server ack and ignores the late timeout", async () => {
    const { sendAnonText } = await loadSocket((_ev, _body, ack: (r: unknown) => void) =>
      ack({ ok: true, message: { id: "m1" } }),
    );
    await expect(sendAnonText("hi", 5000)).resolves.toEqual({ ok: true, message: { id: "m1" } });
    await vi.advanceTimersByTimeAsync(5000);
  });
});
