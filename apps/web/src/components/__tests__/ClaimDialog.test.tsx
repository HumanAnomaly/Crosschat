import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ClaimDialog from "../ClaimDialog";

type DialogProps = React.ComponentProps<typeof ClaimDialog>;
type Mock = ReturnType<typeof vi.fn>;

/** Overrides may arrive as mocks or plain functions; keep the mock type. */
function makeProps(over: Partial<DialogProps> = {}) {
  const setInput = vi.fn<(v: string) => void>();
  const onClose: Mock = vi.fn();
  const onSubmit: Mock = vi.fn();
  return {
    open: true,
    input: "",
    loading: false,
    error: "",
    setInput,
    onClose,
    onSubmit,
    ...over,
  } as DialogProps & {
    setInput: Mock & ((v: string) => void);
    onClose: Mock;
    onSubmit: Mock;
  };
}

describe("ClaimDialog", () => {
  it("opens as a modal dialog", () => {
    render(<ClaimDialog {...makeProps()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("stays closed when open is false", () => {
    const { container } = render(<ClaimDialog {...makeProps({ open: false })} />);
    const dialog = container.querySelector("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog?.open).toBe(false);
  });

  it("shows the expected code format", () => {
    render(<ClaimDialog {...makeProps()} />);
    expect(screen.getByPlaceholderText("AB12-CD34")).toBeInTheDocument();
    expect(screen.getByText(/valid for 5 minutes/i)).toBeInTheDocument();
  });

  it("never emits a lowercase character", async () => {
    const p = makeProps();
    render(<ClaimDialog {...p} />);
    await userEvent.type(screen.getByLabelText(/pairing code/i), "ab12cd34");
    const emitted = p.setInput.mock.calls.map((c) => c[0]);
    expect(emitted.length).toBeGreaterThan(0);
    for (const value of emitted) {
      expect(value).toBe(value.toUpperCase());
    }
    expect(emitted.join("")).toBe("AB12CD34");
  });

  it("submits the code", async () => {
    const p = makeProps({ input: "AB12-CD34" });
    render(<ClaimDialog {...p} />);
    await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));
    expect(p.onSubmit).toHaveBeenCalledOnce();
  });

  it("surfaces an error inside the dialog", () => {
    render(<ClaimDialog {...makeProps({ error: "That code is invalid or expired." })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("That code is invalid or expired.");
  });

  it("reflects the checking state and blocks double submits", () => {
    render(<ClaimDialog {...makeProps({ loading: true })} />);
    expect(screen.getByRole("button", { name: /checking/i })).toBeDisabled();
  });

  it("cancels without submitting", async () => {
    const p = makeProps();
    render(<ClaimDialog {...p} />);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(p.onClose).toHaveBeenCalledOnce();
    expect(p.onSubmit).not.toHaveBeenCalled();
  });
});
