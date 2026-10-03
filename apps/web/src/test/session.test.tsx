import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider, useSession } from "../auth/session";

function Probe() {
  const { me, authLoading, logout } = useSession();
  if (authLoading) return <span data-testid="state">loading</span>;
  return (
    <div>
      <span data-testid="state">{me ? me.name ?? me.email : "anonymous"}</span>
      <button onClick={() => void logout()}>sign out</button>
    </div>
  );
}

const renderProbe = () =>
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );

describe("session", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in a loading state so the UI never flashes signed-out", () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    renderProbe();
    expect(screen.getByTestId("state")).toHaveTextContent("loading");
  });

  it("exposes the signed-in user", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1", email: "a@b.c", name: "Alice", picture: null } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("Alice"));
  });

  it("treats a failed lookup as anonymous rather than hanging on loading", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("anonymous"));
  });

  it("signs out and clears the cached user even if the call fails", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1", email: "a@b.c", name: "Alice", picture: null } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("Alice"));

    fetchMock.mockRejectedValue(new Error("offline"));
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("anonymous"));
  });

  it("requests the session with credentials", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ user: null }), { headers: { "content-type": "application/json" } }),
    );
    renderProbe();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
  });
});
