import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@crosschat/core";
import DeleteMessageDialog from "../DeleteMessageDialog";

const base: ChatMessage = {
  id: "11111111-1111-1111-1111-111111111111",
  connectionId: "22222222-2222-2222-2222-222222222222",
  sender: "web",
  kind: "text",
  text: "hello to remove",
  createdAt: new Date().toISOString(),
};

describe("DeleteMessageDialog", () => {
  it("stays closed when no message is pending", () => {
    render(<DeleteMessageDialog message={null} deleting={false} onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole("dialog", { hidden: true })).not.toBeNull();
    const dlg = document.querySelector("dialog");
    expect(dlg?.open).toBe(false);
  });

  it("shows a preview and a confirm action for the pending message", () => {
    const onConfirm = vi.fn();
    render(<DeleteMessageDialog message={base} deleting={false} onClose={() => {}} onConfirm={onConfirm} />);
    expect(screen.getByText(/delete this message/i)).toBeInTheDocument();
    expect(screen.getByText("hello to remove")).toBeInTheDocument();
    screen.getByRole("button", { name: /^delete$/i }).click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("disables both actions while deleting", () => {
    render(<DeleteMessageDialog message={base} deleting onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole("button", { name: /deleting/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
  });
});
