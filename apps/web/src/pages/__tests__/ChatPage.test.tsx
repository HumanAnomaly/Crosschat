import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, Connection } from "@crosschat/core";
import ChatPage from "../ChatPage";
import { SessionProvider } from "../../auth/session";
import { ThemeProvider } from "../../theme";
import * as api from "../../api";
import * as socket from "../../socket";

const connection: Connection = {
  id: "22222222-2222-2222-2222-222222222222",
  userId: "u1",
  platformId: "telegram",
  telegramChatId: "chat-1",
  createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
};

function msg(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    connectionId: connection.id,
    sender: "web",
    kind: "text",
    text: "hello",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function renderPage() {
  return render(
    <SessionProvider>
      <ThemeProvider>
        <ChatPage />
      </ThemeProvider>
    </SessionProvider>,
  );
}

describe("ChatPage", () => {
  beforeEach(() => {
    vi.spyOn(socket, "getSocket").mockReturnValue({} as never);
    vi.spyOn(socket, "connectSession").mockReturnValue({} as never);
    vi.spyOn(socket, "disconnectSocket").mockReturnValue(undefined);
    vi.spyOn(socket, "leaveChat").mockReturnValue(undefined);
    vi.spyOn(socket, "joinChat").mockReturnValue({} as never);
    vi.spyOn(socket, "sendText").mockResolvedValue(msg({ text: "sent" }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects anonymous visitors to the landing page", async () => {
    window.history.pushState(null, "", "/chat");
    vi.spyOn(api, "getMe").mockResolvedValue({ user: null });
    renderPage();
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(screen.queryByText(/sign in to open your chat/i)).not.toBeInTheDocument();
    window.history.pushState(null, "", "/");
  });

  it("prompts pairing when there is no connection yet", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.c", name: "Alice", picture: null },
    });
    vi.spyOn(api, "getConnection").mockResolvedValue({ connection: null, messages: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText(/link a platform to start chatting/i)).toBeInTheDocument());
  });

  it("renders history once connected", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.c", name: "Alice", picture: null },
    });
    vi.spyOn(api, "getConnection").mockResolvedValue({ connection, messages: [msg()] });
    renderPage();
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });

  it("offers a retry when loading fails", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.c", name: "Alice", picture: null },
    });
    const getConnection = vi
      .spyOn(api, "getConnection")
      .mockRejectedValueOnce(new api.ApiError(500, "boom"))
      .mockResolvedValueOnce({ connection, messages: [msg()] });
    renderPage();
    await waitFor(() => expect(screen.getByText(/couldn’t load the conversation/i)).toBeInTheDocument());
    expect(screen.getByText("boom")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());
    expect(getConnection).toHaveBeenCalledTimes(2);
  });

  it("generates a code and shows the countdown", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.c", name: "Alice", picture: null },
    });
    vi.spyOn(api, "getConnection").mockResolvedValue({ connection: null, messages: [] });
    vi.spyOn(api, "generatePairCode").mockResolvedValue({
      code: "AB12-CD34",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    renderPage();
    // The action appears both in the empty state and the pairing panel.
    const buttons = await screen.findAllByRole("button", { name: /generate code/i });
    await userEvent.click(buttons[0]);
    await waitFor(() => expect(screen.getAllByText("AB12-CD34").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/expires in 0[45]:\d\d/i).length).toBeGreaterThan(0);
  });

  it("rejects a malformed code before calling the server", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.c", name: "Alice", picture: null },
    });
    vi.spyOn(api, "getConnection").mockResolvedValue({ connection: null, messages: [] });
    const claim = vi.spyOn(api, "claimPairCode");
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /enter code/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /enter code/i }));
    await userEvent.type(screen.getByLabelText(/pairing code/i), "nope");
    await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    expect(claim).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/looks short/i);
  });

  it("accepts a loosely formatted code and normalizes it", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.c", name: "Alice", picture: null },
    });
    vi.spyOn(api, "getConnection").mockResolvedValue({ connection: null, messages: [] });
    const claim = vi.spyOn(api, "claimPairCode").mockResolvedValue({ connection });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /enter code/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /enter code/i }));
    await userEvent.type(screen.getByLabelText(/pairing code/i), "ab12cd34");
    await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => expect(claim).toHaveBeenCalledWith("AB12-CD34"));
  });

  it("appends a sent message and clears the draft", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.c", name: "Alice", picture: null },
    });
    vi.spyOn(api, "getConnection").mockResolvedValue({ connection, messages: [] });
    renderPage();
    const input = await screen.findByLabelText(/write a message/i);

    await userEvent.type(input, "sent{Enter}");
    await waitFor(() => expect(screen.getByText("sent")).toBeInTheDocument());
    expect(input).toHaveValue("");
  });

  it("marks a failed send on the bubble and retries it", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.c", name: "Alice", picture: null },
    });
    vi.spyOn(api, "getConnection").mockResolvedValue({ connection, messages: [] });
    const send = vi.spyOn(socket, "sendText").mockRejectedValue(new Error("nope"));
    renderPage();
    const input = await screen.findByLabelText(/write a message/i);

    await userEvent.type(input, "will fail{Enter}");
    const retry = await screen.findByRole("button", { name: /retry sending/i });
    expect(retry).toBeInTheDocument();
    expect(screen.getByText("will fail")).toBeInTheDocument();

    send.mockResolvedValue(msg({ text: "will fail" }));
    await userEvent.click(retry);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: /retry sending/i })).not.toBeInTheDocument());
  });

  it("rejects an oversized file before uploading it", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.c", name: "Alice", picture: null },
    });
    vi.spyOn(api, "getConnection").mockResolvedValue({ connection, messages: [] });
    const upload = vi.spyOn(api, "uploadMedia");
    renderPage();

    const input = (await screen.findAllByLabelText(/attach a file/i, { selector: "input" }))[0];
    // Must satisfy the input's accept list, otherwise userEvent drops it.
    // The size is stubbed so the test does not allocate 21MB of real bytes.
    const big = new File(["x"], "archive.zip", { type: "application/zip" });
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    await userEvent.upload(input, big);

    await waitFor(() => expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/limited to 20MB/i));
    expect(upload).not.toHaveBeenCalled();
  });

  it("asks for confirmation before disconnecting", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.c", name: "Alice", picture: null },
    });
    vi.spyOn(api, "getConnection").mockResolvedValue({ connection, messages: [msg()] });
    const disconnect = vi.spyOn(api, "disconnect");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());

    // Disconnect is offered in the side panel and in the header menu.
    await userEvent.click(screen.getAllByRole("button", { name: /^disconnect$/i })[0]);
    expect(confirmSpy).toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getAllByRole("button", { name: /^disconnect$/i })[0]);
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
  });

  it("returns to the pairing prompt after disconnecting", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.c", name: "Alice", picture: null },
    });
    vi.spyOn(api, "getConnection").mockResolvedValue({ connection, messages: [msg()] });
    vi.spyOn(api, "disconnect").mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());

    await userEvent.click(screen.getAllByRole("button", { name: /^disconnect$/i })[0]);
    await waitFor(() => expect(screen.getByText(/link a platform to start chatting/i)).toBeInTheDocument());
  });

  it("switches platform without confirmation and stages a fresh code", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.c", name: "Alice", picture: null },
    });
    vi.spyOn(api, "getConnection").mockResolvedValue({ connection, messages: [msg()] });
    const disconnect = vi.spyOn(api, "disconnect").mockResolvedValue(undefined);
    const generate = vi.spyOn(api, "generatePairCode").mockResolvedValue({
      code: "ZZ99-ZZ99",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    const confirmSpy = vi.spyOn(window, "confirm");
    renderPage();
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /switch platform/i }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getAllByText("ZZ99-ZZ99").length).toBeGreaterThan(0));
  });

  it("exposes the conversation as a live log", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.c", name: "Alice", picture: null },
    });
    vi.spyOn(api, "getConnection").mockResolvedValue({ connection, messages: [msg()] });
    renderPage();
    const log = await screen.findByRole("log", { name: /messages/i });
    expect(log).toHaveAttribute("aria-live", "polite");
  });
});
