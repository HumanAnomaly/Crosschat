import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@crosschat/core";
import { MessageBubble } from "../MessageBubble";

const base: ChatMessage = {
  id: "11111111-1111-1111-1111-111111111111",
  connectionId: "22222222-2222-2222-2222-222222222222",
  sender: "web",
  kind: "text",
  createdAt: new Date("2026-01-02T10:30:00Z").toISOString(),
};

describe("MessageBubble", () => {
  it("renders text and aligns own messages to the end", () => {
    const { container } = render(<MessageBubble m={{ ...base, text: "hello there" }} />);
    expect(screen.getByText("hello there")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("justify-end");
  });

  it("aligns telegram messages to the start", () => {
    const { container } = render(<MessageBubble m={{ ...base, sender: "telegram", text: "hi" }} />);
    expect(container.firstChild).toHaveClass("justify-start");
  });

  it("uses the /media/<id> contract for every media kind", () => {
    const cases: [ChatMessage["kind"], string][] = [
      ["photo", "img"],
      ["video", "video"],
      ["voice", "audio"],
      ["sticker", "img"],
    ];
    for (const [kind, tag] of cases) {
      const { container, unmount } = render(
        <MessageBubble m={{ ...base, kind, mediaPath: `/media/${base.id}` }} />,
      );
      const el = container.querySelector(tag);
      expect(el, `${kind} should render a <${tag}>`).toBeTruthy();
      expect(el?.getAttribute("src")).toBe(`/media/${base.id}`);
      unmount();
    }
  });

  it("renders a document as a safe external link", () => {
    render(<MessageBubble m={{ ...base, kind: "document", mediaPath: `/media/${base.id}` }} />);
    const link = screen.getByRole("link", { name: /open document/i });
    expect(link).toHaveAttribute("href", `/media/${base.id}`);
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("gives photos descriptive alt text when a caption exists", () => {
    render(<MessageBubble m={{ ...base, kind: "photo", text: "my cat", mediaPath: `/media/${base.id}` }} />);
    expect(screen.getByAltText(/my cat/)).toBeInTheDocument();
  });

  it("lazy-loads images so history does not fetch everything", () => {
    const { container } = render(<MessageBubble m={{ ...base, kind: "photo", mediaPath: `/media/${base.id}` }} />);
    expect(container.querySelector("img")).toHaveAttribute("loading", "lazy");
  });

  it("does not preload audio sources", () => {
    const { container } = render(<MessageBubble m={{ ...base, kind: "voice", mediaPath: `/media/${base.id}` }} />);
    expect(container.querySelector("audio")).toHaveAttribute("preload", "none");
  });

  it("shows an empty bubble for media without a path", () => {
    const { container } = render(<MessageBubble m={{ ...base, kind: "photo" }} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("has no inline delete button inside the bubble", () => {
    const { container } = render(<MessageBubble m={{ ...base, text: "hi" }} onDelete={() => {}} />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("opens the delete action on right-click for your own message", () => {
    const onDelete = vi.fn();
    const { container } = render(<MessageBubble m={{ ...base, text: "hi" }} onDelete={onDelete} />);
    const bubble = container.firstChild?.firstChild as Element;
    fireEvent.contextMenu(bubble);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("ignores right-click on the other side's message", () => {
    const onDelete = vi.fn();
    const { container } = render(
      <MessageBubble m={{ ...base, sender: "telegram", text: "hi" }} onDelete={onDelete} />,
    );
    const bubble = container.firstChild?.firstChild as Element;
    fireEvent.contextMenu(bubble);
    expect(onDelete).not.toHaveBeenCalled();
  });
});
