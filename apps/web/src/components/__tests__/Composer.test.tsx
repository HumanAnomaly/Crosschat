import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Composer from "../Composer";

function props(over: Partial<React.ComponentProps<typeof Composer>> = {}) {
  return {
    draft: "",
    setDraft: vi.fn(),
    sending: false,
    uploading: false,
    onSend: vi.fn(),
    onFile: vi.fn(),
    ...over,
  };
}

describe("Composer", () => {
  it("blocks sending an empty draft", () => {
    render(<Composer {...props()} />);
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });

  it("enables send once there is text and submits on Enter", async () => {
    const p = props({ draft: "hello" });
    render(<Composer {...p} />);
    expect(screen.getByRole("button", { name: /send message/i })).toBeEnabled();
    await userEvent.type(screen.getByLabelText(/write a message/i), "{Enter}");
    expect(p.onSend).toHaveBeenCalledOnce();
  });

  it("reports typing to the parent so the draft stays controlled", async () => {
    const p = props();
    render(<Composer {...p} />);
    await userEvent.type(screen.getByLabelText(/write a message/i), "hi");
    expect(p.setDraft).toHaveBeenCalled();
  });

  it("enforces the shared message length cap", () => {
    render(<Composer {...props()} />);
    expect(screen.getByLabelText(/write a message/i)).toHaveAttribute("maxlength", "4000");
  });

  it("labels the file input and stays hidden", () => {
    render(<Composer {...props()} />);
    const input = screen.getByLabelText(/attach a file/i, { selector: "input" });
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveClass("hidden");
  });

  it("passes the picked file to the parent", async () => {
    const p = props();
    render(<Composer {...p} />);
    const file = new File(["data"], "photo.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/attach a file/i, { selector: "input" }), file);
    expect(p.onFile).toHaveBeenCalledWith(file);
  });

  it("disables the attach button during an upload or send", () => {
    const { rerender } = render(<Composer {...props({ uploading: true })} />);
    expect(screen.getByRole("button", { name: /attach a file/i })).toBeDisabled();
    rerender(<Composer {...props({ sending: true, draft: "x" })} />);
    expect(screen.getByRole("button", { name: /attach a file/i })).toBeDisabled();
  });

  it("states the size limit in the attach label", () => {
    render(<Composer {...props()} />);
    expect(screen.getByRole("button", { name: /max 20MB/i })).toBeInTheDocument();
  });

  it("shows the character counter only when close to the limit", () => {
    const { rerender } = render(<Composer {...props({ draft: "short" })} />);
    expect(screen.queryByText(/\/4000/)).toBeNull();
    rerender(<Composer {...props({ draft: "x".repeat(3600) })} />);
    expect(screen.getByText("3600/4000")).toBeInTheDocument();
  });
});
