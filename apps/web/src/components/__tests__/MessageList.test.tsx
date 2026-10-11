import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@crosschat/core";
import MessageList from "../MessageList";

function msg(over: Partial<ChatMessage> & { id: string; createdAt: string }): ChatMessage {
  return {
    connectionId: "22222222-2222-2222-2222-222222222222",
    sender: "web",
    kind: "text",
    ...over,
  };
}

const today = new Date();
const yesterday = new Date(Date.now() - 86_400_000);
const iso = (d: Date, h = 10) => {
  const c = new Date(d);
  c.setHours(h, 0, 0, 0);
  return c.toISOString();
};

describe("MessageList", () => {
  it("shows an empty state instead of a blank panel", () => {
    render(<MessageList messages={[]} scrollRef={createRef<HTMLDivElement>()} onScroll={() => {}} />);
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });

  it("exposes the log role for assistive tech", () => {
    render(<MessageList messages={[]} scrollRef={createRef<HTMLDivElement>()} onScroll={() => {}} />);
    const log = screen.getByRole("log", { name: /messages/i });
    expect(log).toHaveAttribute("aria-live", "polite");
  });

  it("groups messages under Today and Yesterday headers", () => {
    const messages = [
      msg({ id: "a", createdAt: iso(today, 9), text: "morning" }),
      msg({ id: "b", createdAt: iso(today, 11), text: "later" }),
      msg({ id: "c", createdAt: iso(yesterday, 9), text: "older" }),
    ];
    render(<MessageList messages={messages} scrollRef={createRef<HTMLDivElement>()} onScroll={() => {}} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
    expect(screen.getByText("morning")).toBeInTheDocument();
    expect(screen.getByText("older")).toBeInTheDocument();
  });

  it("renders one separator per day, not per message", () => {
    const messages = [
      msg({ id: "a", createdAt: iso(today, 9) }),
      msg({ id: "b", createdAt: iso(today, 10) }),
      msg({ id: "c", createdAt: iso(today, 11) }),
    ];
    render(<MessageList messages={messages} scrollRef={createRef<HTMLDivElement>()} onScroll={() => {}} />);
    expect(screen.getAllByText("Today")).toHaveLength(1);
  });

  it("passes the scroll container ref through", () => {
    const ref = createRef<HTMLDivElement>();
    render(<MessageList messages={[]} scrollRef={ref} onScroll={() => {}} />);
    expect(ref.current).toBeInstanceOf(HTMLElement);
  });
});
