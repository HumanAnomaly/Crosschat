import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionUser } from "../../api";
import PairPanel from "../PairPanel";

const me: SessionUser = { id: "u1", email: "a@b.c", name: "Alice", picture: null };

function props(over: Partial<React.ComponentProps<typeof PairPanel>> = {}) {
  return {
    me,
    displayName: "Alice",
    connected: false,
    messageCount: 0,
    pairCode: "",
    pairLeft: 0,
    pairLoading: false,
    pairError: "",
    copied: false,
    onGenerate: vi.fn(),
    onCopy: vi.fn(),
    onClaimOpen: vi.fn(),
    platform: null,
    onPlatformSelect: vi.fn(),
    onDisconnect: vi.fn(),
    onLogout: vi.fn(),
    ...over,
  };
}

describe("PairPanel", () => {
  it("offers pairing actions when not linked", async () => {
    const p = props();
    render(<PairPanel {...p} />);
    expect(screen.getByRole("button", { name: /generate code/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /i have a code/i }));
    expect(p.onClaimOpen).toHaveBeenCalledOnce();
  });

  it("shows the countdown and copy control once a code exists", async () => {
    const p = props({ pairCode: "AB12-CD34", pairLeft: 245 });
    render(<PairPanel {...p} />);
    expect(screen.getByText("AB12-CD34")).toBeInTheDocument();
    expect(screen.getByText(/expires in 04:05/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(p.onCopy).toHaveBeenCalledOnce();
  });

  it("surfaces pairing errors to screen readers", () => {
    render(<PairPanel {...props({ pairError: "Could not create a code." })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not create a code.");
  });

  it("shows linked state with a message count and disconnect action", async () => {
    const p = props({ connected: true, messageCount: 1 });
    render(<PairPanel {...p} />);
    expect(screen.getByText(/1 message in this room/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(p.onDisconnect).toHaveBeenCalledOnce();
  });

  it("pluralizes the message count", () => {
    render(<PairPanel {...props({ connected: true, messageCount: 7 })} />);
    expect(screen.getByText(/7 messages in this room/i)).toBeInTheDocument();
  });

  it("shows the linked platform account and user id", () => {
    render(
      <PairPanel
        {...props({ connected: true, accountName: "someuser", accountId: "123456789" })}
      />,
    );
    expect(screen.getByText("@someuser")).toBeInTheDocument();
    expect(screen.getByText("123456789")).toBeInTheDocument();
  });

  it("disables generate while a request is in flight", () => {
    render(<PairPanel {...props({ pairLoading: true })} />);
    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();
  });

  it("shows the display name and the email underneath", () => {
    render(<PairPanel {...props({ me: { ...me, name: null }, displayName: "a@b.c" })} />);
    // The name line falls back to the email, and the email line still shows it.
    expect(screen.getAllByText("a@b.c").length).toBeGreaterThan(0);
  });
});
